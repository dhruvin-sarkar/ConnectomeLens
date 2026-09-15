"""Precomputed JSON and binary geometry for the static demo site in web/public/data."""

import io
import json
import math
import threading
from concurrent.futures import ThreadPoolExecutor

import navis
import numpy as np
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.manifold import TSNE
from sklearn.preprocessing import normalize
from urllib3.util.retry import Retry

from pipeline.ablation import ABLATION_PATH, as_dict, outcome
from pipeline.build_type_graph import load_type_graph
from pipeline.candidates import CANDIDATES_PATH, HEDGE, describe_feature
from pipeline.common import (
    DATA,
    LABELS_PATH,
    NEURON_ROI_PATH,
    NEURONS_PATH,
    RESULTS,
    SCORES_PATH,
    SEED,
    TYPE_EDGES_PATH,
    WEB_DATA,
)
from pipeline.compute_features import GRAPH_FEATURES
from pipeline.ground_truth import SEX_RELATED
from pipeline.model_diagnostics import DIAGNOSTICS_PATH, SHAP_PATH
from pipeline.pathfinder import find_path
from pipeline.render_hero import MESH_SOURCES, decimate, load_neuropil_meshes, neuropil_scores
from pipeline.train_classifier import load_features, training_set

SKELETON_URL = "https://storage.googleapis.com/flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-swc/{}.swc"
SKELETON_CACHE = DATA / "skeletons"
SKELETON_VOXEL_NM = 8
SKELETON_DOWNSAMPLE = 10
MESH_CELL_NM = 6000.0
N_EXPLANATIONS = 4
N_TYPE_NEUROPILS = 3
N_NEUROPIL_TYPES = 12
N_TOP_ISOMORPHIC = 150
GAME_POOL_SIZE = 40
N_PARTNERS = 6
MAP_COMPONENTS = 64
MAP_PERPLEXITY = 40
ROUTES = [
    ("LPLC2", "TTMn", "Looming detector to jump motor neuron (Giant Fiber escape pathway)"),
    ("LC4", "TTMn", "Second looming detector type to jump motor neuron"),
    ("LPLC2", "DLMn c-f", "Looming detector to indirect flight muscle motor neurons"),
    ("T4c", "VS", "Upward-motion detector to vertical-system tangential cells"),
    ("LC10a", "DNa02", "Visual projection used in courtship pursuit to a steering descending neuron"),
    ("LC10a", "pIP10", "Visual projection used in courtship pursuit to the song descending neuron"),
    ("AOTU008", "DNa02", "Optic tubercle type AOTU008 to a steering descending neuron"),
    ("LoVP92", "pIP10", "Visual projection LoVP92 to the song descending neuron"),
    ("LoVP92", "DNa02", "Visual projection LoVP92 to a steering descending neuron"),
    ("ORN_DA1", "pIP10", "cVA pheromone receptor neurons to the song descending neuron"),
    ("ORN_DA1", "aSP-g3Am", "cVA pheromone receptor neurons to male-specific aSP-g neurons"),
    ("JO-B1_a", "pIP10", "Johnston's organ sound receptors to the song descending neuron"),
    ("pC1_10a", "pIP10", "pC1 courtship cluster neuron to the song descending neuron"),
    ("pIP10", "hg1 MN", "Song descending neuron to a wing steering muscle motor neuron"),
    ("R7p", "DNa02", "Pale R7 color photoreceptors to a steering descending neuron"),
    ("MDN", "Ti extensor MN", "Moonwalker descending neuron to a leg motor neuron"),
    ("ORN_V", "DNa02", "CO2 receptor neurons to a steering descending neuron"),
]


def finite(value):
    """Replace non-finite floats with ``None`` so the output is strict JSON."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite(v) for v in value]
    return value


def write_json(name: str, payload) -> None:
    path = WEB_DATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(finite(payload), separators=(",", ":"), allow_nan=False), encoding="utf-8")


def representative_neurons(neurons: pd.DataFrame, n: int = 3) -> dict[str, list[int]]:
    """Per type, up to ``n`` body IDs in order of preference: right-side soma first, then most synapses."""
    ranked = neurons.assign(right=neurons["somaSide"].eq("R"), synapses=neurons["pre"] + neurons["post"])
    ranked = ranked.sort_values(["type", "right", "synapses"], ascending=[True, False, False])
    return {t: ids.head(n).tolist() for t, ids in ranked.groupby("type")["bodyId"]}


def type_neuropils(roi_counts: pd.DataFrame, neurons: pd.DataFrame) -> pd.DataFrame:
    """Share of each type's synapses (pre + post) per bilateral neuropil, ``unspecified`` regions excluded."""
    merged = roi_counts.merge(neurons[["bodyId", "type"]], on="bodyId")
    merged = merged[~merged["roi"].str.contains("unspecified")]
    merged = merged.assign(
        neuropil=merged["roi"].str.replace(r"\((L|R)\)$", "", regex=True), synapses=merged["pre"] + merged["post"]
    )
    table = merged.groupby(["type", "neuropil"], as_index=False)["synapses"].sum()
    table["share"] = table["synapses"] / table.groupby("type")["synapses"].transform("sum")
    return table.sort_values(["type", "share"], ascending=[True, False])


def neuropil_top_types(roi_counts: pd.DataFrame, neurons: pd.DataFrame) -> dict[str, list]:
    """Per ROI: the types with the most synapses there and their share of the ROI's synapses."""
    merged = roi_counts.merge(neurons[["bodyId", "type"]], on="bodyId")
    merged["synapses"] = merged["pre"] + merged["post"]
    table = merged.groupby(["roi", "type"], as_index=False)["synapses"].sum()
    table["share"] = table["synapses"] / table.groupby("roi")["synapses"].transform("sum")
    table = table.sort_values(["roi", "synapses"], ascending=[True, False]).groupby("roi").head(N_NEUROPIL_TYPES)
    return {roi: [[t, round(float(s), 4)] for t, s in zip(g["type"], g["share"])] for roi, g in table.groupby("roi")}


def explanations(labels: pd.DataFrame) -> dict[str, list]:
    """Per type: the features with the largest SHAP contributions in the fold model that scored it."""
    X, _ = training_set(load_features(), labels)
    contributions = pd.read_parquet(SHAP_PATH).set_index("cell_type")
    if set(contributions.index) != set(X.index) or list(contributions.columns) != list(X.columns):
        raise RuntimeError(f"{SHAP_PATH} does not match the feature table; run pipeline.model_diagnostics")
    result = {}
    for cell_type, row in contributions.iterrows():
        top = row.abs().sort_values(ascending=False).head(N_EXPLANATIONS).index
        result[cell_type] = [[describe_feature(f, X.at[cell_type, f]), round(float(row[f]), 3)] for f in top]
    return result


def wiring_map(graph, order: list[str], seed: int = SEED) -> list[int]:
    """2-D map of the types in which types with similar input and output partners sit close together.

    Each type is described by its log-weighted input and output connection rows; a truncated SVD of those rows is
    embedded with cosine t-SNE. Returns flat x, y pairs scaled to 0–1000, in ``order``.
    """
    n = graph.vcount()
    edges = np.asarray(graph.get_edgelist())
    weights = np.log1p(np.asarray(graph.es["weight"], dtype=float))
    adjacency = sparse.coo_matrix((weights, (edges[:, 0], edges[:, 1])), shape=(n, n)).tocsr()
    rows = sparse.hstack([normalize(adjacency), normalize(adjacency.T.tocsr())]).tocsr()
    reduced = normalize(TruncatedSVD(MAP_COMPONENTS, random_state=seed).fit_transform(rows))
    xy = TSNE(2, perplexity=MAP_PERPLEXITY, init="pca", metric="cosine", random_state=seed).fit_transform(reduced)
    xy -= xy.min(axis=0)
    xy *= 1000 / xy.max()
    position = pd.DataFrame(xy, index=graph.vs["name"]).loc[order]
    return np.rint(position.to_numpy()).astype(int).ravel().tolist()


def wiring_profiles(graph, order: list[str]) -> dict:
    """Topology features and the strongest input and output partners of every type, as rows aligned with ``order``."""
    features = load_features().loc[order, GRAPH_FEATURES]
    position = pd.Series(np.arange(len(order)), index=order).reindex(graph.vs["name"]).to_numpy()
    edges = pd.DataFrame(graph.get_edgelist(), columns=["source", "target"])
    edges["weight"] = np.asarray(graph.es["weight"], dtype=np.int64)
    edges = edges.sort_values("weight", ascending=False, kind="stable")

    def partners(own: str, other: str) -> list[list[int]]:
        top = edges.groupby(own, sort=False).head(N_PARTNERS)
        rows = [[] for _ in order]
        for vertex, partner, weight in zip(top[own], top[other], top["weight"]):
            rows[position[vertex]] += [int(position[partner]), int(weight)]
        return rows

    return {
        "columns": GRAPH_FEATURES,
        "values": [[float(f"{v:.4g}") for v in row] for row in features.astype(float).to_numpy()],
        "inputs": partners("target", "source"),
        "outputs": partners("source", "target"),
    }


_SESSIONS = threading.local()


def http_session() -> requests.Session:
    """Per-thread session that retries dropped connections and transient server errors with backoff."""
    if not hasattr(_SESSIONS, "session"):
        retry = Retry(total=6, backoff_factor=1.0, status_forcelist=[429, 500, 502, 503, 504])
        _SESSIONS.session = requests.Session()
        _SESSIONS.session.mount("https://", HTTPAdapter(max_retries=retry))
    return _SESSIONS.session


def fetch_swc(body_id: int) -> str | None:
    """SWC text for one body from Janelia's public bucket (cached); ``None`` when no skeleton is published."""
    path = SKELETON_CACHE / f"{body_id}.swc"
    if path.exists():
        return path.read_text(encoding="utf-8")
    resp = http_session().get(SKELETON_URL.format(body_id), timeout=120)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    path.write_text(resp.text, encoding="utf-8")
    return resp.text


def skeleton_payload(swc: str, center_um: np.ndarray) -> dict:
    """Downsampled skeleton: flat xyz in whole µm relative to the brain center, each node's parent index (-1 for roots)."""
    neuron = navis.read_swc(io.StringIO(swc))
    neuron = navis.downsample_neuron(neuron, downsampling_factor=SKELETON_DOWNSAMPLE, inplace=False)
    nodes = neuron.nodes
    position = pd.Series(np.arange(len(nodes)), index=nodes["node_id"].to_numpy())
    parents = nodes["parent_id"].map(position).fillna(-1).astype(int)
    xyz = nodes[["x", "y", "z"]].to_numpy(dtype=float) * SKELETON_VOXEL_NM / 1000 - center_um
    return {"points": np.rint(xyz).astype(int).ravel().tolist(), "parents": parents.tolist()}


def fetch_skeletons(cell_types: set[str], body_ids: dict[str, list[int]], center_um: np.ndarray) -> dict[str, int]:
    """Write ``skeletons/<bodyId>.json`` for each type's first sampled neuron with a published skeleton."""
    SKELETON_CACHE.mkdir(parents=True, exist_ok=True)

    def first_available(cell_type: str) -> tuple[str, int | None, str | None]:
        for body_id in body_ids[cell_type]:
            swc = fetch_swc(body_id)
            if swc is not None:
                return cell_type, body_id, swc
        return cell_type, None, None

    with ThreadPoolExecutor(8) as pool:
        fetched = list(pool.map(first_available, sorted(cell_types)))

    chosen = {}
    for cell_type, body_id, swc in fetched:
        if body_id is None:
            print(f"No published skeleton for the sampled neurons of {cell_type}")
            continue
        write_json(f"skeletons/{body_id}.json", {"bodyId": body_id, "type": cell_type, **skeleton_payload(swc, center_um)})
        chosen[cell_type] = body_id
    return chosen


def neuropil_geometry(
    center_nm: np.ndarray, scores: pd.DataFrame, top_types: dict[str, list], annotated: dict[str, float]
) -> list[dict]:
    """Decimated neuropil meshes written as two binary buffers; returns the manifest of per-mesh slices and scores.

    ``annotated`` maps each neuropil to the share of its synapses made by types annotated sex-related.
    """
    score = scores.set_index("neuropil")
    positions, indices, manifest = [], [], []
    vertex_start = index_start = 0
    for region in MESH_SOURCES:
        for name, (vertices, faces) in sorted(load_neuropil_meshes(region).items()):
            vertices, faces = decimate(vertices, faces, MESH_CELL_NM)
            if len(faces) == 0:
                print(f"{name} has no faces at {MESH_CELL_NM / 1000:g} µm resolution; skipped")
                continue
            positions.append(np.round((vertices - center_nm) / 1000, 1).astype("<f4"))
            indices.append(faces.astype("<u4"))
            scored = name in score.index
            manifest.append(
                {
                    "name": name,
                    "region": region,
                    "score": float(score.at[name, "score"]) if scored else None,
                    "annotatedShare": annotated.get(name),
                    "synapses": int(score.at[name, "synapses"]) if scored else 0,
                    "vertexStart": vertex_start,
                    "vertexCount": len(vertices),
                    "indexStart": index_start,
                    "indexCount": int(faces.size),
                    "topTypes": top_types.get(name, []),
                }
            )
            vertex_start += len(vertices)
            index_start += faces.size
    (WEB_DATA / "neuropil_positions.f32").write_bytes(np.concatenate(positions).tobytes())
    (WEB_DATA / "neuropil_indices.u32").write_bytes(np.concatenate(indices).tobytes())
    return manifest


def route_payload(graph, path) -> dict | None:
    """Route as stored by the ablation analysis, plus each edge's share of its source type's output synapses."""
    if path is None:
        return None
    totals = [graph.vs.find(name=t)["synapses_out"] for t in path.types[:-1]]
    return {**as_dict(path), "shares": [float(f"{s / total:.4g}") for s, total in zip(path.synapses, totals)]}


def routes(graph) -> list[dict]:
    """Each curated route, plus the route found after deleting each of its intermediate types in turn."""
    names = set(graph.vs["name"])
    records = []
    for source, target, title in ROUTES:
        if missing := {source, target} - names:
            raise KeyError(f"Route endpoint not in the type graph: {sorted(missing)}")
        path = find_path(graph, source, target)
        if path is None:
            raise RuntimeError(f"No route from {source} to {target}")
        ablations = {}
        for removed in path.types[1:-1]:
            ablated = graph.copy()
            ablated.delete_vertices(ablated.vs.find(name=removed).index)
            after = find_path(ablated, source, target)
            ablations[removed] = {"route": route_payload(graph, after), "outcome": outcome(path, after)}
        records.append(
            {"source": source, "target": target, "title": title, "route": route_payload(graph, path), "ablations": ablations}
        )
    return records


def game_pairs(types: pd.DataFrame, rng: np.random.Generator, n: int) -> list[tuple[str, str]]:
    """Pairs of one sex-related and one isomorphic type sharing superclass and dominant neuropil."""
    sex_related = types[types["label"].isin(SEX_RELATED) & types["dominant"].notna()]
    isomorphic = types[(types["label"] == "isomorphic") & types["dominant"].notna()]
    pools = {key: sorted(group.index) for key, group in isomorphic.groupby(["superclass", "dominant"])}
    pairs, used = [], set()
    for cell_type in rng.permutation(sorted(sex_related.index)):
        key = (sex_related.at[cell_type, "superclass"], sex_related.at[cell_type, "dominant"])
        options = [t for t in pools.get(key, []) if t not in used]
        if options:
            match = options[int(rng.integers(len(options)))]
            pairs.append((str(cell_type), match))
            used.add(match)
        if len(pairs) == n:
            break
    return pairs


def summary(graph, types: pd.DataFrame, neurons: pd.DataFrame) -> dict:
    """Headline numbers, copied from the result files the pipeline wrote."""
    read = lambda name: json.loads((RESULTS / name).read_text(encoding="utf-8"))  # noqa: E731
    ablation = json.loads(ABLATION_PATH.read_text(encoding="utf-8"))
    counts = types["label"].value_counts()
    pairs = pd.read_parquet(TYPE_EDGES_PATH, columns=["weight"])["weight"]
    return {
        "dataset": "male-cns:v1.0",
        "nTypes": int(graph.vcount()),
        "nTypePairs": int(len(pairs)),
        "typePairSynapses": int(pairs.sum()),
        "nEdges": int(graph.ecount()),
        "edgeSynapses": int(sum(graph.es["weight"])),
        "nTypedNeurons": int(len(neurons)),
        "labelCounts": {k: int(v) for k, v in counts.items()},
        "classifier": read("classifier_metrics.json"),
        "nullModel": read("null_model_summary.json"),
        "candidates": read("candidates_summary.json"),
        "ablation": ablation,
        "candidateHedge": HEDGE,
    }


def main() -> None:
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    graph = load_type_graph()
    labels = pd.read_parquet(LABELS_PATH)
    scores = pd.read_parquet(SCORES_PATH).set_index("cell_type")
    neurons = pd.read_parquet(NEURONS_PATH)
    roi_counts = pd.read_parquet(NEURON_ROI_PATH)
    candidates = pd.read_parquet(CANDIDATES_PATH)
    rng = np.random.default_rng(SEED)

    brain = np.concatenate([v for v, _ in load_neuropil_meshes("brain").values()])
    center_nm = (brain.min(axis=0) + brain.max(axis=0)) / 2

    shares = type_neuropils(roi_counts, neurons)
    top_neuropils = {
        t: [[n, round(float(s), 3)] for n, s in zip(g["neuropil"], g["share"])]
        for t, g in shares.groupby("type").head(N_TYPE_NEUROPILS).groupby("type")
    }
    nodes = pd.DataFrame({"superclass": graph.vs["superclass"], "nt": graph.vs["nt"]}, index=graph.vs["name"])
    types = scores.join(nodes).join(neurons["type"].value_counts().rename("n_neurons"))
    types["dominant"] = shares.groupby("type")["neuropil"].first()

    route_records = routes(graph)
    pairs = game_pairs(types, rng, n=GAME_POOL_SIZE + 20)

    wanted = set(types.index[types["label"].isin(SEX_RELATED)])
    wanted |= set(types[types["label"] == "isomorphic"].nlargest(N_TOP_ISOMORPHIC, "oof_probability").index)
    wanted |= set(candidates["cell_type"])
    wanted |= {t for r in route_records for t in r["route"]["types"]}
    wanted |= {t for r in route_records for a in r["ablations"].values() if a["route"] for t in a["route"]["types"]}
    wanted |= {t for pair in pairs for t in pair}

    skeleton_dir = WEB_DATA / "skeletons"
    previous = set(skeleton_dir.glob("*.json")) if skeleton_dir.exists() else set()
    skeletons = fetch_skeletons(wanted, representative_neurons(neurons), center_nm / 1000)
    for stale in previous - {skeleton_dir / f"{b}.json" for b in skeletons.values()}:
        stale.unlink()

    if missing := {t for r in route_records for t in r["route"]["types"]} - set(skeletons):
        raise RuntimeError(f"Route types without skeletons: {sorted(missing)}")
    pairs = [p for p in pairs if p[0] in skeletons and p[1] in skeletons][:GAME_POOL_SIZE]
    if len(pairs) < 10:
        raise RuntimeError(f"Only {len(pairs)} game pairs have skeletons for both types")

    ordered = types.sort_values("oof_probability", ascending=False)
    community = load_features()["community"].astype(int)
    write_json(
        "types.json",
        [
            {
                "t": t,
                "p": round(float(row.oof_probability), 4),
                "l": row.label,
                "n": int(row.n_neurons),
                "s": row.superclass,
                "nt": row.nt,
                "c": int(community[t]),
                "np": top_neuropils.get(t, []),
                "b": skeletons.get(t),
            }
            for t, row in ordered.iterrows()
        ],
    )
    order = ordered.index.tolist()
    write_json("explanations.json", explanations(labels))
    diagnostics = json.loads(DIAGNOSTICS_PATH.read_text(encoding="utf-8"))
    annotated = {r["neuropil"]: r["annotated_share"] for r in diagnostics["neuropil_agreement"]["neuropils"]}
    region_scores = neuropil_scores(roi_counts, neurons, scores.reset_index())
    write_json(
        "neuropils.json", neuropil_geometry(center_nm, region_scores, neuropil_top_types(roi_counts, neurons), annotated)
    )
    write_json("routes.json", route_records)
    write_json("game.json", [{"sexRelated": a, "isomorphic": b} for a, b in pairs])
    write_json("candidates.json", candidates.assign(note=HEDGE).to_dict("records"))
    write_json("summary.json", summary(graph, types, neurons))
    write_json("diagnostics.json", diagnostics)
    write_json("map.json", {"xy": wiring_map(graph, order)})
    write_json("wiring.json", wiring_profiles(graph, order))

    size = sum(p.stat().st_size for p in WEB_DATA.rglob("*") if p.is_file())
    print(
        f"Wrote {WEB_DATA}: {len(types)} types, {len(skeletons)} skeletons, {len(route_records)} routes, "
        f"{len(pairs)} game pairs, {size / 1e6:.1f} MB"
    )


if __name__ == "__main__":
    main()
