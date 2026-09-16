"""Render the data figures used in the README, in light and dark variants."""

import argparse
import gc
import io
import json
import re
import tempfile
from collections.abc import Callable, Sequence
from html import escape
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
from fontTools.ttLib import TTFont

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402
from matplotlib.font_manager import FontProperties  # noqa: E402
from matplotlib.patches import Circle, FancyBboxPatch, PathPatch  # noqa: E402
from matplotlib.path import Path as MplPath  # noqa: E402

from pipeline.common import ASSETS, RESULTS, WEB_DATA  # noqa: E402
from verify.check_classifier import TOP_N  # noqa: E402

WIDTH = 1760
MARGIN = 64
OUT_DIR = ASSETS / "readme"

THEMES = {
    "light": {
        "ground": "#f3f5f6",
        "border": None,
        "track": "#e6eaed",
        "rule": "#d3d9de",
        "rule_strong": "#aab3bb",
        "faint": "#d3d9de",
        "ink": "#0e1216",
        "ink2": "#454f59",
        "ink3": "#5c6670",
        "axis": "#7d8791",
        "magenta": "#b8166f",
        "magenta_soft": "#f5d3e6",
        "green": "#0a8448",
        "cyan": "#0a7690",
        "neutral": "#8a939c",
    },
    "dark": {
        "ground": "#0b0d10",
        "border": "#262b31",
        "track": "#161a1f",
        "rule": "#262b31",
        "rule_strong": "#5c6670",
        "faint": "#454f59",
        "ink": "#e8edf1",
        "ink2": "#98a2ac",
        "ink3": "#7c8690",
        "axis": "#7c8690",
        "magenta": "#ff4fc3",
        "magenta_soft": "#3a1830",
        "green": "#45f090",
        "cyan": "#52d8f2",
        "neutral": "#6c7680",
    },
}

FONT_FILES = {
    "sans": "Atkinson-Regular.ttf",
    "sans_bold": "Atkinson-SemiBold.ttf",
    "serif": "NewsreaderText.ttf",
}
# Figures in the sans face are set tabular, as on the site.
TABULAR_ROLES = ("sans", "sans_bold")
_fonts: dict[str, Path | None] = dict.fromkeys(FONT_FILES)

LABEL_COLORS = {"male_specific": "green", "dimorphic": "cyan"}
LABEL_NAMES = {"male_specific": "Male-specific", "dimorphic": "Dimorphic"}


def tabular_copy(source: Path, target: Path) -> None:
    """Write a copy of ``source`` whose cmap points digits at their tabular ('tnum') glyphs."""
    font = TTFont(source)
    mapping: dict[str, str] = {}
    if "GSUB" in font:
        gsub = font["GSUB"].table
        for record in gsub.FeatureList.FeatureRecord:
            if record.FeatureTag != "tnum":
                continue
            for index in record.Feature.LookupListIndex:
                for subtable in gsub.LookupList.Lookup[index].SubTable:
                    subtable = getattr(subtable, "ExtSubTable", subtable)
                    mapping.update(getattr(subtable, "mapping", None) or {})
    for table in font["cmap"].tables:
        table.cmap = {code: mapping.get(name, name) for code, name in table.cmap.items()}
    font.save(target)


def configure(font_dir: Path | None, work_dir: Path) -> None:
    """Set rcParams shared by every figure and register the font files, if given."""
    matplotlib.rcParams.update(
        {
            "svg.fonttype": "path",
            "svg.hashsalt": "wired-different",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.linewidth": 2,
            "xtick.major.width": 2,
            "ytick.major.width": 2,
            "xtick.major.size": 8,
            "ytick.major.size": 8,
            "xtick.labelsize": 26,
            "ytick.labelsize": 26,
            "figure.dpi": 72,
            "savefig.dpi": 72,
            "lines.scale_dashes": False,
            "lines.solid_capstyle": "butt",
            "lines.dash_capstyle": "butt",
        }
    )
    if font_dir is None:
        print("No --font-dir given; falling back to matplotlib's default fonts")
        return
    for role, name in FONT_FILES.items():
        path = font_dir / name
        if not path.exists():
            raise FileNotFoundError(path)
        if role in TABULAR_ROLES:
            tabular = work_dir / name
            tabular_copy(path, tabular)
            path = tabular
        _fonts[role] = path
        font_manager.fontManager.addfont(path)
    matplotlib.rcParams.update(
        {
            "mathtext.fontset": "custom",
            "mathtext.rm": FontProperties(fname=_fonts["sans"]).get_name(),
            "mathtext.it": FontProperties(fname=_fonts["sans"]).get_name(),
            "mathtext.bf": FontProperties(fname=_fonts["sans_bold"]).get_name(),
        }
    )


def font(role: str, size: float) -> FontProperties:
    """FontProperties for ``role`` (sans, sans_bold, serif) at ``size`` points."""
    path = _fonts[role]
    if path is not None:
        return FontProperties(fname=path, size=size)
    family = "serif" if role == "serif" else "sans-serif"
    return FontProperties(family=family, weight="bold" if role == "sans_bold" else "normal", size=size)


class Plate:
    """A figure drawn in canvas units: origin top left, one unit per point, on a rounded ground."""

    def __init__(self, height: int, theme: str) -> None:
        self.theme = THEMES[theme]
        self.height = height
        self.fig = plt.figure(figsize=(WIDTH / 72, height / 72), dpi=72)
        self.ax = self.fig.add_axes((0, 0, 1, 1))
        self.ax.set_xlim(0, WIDTH)
        self.ax.set_ylim(height, 0)
        self.ax.axis("off")
        border = self.theme["border"]
        inset = 1 if border else 0
        self.ax.add_patch(
            FancyBboxPatch(
                (inset, inset),
                WIDTH - 2 * inset,
                height - 2 * inset,
                boxstyle=f"round,pad=0,rounding_size={16 - inset}",
                facecolor=self.theme["ground"],
                edgecolor=border or "none",
                linewidth=2 if border else 0,
                zorder=0,
            )
        )
        self._renderer = None

    def color(self, name: str) -> str:
        return self.theme.get(name, name)

    def text(
        self,
        x: float,
        y: float,
        s: str,
        size: float = 26,
        role: str = "sans",
        color: str = "ink",
        ha: str = "left",
        zorder: float = 5,
    ):
        """Place ``s`` with its baseline at ``y``."""
        return self.ax.text(
            x, y, s, fontproperties=font(role, size), color=self.color(color), ha=ha, va="baseline", zorder=zorder
        )

    def text_width(self, s: str, size: float = 26, role: str = "sans") -> float:
        if self._renderer is None:
            self._renderer = self.fig.canvas.get_renderer()
        artist = self.text(0, 0, s, size=size, role=role)
        width = artist.get_window_extent(self._renderer).width
        artist.remove()
        return width

    def line(
        self,
        xs: Sequence[float],
        ys: Sequence[float],
        color: str,
        width: float = 2,
        dashes: tuple[float, float] | None = None,
        alpha: float = 1,
        zorder: float = 3,
    ) -> None:
        (artist,) = self.ax.plot(
            xs, ys, color=self.color(color), linewidth=width, alpha=alpha, zorder=zorder, solid_joinstyle="round"
        )
        if dashes:
            artist.set_linestyle((0, dashes))

    def rects(
        self, boxes: Sequence[tuple[float, float, float, float]], color: str, alpha: float = 1, zorder: float = 2
    ) -> None:
        """Fill (x0, y0, x1, y1) boxes as one compound path."""
        if len(boxes) == 0:
            return
        vertices, codes = [], []
        for x0, y0, x1, y1 in boxes:
            vertices += [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
            codes += [MplPath.MOVETO, MplPath.LINETO, MplPath.LINETO, MplPath.LINETO, MplPath.CLOSEPOLY]
        self.ax.add_patch(
            PathPatch(
                MplPath(vertices, codes), facecolor=self.color(color), edgecolor="none", alpha=alpha, zorder=zorder
            )
        )

    def outline(self, x0: float, y0: float, x1: float, y1: float, color: str, width: float = 2) -> None:
        h = width / 2
        xs = [x0 + h, x1 - h, x1 - h, x0 + h, x0 + h]
        self.line(xs, [y0 + h, y0 + h, y1 - h, y1 - h, y0 + h], color, width, zorder=4)

    def dot(
        self, x: float, y: float, r: float, color: str, hollow: bool = False, ring: float = 0, zorder: float = 6
    ) -> None:
        """Circle of radius ``r``; ``hollow`` draws a 3-unit outline, ``ring`` adds a ground-colored halo."""
        if ring:
            self.ax.add_patch(Circle((x, y), r + ring, facecolor=self.color("ground"), edgecolor="none", zorder=zorder))
        if hollow:
            face, edge, lw = self.color("ground"), self.color(color), 3
            r -= 1.5
        else:
            face, edge, lw = self.color(color), "none", 0
        self.ax.add_patch(Circle((x, y), r, facecolor=face, edgecolor=edge, linewidth=lw, zorder=zorder))


def linear(d0: float, d1: float, r0: float, r1: float) -> Callable[[float], float]:
    """Map the data interval [d0, d1] onto the canvas interval [r0, r1]."""
    return lambda v: r0 + (v - d0) / (d1 - d0) * (r1 - r0)


def fmt3(value: float) -> str:
    return f"{value:.3f}"


def pct(value: float) -> str:
    return f"{round(value * 100)}%"


def merged_intervals(xs: np.ndarray, width: float, limit: float) -> list[tuple[float, float]]:
    """Union of [x, x + width] intervals, clipped at ``limit``."""
    runs: list[list[float]] = []
    for x in np.sort(xs):
        if runs and x <= runs[-1][1]:
            runs[-1][1] = max(runs[-1][1], x + width)
        else:
            runs.append([x, x + width])
    return [(a, min(b, limit)) for a, b in runs]


def load_inputs() -> dict:
    """Committed results and site data behind the figures."""
    types = pd.DataFrame(json.loads((WEB_DATA / "types.json").read_text(encoding="utf-8")))[["t", "p", "l"]]
    return {
        "diagnostics": json.loads((RESULTS / "model_diagnostics.json").read_text(encoding="utf-8")),
        "metrics": json.loads((RESULTS / "classifier_metrics.json").read_text(encoding="utf-8")),
        "null_summary": json.loads((RESULTS / "null_model_summary.json").read_text(encoding="utf-8")),
        "null_scores": pd.read_csv(RESULTS / "null_model_scores.csv"),
        "types": types.sort_values("p", ascending=False, kind="stable").reset_index(drop=True),
    }


def rug(plate: Plate, labels: np.ndarray, x0: float, x1: float, top: float, lane: float, tick: float) -> list[float]:
    """Ranked rug in two lanes, male-specific above dimorphic; returns the lane centers."""
    step = (x1 - x0) / len(labels)
    centers = []
    for i, label in enumerate(LABEL_NAMES):
        y0 = top + i * (lane + 4)
        plate.rects([(x0, y0, x1, y0 + lane)], "track", zorder=1)
        runs = merged_intervals(x0 + np.flatnonzero(labels == label) * step, tick, x1)
        plate.rects([(a, y0, b, y0 + lane) for a, b in runs], LABEL_COLORS[label], alpha=0.9)
        centers.append(y0 + lane / 2)
    return centers


def figure_ranking(data: dict, theme: str) -> tuple[Figure, str]:
    """Figure 1: ranked rug of every type, the enlarged top decile, and precision-recall curves."""
    plate = Plate(1168, theme)
    diag, metrics, types = data["diagnostics"], data["metrics"], data["types"]
    n_types = len(types)
    n_iso = metrics["n_isomorphic"]
    n_pos = metrics["n_sex_related"]
    n_full = metrics["feature_sets"]["full"]["n_features"]
    n_class = {k: metrics["per_class"][k]["n_positive"] for k in LABEL_NAMES}
    n_ms, n_di = n_class["male_specific"], n_class["dimorphic"]
    top1, _, top10 = diag["top_fraction_capture"]
    labels = types["l"].to_numpy()
    sex_related = np.isin(labels, list(LABEL_NAMES))
    for entry in (top1, top10):
        if int(sex_related[: entry["k"]].sum()) != entry["sex_related"]:
            raise ValueError("types.json ranking disagrees with model_diagnostics.json")

    plate.text(MARGIN, 80, f"All {n_types:,} cell types, ranked by classifier probability", 34, "sans_bold")
    plate.text(
        MARGIN,
        122,
        f"Each tick is one annotated sex-related type, highest probability at left. "
        f"The other {n_iso:,} types are isomorphic.",
        26,
        color="ink2",
    )
    lane_names = [f"{LABEL_NAMES[k]} ({n_class[k]})" for k in LABEL_NAMES]
    x0 = MARGIN + max(plate.text_width(name) for name in lane_names) + 24
    x1 = WIDTH - MARGIN

    # Full ranking.
    a0, lane_a = 160, 34
    a1 = a0 + 2 * lane_a + 4
    for name, cy in zip(lane_names, rug(plate, labels, x0, x1, a0, lane_a, 1.6)):
        plate.text(MARGIN, cy + 9, name, 26, color="ink2")
    plate.text(x1, a1 + 34, f"Rank {n_types:,}", 26, color="ink3", ha="right")

    # Zoom onto the top decile.
    b0, lane_b = 376, 38
    b1 = b0 + 2 * lane_b + 4
    zoom_end = x0 + top10["k"] * (x1 - x0) / n_types
    bracket = a1 + 18
    plate.line([x0, x0, zoom_end, zoom_end], [a1 + 6, bracket, bracket, a1 + 6], "ink3", 2)
    plate.line([x0, x0], [bracket, b0 - 10], "rule_strong", 2, dashes=(6, 6))
    plate.line([zoom_end, x1], [bracket, b0 - 10], "rule_strong", 2, dashes=(6, 6))
    zoom_label = (
        f"Top {top10['fraction']:.0%}, enlarged: {top10['sex_related']} of {top10['k']:,} types are sex-related, "
        f"{pct(top10['recall'])} of all {n_pos}"
    )
    label_x = x0 + 24
    right = label_x + plate.text_width(zoom_label, 28)
    diagonal = bracket + (right - zoom_end) / (x1 - zoom_end) * (b0 - 10 - bracket)
    plate.text(label_x, max(diagonal + 32, b0 - 30), zoom_label, 28)

    for name, cy in zip(LABEL_NAMES.values(), rug(plate, labels[: top10["k"]], x0, x1, b0, lane_b, 1.4)):
        plate.text(MARGIN, cy + 9, name, 26, color="ink2")
    top1_end = x0 + top1["k"] * (x1 - x0) / top10["k"]
    plate.line([x0, x0, top1_end, top1_end], [b1 + 6, b1 + 18, b1 + 18, b1 + 6], "ink3", 2)
    top1_label = f"Top {top1['fraction']:.0%}: {top1['sex_related']} of {top1['k']} are sex-related"
    plate.text(top1_end + 16, b1 + 30, top1_label, 28)
    plate.text(x1, b1 + 34, f"Rank {top10['k']:,}", 26, color="ink3", ha="right")

    # Precision against recall.
    px0, px1, py0, py1 = 160, 1236, 636, 1048
    to_x = linear(0, 1, px0, px1)
    to_y = linear(0, 1, py1, py0)
    plate.text(MARGIN, 560, "Precision against recall", 34, "sans_bold")
    plate.text(MARGIN, 608, "Precision", 26, color="ink2")
    plate.text((px0 + px1) / 2, 1128, "Recall", 26, color="ink2", ha="center")
    for v in (0.25, 0.5, 0.75, 1):
        plate.line([px0, px1], [to_y(v), to_y(v)], "rule", 1, zorder=1)
    for v, s in ((0, "0"), (0.25, "0.25"), (0.5, "0.5"), (0.75, "0.75"), (1, "1")):
        plate.line([px0 - 8, px0], [to_y(v), to_y(v)], "axis", 2)
        plate.text(px0 - 16, to_y(v) + 9, s, 26, color="ink2", ha="right")
        plate.line([to_x(v), to_x(v)], [py1, py1 + 8], "axis", 2)
        plate.text(to_x(v), py1 + 38, s, 26, color="ink2", ha="center")
    plate.line([px0, px0, px1], [py0, py1, py1], "axis", 2, zorder=2)

    chance = metrics["baseline_auc_pr"]
    plate.line([px0, px1], [to_y(chance), to_y(chance)], "rule_strong", 2, dashes=(4, 6), zorder=2)

    series = [
        ("full", f"All {n_full} features", "magenta", 5, None),
        ("static_only", "Static only", "ink2", 3, None),
        ("hemilineage_grouped", "Hemilineage folds", "ink3", 3, (8, 6)),
        ("topology_only", "Topology only", "neutral", 3, None),
    ]
    curves = diag["curves"]
    series.sort(key=lambda s: -curves[s[0]]["auc_pr"])
    for key, _, color, lw, dashes in reversed(series):
        recall = np.concatenate([[0.0], curves[key]["recall"]])
        precision = np.concatenate([[curves[key]["precision"][0]], curves[key]["precision"]])
        plate.line(to_x(recall), to_y(precision), color, lw, dashes=dashes, zorder=5 if key == "full" else 4)

    # Key: line sample, name and AUC-PR, ordered by AUC-PR.
    kx0, pitch = px1 + 84, 46
    ky = py0 + 22
    plate.text(x1, ky, "AUC-PR", 26, color="ink3", ha="right")
    rows = [(name, curves[k]["auc_pr"], color, lw, dashes, k == "full") for k, name, color, lw, dashes in series]
    rows.append(("Chance", chance, "rule_strong", 2, (4, 6), False))
    for i, (name, value, color, lw, dashes, lead) in enumerate(rows):
        y = ky + (i + 1) * pitch
        plate.line([kx0, kx0 + 44], [y - 9, y - 9], color, lw, dashes=dashes)
        role = "sans_bold" if lead else "sans"
        ink = "ink" if lead else "ink2"
        plate.text(kx0 + 60, y, name, 26, role, color=ink)
        plate.text(x1, y, fmt3(value), 26, role, color=ink, ha="right")

    # The top 1% and top 10% of the ranking above, as points on the full model's curve.
    for entry, dx, dy in ((top1, 16, -22), (top10, 18, -24)):
        tx, ty = to_x(entry["recall"]), to_y(entry["precision"])
        plate.dot(tx, ty, 9, "magenta", ring=3, zorder=7)
        plate.text(tx + dx, ty + dy, f"Top {entry['fraction']:.0%}", 26, "sans_bold", color="ink")
    note_y = ky + (len(rows) + 1) * pitch + 30
    plate.dot(kx0 + 22, note_y - 9, 9, "magenta")
    for i, line in enumerate(("Top 1% and top 10% of", "the ranking above")):
        plate.text(kx0 + 60, note_y + i * 36, line, 26, color="ink2")

    desc = (
        f"Figure 1. Top: a barcode of all {n_types:,} cell types ranked by classifier probability. "
        f"Green ticks for the {n_ms} male-specific types and cyan ticks for the {n_di} dimorphic types "
        f"crowd the left end. An enlarged top {top10['fraction']:.0%} shows that {top1['sex_related']} of the "
        f"{top1['k']} highest-scoring types are sex-related, and the top {top10['fraction']:.0%} holds "
        f"{pct(top10['recall'])} of all {n_pos}. Bottom: precision-recall curves with AUC-PR "
        f"{fmt3(curves['full']['auc_pr'])} for all {n_full} features, {fmt3(curves['static_only']['auc_pr'])} static "
        f"features only, {fmt3(curves['hemilineage_grouped']['auc_pr'])} with hemilineage-grouped folds and "
        f"{fmt3(curves['topology_only']['auc_pr'])} topology only, against chance at {fmt3(chance)}."
    )
    return plate.fig, desc


def histogram_counts(values: np.ndarray, width: float = 0.001) -> tuple[np.ndarray, np.ndarray]:
    """Counts in bins of ``width`` aligned to its multiples; returns left edges and counts."""
    index = np.floor(values / width + 1e-9).astype(int)
    lo = index.min()
    counts = np.bincount(index - lo)
    return (lo + np.arange(len(counts))) * width, counts


def figure_null(data: dict, theme: str) -> tuple[Figure, str]:
    """Figure 2: randomized-graph AUC-PR histograms against the real wiring."""
    plate = Plate(760, theme)
    summary, scores = data["null_summary"], data["null_scores"]
    n_trials = summary["n_trials"]
    n_full = data["metrics"]["feature_sets"]["full"]["n_features"]
    py0, py1 = 220, 620
    bin_width = 0.001

    def subtitle(s: dict) -> str:
        return (
            f"Randomized {fmt3(s['null_mean'])} ± {fmt3(s['null_sd'])}, {s['n_exceeding']} of {n_trials} "
            f"at or above real, p = {fmt3(s['p_value'])}"
        )

    def y_axis(x: float, top: int, ticks: list[int]) -> Callable[[float], float]:
        to_y = linear(0, top, py1, py0)
        for t in ticks:
            plate.line([x - 8, x], [to_y(t), to_y(t)], "axis", 2)
            plate.text(x - 16, to_y(t) + 9, str(t), 26, color="ink2", ha="right")
        plate.line([x, x], [py0, py1], "axis", 2)
        plate.text(MARGIN if x < WIDTH / 2 else x - 60, py0 - 36, "Randomized graphs", 26, color="ink2")
        return to_y

    def bars(to_x, to_y, values: np.ndarray, lo: float, hi: float) -> None:
        edges, counts = histogram_counts(values, bin_width)
        boxes = [
            (to_x(left + bin_width * 0.06), to_y(count), to_x(left + bin_width * 0.94), py1)
            for left, count in zip(edges, counts)
            if count and lo <= left and left + bin_width <= hi
        ]
        plate.rects(boxes, "neutral")

    def x_ticks(to_x, ticks) -> None:
        for t in ticks:
            plate.line([to_x(t), to_x(t)], [py1, py1 + 8], "axis", 2)
            plate.text(to_x(t), py1 + 38, f"{t:.2f}", 26, color="ink2", ha="center")

    def real_rule(x: float, value: float) -> None:
        plate.line([x, x], [py1, py0 - 12], "magenta", 5, zorder=6)
        plate.text(x - 18, py0 + 22, "Real wiring", 26, "sans_bold", color="magenta", ha="right")
        plate.text(x - 18, py0 + 74, fmt3(value), 50, "serif", color="magenta", ha="right")

    # All features.
    plate.text(MARGIN, 90, f"All {n_full} features", 34, "sans_bold")
    plate.text(MARGIN, 132, subtitle(summary["full"]), 26, color="ink2")
    ax0, ax1, lo, hi = 124, 840, 0.690, 0.765
    to_x = linear(lo, hi, ax0, ax1)
    to_y = y_axis(ax0, 60, [0, 20, 40, 60])
    bars(to_x, to_y, scores["auc_pr_full"].to_numpy(), lo, hi)
    plate.line([ax0, ax1], [py1, py1], "axis", 2)
    x_ticks(to_x, np.round(np.arange(0.69, 0.7651, 0.01), 2))
    real_rule(to_x(summary["full"]["real"]), summary["full"]["real"])

    # Topology only, on a broken axis at one scale.
    right0 = 920
    plate.text(right0, 90, "Graph topology features only", 34, "sans_bold")
    plate.text(right0, 132, subtitle(summary["topology_only"]), 26, color="ink2")
    rx0, rx1, gap = 980, 1696, 24
    seg_a = (0.055, 0.095)
    width_a = (rx1 - rx0 - gap) * 0.7
    scale = width_a / (seg_a[1] - seg_a[0])
    real_topo = summary["topology_only"]["real"]
    seg_b_lo = np.floor(real_topo * 100) / 100 - 0.0045
    seg_b = (seg_b_lo, seg_b_lo + (rx1 - rx0 - gap - width_a) / scale)
    xa1 = rx0 + width_a
    xb0 = xa1 + gap
    to_xa = linear(*seg_a, rx0, xa1)
    to_xb = linear(*seg_b, xb0, rx1)
    to_y = y_axis(rx0, 70, [0, 35, 70])
    bars(to_xa, to_y, scores["auc_pr_topology_only"].to_numpy(), *seg_a)
    plate.line([rx0, xa1], [py1, py1], "axis", 2)
    plate.line([xb0, rx1], [py1, py1], "axis", 2)
    for dx in (-5, 5):
        cx = (xa1 + xb0) / 2 + dx
        plate.line([cx - 6, cx + 6], [py1 + 12, py1 - 12], "ink3", 2)
    x_ticks(to_xa, [t for t in np.round(np.arange(0.06, 0.0951, 0.01), 2) if seg_a[1] - t >= 0.004])
    x_ticks(to_xb, [t for t in np.round(np.arange(0.47, 0.5001, 0.01), 2) if t - seg_b[0] >= 0.004 and t <= seg_b[1]])
    real_rule(to_xb(real_topo), real_topo)

    for x in (ax1, rx1):
        plate.text(x, 704, "Cross-validated AUC-PR", 26, color="ink2", ha="right")

    full, topo = summary["full"], summary["topology_only"]
    desc = (
        f"Figure 2. Two histograms of cross-validated AUC-PR on {n_trials} degree-preserving randomized graphs. "
        f"All {n_full} features: randomized graphs cluster between {fmt3(full['null_min'])} and "
        f"{fmt3(full['null_max'])}, mean {fmt3(full['null_mean'])}, and the real wiring scores {fmt3(full['real'])}. "
        f"Topology features only: randomized graphs fall between {fmt3(topo['null_min'])} and "
        f"{fmt3(topo['null_max'])}, mean {fmt3(topo['null_mean'])}, and the real wiring scores {fmt3(topo['real'])}, "
        f"beyond an axis break. No randomized graph reaches the real score in either test, "
        f"p = {fmt3(full['p_value'])}."
    )
    return plate.fig, desc


SUBSET_NAMES = {
    "full": "All {n} features",
    "full_without_community": "All except community ({n})",
    "static_only": "Static only ({n})",
    "neuropil_only": "Neuropil only ({n})",
    "topology_and_transmitter": "Topology and transmitter ({n})",
    "topology_only": "Topology only ({n})",
    "community_only": "Community only ({n})",
    "topology_without_community": "Topology without community ({n})",
    "transmitter_only": "Transmitter only ({n})",
}


def figure_signal(data: dict, theme: str) -> tuple[Figure, str]:
    """Figure 3: SHAP share by feature group and AUC-PR by feature subset."""
    plate = Plate(944, theme)
    diag = data["diagnostics"]
    groups = diag["attribution"]["groups"]
    span = WIDTH - 2 * MARGIN

    plate.text(MARGIN, 76, "Share of mean absolute SHAP attribution", 34, "sans_bold")
    order = sorted(groups, key=lambda g: -groups[g]["share"])
    colors = {"neuropil": "ink2", "topology": "neutral", "transmitter": "faint"}
    captions = {"neuropil": "where a type sends its synapses", "topology": "position in the wiring graph"}
    bar0, bar1 = 126, 174
    x = MARGIN
    for name in order:
        width = groups[name]["share"] * span
        plate.rects([(x, bar0, x + width, bar1)], colors[name])
        if name in captions:
            plate.text(x, 212, f"{pct(groups[name]['share'])} {name}", 28, "sans_bold")
            plate.text(x, 246, captions[name], 26, color="ink2")
        else:
            mid = x + width / 2
            plate.line([mid, mid], [bar0 - 22, bar0 - 4], "ink3", 2)
            plate.text(WIDTH - MARGIN, bar0 - 30, f"{pct(groups[name]['share'])} {name}", 28, "sans_bold", ha="right")
        x += width
    x = MARGIN
    for name in order[:-1]:
        x += groups[name]["share"] * span
        plate.rects([(x - 1, bar0, x + 1, bar1)], "ground", zorder=3)

    # AUC-PR of the same classifier on feature subsets.
    subsets = diag["feature_sets"]
    rows = sorted(subsets, key=lambda k: -subsets[k]["auc_pr"])
    plate.text(MARGIN, 330, "AUC-PR by feature subset", 34, "sans_bold")
    ax0, ax1 = 660, 1540
    to_x = linear(0, 1, ax0, ax1)
    first, pitch = 406, 52
    top, bottom = first - 30, first + pitch * (len(rows) - 1) + 30
    for t, s in ((0, "0"), (0.25, "0.25"), (0.5, "0.5"), (0.75, "0.75"), (1, "1")):
        plate.line([to_x(t), to_x(t)], [top, bottom], "rule", 1, zorder=1)
        plate.line([to_x(t), to_x(t)], [bottom, bottom + 8], "axis", 2)
        plate.text(to_x(t), bottom + 40, s, 26, color="ink2", ha="center")
    plate.line([ax0, ax1], [bottom, bottom], "axis", 2)
    chance = subsets["full"]["baseline_auc_pr"]
    plate.line([to_x(chance), to_x(chance)], [top - 10, bottom], "rule_strong", 2, dashes=(4, 6), zorder=2)
    plate.text(to_x(chance) + 10, top - 6, f"Chance {fmt3(chance)}", 26, color="ink3")
    plate.text(WIDTH - MARGIN, top - 6, "AUC-PR", 26, color="ink3", ha="right")

    for i, key in enumerate(rows):
        y = first + i * pitch
        entry = subsets[key]
        is_full = key == "full"
        role = "sans_bold" if is_full else "sans"
        plate.text(MARGIN, y + 10, SUBSET_NAMES[key].format(n=entry["n_features"]), 28, role)
        plate.line([to_x(0), to_x(entry["auc_pr"])], [y, y], "magenta" if is_full else "rule_strong", 2, zorder=3)
        plate.dot(to_x(entry["auc_pr"]), y, 11, "magenta" if is_full else "ink", hollow=entry["exploratory"])
        value_ink = "ink" if is_full else "ink2"
        plate.text(WIDTH - MARGIN, y + 9, fmt3(entry["auc_pr"]), 26, role, color=value_ink, ha="right")

    key_hollow, key_filled = "Exploratory, run afterwards", "Specified before the null model"
    x = WIDTH - MARGIN - plate.text_width(key_hollow)
    plate.text(x, 330, key_hollow, 26, color="ink2")
    plate.dot(x - 22, 321, 11, "ink", hollow=True)
    x -= 44 + 32 + plate.text_width(key_filled)
    plate.text(x, 330, key_filled, 26, color="ink2")
    plate.dot(x - 22, 321, 11, "ink")

    def listing(keys: list[str]) -> str:
        names = [SUBSET_NAMES[k].format(n=subsets[k]["n_features"]).split(" (")[0].lower() for k in keys]
        return ", ".join(f"{name} {fmt3(subsets[k]['auc_pr'])}" for name, k in zip(names, keys))

    desc = (
        "Figure 3. Top: mean absolute SHAP attribution divides into neuropil features "
        f"{pct(groups['neuropil']['share'])}, topology {pct(groups['topology']['share'])} and predicted "
        f"transmitter {pct(groups['transmitter']['share'])}. "
        f"Bottom: AUC-PR by feature subset against chance at {fmt3(chance)}. "
        f"Specified in advance: {listing([k for k in rows if not subsets[k]['exploratory']])}. "
        f"Exploratory: {listing([k for k in rows if subsets[k]['exploratory']])}."
    )
    return plate.fig, desc


def figure_limits(data: dict, theme: str) -> tuple[Figure, str]:
    """Figure 6: per-class AUC-PR, the named-type rank check and top-decile calibration."""
    plate = Plate(680, theme)
    metrics, diag = data["metrics"], data["diagnostics"]
    gutter = 56
    pa = (MARGIN, MARGIN + 340)
    pb = (pa[1] + gutter, pa[1] + gutter + 760)
    pc = (pb[1] + gutter, WIDTH - MARGIN)
    title_y, axis_y = 84, 492
    rows_y = (208, 360)
    bar_h = 44

    def bar_panel(x0: float, x1: float, entries: list[tuple[str, float, str]]) -> Callable[[float], float]:
        to_x = linear(0, 1, x0, x1 - plate.text_width("0.000") - 14)
        for t, s in ((0, "0"), (0.5, "0.5"), (1, "1")):
            plate.line([to_x(t), to_x(t)], [rows_y[0] - 56, axis_y], "rule", 1, zorder=1)
            plate.line([to_x(t), to_x(t)], [axis_y, axis_y + 8], "axis", 2)
            plate.text(to_x(t), axis_y + 38, s, 26, color="ink2", ha="center")
        plate.line([x0, to_x(1)], [axis_y, axis_y], "axis", 2)
        for (name, value, color), y in zip(entries, rows_y):
            plate.text(x0, y - 16, name, 28)
            plate.rects([(x0, y, to_x(value), y + bar_h)], color)
            plate.text(to_x(value) + 12, y + bar_h / 2 + 10, fmt3(value), 28, "sans_bold")
        return to_x

    # Per-class AUC-PR, each with its own chance level.
    plate.text(pa[0], title_y, "AUC-PR by class", 34, "sans_bold")
    per_class = metrics["per_class"]
    to_x = bar_panel(*pa, [(LABEL_NAMES[k], per_class[k]["auc_pr"], LABEL_COLORS[k]) for k in LABEL_NAMES])
    for key, y in zip(LABEL_NAMES, rows_y):
        stub = to_x(per_class[key]["baseline_auc_pr"])
        plate.line([stub, stub], [y - 8, y + bar_h + 8], "ink", 3, zorder=4)
        plate.text(pa[0], y + bar_h + 38, f"Chance {fmt3(per_class[key]['baseline_auc_pr'])}", 26, color="ink3")

    # Named-type rank check: a compressed rank strip above the four types in full.
    required = TOP_N
    n_types = metrics["n_types"]
    named = sorted(diag["named_types"], key=lambda t: t["rank"])
    bx0, bx1 = pb
    plate.text(bx0, title_y, f"Pre-specified check: a named type in the top {required}", 34, "sans_bold")

    strip_y, strip_h = 144, 34
    span = bx1 - 36 - bx0

    def to_rank_x(rank: float) -> float:
        return bx0 + np.log10(rank) / np.log10(n_types) * span

    plate.rects([(bx0, strip_y, bx0 + span, strip_y + strip_h)], "track", zorder=1)
    plate.rects([(to_rank_x(1), strip_y, to_rank_x(required), strip_y + strip_h)], "magenta_soft", zorder=2)
    plate.outline(to_rank_x(1), strip_y, to_rank_x(required), strip_y + strip_h, "magenta", 2)
    # The four ranks sit within a few units of each other here, so one marker stands for them and the rows resolve them.
    lo_x, hi_x = to_rank_x(named[0]["rank"]), to_rank_x(named[-1]["rank"])
    mark = max(hi_x - lo_x, 12)
    cx = (lo_x + hi_x) / 2
    plate.rects([(cx - mark / 2, strip_y, cx + mark / 2, strip_y + strip_h)], "ink", zorder=3)
    plate.text(bx0, strip_y - 14, f"Required: top {required}", 26, "sans_bold", color="magenta")
    plate.text(cx - mark / 2, strip_y - 14, f"Actual: {named[0]['rank']} to {named[-1]['rank']}", 26, "sans_bold")

    tick_y = strip_y + strip_h
    for rank in (1, 10, 100, 1000, 10000):
        plate.line([to_rank_x(rank), to_rank_x(rank)], [tick_y, tick_y + 8], "axis", 2)
        plate.text(to_rank_x(rank), tick_y + 38, f"{rank:,}", 26, color="ink2", ha="center")
    plate.line([bx0, to_rank_x(n_types)], [tick_y, tick_y], "axis", 2)
    plate.text(bx0, tick_y + 76, f"Rank among {n_types:,} types, log scale", 26, color="ink3")

    # The same four types, one row each.
    head_y = 300
    rule_y = head_y + 18
    plate.line([bx0, bx1], [rule_y, rule_y], "rule", 2, zorder=1)
    plate.text(bx0, head_y, "The four named types", 28, "sans_bold")
    name_w = max(plate.text_width(t["cell_type"], 28) for t in named)
    rank_w = max(plate.text_width(str(t["rank"]), 28, "sans_bold") for t in named)
    label_x = bx0 + 34 + name_w + 32
    prob_x = bx1 - rank_w - 60
    plate.text(prob_x, head_y, "Probability", 26, color="ink3", ha="right")
    plate.text(bx1, head_y, "Rank", 26, color="ink3", ha="right")
    first_row, pitch = rule_y + 48, 52
    for i, entry in enumerate(named):
        y = first_row + i * pitch
        plate.rects([(bx0, y - 21, bx0 + 20, y - 1)], LABEL_COLORS.get(entry["label"], "ink"), zorder=4)
        plate.text(bx0 + 34, y, entry["cell_type"], 28)
        plate.text(label_x, y, LABEL_NAMES[entry["label"]], 26, color="ink2")
        plate.text(prob_x, y, fmt3(entry["probability"]), 28, color="ink2", ha="right")
        plate.text(bx1, y, str(entry["rank"]), 28, "sans_bold", ha="right")
    if first_row + pitch * (len(named) - 1) > axis_y + 40:
        raise ValueError("named-type rows overlap the panel notes")
    plate.text(bx0, axis_y + 80, f"None of the four reaches the top {required}", 26, color="ink2")
    plate.text(bx0, axis_y + 118, "The check fails and is reported unchanged", 26, "sans_bold", color="ink2")

    # Calibration of the highest decile of probabilities.
    calibration = diag["calibration"]
    top_bin = calibration["bins"][-1]
    plate.text(pc[0], title_y, f"Calibration in the top {top_bin['n'] / n_types:.0%}", 34, "sans_bold")
    bar_panel(
        *pc,
        [
            ("Mean predicted", top_bin["mean_probability"], "magenta"),
            ("Observed rate", top_bin["observed_rate"], "ink2"),
        ],
    )
    plate.text(pc[0], axis_y + 80, f"Brier score {calibration['brier']:.4f}", 26, color="ink2")
    constant = calibration["brier_prevalence_only"]
    plate.text(pc[0], axis_y + 118, f"Constant prediction {constant:.4f}", 26, color="ink2")

    listing = ", ".join(
        f"{t['cell_type']} {LABEL_NAMES[t['label']].lower()}, rank {t['rank']}, probability {fmt3(t['probability'])}"
        for t in named
    )
    desc = (
        f"Figure 6. Left: AUC-PR {fmt3(per_class['male_specific']['auc_pr'])} for male-specific types against chance "
        f"{fmt3(per_class['male_specific']['baseline_auc_pr'])}, and {fmt3(per_class['dimorphic']['auc_pr'])} for "
        f"dimorphic types against chance {fmt3(per_class['dimorphic']['baseline_auc_pr'])}. "
        f"Middle: the pre-specified check asked for at least one of the four named types in the top {required} of "
        f"{n_types:,}. A log rank strip marks that band and, well to its right, where the four actually sit; "
        f"listed in full they are {listing}. The check fails. "
        f"Right: among the tenth of types with the highest probabilities, the mean predicted probability is "
        f"{fmt3(top_bin['mean_probability'])} against an observed sex-related rate of "
        f"{fmt3(top_bin['observed_rate'])}; "
        f"Brier score {calibration['brier']:.4f} against {calibration['brier_prevalence_only']:.4f} for a constant "
        f"prediction."
    )
    return plate.fig, desc


_NUMBER = re.compile(r"-?\d+\.\d+")
_GEOMETRY = re.compile(r'(\s(?:d|x|y|x1|y1|x2|y2|width|height)=")([^"]*)(")')
_TRANSLATE = re.compile(r"translate\(([^)]*)\)")


def _round(match: re.Match) -> str:
    text = f"{round(float(match.group()), 1):.1f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def finish_svg(raw: str, title: str, desc: str, height: int) -> str:
    """Round geometry to one decimal, set pixel dimensions, and add a title and description."""
    svg = _GEOMETRY.sub(lambda m: m.group(1) + _NUMBER.sub(_round, m.group(2)) + m.group(3), raw)
    svg = _TRANSLATE.sub(lambda m: "translate(" + _NUMBER.sub(_round, m.group(1)) + ")", svg)
    svg = svg.replace(f'width="{WIDTH}pt" height="{height}pt"', f'width="{WIDTH}" height="{height}"', 1)
    head_end = svg.index(">", svg.index("<svg")) + 1
    accessible = f"\n <title>{escape(title)}</title>\n <desc>{escape(desc)}</desc>"
    svg = svg[:head_end] + accessible + svg[head_end:]
    return svg.replace("<svg ", '<svg role="img" ', 1)


FIGURES = {
    "fig-ranking": (figure_ranking, "Figure 1. Ranking of all cell types by classifier probability"),
    "fig-null": (figure_null, "Figure 2. The real wiring against randomized wirings"),
    "fig-signal": (figure_signal, "Figure 3. Where the signal sits"),
    "fig-limits": (figure_limits, "Figure 6. Where the classifier falls short"),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font-dir", type=Path, help="folder with NewsreaderText.ttf and the Atkinson TTFs")
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work_dir:
        configure(args.font_dir, Path(work_dir))
        data = load_inputs()
        args.out.mkdir(parents=True, exist_ok=True)
        for name, (build, title) in FIGURES.items():
            for theme in THEMES:
                fig, desc = build(data, theme)
                height = round(fig.get_figheight() * 72)
                buffer = io.StringIO()
                fig.savefig(buffer, format="svg", facecolor="none", metadata={"Date": None, "Creator": None})
                plt.close(fig)
                path = args.out / f"{name}-{theme}.svg"
                path.write_text(finish_svg(buffer.getvalue(), title, desc, height), encoding="utf-8")
                print(f"Wrote {path} ({path.stat().st_size / 1024:.0f} KB)")
        # Release open font handles so the tabular copies can be removed on Windows.
        font_manager._get_font.cache_clear()
        gc.collect()


if __name__ == "__main__":
    main()
