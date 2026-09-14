"""Isomorphic-labeled types whose wiring the classifier ranks alongside sex-related types."""

import json

import numpy as np
import pandas as pd
import shap
from scipy.stats import fisher_exact

from pipeline.build_type_graph import load_type_graph
from pipeline.common import DATA, LABELS_PATH, NEURONS_PATH, RESULTS, SCORES_PATH
from pipeline.ground_truth import SEX_RELATED
from pipeline.train_classifier import cross_validate, load_features, training_set

TOP_FRACTION = 0.01
N_REASONS = 3
HEDGE = "Candidate for further investigation: wiring resembles sex-related types; correlational, not evidence of dimorphism."
CANDIDATES_PATH = DATA / "candidates.parquet"


def describe_feature(name: str, value) -> str:
    """Plain-language description of one feature value."""
    if name.startswith("out_frac_"):
        return f"{value:.0%} of output synapses in {name.removeprefix('out_frac_')}"
    descriptions = {
        "in_degree": f"{int(value)} strong input partner types",
        "out_degree": f"{int(value)} strong output partner types",
        "in_strength": f"{int(value):,} synapses received on strong connections",
        "out_strength": f"{int(value):,} synapses sent on strong connections",
        "pagerank": f"PageRank {value:.2e}",
        "betweenness": f"betweenness centrality {value:,.0f}",
        "community": f"member of wiring community {value}",
        "hops_from_sensory": f"{int(value)} hops downstream of the nearest sensory type",
        "hops_to_motor": f"{int(value)} hops upstream of the nearest descending or motor type",
        "nt": f"predicted neurotransmitter {value}",
    }
    return descriptions[name]


def top_reasons(contributions: pd.Series, values: pd.Series, n: int = N_REASONS) -> list[str]:
    """Descriptions of the ``n`` features pushing the prediction most strongly towards sex-related."""
    positive = contributions[contributions > 0].sort_values(ascending=False).head(n)
    return [describe_feature(name, values[name]) for name in positive.index]


def fru_dsx_summary(neurons: pd.DataFrame) -> pd.Series:
    """Per type: the most common fru/dsx annotation and how many neurons carry any annotation."""

    def summarize(group: pd.DataFrame) -> str:
        annotated = group["fruDsx"].dropna()
        if annotated.empty:
            return "none"
        return f"{annotated.mode().sort_values().iloc[0]} ({len(annotated)}/{len(group)} neurons)"

    return neurons.groupby("type")[["fruDsx"]].apply(summarize)


def sex_related_partner_share(graph, labels: pd.Series) -> pd.Series:
    """Fraction of each type's strong input and output partners that are labeled sex-related."""
    sex_related = np.asarray(labels.reindex(graph.vs["name"]).isin(SEX_RELATED))
    shares = []
    for v in range(graph.vcount()):
        partners = set(graph.neighbors(v, mode="all"))
        shares.append(sex_related[list(partners)].mean() if partners else 0.0)
    return pd.Series(shares, index=graph.vs["name"])


def main() -> None:
    null_summary = json.loads((RESULTS / "null_model_summary.json").read_text(encoding="utf-8"))
    if not null_summary["full"]["significant"]:
        raise SystemExit("The classifier did not beat the degree-preserving null model; candidates are not reported.")

    features = load_features()
    labels = pd.read_parquet(LABELS_PATH)
    scores = pd.read_parquet(SCORES_PATH).set_index("cell_type")
    X, y = training_set(features, labels)
    cv = cross_validate(X, y)
    if not np.allclose(cv.oof, scores.loc[X.index, "oof_probability"]):
        raise RuntimeError("Re-run cross-validation does not reproduce the stored out-of-fold probabilities")

    threshold = scores["oof_probability"].quantile(1 - TOP_FRACTION)
    selected = scores[(scores["label"] == "isomorphic") & (scores["oof_probability"] >= threshold)]
    selected = selected.sort_values("oof_probability", ascending=False)

    reasons = {}
    for fold, members in selected.groupby("fold"):
        explainer = shap.TreeExplainer(cv.models[int(fold)])
        values = explainer.shap_values(X.loc[members.index])
        contributions = pd.DataFrame(values, index=members.index, columns=X.columns)
        for cell_type in members.index:
            reasons[cell_type] = top_reasons(contributions.loc[cell_type], X.loc[cell_type])

    neurons = pd.read_parquet(NEURONS_PATH)
    fru_dsx = fru_dsx_summary(neurons)
    graph = load_type_graph()
    label_of = labels.set_index("cell_type")["label"]
    partner_share = sex_related_partner_share(graph, label_of)

    table = pd.DataFrame(
        {
            "cell_type": selected.index,
            "oof_probability": selected["oof_probability"].to_numpy(),
            "top_features": ["; ".join(reasons[t]) for t in selected.index],
            "fru_dsx": fru_dsx.reindex(selected.index).to_numpy(),
            "sex_related_partner_share": partner_share.reindex(selected.index).to_numpy(),
            "n_neurons": neurons["type"].value_counts().reindex(selected.index).to_numpy(),
        }
    )
    table.to_parquet(CANDIDATES_PATH, index=False)

    isomorphic = label_of[label_of == "isomorphic"].index
    has_fru_dsx = fru_dsx.reindex(isomorphic) != "none"
    in_table = pd.Series(isomorphic.isin(selected.index), index=isomorphic)
    contingency = [
        [int((in_table & has_fru_dsx).sum()), int((in_table & ~has_fru_dsx).sum())],
        [int((~in_table & has_fru_dsx).sum()), int((~in_table & ~has_fru_dsx).sum())],
    ]
    odds_ratio, p_value = fisher_exact(contingency, alternative="greater")

    lines = [
        "# Candidate cell types",
        "",
        f"Types that Janelia annotates as isomorphic but whose out-of-fold probability is in the top "
        f"{TOP_FRACTION:.0%} of all {len(scores):,} types (probability >= {threshold:.3f}). Out-of-fold means "
        "each type was scored by a model that never saw its label. Feature explanations are SHAP values from that "
        "same fold model; listed features are the three pushing the score most strongly towards sex-related.",
        "",
        "These are candidates for further investigation, not new findings of dimorphism. Most of the signal "
        "separating sex-related from isomorphic types comes from neuropil location and membership of a wiring "
        "community dominated by male-specific types, so a high score says a type sits in the same circuits as "
        "known sex-related types. Confirming dimorphism requires comparison with the female connectome or with "
        "light-level anatomy.",
        "",
        "## fru/dsx cross-reference",
        "",
        f"fru/dsx expression was not a model input. {contingency[0][0]} of {len(selected)} candidates carry a fru or "
        f"dsx annotation, against {contingency[1][0]:,} of {contingency[1][0] + contingency[1][1]:,} other "
        f"isomorphic types (one-sided Fisher exact test: odds ratio {odds_ratio:.1f}, p = {p_value:.2g}).",
        "",
        "## Table",
        "",
        "| cell type | neurons | probability | strongest contributing features | fru/dsx | sex-related partners | note |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in table.itertuples(index=False):
        lines.append(
            f"| {row.cell_type} | {row.n_neurons} | {row.oof_probability:.3f} | {row.top_features} | {row.fru_dsx} | "
            f"{row.sex_related_partner_share:.0%} | {HEDGE} |"
        )
    (RESULTS / "candidates.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    summary = {
        "threshold": float(threshold),
        "n_candidates": int(len(table)),
        "fru_dsx_candidates": contingency[0][0],
        "fru_dsx_other_isomorphic": contingency[1][0],
        "n_other_isomorphic": contingency[1][0] + contingency[1][1],
        "fisher_odds_ratio": float(odds_ratio),
        "fisher_p_value": float(p_value),
    }
    (RESULTS / "candidates_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print("\n".join(lines[:16]))
    print(f"{len(table)} candidates written to results/candidates.md")


if __name__ == "__main__":
    main()
