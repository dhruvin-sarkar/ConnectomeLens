"""Render the brain's neuropils colored by the classifier's synapse-weighted mean probability."""

import urllib.parse

import matplotlib
import numpy as np
import pandas as pd
import requests
from PIL import Image

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

from pipeline.common import ASSETS, NEURON_ROI_PATH, NEURONS_PATH, RESULTS, SCORES_PATH, DATA  # noqa: E402

MESH_SOURCES = {
    "brain": "https://storage.googleapis.com/flyem-male-cns/rois/fullbrain-roi-v5",
    "vnc": "https://storage.googleapis.com/flyem-male-cns/rois/malecns-vnc-neuropil-roi-v0",
}
MESH_CACHE = DATA / "neuropil_meshes"
HERO_SIZE = (1920, 1080)
SUPERSAMPLE = 2
CMAP = "inferno"
BACKGROUND = "#07070b"


def load_neuropil_meshes(region: str = "brain") -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Janelia's neuropil meshes for ``brain`` or ``vnc``, keyed by ROI name: vertices (nm), triangles.

    ROIs listed in the segment properties but without a published mesh file are reported and skipped.
    """
    source = MESH_SOURCES[region]
    info = requests.get(f"{source}/segment_properties/info", timeout=60).json()["inline"]
    cache = MESH_CACHE / region
    cache.mkdir(parents=True, exist_ok=True)
    meshes = {}
    for name in info["properties"][0]["values"]:
        path = cache / f"{name}.ngmesh"
        if not path.exists():
            resp = requests.get(f"{source}/mesh/{urllib.parse.quote(name)}.ngmesh", timeout=300)
            if resp.status_code == 404:
                print(f"No published {region} mesh for {name}; skipped")
                continue
            resp.raise_for_status()
            path.write_bytes(resp.content)
        raw = path.read_bytes()
        n = int(np.frombuffer(raw[:4], np.uint32)[0])
        vertices = np.frombuffer(raw[4 : 4 + 12 * n], np.float32).reshape(-1, 3).astype(np.float64)
        faces = np.frombuffer(raw[4 + 12 * n :], np.uint32).reshape(-1, 3).astype(np.int64)
        meshes[name] = (vertices, faces)
    return meshes


def face_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Unnormalized triangle normals following the winding order."""
    tri = vertices[faces]
    return np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])


def decimate(vertices: np.ndarray, faces: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """Vertex-clustering simplification: merge vertices sharing a cubic cell of side ``cell``.

    Moving vertices to cluster centroids can invert a triangle; inverted triangles get their original winding back.
    """
    keys = np.floor(vertices / cell).astype(np.int64)
    _, cluster, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    cluster = cluster.ravel()
    merged = np.zeros((len(counts), 3))
    np.add.at(merged, cluster, vertices)
    merged /= counts[:, None]
    remapped = cluster[faces]
    degenerate = (
        (remapped[:, 0] == remapped[:, 1]) | (remapped[:, 1] == remapped[:, 2]) | (remapped[:, 0] == remapped[:, 2])
    )
    remapped, original = remapped[~degenerate], faces[~degenerate]
    flipped = np.einsum("ij,ij->i", face_normals(vertices, original), face_normals(merged, remapped)) < 0
    remapped[flipped] = remapped[flipped][:, [0, 2, 1]]
    _, first = np.unique(np.sort(remapped, axis=1), axis=0, return_index=True)
    return merged, remapped[np.sort(first)]


def neuropil_scores(roi_counts: pd.DataFrame, neurons: pd.DataFrame, scores: pd.DataFrame) -> pd.DataFrame:
    """Per ROI: mean out-of-fold probability over neurons, weighted by their synapses in the ROI."""
    probability = scores.set_index("cell_type")["oof_probability"]
    merged = roi_counts.merge(neurons[["bodyId", "type"]], on="bodyId")
    merged["synapses"] = merged["pre"] + merged["post"]
    merged["weighted"] = merged["synapses"] * merged["type"].map(probability)
    table = merged.groupby("roi")[["weighted", "synapses"]].sum()
    return (
        pd.DataFrame({"score": table["weighted"] / table["synapses"], "synapses": table["synapses"].astype(int)})
        .rename_axis("neuropil")
        .reset_index()
        .sort_values("score", ascending=False)
    )


def view_rotation(pitch_degrees: float) -> np.ndarray:
    """Rotation about the left-right axis; positive pitch tips the dorsal surface towards the viewer."""
    a = np.radians(pitch_degrees)
    return np.array([[1, 0, 0], [0, np.cos(a), np.sin(a)], [0, -np.sin(a), np.cos(a)]])


def render(meshes: dict, scores: pd.Series, path, pitch_degrees: float = 22.0) -> None:
    """Orthographic anterior view tipped by ``pitch_degrees``; faces depth-sorted back to front."""
    cmap = plt.get_cmap(CMAP)
    vmax = float(np.ceil(scores.max() * 10) / 10)
    light = np.array([-0.35, -0.55, -0.76])
    light /= np.linalg.norm(light)
    rotation = view_rotation(pitch_degrees)
    center = np.concatenate([v for name, (v, _) in meshes.items() if name in scores.index]).mean(axis=0)

    polygons, colors, depths = [], [], []
    for name, (vertices, faces) in meshes.items():
        if name not in scores.index:
            continue
        v, f = decimate(vertices, faces, cell=2500.0)
        v = (v - center) @ rotation.T
        tri = v[f]
        face_normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        vertex_normals = np.zeros_like(v)
        for corner in range(3):
            np.add.at(vertex_normals, f[:, corner], face_normals)
        vertex_normals /= np.linalg.norm(vertex_normals, axis=1, keepdims=True) + 1e-12
        lambert = np.abs(vertex_normals @ light)[f].mean(axis=1)
        base = np.array(cmap(0.12 + 0.88 * scores[name] / vmax))[:3]
        shade = (0.28 + 0.72 * lambert)[:, None]
        colors.append(np.clip(base * shade + 0.10 * lambert[:, None] ** 12, 0, 1))
        polygons.append(tri[:, :, :2] * [1, -1])
        depths.append(tri[:, :, 2].mean(axis=1))

    order = np.argsort(-np.concatenate(depths))
    polygons = np.concatenate(polygons)[order]
    colors = np.concatenate(colors)[order]

    width, height = (s * SUPERSAMPLE for s in HERO_SIZE)
    fig = plt.figure(figsize=(width / 100, height / 100), dpi=100, facecolor=BACKGROUND)
    ax = fig.add_axes([0.03, 0.03, 0.94, 0.72], facecolor=BACKGROUND)
    ax.add_collection(PolyCollection(polygons, facecolors=colors, edgecolors=colors, linewidths=0.5, antialiased=False))
    xy = polygons.reshape(-1, 2)
    ax.set_xlim(xy[:, 0].min(), xy[:, 0].max())
    ax.set_ylim(xy[:, 1].min(), xy[:, 1].max())
    ax.set_aspect("equal")
    ax.axis("off")

    s = SUPERSAMPLE
    muted = "#a9a9b8"
    fig.text(0.04, 0.945, "Wired Different", color="white", fontsize=40 * s, fontweight="bold", va="top")
    fig.text(
        0.04,
        0.868,
        "Each neuropil of the male Drosophila brain, colored by how sex-specific\n"
        "the wiring of its cell types looks to a classifier trained on the male connectome",
        color=muted,
        fontsize=15 * s,
        va="top",
        linespacing=1.5,
    )
    fig.text(0.96, 0.945, "predicted probability of a sex-related cell type", color=muted, fontsize=12 * s, ha="right", va="top")
    fig.text(0.96, 0.915, "(synapse-weighted mean per neuropil)", color="#6f6f7e", fontsize=11 * s, ha="right", va="top")
    bar = fig.add_axes([0.74, 0.855, 0.22, 0.02])
    bar.imshow(np.linspace(0.12, 1.0, 256)[None, :], aspect="auto", cmap=CMAP, vmin=0, vmax=1, extent=[0, vmax, 0, 1])
    bar.set_yticks([])
    bar.set_xticks([0, vmax / 2, vmax])
    bar.tick_params(colors=muted, labelsize=11 * s, length=0, pad=5)
    for spine in bar.spines.values():
        spine.set_visible(False)
    fig.text(
        0.96,
        0.025,
        "Data: male CNS connectome, HHMI Janelia FlyEM and Google Research (Berg et al., Cell 2026), CC-BY 4.0",
        color="#5f5f6e",
        fontsize=10 * s,
        ha="right",
    )
    fig.canvas.draw()
    image = Image.frombuffer("RGBA", fig.canvas.get_width_height(), fig.canvas.buffer_rgba()).convert("RGB")
    plt.close(fig)
    image.resize(HERO_SIZE, Image.LANCZOS).save(path, optimize=True)


def main() -> None:
    table = neuropil_scores(
        pd.read_parquet(NEURON_ROI_PATH), pd.read_parquet(NEURONS_PATH), pd.read_parquet(SCORES_PATH)
    )
    RESULTS.mkdir(exist_ok=True)
    table.to_csv(RESULTS / "neuropil_scores.csv", index=False, float_format="%.4f")

    meshes = load_neuropil_meshes()
    ASSETS.mkdir(exist_ok=True)
    out = ASSETS / "hero.png"
    render(meshes, table.set_index("neuropil")["score"], out)
    rendered = sorted(set(meshes) & set(table["neuropil"]))
    print(f"Wrote {out} ({HERO_SIZE[0]}x{HERO_SIZE[1]}, {len(rendered)} neuropils)")
    print(table.head(12).to_string(index=False))


if __name__ == "__main__":
    main()
