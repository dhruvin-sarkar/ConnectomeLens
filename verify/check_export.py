"""Check the site data matches the pipeline results it was exported from."""

import json

import numpy as np
import pandas as pd

from export.build_static_json import GAME_POOL_SIZE, ROUTES
from pipeline.common import FEATURES_PATH, RESULTS, SCORES_PATH, WEB_DATA
from pipeline.ground_truth import SEX_RELATED


def load(name: str):
    return json.loads((WEB_DATA / name).read_text(encoding="utf-8"))


def main() -> None:
    scores = pd.read_parquet(SCORES_PATH).set_index("cell_type")
    types = {t["t"]: t for t in load("types.json")}
    assert set(types) == set(scores.index), "types.json does not cover exactly the scored types"
    assert all(abs(types[t]["p"] - p) < 1e-4 for t, p in scores["oof_probability"].items()), "Probabilities differ"
    assert all(types[t]["l"] == label for t, label in scores["label"].items()), "Labels differ"

    summary = load("summary.json")
    metrics = json.loads((RESULTS / "classifier_metrics.json").read_text(encoding="utf-8"))
    null = json.loads((RESULTS / "null_model_summary.json").read_text(encoding="utf-8"))
    assert summary["classifier"]["auc_pr"] == metrics["auc_pr"], "Headline AUC-PR differs from classifier_metrics.json"
    assert summary["nullModel"]["full"]["p_value"] == null["full"]["p_value"], "p-value differs from null_model_summary.json"

    routes = load("routes.json")
    assert [(r["source"], r["target"]) for r in routes] == [(s, t) for s, t, _ in ROUTES], "Routes differ from ROUTES"
    giant_fiber = next(r for r in routes if (r["source"], r["target"]) == ("LPLC2", "TTMn"))
    assert "DNp01" in giant_fiber["route"]["types"], "Giant Fiber missing from the exported LPLC2 -> TTMn route"
    for r in routes:
        route = r["route"]
        assert len(route["synapses"]) == len(route["shares"]) == route["hops"], f"Malformed route {r['source']}"
        assert np.isclose(np.prod(route["shares"]), np.exp(-route["cost"]), rtol=1e-3), f"Shares disagree with cost for {r['source']}"
        assert set(r["ablations"]) == set(route["types"][1:-1]), f"Ablations do not cover the intermediates of {r['source']}"

    skeletons = {p.stem for p in (WEB_DATA / "skeletons").glob("*.json")}
    needed = {types[t]["b"] for r in routes for t in r["route"]["types"]}
    game = load("game.json")
    needed |= {types[p[k]]["b"] for p in game for k in ("sexRelated", "isomorphic")}
    assert None not in needed and {str(b) for b in needed} <= skeletons, "Route or game neuron without a skeleton file"
    assert 10 <= len(game) <= GAME_POOL_SIZE, "Game pool smaller than one game"
    for pair in game:
        a, b = types[pair["sexRelated"]], types[pair["isomorphic"]]
        assert a["l"] in SEX_RELATED and b["l"] == "isomorphic", f"Mislabeled game pair {pair}"
        assert a["s"] == b["s"] and a["np"][0][0] == b["np"][0][0], f"Game pair not matched on superclass and neuropil {pair}"

    manifest = load("neuropils.json")
    last = manifest[-1]
    assert (WEB_DATA / "neuropil_positions.f32").stat().st_size == 12 * (last["vertexStart"] + last["vertexCount"])
    assert (WEB_DATA / "neuropil_indices.u32").stat().st_size == 4 * (last["indexStart"] + last["indexCount"])
    assert all(n["annotatedShare"] is not None for n in manifest if n["synapses"] > 0), "Neuropil without annotated share"

    order = list(types)
    diagnostics = json.loads((RESULTS / "model_diagnostics.json").read_text(encoding="utf-8"))
    assert load("diagnostics.json") == diagnostics, "diagnostics.json differs from results/model_diagnostics.json"
    xy = load("map.json")["xy"]
    assert len(xy) == 2 * len(order) and min(xy) >= 0 and max(xy) <= 1000, "Wiring map does not cover every type"
    wiring = load("wiring.json")
    assert len(wiring["values"]) == len(wiring["inputs"]) == len(wiring["outputs"]) == len(order), "Wiring rows misaligned"
    features = pd.read_parquet(FEATURES_PATH).set_index("cell_type")
    for i in (0, len(order) // 2, len(order) - 1):
        expected = features.loc[order[i], wiring["columns"]].astype(float).to_numpy()
        assert np.allclose(wiring["values"][i], expected, rtol=1e-3), f"Wiring features misaligned for {order[i]}"
    assert all(max(row[0::2], default=0) < len(order) for row in wiring["inputs"]), "Partner index out of range"

    print(
        f"OK: {len(types)} types, {len(routes)} routes (Giant Fiber on LPLC2 -> TTMn), {len(game)} game pairs, "
        f"{len(skeletons)} skeletons, {len(manifest)} neuropil meshes"
    )


if __name__ == "__main__":
    main()
