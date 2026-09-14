"""Strongest synaptic route between two cell types on the type graph."""

import argparse
import math
import warnings
from dataclasses import dataclass

import igraph as ig

from pipeline.build_type_graph import load_type_graph


@dataclass
class Path:
    types: list[str]
    synapses: list[int]
    cost: float

    @property
    def hops(self) -> int:
        return len(self.types) - 1

    def describe(self) -> str:
        steps = [self.types[0]]
        for synapses, cell_type in zip(self.synapses, self.types[1:]):
            steps.append(f"-({synapses})-> {cell_type}")
        return " ".join(steps)


def transition_costs(graph: ig.Graph) -> list[float]:
    """Edge cost ``-log(synapses / total output synapses of the source type)``.

    Summed along a path this is the negative log of the product of output fractions, so the
    cheapest path is the one that carries the largest share of each successive type's output.
    """
    out = graph.vs["synapses_out"]
    return [-math.log(e["weight"] / out[e.source]) for e in graph.es]


def find_path(graph: ig.Graph, source: str, target: str) -> Path | None:
    """Weighted Dijkstra path from ``source`` to ``target``; ``None`` when no path exists."""
    costs = transition_costs(graph)
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Couldn't reach some vertices")
        vertices = graph.get_shortest_paths(source, to=target, weights=costs, mode="out", output="vpath")[0]
    if not vertices:
        return None
    edge_ids = [graph.get_eid(a, b) for a, b in zip(vertices, vertices[1:])]
    return Path(
        types=[graph.vs[v]["name"] for v in vertices],
        synapses=[int(graph.es[e]["weight"]) for e in edge_ids],
        cost=float(sum(costs[e] for e in edge_ids)),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="source cell type")
    parser.add_argument("--target", required=True, help="target cell type")
    args = parser.parse_args()

    graph = load_type_graph()
    for name in (args.source, args.target):
        if name not in set(graph.vs["name"]):
            raise SystemExit(f"Unknown cell type: {name}")
    path = find_path(graph, args.source, args.target)
    if path is None:
        print(f"No directed path from {args.source} to {args.target}")
        return
    print(f"{path.hops} hops, cost {path.cost:.3f}: {path.describe()}")


if __name__ == "__main__":
    main()
