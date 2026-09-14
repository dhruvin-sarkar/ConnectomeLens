import numpy as np
import pytest

from pipeline.model_diagnostics import (
    calibration,
    exploratory_sets,
    feature_group,
    ranking_curve,
    score_histograms,
    top_fraction_capture,
)


def test_ranking_curve_counts_hits_among_the_top_k():
    y = np.array([1, 0, 1, 0, 0, 1])
    score = np.array([0.9, 0.8, 0.7, 0.2, 0.1, 0.05])
    curve = ranking_curve(y, score, n_points=8)
    assert curve["k"] == [1, 2, 3, 4, 5, 6]
    assert curve["tp"] == [1, 1, 2, 2, 2, 3]
    assert curve["precision"][2] == pytest.approx(2 / 3, abs=1e-5)
    assert curve["recall"][-1] == 1.0
    assert curve["fpr"][-1] == 1.0


def test_calibration_bins_cover_every_type():
    rng = np.random.default_rng(0)
    p = rng.random(1000)
    y = (rng.random(1000) < p).astype(int)
    result = calibration(y, p, n_bins=10)
    assert sum(b["n"] for b in result["bins"]) == 1000
    assert result["brier"] < result["brier_prevalence_only"]


def test_score_histograms_split_by_label():
    p = np.array([0.01, 0.5, 0.99, 0.2])
    labels = np.array(["isomorphic", "dimorphic", "male_specific", "isomorphic"])
    result = score_histograms(p, labels, n_bins=4)
    assert sum(result["isomorphic"]) == 2
    assert result["male_specific"] == [0, 0, 0, 1]


def test_top_fraction_capture_reports_precision_and_recall():
    y = np.array([1] * 5 + [0] * 95)
    p = np.linspace(1, 0, 100)
    rows = {r["fraction"]: r for r in top_fraction_capture(y, p)}
    assert rows[0.05]["sex_related"] == 5
    assert rows[0.05]["precision"] == 1.0
    assert rows[0.01]["recall"] == pytest.approx(0.2)


def test_feature_groups_and_exploratory_sets_partition_features():
    columns = ["in_degree", "community", "hops_to_motor", "nt", "out_frac_SIP", "out_frac_EPA"]
    assert [feature_group(c) for c in columns] == ["topology", "topology", "topology", "transmitter", "neuropil", "neuropil"]
    sets = exploratory_sets(columns)
    assert sets["neuropil_only"] == ["out_frac_SIP", "out_frac_EPA"]
    assert "community" not in sets["topology_without_community"]
    assert set(sets["full_without_community"]) == set(columns) - {"community"}
