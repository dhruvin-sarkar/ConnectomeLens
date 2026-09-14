import math

import igraph as ig
import pytest

from pipeline.pathfinder import find_path, transition_costs


def toy_graph() -> ig.Graph:
    # S has 100 output synapses: 60 to A, 40 to B. A sends 10 of 100 to T, B sends 90 of 100 to T.
    # Path via A carries 0.6 * 0.1 = 0.06 of the signal; via B, 0.4 * 0.9 = 0.36. The direct S->T
    # edge does not exist, and D is disconnected.
    graph = ig.Graph(directed=True)
    graph.add_vertices(["S", "A", "B", "T", "D"])
    graph.add_edges([("S", "A"), ("S", "B"), ("A", "T"), ("B", "T"), ("T", "S")], attributes={"weight": [60, 40, 10, 90, 5]})
    graph.vs["synapses_out"] = [100, 100, 100, 5, 0]
    return graph


def test_costs_are_negative_log_output_fractions():
    graph = toy_graph()
    costs = transition_costs(graph)
    assert costs[graph.get_eid("S", "A")] == pytest.approx(-math.log(0.6))
    assert costs[graph.get_eid("T", "S")] == pytest.approx(0.0)


def test_prefers_route_carrying_largest_output_share():
    path = find_path(toy_graph(), "S", "T")
    assert path.types == ["S", "B", "T"]
    assert path.synapses == [40, 90]
    assert path.hops == 2
    assert path.cost == pytest.approx(-math.log(0.36))


def test_fewer_hops_do_not_override_weaker_fractions():
    graph = toy_graph()
    graph.add_edges([("S", "T")], attributes={"weight": [1]})
    graph.vs.find(name="S")["synapses_out"] = 101
    assert find_path(graph, "S", "T").types == ["S", "B", "T"]


def test_unreachable_target_returns_none():
    assert find_path(toy_graph(), "S", "D") is None
