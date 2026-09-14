"""Check that the pathfinder recovers the Giant Fiber escape circuit from the type graph."""

from pipeline.build_type_graph import load_type_graph
from pipeline.common import get_client
from pipeline.pathfinder import find_path

# Looming detector LPLC2 synapses onto the Giant Fiber (Ache et al. 2019); the Giant Fiber drives the
# tergotrochanteral jump motor neuron TTMn (King & Wyman 1980). The Giant Fiber is DNp01 (Namiki et al. 2018).
SOURCE, GIANT_FIBER, TARGET = "LPLC2", "DNp01", "TTMn"
SUPPORTING_PAIRS = [("LC4", "TTMn"), ("LPLC2", "DLMn c-f"), ("LPLC2", "PSI")]


def main() -> None:
    client = get_client()
    instances = client.fetch_custom(
        f"MATCH (n:Neuron) WHERE n.type = '{GIANT_FIBER}' RETURN DISTINCT n.instance AS instance"
    )["instance"].tolist()
    assert instances and all("(GF)" in i for i in instances), f"{GIANT_FIBER} instances {instances} not marked as GF"
    print(f"{GIANT_FIBER} instances in neuPrint: {instances}")

    graph = load_type_graph()
    names = set(graph.vs["name"])
    for name in (SOURCE, GIANT_FIBER, TARGET):
        assert name in names, f"{name} missing from the type graph"

    path = find_path(graph, SOURCE, TARGET)
    assert path is not None, f"No path from {SOURCE} to {TARGET}"
    print(f"{SOURCE} -> {TARGET}: {path.describe()} ({path.hops} hops)")
    assert GIANT_FIBER in path.types, f"Giant Fiber {GIANT_FIBER} not on the {SOURCE} -> {TARGET} path"

    for source, target in SUPPORTING_PAIRS:
        other = find_path(graph, source, target)
        via = "via" if other and GIANT_FIBER in other.types else "not via"
        print(f"{source} -> {target}: {other.describe() if other else 'no path'} ({via} {GIANT_FIBER})")
    print("OK: Giant Fiber lies on the looming-detector to jump-motor-neuron path")


if __name__ == "__main__":
    main()
