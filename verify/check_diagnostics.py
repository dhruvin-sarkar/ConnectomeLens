"""Check the model diagnostics against the stored scores, metrics and null-model results."""

import json

import numpy as np
import pandas as pd

from pipeline.common import RESULTS, SCORES_PATH
from pipeline.model_diagnostics import DIAGNOSTICS_PATH, SHAP_PATH
from pipeline.null_model import SCORES_CSV


def main() -> None:
    d = json.loads(DIAGNOSTICS_PATH.read_text(encoding="utf-8"))
    metrics = json.loads((RESULTS / "classifier_metrics.json").read_text(encoding="utf-8"))
    scores = pd.read_parquet(SCORES_PATH).set_index("cell_type")

    assert np.isclose(d["curves"]["full"]["auc_pr"], metrics["auc_pr"]), "Full-model curve AUC-PR differs from the metrics"
    assert np.isclose(d["curves"]["hemilineage_grouped"]["auc_pr"], metrics["hemilineage_grouped_cv"]["auc_pr"])
    for name in ("full", "topology_only", "static_only"):
        assert np.isclose(d["feature_sets"][name]["auc_pr"], metrics["feature_sets"][name]["auc_pr"]), f"{name} AUC-PR differs"
        assert not d["feature_sets"][name]["exploratory"], f"{name} must be marked pre-specified"
    for curve in d["curves"].values():
        assert np.all(np.diff(curve["recall"]) >= 0) and np.all(np.diff(curve["tp"]) >= 0), "Curve is not cumulative"

    ranked = scores.sort_values("oof_probability", ascending=False)
    positive = ranked["label"].isin(["male_specific", "dimorphic"]).to_numpy()
    for row in d["top_fraction_capture"]:
        assert row["sex_related"] == int(positive[: row["k"]].sum()), f"Top {row['fraction']:.0%} capture differs"
    assert sum(h for label in ("male_specific", "dimorphic", "isomorphic") for h in d["histograms"][label]) == len(scores)

    shares = [g["share"] for g in d["attribution"]["groups"].values()]
    assert np.isclose(sum(shares), 1.0), "Feature-group shares do not sum to one"

    # SHAP values plus the fold's base value must reproduce each stored probability (additivity in log-odds).
    values = pd.read_parquet(SHAP_PATH).set_index("cell_type")
    fold = scores.loc[values.index, "fold"].to_numpy()
    margin = values.sum(axis=1).to_numpy() + np.asarray(d["attribution"]["base_values"])[fold]
    reproduced = 1 / (1 + np.exp(-margin))
    error = np.abs(reproduced - scores.loc[values.index, "oof_probability"].to_numpy()).max()
    assert error < 1e-4, f"SHAP values do not add up to the out-of-fold probabilities (max error {error:.2g})"

    null = pd.read_csv(SCORES_CSV)
    assert np.allclose(d["null_scores"]["full"], null["auc_pr_full"], atol=1e-5), "Null scores differ from the CSV"
    assert len(d["null_scores"]["topology_only"]) == len(null), "Null score count differs from the CSV"

    for row in d["named_types"]:
        assert ranked.index.get_loc(row["cell_type"]) + 1 == row["rank"], f"Rank of {row['cell_type']} differs"

    agreement = d["neuropil_agreement"]
    print(
        f"OK: {len(d['curves'])} ranking curves, SHAP additivity error {error:.1e}, "
        f"neuropil map vs annotations rho {agreement['spearman_rho']:.2f} over {agreement['n_neuropils']} neuropils"
    )


if __name__ == "__main__":
    main()
