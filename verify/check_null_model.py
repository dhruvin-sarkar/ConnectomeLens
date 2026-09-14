"""Check the null model preserves degree sequences on the real graph and produced a p-value."""

import json
import math

import pandas as pd

from pipeline.build_type_graph import load_type_graph
from pipeline.common import RESULTS, SEED
from pipeline.null_model import SCORES_CSV, TESTS, rewire

MIN_TRIALS = 500


def main() -> None:
    graph = load_type_graph()
    null = rewire(graph, seed=SEED + 1)
    assert null.indegree() == graph.indegree(), "In-degree sequence changed"
    assert null.outdegree() == graph.outdegree(), "Out-degree sequence changed"
    assert null.strength(mode="out", weights="weight") == graph.strength(mode="out", weights="weight"), "Out-strength changed"
    moved = 1 - len(set(null.get_edgelist()) & set(graph.get_edgelist())) / graph.ecount()
    print(f"Rewired real graph: degrees and out-strength preserved, {moved:.1%} of edges moved")

    scores = pd.read_csv(SCORES_CSV)
    assert len(scores) >= MIN_TRIALS and scores["trial"].is_unique, f"{len(scores)} trials recorded, need {MIN_TRIALS}"
    summary = json.loads((RESULTS / "null_model_summary.json").read_text(encoding="utf-8"))
    for name in TESTS:
        p = summary[name]["p_value"]
        assert 0 < p <= 1 and math.isfinite(p), f"Invalid p-value for {name}: {p}"
        recomputed = (1 + (scores[f"auc_pr_{name}"] >= summary[name]["real"]).sum()) / (1 + len(scores))
        assert math.isclose(p, recomputed), f"{name} p-value {p} does not match scores ({recomputed})"
        print(f"{name}: real AUC-PR {summary[name]['real']:.4f}, p = {p:.4f} over {len(scores)} randomized graphs")
    assert (RESULTS / "null_model_validation.md").exists() and (RESULTS / "null_distribution.png").exists()
    print("OK")


if __name__ == "__main__":
    main()
