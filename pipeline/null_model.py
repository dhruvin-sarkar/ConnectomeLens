"""Degree-preserving randomization test for the classifier's cross-validated AUC-PR."""

import argparse
import json
import random
from multiprocessing import Pool

import igraph as ig
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from pipeline.build_type_graph import load_type_graph  # noqa: E402
from pipeline.common import LABELS_PATH, NEURON_ROI_PATH, NEURONS_PATH, RESULTS, SEED  # noqa: E402
from pipeline.compute_features import assemble, graph_features, static_features  # noqa: E402
from pipeline.train_classifier import cross_validate, feature_columns, summarize, training_set  # noqa: E402

SWAPS_PER_EDGE = 10
# Two pre-specified tests share the same randomized graphs; Bonferroni-corrected threshold.
TESTS = {"full": "all features", "topology_only": "topology features only"}
ALPHA = 0.05 / len(TESTS)
SCORES_CSV = RESULTS / "null_model_scores.csv"


def rewire(graph: ig.Graph, seed: int, swaps_per_edge: int = SWAPS_PER_EDGE) -> ig.Graph:
    """Randomize edges with in/out-degree-preserving swaps.

    Every vertex keeps its exact in-degree and out-degree. Each source vertex's original set of
    out-edge synapse counts is reassigned, shuffled, to its new out-edges, so out-strength is also
    preserved while the identity of downstream partners is randomized.
    """
    null = graph.copy()
    random.seed(seed)
    null.rewire(n=swaps_per_edge * graph.ecount(), allowed_edge_types="simple")

    rng = np.random.default_rng(seed)
    old_sources = np.asarray(graph.get_edgelist(), dtype=np.int64).reshape(-1, 2)[:, 0]
    new_sources = np.asarray(null.get_edgelist(), dtype=np.int64).reshape(-1, 2)[:, 0]
    old_weights = np.asarray(graph.es["weight"])
    old_order = np.lexsort((rng.random(len(old_sources)), old_sources))
    new_order = np.argsort(new_sources, kind="stable")
    weights = np.empty_like(old_weights)
    weights[new_order] = old_weights[old_order]
    null.es["weight"] = weights.tolist()
    if "input_fraction" in null.es.attributes():
        del null.es["input_fraction"]
    return null


def score_graph(graph: ig.Graph, static: pd.DataFrame, labels: pd.DataFrame, seed: int = SEED) -> dict[str, float]:
    """Out-of-fold AUC-PR of each pre-specified feature set on one graph."""
    X, y = training_set(assemble(graph_features(graph, seed=seed), static), labels)
    return {name: summarize(y, cross_validate(X[feature_columns(X, name)], y).oof)["auc_pr"] for name in TESTS}


_WORKER: dict = {}


def _init_worker(graph: ig.Graph, static: pd.DataFrame, labels: pd.DataFrame) -> None:
    _WORKER.update(graph=graph, static=static, labels=labels)


def run_trial(trial: int) -> dict:
    """Rewire, recompute topology features, and cross-validate on the real labels."""
    seed = SEED + 1 + trial
    null = rewire(_WORKER["graph"], seed)
    scores = score_graph(null, _WORKER["static"], _WORKER["labels"], seed)
    return {"trial": trial, "seed": seed, **{f"auc_pr_{k}": v for k, v in scores.items()}}


def empirical_p_value(real: float, null: np.ndarray) -> float:
    """One-sided permutation p-value with the +1 correction, so it is never exactly zero."""
    return float((1 + np.sum(null >= real)) / (1 + len(null)))


def plot(results: dict) -> None:
    fig, axes = plt.subplots(1, len(results), figsize=(12, 4.5), dpi=150)
    for ax, (name, r) in zip(axes, results.items()):
        span = r["real"] - r["null"].min()
        lo, hi = r["null"].min() - 0.08 * span, r["real"] + 0.08 * span
        ax.hist(r["null"], bins=np.linspace(lo, hi, 90), color="#8c96a8", label=f"randomized graphs (n={len(r['null'])})")
        ax.axvline(r["real"], color="#c2185b", linewidth=2.5, label=f"real connectome = {r['real']:.3f}")
        ax.set_xlim(lo, hi)
        ax.set_title(f"{TESTS[name]}: empirical p = {r['p_value']:.4f}", fontsize=10)
        ax.set_xlabel("cross-validated AUC-PR")
        ax.spines[["top", "right"]].set_visible(False)
        ax.legend(frameon=False, fontsize=8, loc="upper center")
    axes[0].set_ylabel("randomized graphs")
    fig.suptitle("Classifier on the real male CNS type graph vs degree-preserving randomizations", fontsize=11)
    fig.tight_layout()
    fig.savefig(RESULTS / "null_distribution.png")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n-trials", type=int, default=500)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()

    graph = load_type_graph()
    labels = pd.read_parquet(LABELS_PATH)
    static = static_features(graph, pd.read_parquet(NEURONS_PATH), pd.read_parquet(NEURON_ROI_PATH))

    real = score_graph(graph, static, labels)
    recorded = json.loads((RESULTS / "classifier_metrics.json").read_text(encoding="utf-8"))["feature_sets"]
    for name, value in real.items():
        if not np.isclose(value, recorded[name]["auc_pr"], atol=1e-9):
            raise RuntimeError(f"Real {name} AUC-PR {value} differs from classifier_metrics.json {recorded[name]['auc_pr']}")

    rows = pd.read_csv(SCORES_CSV).to_dict("records") if SCORES_CSV.exists() else []
    done = {row["trial"] for row in rows}
    todo = [t for t in range(args.n_trials) if t not in done]
    with Pool(args.workers, initializer=_init_worker, initargs=(graph, static, labels)) as pool:
        for i, row in enumerate(pool.imap_unordered(run_trial, todo), start=1):
            rows.append(row)
            if i % 25 == 0 or i == len(todo):
                pd.DataFrame(rows).sort_values("trial").to_csv(SCORES_CSV, index=False)
                print(f"null trials: {len(rows)}/{args.n_trials}", flush=True)

    scores = pd.DataFrame(rows).sort_values("trial")
    scores = scores[scores["trial"] < args.n_trials]
    results = {}
    for name in TESTS:
        null = scores[f"auc_pr_{name}"].to_numpy()
        results[name] = {
            "real": real[name],
            "null": null,
            "null_mean": float(null.mean()),
            "null_sd": float(null.std(ddof=1)),
            "null_min": float(null.min()),
            "null_max": float(null.max()),
            "n_exceeding": int(np.sum(null >= real[name])),
            "z_score": float((real[name] - null.mean()) / null.std(ddof=1)),
            "p_value": empirical_p_value(real[name], null),
        }
        results[name]["significant"] = results[name]["p_value"] < ALPHA
    plot(results)

    n = len(scores)
    floor = 1 / (1 + n)
    lines = [
        "# Null-model validation",
        "",
        "## Question",
        "",
        "Does the arrangement of connections in the male CNS cell-type graph carry information about which types are "
        "sexually dimorphic, beyond what is fixed by each type's number of input and output partners?",
        "",
        "## Procedure",
        "",
        f"1. Generate {n} randomized versions of the cell-type graph ({graph.vcount()} types, {graph.ecount()} edges) "
        f"with {SWAPS_PER_EDGE} x |E| degree-preserving edge swaps each (`igraph.Graph.rewire`, simple graphs only). "
        "Every type keeps its exact in-degree and out-degree; each type's outgoing synapse counts are shuffled across "
        "its new outgoing edges, preserving out-strength.",
        "2. On each randomized graph, recompute every topology feature: in/out-degree, in/out-strength, PageRank, "
        "betweenness, Leiden community, and hop distance from sensory and to descending/motor types. Type attributes "
        "that do not depend on the graph (share of output synapses per neuropil, predicted neurotransmitter) are held "
        "fixed.",
        "3. Retrain the identical LightGBM model with the identical 5-fold split on the real labels and record "
        "out-of-fold AUC-PR, for two feature sets specified before any randomized graph was scored: all features, "
        "and topology features only.",
        "4. Empirical one-sided p-value: (1 + number of randomized graphs with AUC-PR >= real) / (1 + number of "
        f"randomized graphs). With two tests on the same graphs, significance is assessed at alpha = 0.05 / 2 = {ALPHA}.",
        "",
        "The all-features test asks whether the real connectivity pattern adds predictive signal on top of degree "
        "sequence, neuropil distribution and neurotransmitter identity. The topology-only test asks whether graph "
        "structure by itself carries signal beyond the degree sequence.",
        "",
        "## Result",
        "",
        "| quantity | " + " | ".join(TESTS.values()) + " |",
        "|---|" + "---|" * len(TESTS),
        "| real AUC-PR | " + " | ".join(f"{r['real']:.4f}" for r in results.values()) + " |",
        "| randomized AUC-PR, mean ± sd | "
        + " | ".join(f"{r['null_mean']:.4f} ± {r['null_sd']:.4f}" for r in results.values())
        + " |",
        "| randomized AUC-PR, range | " + " | ".join(f"{r['null_min']:.4f} – {r['null_max']:.4f}" for r in results.values()) + " |",
        "| randomized graphs >= real | " + " | ".join(f"{r['n_exceeding']} / {n}" for r in results.values()) + " |",
        "| z-score | " + " | ".join(f"{r['z_score']:.1f}" for r in results.values()) + " |",
        "| empirical p-value | " + " | ".join(f"{r['p_value']:.4f}" for r in results.values()) + " |",
        f"| significant at {ALPHA} | " + " | ".join("yes" if r["significant"] else "no" for r in results.values()) + " |",
        "",
    ]
    for name, r in results.items():
        exceed = (
            f"no randomized graph reached the real AUC-PR, so p is at the floor attainable with {n} graphs ({floor:.4f})"
            if r["n_exceeding"] == 0
            else f"{r['n_exceeding']} of {n} randomized graphs matched or exceeded it"
        )
        lines.append(
            f"- **{TESTS[name]}**: real AUC-PR {r['real']:.3f} vs randomized {r['null_mean']:.3f} ± {r['null_sd']:.3f}; "
            f"{exceed}. The real topology is {'significantly' if r['significant'] else 'not significantly'} more "
            f"predictive than degree-preserving randomized topology (p = {r['p_value']:.4f})."
        )
    lines += ["", "![Null distributions](null_distribution.png)"]
    (RESULTS / "null_model_validation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    summary = {name: {k: v for k, v in r.items() if k != "null"} for name, r in results.items()}
    summary["n_trials"] = n
    summary["alpha"] = ALPHA
    (RESULTS / "null_model_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
