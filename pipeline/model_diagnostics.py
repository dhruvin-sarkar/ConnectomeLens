"""Classifier diagnostics and descriptive breakdowns of the type graph, written for the report and the site."""

import json

import numpy as np
import pandas as pd
import shap
from scipy.stats import mannwhitneyu, spearmanr
from sklearn.metrics import average_precision_score, brier_score_loss

from pipeline.build_type_graph import load_type_graph
from pipeline.common import (
    DATA,
    LABELS_PATH,
    NAMED_TYPES,
    NEURON_ROI_PATH,
    NEURONS_PATH,
    RESULTS,
    SCORES_PATH,
    SEED,
    TYPE_NODES_PATH,
)
from pipeline.compute_features import CATEGORICAL_FEATURES, GRAPH_FEATURES
from pipeline.ground_truth import SEX_RELATED
from pipeline.null_model import SCORES_CSV
from pipeline.render_hero import neuropil_scores
from pipeline.train_classifier import (
    cross_validate,
    feature_columns,
    lineage_groups,
    load_features,
    summarize,
    training_set,
)

SHAP_PATH = DATA / "shap_values.parquet"
DIAGNOSTICS_PATH = RESULTS / "model_diagnostics.json"
LABEL_ORDER = ("male_specific", "dimorphic", "isomorphic")
CURVE_POINTS = 400
CALIBRATION_BINS = 10
HISTOGRAM_BINS = 50
TOP_FRACTIONS = (0.01, 0.05, 0.10)
BEESWARM_FEATURES = 12
BEESWARM_ISOMORPHIC = 1000
# Neuropils with fewer synapses than this are left out of the map-versus-annotation correlation.
MIN_NEUROPIL_SYNAPSES = 10_000
NUMERIC_TOPOLOGY = [f for f in GRAPH_FEATURES if f not in CATEGORICAL_FEATURES]
COUNT_FEATURES = {"hops_from_sensory", "hops_to_motor"}


def exploratory_sets(columns: list[str]) -> dict[str, list[str]]:
    """Feature subsets beyond the pre-specified ones, used only to describe where the signal sits."""
    neuropil = [c for c in columns if c.startswith("out_frac_")]
    topology = [c for c in columns if c in GRAPH_FEATURES]
    return {
        "neuropil_only": neuropil,
        "transmitter_only": ["nt"],
        "community_only": ["community"],
        "topology_without_community": [c for c in topology if c != "community"],
        "topology_and_transmitter": topology + ["nt"],
        "full_without_community": [c for c in columns if c != "community"],
    }


def rounded(values, digits: int = 5) -> list:
    return [round(float(v), digits) for v in values]


def ranking_curve(y: np.ndarray, score: np.ndarray, n_points: int = CURVE_POINTS) -> dict:
    """Precision, recall and false-positive rate when the ``k`` highest-scoring types are flagged, on a log-spaced grid of ``k``."""
    n, positives = len(y), int(y.sum())
    order = np.argsort(-score, kind="stable")
    hits = np.cumsum(y[order])
    grid = np.unique(
        np.concatenate([np.geomspace(1, n, n_points), np.linspace(1, n, n_points // 4)]).round().astype(int)
    )
    tp = hits[grid - 1]
    return {
        "auc_pr": float(average_precision_score(y, score)),
        "k": grid.tolist(),
        "threshold": rounded(score[order][grid - 1]),
        "tp": tp.tolist(),
        "precision": rounded(tp / grid),
        "recall": rounded(tp / positives),
        "fpr": rounded((grid - tp) / (n - positives)),
    }


def calibration(y: np.ndarray, p: np.ndarray, n_bins: int = CALIBRATION_BINS) -> dict:
    """Observed sex-related rate in equal-count bins of predicted probability, with the Brier score."""
    bins = pd.qcut(p, n_bins, labels=False, duplicates="drop")
    table = pd.DataFrame({"p": p, "y": y, "bin": bins}).groupby("bin").agg(
        mean_probability=("p", "mean"), observed_rate=("y", "mean"), n=("y", "size"), low=("p", "min"), high=("p", "max")
    )
    return {
        "bins": [{k: (int(v) if k == "n" else round(float(v), 5)) for k, v in row.items()} for _, row in table.iterrows()],
        "brier": float(brier_score_loss(y, p)),
        "brier_prevalence_only": float(brier_score_loss(y, np.full(len(y), y.mean()))),
        "mean_probability": float(p.mean()),
        "prevalence": float(y.mean()),
    }


def score_histograms(p: np.ndarray, labels: np.ndarray, n_bins: int = HISTOGRAM_BINS) -> dict:
    """Counts of out-of-fold probabilities per label on equal-width bins over [0, 1]."""
    edges = np.linspace(0, 1, n_bins + 1)
    return {"edges": rounded(edges, 3), **{label: np.histogram(p[labels == label], edges)[0].tolist() for label in LABEL_ORDER}}


def top_fraction_capture(y: np.ndarray, p: np.ndarray) -> list[dict]:
    """How many sex-related types sit in the top 1%, 5% and 10% of the ranking."""
    order = np.argsort(-p, kind="stable")
    rows = []
    for fraction in TOP_FRACTIONS:
        k = int(round(fraction * len(y)))
        found = int(y[order[:k]].sum())
        rows.append({"fraction": fraction, "k": k, "sex_related": found, "recall": found / int(y.sum()), "precision": found / k})
    return rows


def oof_shap(X: pd.DataFrame, cv) -> tuple[pd.DataFrame, list[float]]:
    """SHAP values in log-odds for every type, each from the fold model that scored it, and each fold's base value."""
    parts, base_values = [], []
    for k, model in enumerate(cv.models):
        members = X.index[cv.fold == k]
        explainer = shap.TreeExplainer(model)
        parts.append(pd.DataFrame(explainer.shap_values(X.loc[members]), index=members, columns=X.columns))
        base_values.append(float(np.atleast_1d(explainer.expected_value)[-1]))
    return pd.concat(parts).loc[X.index], base_values


def feature_group(name: str) -> str:
    if name in GRAPH_FEATURES:
        return "topology"
    return "transmitter" if name == "nt" else "neuropil"


def attribution_summary(values: pd.DataFrame, y: np.ndarray) -> dict:
    """Mean absolute SHAP per feature (all features, most important first) and per feature group, with mean signed SHAP within each class."""
    importance = values.abs().mean().sort_values(ascending=False)
    groups = importance.groupby(importance.index.map(feature_group)).sum()
    positive, negative = values[y == 1].mean(), values[y == 0].mean()
    return {
        "groups": {g: {"mean_abs_shap": float(v), "share": float(v / groups.sum())} for g, v in groups.items()},
        "features": [
            {
                "feature": f,
                "group": feature_group(f),
                "mean_abs_shap": round(float(importance[f]), 5),
                "mean_shap_sex_related": round(float(positive[f]), 5),
                "mean_shap_isomorphic": round(float(negative[f]), 5),
            }
            for f in importance.index
        ],
    }


def beeswarm(values: pd.DataFrame, X: pd.DataFrame, labels: pd.Series, features: list[str], rng: np.random.Generator) -> dict:
    """Per-type SHAP values for a sample of types: every sex-related type plus a random draw of isomorphic ones.

    Numeric feature values are given as percentile ranks over all types. For categorical features the value is 1
    for the category with the highest mean SHAP and 0 otherwise.
    """
    sex_related = labels.index[labels.isin(SEX_RELATED)]
    isomorphic = labels.index[labels == "isomorphic"]
    sample = list(sex_related) + list(rng.choice(isomorphic, size=BEESWARM_ISOMORPHIC, replace=False))
    panels = []
    for f in features:
        if f in CATEGORICAL_FEATURES:
            top = values[f].groupby(X[f].astype(str), observed=True).mean().idxmax()
            value = (X.loc[sample, f].astype(str) == top).astype(float)
            panel = {"feature": f, "kind": "categorical", "highlight": top}
        else:
            value = X[f].rank(pct=True).loc[sample]
            panel = {"feature": f, "kind": "numeric"}
        panel.update({"shap": rounded(values.loc[sample, f], 3), "value": rounded(value, 3)})
        panels.append(panel)
    return {
        "types": sample,
        "label": [LABEL_ORDER.index(labels[t]) for t in sample],
        "labels": list(LABEL_ORDER),
        "panels": panels,
    }


def superclass_breakdown(frame: pd.DataFrame, y: np.ndarray) -> list[dict]:
    """Per superclass: label counts, mean probability and, where both classes have at least ten types, AUC-PR."""
    rows = []
    for superclass, group in frame.groupby("superclass"):
        mask = frame.index.isin(group.index)
        n_pos, n_neg = int(y[mask].sum()), int((1 - y[mask]).sum())
        rows.append(
            {
                "superclass": superclass,
                "n_types": len(group),
                **{label: int((group["label"] == label).sum()) for label in LABEL_ORDER},
                "mean_probability": float(group["p"].mean()),
                "auc_pr": float(average_precision_score(y[mask], group["p"])) if n_pos >= 10 and n_neg >= 10 else None,
                "baseline_auc_pr": n_pos / len(group),
            }
        )
    return sorted(rows, key=lambda r: -r["n_types"])


def community_breakdown(frame: pd.DataFrame, X: pd.DataFrame, graph) -> dict:
    """Composition of each Leiden community and the synapses exchanged between communities on the kept edges."""
    neuropil = [c for c in X.columns if c.startswith("out_frac_")]
    order = sorted(frame["community"].unique(), key=lambda c: (c < 0, c))
    rows = []
    for community in order:
        group = frame[frame["community"] == community]
        shares = X.loc[group.index, neuropil].mean().sort_values(ascending=False).head(3)
        ranked = group.sort_values("p", ascending=False).head(5)
        rows.append(
            {
                "community": int(community),
                "n_types": len(group),
                **{label: int((group["label"] == label).sum()) for label in LABEL_ORDER},
                "mean_probability": float(group["p"].mean()),
                "top_neuropils": [[c.removeprefix("out_frac_"), round(float(s), 4)] for c, s in shares.items()],
                "top_superclasses": [[s, int(n)] for s, n in group["superclass"].value_counts().head(3).items()],
                "top_types": [[t, round(float(r.p), 4), r.label] for t, r in ranked.iterrows()],
            }
        )
    community_of = frame["community"].reindex(graph.vs["name"]).to_numpy()
    edges = np.asarray(graph.get_edgelist())
    index = {c: i for i, c in enumerate(order)}
    flow = np.zeros((len(order), len(order)), dtype=np.int64)
    np.add.at(
        flow,
        (np.vectorize(index.get)(community_of[edges[:, 0]]), np.vectorize(index.get)(community_of[edges[:, 1]])),
        np.asarray(graph.es["weight"], dtype=np.int64),
    )
    return {"communities": rows, "order": [int(c) for c in order], "synapse_flow": flow.tolist()}


def topology_by_label(frame: pd.DataFrame, X: pd.DataFrame) -> list[dict]:
    """Distribution of each numeric topology feature per label, with a rank test of sex-related against isomorphic."""
    rows = []
    sex_related = frame["label"].isin(SEX_RELATED)
    for f in NUMERIC_TOPOLOGY:
        values = X[f].astype(float)
        if f in COUNT_FEATURES:
            edges = np.arange(values.min(), values.max() + 2) - 0.5
            scale = "count"
        else:
            transformed = np.log10(values + 1) if f != "pagerank" else np.log10(values)
            edges = np.linspace(transformed.min(), transformed.max(), 31)
            scale = "log10" if f == "pagerank" else "log10(1+x)"
            values = transformed
        test = mannwhitneyu(X.loc[sex_related, f], X.loc[~sex_related, f], alternative="two-sided")
        n1, n2 = int(sex_related.sum()), int((~sex_related).sum())
        rows.append(
            {
                "feature": f,
                "scale": scale,
                "edges": rounded(edges, 4),
                "histograms": {label: np.histogram(values[frame["label"] == label], edges)[0].tolist() for label in LABEL_ORDER},
                "quantiles": {
                    label: rounded(X.loc[frame["label"] == label, f].quantile([0.05, 0.25, 0.5, 0.75, 0.95]), 6)
                    for label in LABEL_ORDER
                },
                "probability_sex_related_higher": float(test.statistic / (n1 * n2)),
                "mann_whitney_p": float(test.pvalue),
            }
        )
    return rows


def neuropil_agreement(scores: pd.DataFrame, labels: pd.Series) -> dict:
    """Model score per neuropil beside the share of its synapses made by types annotated sex-related."""
    roi_counts, neurons = pd.read_parquet(NEURON_ROI_PATH), pd.read_parquet(NEURONS_PATH)
    region = neuropil_scores(roi_counts, neurons, scores.reset_index()).set_index("neuropil")
    region = region[region["synapses"] > 0]
    merged = roi_counts.merge(neurons[["bodyId", "type"]], on="bodyId")
    merged["synapses"] = merged["pre"] + merged["post"]
    merged["annotated"] = merged["synapses"] * merged["type"].map(labels).isin(SEX_RELATED)
    totals = merged.groupby("roi")[["annotated", "synapses"]].sum()
    region["annotated_share"] = totals["annotated"] / totals["synapses"]
    kept = region[region["synapses"] >= MIN_NEUROPIL_SYNAPSES]
    rho, p_value = spearmanr(kept["score"], kept["annotated_share"])
    return {
        "spearman_rho": float(rho),
        "spearman_p": float(p_value),
        "n_neuropils": int(len(kept)),
        "min_synapses": MIN_NEUROPIL_SYNAPSES,
        "neuropils": [
            {"neuropil": n, "score": round(float(r.score), 5), "annotated_share": round(float(r.annotated_share), 5), "synapses": int(r.synapses)}
            for n, r in region.iterrows()
        ],
    }


def named_type_ranks(scores: pd.DataFrame) -> list[dict]:
    ranked = scores.sort_values("oof_probability", ascending=False)
    position = pd.Series(np.arange(1, len(ranked) + 1), index=ranked.index)
    return [
        {"cell_type": t, "rank": int(position[t]), "probability": float(scores.at[t, "oof_probability"]), "label": scores.at[t, "label"]}
        for t in NAMED_TYPES
    ]


def markdown(d: dict) -> str:
    """Human-readable summary of the diagnostics."""
    sets, cal = d["feature_sets"], d["calibration"]
    lines = [
        "# Model diagnostics",
        "",
        "Descriptive analyses of the out-of-fold predictions in `data/scores.parquet`. The pre-specified results are in "
        "`classifier_metrics.md` and `null_model_validation.md`; nothing here changed the model, its features or its "
        "hyperparameters. Feature subsets marked exploratory were evaluated after the null-model results were known and "
        "only describe where the signal sits.",
        "",
        "## Ranking",
        "",
        "| flagged | types | sex-related among them | precision | share of all sex-related types |",
        "|---|---|---|---|---|",
    ]
    lines += [
        f"| top {r['fraction']:.0%} | {r['k']} | {r['sex_related']} | {r['precision']:.2f} | {r['recall']:.2f} |"
        for r in d["top_fraction_capture"]
    ]
    lines += [
        "",
        "## Calibration",
        "",
        "The model weights the positive class by the class ratio, so its probabilities rank types but overstate the "
        f"chance that a type is sex-related: the mean predicted probability is {cal['mean_probability']:.3f} against a "
        f"prevalence of {cal['prevalence']:.3f}. Brier score {cal['brier']:.4f} (predicting the prevalence for every "
        f"type gives {cal['brier_prevalence_only']:.4f}).",
        "",
        "| probability range | types | mean probability | observed sex-related rate |",
        "|---|---|---|---|",
    ]
    lines += [f"| {b['low']:.3f}–{b['high']:.3f} | {b['n']} | {b['mean_probability']:.3f} | {b['observed_rate']:.3f} |" for b in cal["bins"]]
    groups = d["attribution"]["groups"]
    lines += [
        "",
        "## Feature attributions",
        "",
        "Mean absolute SHAP value (log-odds) over all 11,751 types, each type explained by the fold model that scored it. "
        "Share of the total by feature group: "
        + ", ".join(f"{g} {v['share']:.0%}" for g, v in sorted(groups.items(), key=lambda kv: -kv[1]["share"]))
        + ".",
        "",
        "| feature | group | mean abs SHAP | mean SHAP, sex-related | mean SHAP, isomorphic |",
        "|---|---|---|---|---|",
    ]
    lines += [
        f"| {f['feature']} | {f['group']} | {f['mean_abs_shap']:.3f} | {f['mean_shap_sex_related']:+.3f} | {f['mean_shap_isomorphic']:+.3f} |"
        for f in d["attribution"]["features"][:15]
    ]
    lines += [
        "",
        "## Feature subsets",
        "",
        "| features | count | AUC-PR | ROC AUC | precision in top 100 | status |",
        "|---|---|---|---|---|---|",
    ]
    lines += [
        f"| {name.replace('_', ' ')} | {v['n_features']} | {v['auc_pr']:.3f} | {v['roc_auc']:.3f} | {v['precision_at_100']:.2f} | "
        f"{'exploratory' if v['exploratory'] else 'pre-specified'} |"
        for name, v in sets.items()
    ]
    lines += [
        "",
        "## Leiden communities",
        "",
        "| community | types | male-specific | dimorphic | mean probability | main output neuropils |",
        "|---|---|---|---|---|---|",
    ]
    lines += [
        f"| {'pooled' if c['community'] < 0 else c['community']} | {c['n_types']} | {c['male_specific']} | {c['dimorphic']} | "
        f"{c['mean_probability']:.3f} | {', '.join(n for n, _ in c['top_neuropils'])} |"
        for c in d["communities"]["communities"]
    ]
    lines += [
        "",
        "## Superclasses",
        "",
        "| superclass | types | male-specific | dimorphic | mean probability | AUC-PR (baseline) |",
        "|---|---|---|---|---|---|",
    ]
    lines += [
        f"| {s['superclass']} | {s['n_types']} | {s['male_specific']} | {s['dimorphic']} | {s['mean_probability']:.3f} | "
        + (f"{s['auc_pr']:.3f} ({s['baseline_auc_pr']:.3f})" if s["auc_pr"] is not None else "too few types")
        + " |"
        for s in d["superclasses"]
    ]
    lines += [
        "",
        "## Topology by label",
        "",
        "Medians per label. The last columns give the probability that a random sex-related type has the larger value "
        "than a random isomorphic type (0.5 means no difference) and the two-sided Mann-Whitney p-value.",
        "",
        "| feature | male-specific | dimorphic | isomorphic | P(sex-related higher) | p |",
        "|---|---|---|---|---|---|",
    ]
    lines += [
        f"| {t['feature']} | {t['quantiles']['male_specific'][2]:.4g} | {t['quantiles']['dimorphic'][2]:.4g} | "
        f"{t['quantiles']['isomorphic'][2]:.4g} | {t['probability_sex_related_higher']:.2f} | {t['mann_whitney_p']:.2g} |"
        for t in d["topology_by_label"]
    ]
    agreement = d["neuropil_agreement"]
    lines += [
        "",
        "## Neuropil map against the annotations",
        "",
        f"Across the {agreement['n_neuropils']} neuropils with at least {agreement['min_synapses']:,} synapses, the "
        "synapse-weighted mean probability correlates with the share of synapses made by annotated sex-related types "
        f"(Spearman rho = {agreement['spearman_rho']:.2f}, p = {agreement['spearman_p']:.2g}). The two maps are not "
        "independent: the probabilities were trained on the same annotations, out of fold.",
        "",
        "## Transmitters",
        "",
        "| predicted transmitter | male-specific | dimorphic | isomorphic |",
        "|---|---|---|---|",
    ]
    lines += [
        f"| {nt} | {row['male_specific']} | {row['dimorphic']} | {row['isomorphic']} |" for nt, row in d["transmitters"].items()
    ]
    lines += ["", "## Named types", "", "| cell type | rank | probability | label |", "|---|---|---|---|"]
    lines += [f"| {r['cell_type']} | {r['rank']} | {r['probability']:.3f} | {r['label']} |" for r in d["named_types"]]
    return "\n".join(lines) + "\n"


def main() -> None:
    features = load_features()
    labels = pd.read_parquet(LABELS_PATH)
    scores = pd.read_parquet(SCORES_PATH).set_index("cell_type")
    metrics = json.loads((RESULTS / "classifier_metrics.json").read_text(encoding="utf-8"))
    X, y = training_set(features, labels)
    label_of = labels.set_index("cell_type")["label"].reindex(X.index)

    cv = cross_validate(X, y)
    if not np.allclose(cv.oof, scores.loc[X.index, "oof_probability"]):
        raise RuntimeError("Re-run cross-validation does not reproduce the stored out-of-fold probabilities")
    oof = {"full": cv.oof}
    sets = {"full": {"n_features": X.shape[1], **summarize(y, cv.oof), "exploratory": False}}
    for name in ("topology_only", "static_only"):
        columns = feature_columns(X, name)
        oof[name] = cross_validate(X[columns], y).oof
        sets[name] = {"n_features": len(columns), **summarize(y, oof[name]), "exploratory": False}
        if not np.isclose(sets[name]["auc_pr"], metrics["feature_sets"][name]["auc_pr"]):
            raise RuntimeError(f"Re-run {name} AUC-PR differs from classifier_metrics.json")
    for name, columns in exploratory_sets(X.columns.tolist()).items():
        sets[name] = {"n_features": len(columns), **summarize(y, cross_validate(X[columns], y).oof), "exploratory": True}
        print(f"{name}: AUC-PR {sets[name]['auc_pr']:.3f}")
    oof["hemilineage_grouped"] = cross_validate(X, y, groups=lineage_groups(X.index)).oof
    if not np.isclose(average_precision_score(y, oof["hemilineage_grouped"]), metrics["hemilineage_grouped_cv"]["auc_pr"]):
        raise RuntimeError("Re-run hemilineage-grouped AUC-PR differs from classifier_metrics.json")

    curves = {name: ranking_curve(y, p) for name, p in oof.items()}
    for cls in ("male_specific", "dimorphic"):
        mask = label_of.isin([cls, "isomorphic"]).to_numpy()
        curves[f"{cls}_vs_isomorphic"] = ranking_curve(y[mask], cv.oof[mask])

    values, base_values = oof_shap(X, cv)
    values.reset_index().to_parquet(SHAP_PATH, index=False)
    attribution = attribution_summary(values, y)
    attribution["base_values"] = base_values
    swarm_features = [f["feature"] for f in attribution["features"][:BEESWARM_FEATURES]]

    nodes = pd.read_parquet(TYPE_NODES_PATH).set_index("cell_type")
    frame = pd.DataFrame(
        {
            "label": label_of,
            "p": cv.oof,
            "superclass": nodes["superclass"].reindex(X.index).fillna("unknown"),
            "community": X["community"].astype(int),
        },
        index=X.index,
    )
    transmitters = pd.crosstab(X["nt"].astype(str), label_of).reindex(columns=list(LABEL_ORDER), fill_value=0)
    null = pd.read_csv(SCORES_CSV)
    diagnostics = {
        "n_types": int(len(y)),
        "curves": curves,
        "calibration": calibration(y, cv.oof),
        "histograms": score_histograms(cv.oof, label_of.to_numpy()),
        "top_fraction_capture": top_fraction_capture(y, cv.oof),
        "feature_sets": sets,
        "attribution": attribution,
        "beeswarm": beeswarm(values, X, label_of, swarm_features, np.random.default_rng(SEED)),
        "superclasses": superclass_breakdown(frame, y),
        "communities": community_breakdown(frame, X, load_type_graph()),
        "transmitters": {
            nt: {k: int(v) for k, v in row.items()}
            for nt, row in transmitters.sort_values("isomorphic", ascending=False).iterrows()
        },
        "topology_by_label": topology_by_label(frame, X),
        "neuropil_agreement": neuropil_agreement(scores, labels.set_index("cell_type")["label"]),
        "named_types": named_type_ranks(scores),
        "null_scores": {"full": rounded(null["auc_pr_full"]), "topology_only": rounded(null["auc_pr_topology_only"])},
        "fold_auc_pr": {
            "stratified": metrics["fold_auc_pr"],
            "hemilineage_grouped": metrics["hemilineage_grouped_cv"]["fold_auc_pr"],
        },
    }
    DIAGNOSTICS_PATH.write_text(json.dumps(diagnostics, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    text = markdown(diagnostics)
    (RESULTS / "model_diagnostics.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
