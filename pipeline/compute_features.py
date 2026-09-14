"""Per-type features: graph topology recomputed per graph, plus fixed synaptic attributes."""

import random

import igraph as ig
import numpy as np
import pandas as pd

from pipeline.build_type_graph import load_type_graph
from pipeline.common import (
    FEATURES_PATH,
    MOTOR_SUPERCLASSES,
    NEURON_ROI_PATH,
    NEURONS_PATH,
    SEED,
    SENSORY_SUPERCLASSES,
)

GRAPH_FEATURES = [
    "in_degree",
    "out_degree",
    "in_strength",
    "out_strength",
    "pagerank",
    "betweenness",
    "community",
    "hops_from_sensory",
    "hops_to_motor",
]
CATEGORICAL_FEATURES = ["community", "nt"]
# Communities smaller than this are pooled into a single category (-1).
MIN_COMMUNITY_SIZE = 25


def hop_distances(graph: ig.Graph, anchors: list[int], mode: str) -> np.ndarray:
    """Unweighted shortest-path length between each vertex and the nearest anchor vertex.

    ``mode="out"`` measures hops downstream from the anchors; ``mode="in"`` measures hops from
    each vertex down to an anchor. Unreachable vertices get one more than the longest finite hop.
    """
    if not anchors:
        raise ValueError("No anchor vertices")
    augmented = graph.copy()
    augmented.add_vertices(1)
    hub = augmented.vcount() - 1
    pairs = [(hub, a) for a in anchors] if mode == "out" else [(a, hub) for a in anchors]
    augmented.add_edges(pairs)
    hops = np.asarray(augmented.distances(source=[hub], mode=mode)[0][:-1], dtype=float) - 1
    finite = np.isfinite(hops)
    hops[~finite] = hops[finite].max() + 1
    return hops.astype(int)


def communities(graph: ig.Graph, seed: int = SEED) -> np.ndarray:
    """Leiden modularity communities on the undirected, weight-summed graph, labeled by size rank."""
    random.seed(seed)
    undirected = graph.as_undirected(mode="collapse", combine_edges={"weight": "sum"})
    membership = np.asarray(
        undirected.community_leiden(objective_function="modularity", weights="weight", n_iterations=-1).membership
    )
    sizes = pd.Series(membership).value_counts()
    rank = {community: i for i, community in enumerate(sizes.index)}
    labels = np.array([rank[m] for m in membership])
    small = sizes[sizes < MIN_COMMUNITY_SIZE].index.map(rank)
    labels[np.isin(labels, small)] = -1
    return labels


def graph_features(graph: ig.Graph, seed: int = SEED) -> pd.DataFrame:
    """Topology features for every vertex, indexed by cell type."""
    superclass = np.asarray(graph.vs["superclass"])
    sensory = np.flatnonzero(np.isin(superclass, list(SENSORY_SUPERCLASSES))).tolist()
    motor = np.flatnonzero(np.isin(superclass, list(MOTOR_SUPERCLASSES))).tolist()
    return pd.DataFrame(
        {
            "in_degree": graph.indegree(),
            "out_degree": graph.outdegree(),
            "in_strength": graph.strength(mode="in", weights="weight"),
            "out_strength": graph.strength(mode="out", weights="weight"),
            "pagerank": graph.pagerank(directed=True, weights="weight"),
            "betweenness": graph.betweenness(directed=True),
            "community": communities(graph, seed),
            "hops_from_sensory": hop_distances(graph, sensory, "out"),
            "hops_to_motor": hop_distances(graph, motor, "in"),
        },
        index=pd.Index(graph.vs["name"], name="cell_type"),
    )


def static_features(graph: ig.Graph, neurons: pd.DataFrame, roi_counts: pd.DataFrame) -> pd.DataFrame:
    """Predicted neurotransmitter and the share of output synapses in each bilateral neuropil."""
    roi = roi_counts.merge(neurons[["bodyId", "type"]], on="bodyId", how="inner")
    roi["neuropil"] = roi["roi"].str.replace(r"\((L|R)\)$", "", regex=True)
    pre = roi.pivot_table(index="type", columns="neuropil", values="pre", aggfunc="sum", fill_value=0)
    totals = pre.sum(axis=1)
    fractions = pre.div(totals.where(totals > 0), axis=0).fillna(0.0)
    fractions.columns = [f"out_frac_{c}" for c in fractions.columns]

    index = pd.Index(graph.vs["name"], name="cell_type")
    static = fractions.reindex(index).fillna(0.0)
    static.insert(0, "nt", graph.vs["nt"])
    return static


def assemble(topology: pd.DataFrame, static: pd.DataFrame) -> pd.DataFrame:
    """Join topology and static features, typing categorical columns for LightGBM."""
    features = topology.join(static, how="inner")
    if len(features) != len(topology):
        raise ValueError("Topology and static feature tables cover different types")
    for column in CATEGORICAL_FEATURES:
        features[column] = features[column].astype("category")
    return features


def main() -> None:
    graph = load_type_graph()
    static = static_features(graph, pd.read_parquet(NEURONS_PATH), pd.read_parquet(NEURON_ROI_PATH))
    features = assemble(graph_features(graph), static)
    features.reset_index().to_parquet(FEATURES_PATH, index=False)
    print(f"Wrote {FEATURES_PATH}: {features.shape[0]} types x {features.shape[1]} features")
    print(features[GRAPH_FEATURES].describe().T.to_string())


if __name__ == "__main__":
    main()
