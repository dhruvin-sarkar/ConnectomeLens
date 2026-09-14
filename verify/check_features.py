"""Check the feature table is complete and free of female-connectome information."""

import pandas as pd

from pipeline.build_type_graph import load_type_graph
from pipeline.common import DATA, FEATURES_PATH, NEURONS_PATH, TYPE_NODES_PATH
from pipeline.compute_features import GRAPH_FEATURES

# Identifiers of female connectome resources: FlyWire / FAFB (whole female brain) and the hemibrain.
FEMALE_SOURCES = ("flywire", "fafb", "hemibrain", "female")


def main() -> None:
    features = pd.read_parquet(FEATURES_PATH)
    graph = load_type_graph()
    assert len(features) == graph.vcount(), f"{len(features)} feature rows vs {graph.vcount()} types"
    assert set(features["cell_type"]) == set(graph.vs["name"]), "Feature rows do not match graph types"
    assert set(GRAPH_FEATURES) <= set(features.columns), "Topology features missing"

    nulls = features.isna().sum()
    assert not nulls.any(), f"Null values in: {nulls[nulls > 0].to_dict()}"

    for path in (FEATURES_PATH, NEURONS_PATH, TYPE_NODES_PATH):
        columns = pd.read_parquet(path).columns
        leaked = [c for c in columns if any(s in c.lower() for s in FEMALE_SOURCES)]
        assert not leaked, f"{path.name} has female-connectome columns: {leaked}"
    leaked_files = [p.name for p in DATA.rglob("*") if any(s in p.name.lower() for s in FEMALE_SOURCES)]
    assert not leaked_files, f"Female-connectome files in data/: {leaked_files}"

    print(f"OK: {len(features)} types x {features.shape[1] - 1} features, no nulls, no female-connectome sources")


if __name__ == "__main__":
    main()
