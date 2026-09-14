"""Cross-validated LightGBM classifier for sex-related versus isomorphic cell types."""

import json
from dataclasses import dataclass

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

from pipeline.common import FEATURES_PATH, LABELS_PATH, RESULTS, SCORES_PATH, SEED, TYPE_NODES_PATH
from pipeline.compute_features import CATEGORICAL_FEATURES, GRAPH_FEATURES
from pipeline.ground_truth import SEX_RELATED

N_FOLDS = 5
TOP_K = 100
PARAMS = {
    "objective": "binary",
    "n_estimators": 400,
    "learning_rate": 0.03,
    "num_leaves": 15,
    "min_child_samples": 20,
    "subsample": 0.8,
    "subsample_freq": 1,
    "colsample_bytree": 0.8,
    "reg_lambda": 1.0,
    "verbose": -1,
}


@dataclass
class CVResult:
    oof: np.ndarray
    fold: np.ndarray
    fold_auc_pr: list[float]
    models: list[lgb.LGBMClassifier]


def load_features() -> pd.DataFrame:
    features = pd.read_parquet(FEATURES_PATH).set_index("cell_type")
    for column in CATEGORICAL_FEATURES:
        features[column] = features[column].astype("category")
    return features


def feature_columns(features: pd.DataFrame, feature_set: str) -> list[str]:
    """Columns for ``full``, ``topology_only`` (graph-derived) or ``static_only`` (neuropil and NT)."""
    if feature_set == "full":
        return features.columns.tolist()
    if feature_set == "topology_only":
        return [c for c in features.columns if c in GRAPH_FEATURES]
    if feature_set == "static_only":
        return [c for c in features.columns if c not in GRAPH_FEATURES]
    raise ValueError(f"Unknown feature set: {feature_set}")


def training_set(features: pd.DataFrame, labels: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
    """Features and binary targets for types labelled sex-related or isomorphic."""
    label = labels.set_index("cell_type")["label"].reindex(features.index)
    if label.isna().any():
        raise ValueError(f"{int(label.isna().sum())} feature rows have no label")
    usable = label.isin(SEX_RELATED | {"isomorphic"})
    return features[usable], label[usable].isin(SEX_RELATED).to_numpy(dtype=int)


def fit(X: pd.DataFrame, y: np.ndarray, seed: int = SEED, n_jobs: int = 1) -> lgb.LGBMClassifier:
    """Fit the class-weighted model with fixed hyperparameters."""
    model = lgb.LGBMClassifier(
        **PARAMS, scale_pos_weight=(y == 0).sum() / (y == 1).sum(), random_state=seed, n_jobs=n_jobs
    )
    return model.fit(X, y)


def cross_validate(
    X: pd.DataFrame, y: np.ndarray, seed: int = SEED, n_jobs: int = 1, groups: np.ndarray | None = None
) -> CVResult:
    """Stratified k-fold cross-validation returning out-of-fold probabilities.

    When ``groups`` is given, folds keep every group intact (stratified group k-fold).
    """
    oof = np.zeros(len(y))
    fold = np.zeros(len(y), dtype=int)
    fold_auc_pr, models = [], []
    if groups is None:
        splits = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=seed).split(X, y)
    else:
        splits = StratifiedGroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=seed).split(X, y, groups)
    for k, (train, test) in enumerate(splits):
        model = fit(X.iloc[train], y[train], seed, n_jobs)
        oof[test] = model.predict_proba(X.iloc[test])[:, 1]
        fold[test] = k
        fold_auc_pr.append(float(average_precision_score(y[test], oof[test])))
        models.append(model)
    return CVResult(oof, fold, fold_auc_pr, models)


def summarise(y: np.ndarray, oof: np.ndarray) -> dict:
    """AUC-PR, ROC AUC, prevalence baseline, and precision among the top-k ranked types."""
    top = np.argsort(-oof, kind="stable")[:TOP_K]
    return {
        "auc_pr": float(average_precision_score(y, oof)),
        "baseline_auc_pr": float(y.mean()),
        "roc_auc": float(roc_auc_score(y, oof)),
        f"precision_at_{TOP_K}": float(y[top].mean()),
    }


def lineage_groups(cell_types: pd.Index) -> np.ndarray:
    """Hemilineage of each type; types without one form their own group."""
    lineage = pd.read_parquet(TYPE_NODES_PATH).set_index("cell_type")["hemilineage"].reindex(cell_types)
    return np.where(lineage.isin(["unknown"]) | lineage.isna(), cell_types, lineage)


def main() -> None:
    features = load_features()
    labels = pd.read_parquet(LABELS_PATH)
    X, y = training_set(features, labels)
    cv = cross_validate(X, y)
    metrics = summarise(y, cv.oof)

    label_of = labels.set_index("cell_type")["label"].reindex(X.index)
    per_class = {}
    for cls in sorted(SEX_RELATED):
        mask = label_of.isin([cls, "isomorphic"]).to_numpy()
        per_class[cls] = {
            "n_positive": int((label_of == cls).sum()),
            "auc_pr": float(average_precision_score(y[mask], cv.oof[mask])),
            "baseline_auc_pr": float(y[mask].mean()),
        }

    feature_sets = {"full": {"n_features": X.shape[1], **summarise(y, cv.oof)}}
    for name in ("topology_only", "static_only"):
        columns = feature_columns(X, name)
        feature_sets[name] = {"n_features": len(columns), **summarise(y, cross_validate(X[columns], y).oof)}

    groups = lineage_groups(X.index)
    grouped = cross_validate(X, y, groups=groups)
    lineage_cv = {"n_groups": int(len(np.unique(groups))), **summarise(y, grouped.oof), "fold_auc_pr": grouped.fold_auc_pr}

    final = fit(X, y)
    booster = final.booster_
    importance = pd.Series(booster.feature_importance("gain"), index=booster.feature_name()).sort_values(ascending=False)
    metrics.update(
        {
            "n_types": int(len(y)),
            "n_sex_related": int(y.sum()),
            "n_isomorphic": int((y == 0).sum()),
            "n_folds": N_FOLDS,
            "fold_auc_pr": cv.fold_auc_pr,
            "per_class": per_class,
            "feature_sets": feature_sets,
            "hemilineage_grouped_cv": lineage_cv,
            "params": PARAMS,
            "seed": SEED,
            "top_features_by_gain": {k: round(float(v), 1) for k, v in importance.head(15).items()},
        }
    )
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "classifier_metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    booster.save_model(str(RESULTS / "classifier_model.txt"))

    scores = labels.set_index("cell_type").reindex(features.index)[["label"]]
    scores["oof_probability"] = pd.Series(cv.oof, index=X.index)
    scores["fold"] = pd.Series(cv.fold, index=X.index)
    scores["model_probability"] = final.predict_proba(features)[:, 1]
    scores.reset_index().to_parquet(SCORES_PATH, index=False)

    ranked = scores.sort_values("oof_probability", ascending=False)
    lines = [
        "# Classifier performance",
        "",
        f"LightGBM, {N_FOLDS}-fold stratified cross-validation over {len(y)} cell types "
        f"({int(y.sum())} sex-related, {int((y == 0).sum())} isomorphic). All scores below are out-of-fold.",
        "",
        "| metric | value | baseline |",
        "|---|---|---|",
        f"| AUC-PR | {metrics['auc_pr']:.3f} | {metrics['baseline_auc_pr']:.3f} |",
        f"| ROC AUC | {metrics['roc_auc']:.3f} | 0.500 |",
        f"| Precision@{TOP_K} | {metrics[f'precision_at_{TOP_K}']:.2f} | {metrics['baseline_auc_pr']:.3f} |",
        "",
        "Per-fold AUC-PR: " + ", ".join(f"{v:.3f}" for v in cv.fold_auc_pr),
        "",
        "## By class",
        "",
        "Each sex-related class scored against isomorphic types only, using the same out-of-fold probabilities.",
        "",
        "| class | types | AUC-PR | baseline |",
        "|---|---|---|---|",
    ]
    lines += [f"| {c} | {v['n_positive']} | {v['auc_pr']:.3f} | {v['baseline_auc_pr']:.3f} |" for c, v in per_class.items()]
    lines += [
        "",
        "## Feature groups",
        "",
        "Topology features are recomputed from the graph (degree, strength, PageRank, betweenness, community, hop "
        "distances). Static features are type attributes: predicted neurotransmitter and the share of output "
        "synapses in each neuropil.",
        "",
        "| features | count | AUC-PR | ROC AUC | Precision@100 |",
        "|---|---|---|---|---|",
    ]
    lines += [
        f"| {name.replace('_', ' ')} | {v['n_features']} | {v['auc_pr']:.3f} | {v['roc_auc']:.3f} | {v[f'precision_at_{TOP_K}']:.2f} |"
        for name, v in feature_sets.items()
    ]
    lines += [
        "",
        "## Hemilineage-grouped cross-validation",
        "",
        "Related types often share a developmental hemilineage and similar wiring. Keeping each hemilineage within a "
        f"single fold ({lineage_cv['n_groups']} groups; types without a hemilineage annotation are their own group) "
        f"gives AUC-PR {lineage_cv['auc_pr']:.3f} (ROC AUC {lineage_cv['roc_auc']:.3f}), against "
        f"{metrics['auc_pr']:.3f} with type-level folds.",
        "",
        "## Top 20 types by out-of-fold probability",
        "",
        "| rank | cell type | probability | Janelia label |",
        "|---|---|---|---|",
    ]
    lines += [
        f"| {i + 1} | {t} | {row.oof_probability:.3f} | {row.label} |"
        for i, (t, row) in enumerate(ranked.head(20).iterrows())
    ]
    (RESULTS / "classifier_metrics.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
