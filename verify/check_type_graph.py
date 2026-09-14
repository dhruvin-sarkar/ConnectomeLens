"""Check the size of the cell-type graph against the published dataset totals."""

import pandas as pd

from pipeline.build_type_graph import load_type_graph
from pipeline.common import TYPE_EDGES_PATH

# Berg et al. (2026): 11,710 neuron types. Google Research blog (2026-09-03): ~125 million synaptic connections.
PUBLISHED_TYPES = 11_710
PUBLISHED_SYNAPSES = 125_000_000


def main() -> None:
    graph = load_type_graph()
    assert 9_000 <= graph.vcount() <= 14_000, f"{graph.vcount()} types outside 9,000-14,000"
    assert graph.is_directed() and graph.is_simple(), "Graph should be directed with no loops or multi-edges"

    total = int(pd.read_parquet(TYPE_EDGES_PATH)["weight"].sum())
    ratio = total / PUBLISHED_SYNAPSES
    assert 0.1 <= ratio <= 10, f"{total} synapses vs ~{PUBLISHED_SYNAPSES} published (ratio {ratio:.2f})"
    print(f"types: {graph.vcount()} (published {PUBLISHED_TYPES})")
    print(f"synapses between typed neurons: {total:,} (published ~{PUBLISHED_SYNAPSES:,}, ratio {ratio:.2f})")
    print(f"OK: thresholded graph has {graph.ecount():,} edges carrying {int(sum(graph.es['weight'])):,} synapses")


if __name__ == "__main__":
    main()
