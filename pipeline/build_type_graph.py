"""Fetch neuron-level connectivity and collapse it into a weighted, directed cell-type graph."""

import igraph as ig
import pandas as pd
from neuprint import NeuronCriteria as NC, NotNull, fetch_adjacencies, fetch_neurons

from pipeline.common import (
    DATA,
    DATASET,
    NEURON_ROI_PATH,
    NEURONS_PATH,
    TYPE_EDGES_PATH,
    TYPE_NODES_PATH,
    get_client,
)

CHUNK = 10_000
NEURON_COLUMNS = [
    "bodyId",
    "type",
    "instance",
    "superclass",
    "celltypePredictedNt",
    "somaSide",
    "pre",
    "post",
    "fruDsx",
    "itoleeHl",
    "trumanHl",
]
# A type-to-type connection enters the graph only if it supplies at least this fraction of the
# postsynaptic type's input synapses (from all typed neurons, within-type synapses included).
MIN_INPUT_FRACTION = 0.01


def aggregate_type_edges(connections: pd.DataFrame, body_types: pd.Series) -> pd.DataFrame:
    """Sum neuron-to-neuron synapse counts into type-to-type edges.

    Args:
        connections: columns ``bodyId_pre``, ``bodyId_post``, ``weight``.
        body_types: cell type indexed by bodyId.

    Returns:
        Columns ``type_pre``, ``type_post``, ``weight`` (summed synapses) and
        ``n_connections`` (number of contributing neuron pairs).
    """
    edges = connections.assign(
        type_pre=connections["bodyId_pre"].map(body_types),
        type_post=connections["bodyId_post"].map(body_types),
    )
    missing = edges[["type_pre", "type_post"]].isna().any(axis=1)
    if missing.any():
        raise ValueError(f"{int(missing.sum())} connections reference bodies without a cell type")
    return edges.groupby(["type_pre", "type_post"], as_index=False, sort=True).agg(
        weight=("weight", "sum"), n_connections=("weight", "size")
    )


def combine_type_edges(parts: list[pd.DataFrame]) -> pd.DataFrame:
    """Merge type-edge tables computed on disjoint sets of source neurons."""
    return pd.concat(parts, ignore_index=True).groupby(["type_pre", "type_post"], as_index=False, sort=True)[
        ["weight", "n_connections"]
    ].sum()


def summarise_types(neurons: pd.DataFrame) -> pd.DataFrame:
    """One row per cell type: size, dominant superclass, neurotransmitter and hemilineage, synapse totals."""

    def mode(series: pd.Series) -> str:
        values = series.dropna()
        return values.mode().sort_values().iloc[0] if len(values) else "unknown"

    return (
        neurons.assign(hemilineage=neurons["itoleeHl"].fillna(neurons["trumanHl"]))
        .groupby("type", sort=True)
        .agg(
            n_neurons=("bodyId", "size"),
            superclass=("superclass", mode),
            nt=("celltypePredictedNt", mode),
            hemilineage=("hemilineage", mode),
            total_pre=("pre", "sum"),
            total_post=("post", "sum"),
        )
        .reset_index()
        .rename(columns={"type": "cell_type"})
    )


def build_graph(
    nodes: pd.DataFrame, edges: pd.DataFrame, min_input_fraction: float = MIN_INPUT_FRACTION
) -> ig.Graph:
    """Build a directed igraph graph with one vertex per type.

    Self-loops and connections below ``min_input_fraction`` of the target's input are dropped.
    Vertex attributes: ``name`` (cell type), the node-table columns, and ``synapses_in`` /
    ``synapses_out`` (totals over all typed partners before thresholding). Edge attributes:
    ``weight`` (synapses) and ``input_fraction``.
    """
    unknown = set(edges["type_pre"]).union(edges["type_post"]) - set(nodes["cell_type"])
    if unknown:
        raise ValueError(f"{len(unknown)} edge endpoints are not in the node table")
    synapses_in = edges.groupby("type_post")["weight"].sum()
    synapses_out = edges.groupby("type_pre")["weight"].sum()
    input_fraction = edges["weight"] / edges["type_post"].map(synapses_in)
    kept = edges.assign(input_fraction=input_fraction)
    kept = kept[(kept["type_pre"] != kept["type_post"]) & (kept["input_fraction"] >= min_input_fraction)]

    graph = ig.Graph(directed=True)
    graph.add_vertices(nodes["cell_type"].tolist())
    graph.add_edges(
        list(zip(kept["type_pre"], kept["type_post"])),
        attributes={"weight": kept["weight"].tolist(), "input_fraction": kept["input_fraction"].tolist()},
    )
    for column in nodes.columns.drop("cell_type"):
        graph.vs[column] = nodes[column].tolist()
    graph.vs["synapses_in"] = nodes["cell_type"].map(synapses_in).fillna(0).astype(int).tolist()
    graph.vs["synapses_out"] = nodes["cell_type"].map(synapses_out).fillna(0).astype(int).tolist()
    return graph


def load_type_graph(min_input_fraction: float = MIN_INPUT_FRACTION) -> ig.Graph:
    """Load the cached type graph built by :func:`main`."""
    return build_graph(pd.read_parquet(TYPE_NODES_PATH), pd.read_parquet(TYPE_EDGES_PATH), min_input_fraction)


def fetch_neuron_tables(client, roi_names: set[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    body_ids = client.fetch_custom(
        "MATCH (n:Neuron) WHERE n.type IS NOT NULL RETURN n.bodyId AS bodyId ORDER BY bodyId"
    )["bodyId"].tolist()
    neuron_parts, roi_parts = [], []
    for start in range(0, len(body_ids), CHUNK):
        neurons, roi_counts = fetch_neurons(NC(bodyId=body_ids[start : start + CHUNK]))
        neuron_parts.append(neurons.reindex(columns=NEURON_COLUMNS))
        roi_parts.append(roi_counts.loc[roi_counts["roi"].isin(roi_names), ["bodyId", "roi", "pre", "post"]])
        print(f"neurons: {min(start + CHUNK, len(body_ids))}/{len(body_ids)}", flush=True)
    neurons = pd.concat(neuron_parts, ignore_index=True)
    if len(neurons) != len(body_ids) or neurons["type"].isna().any():
        raise RuntimeError(f"Expected {len(body_ids)} typed neurons, fetched {len(neurons)}")
    return neurons, pd.concat(roi_parts, ignore_index=True)


def fetch_type_edges(body_types: pd.Series) -> pd.DataFrame:
    cache = DATA / "adjacency_chunks"
    cache.mkdir(parents=True, exist_ok=True)
    body_ids = body_types.index.tolist()
    parts = []
    for i, start in enumerate(range(0, len(body_ids), CHUNK)):
        path = cache / f"chunk_{i:03d}.parquet"
        if not path.exists():
            _, conn = fetch_adjacencies(
                NC(bodyId=body_ids[start : start + CHUNK]),
                NC(type=NotNull),
                omit_rois=True,
                weight_props=["weight"],
                batch_size=200,
                threads=4,
            )
            aggregate_type_edges(conn, body_types).to_parquet(path, index=False)
        parts.append(pd.read_parquet(path))
        print(f"adjacency: {min(start + CHUNK, len(body_ids))}/{len(body_ids)}", flush=True)
    return combine_type_edges(parts)


def main() -> None:
    client = get_client()
    DATA.mkdir(exist_ok=True)
    if NEURONS_PATH.exists() and NEURON_ROI_PATH.exists():
        neurons = pd.read_parquet(NEURONS_PATH)
    else:
        roi_names = set(client.fetch_datasets()[DATASET]["superLevelROIs"])
        neurons, roi_counts = fetch_neuron_tables(client, roi_names)
        neurons.to_parquet(NEURONS_PATH, index=False)
        roi_counts.to_parquet(NEURON_ROI_PATH, index=False)

    nodes = summarise_types(neurons)
    nodes.to_parquet(TYPE_NODES_PATH, index=False)
    edges = fetch_type_edges(neurons.set_index("bodyId")["type"])
    edges.to_parquet(TYPE_EDGES_PATH, index=False)

    graph = load_type_graph()
    print(
        f"Type graph: {graph.vcount()} types, {graph.ecount()} edges, "
        f"{int(edges['weight'].sum())} synapses between typed neurons "
        f"({int(edges.loc[edges['type_pre'] == edges['type_post'], 'weight'].sum())} within-type)"
    )


if __name__ == "__main__":
    main()
