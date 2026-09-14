"""Structural redundancy of the Giant Fiber pathway: remove a node and recompute the routes."""

import json
import math

import pandas as pd

from pipeline.build_type_graph import load_type_graph
from pipeline.common import DATA, RESULTS, SCORES_PATH
from pipeline.pathfinder import Path, find_path

PRIMARY = ("LPLC2", "TTMn")
PAIRS = [PRIMARY, ("LC4", "TTMn"), ("LPLC2", "DLMn c-f")]
ABLATION_PATH = DATA / "ablation.json"


def outcome(before: Path | None, after: Path | None) -> str:
    """Classify how a route responds to the removal."""
    if before is None:
        return "no route before removal"
    if after is None:
        return "disconnected"
    if after.types == before.types:
        return "unchanged"
    if after.hops > before.hops:
        return "rerouted, longer"
    if after.hops < before.hops:
        return "rerouted, fewer hops"
    return "rerouted, same length"


def as_dict(path: Path | None) -> dict | None:
    if path is None:
        return None
    return {"types": path.types, "synapses": path.synapses, "hops": path.hops, "cost": path.cost}


def main() -> None:
    graph = load_type_graph()
    probability = pd.read_parquet(SCORES_PATH).set_index("cell_type")["oof_probability"]

    primary = find_path(graph, *PRIMARY)
    if primary is None or primary.hops < 2:
        raise RuntimeError(f"{PRIMARY[0]} -> {PRIMARY[1]} has no intermediate node to remove")
    intermediates = primary.types[1:-1]
    removed = max(intermediates, key=lambda t: probability[t])

    ablated = graph.copy()
    ablated.delete_vertices(ablated.vs.find(name=removed).index)

    records = []
    for source, target in PAIRS:
        before, after = find_path(graph, source, target), find_path(ablated, source, target)
        records.append(
            {"source": source, "target": target, "before": as_dict(before), "after": as_dict(after), "outcome": outcome(before, after)}
        )
    ABLATION_PATH.write_text(json.dumps({"removed": removed, "pairs": records}, indent=2), encoding="utf-8")

    lines = [
        "# Structural redundancy: removing the Giant Fiber from the type graph",
        "",
        "This is a structural analysis of the wiring diagram. It shows which alternative synaptic routes exist "
        "once a cell type is deleted from the graph; it makes no claim about behavior, and it cannot capture "
        "electrical synapses, neuromodulation or timing.",
        "",
        f"Route: strongest path from {PRIMARY[0]} to {PRIMARY[1]} (edge cost -log of the share of the source type's "
        f"output synapses). Removed node: the intermediate type on that route with the highest classifier "
        f"probability, **{removed}** (out-of-fold probability {probability[removed]:.3f}; intermediates were "
        f"{', '.join(intermediates)}).",
        "",
        "| route | before | hops before | after | hops after | output-share product before -> after | outcome |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in records:
        before, after = r["before"], r["after"]
        share = f"{math.exp(-before['cost']):.2e} -> {math.exp(-after['cost']):.2e}" if before and after else "n/a"
        lines.append(
            f"| {r['source']} -> {r['target']} | {' -> '.join(before['types']) if before else 'none'} | "
            f"{before['hops'] if before else 'n/a'} | {' -> '.join(after['types']) if after else 'none'} | "
            f"{after['hops'] if after else 'n/a'} | {share} | {r['outcome']} |"
        )
    lines += ["", "Synapse counts along each route:", ""]
    for r in records:
        for when in ("before", "after"):
            p = r[when]
            if p:
                lines.append(f"- {r['source']} -> {r['target']}, {when}: {Path(p['types'], p['synapses'], p['cost']).describe()}")
    (RESULTS / "ablation_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
