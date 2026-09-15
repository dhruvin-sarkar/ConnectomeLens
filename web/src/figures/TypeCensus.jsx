import { quadtree } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { PAPER } from "../lib/color.js";
import { LABELS, SEX_RELATED, integer, probability, superclassName } from "../lib/format.js";
import { easeInOutCubic, prefersReducedMotion, useSize } from "../lib/hooks.js";
import { SANS, Tooltip, prepareCanvas } from "./chart.jsx";
import { Figure, Segmented } from "../components/ui.jsx";

const LABEL_ORDER = { male_specific: 0, dimorphic: 1, isomorphic: 2 };
const BAND_LABEL = 190;
const BAND_GAP = 14;

const groupers = {
  all: () => "all",
  superclass: (t) => t.s ?? "unassigned",
  community: (t) => t.c,
};

function groupTitle(mode, key) {
  if (mode === "superclass") return superclassName(key);
  if (mode === "community") return key < 0 ? "Small communities, pooled" : `Community ${key}`;
  return "All cell types";
}

/** Cell positions for one grouping: every type is a square, sex-related types first within each group. */
function layout(types, mode, width, pitch) {
  const groups = new Map();
  types.forEach((t, i) => {
    const key = groupers[mode](t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const ordered = [...groups.entries()].sort((a, b) =>
    mode === "community" ? (a[0] < 0) - (b[0] < 0) || a[0] - b[0] : b[1].length - a[1].length,
  );
  const labelWidth = mode === "all" || width < 560 ? 0 : BAND_LABEL;
  const columns = Math.max(8, Math.floor((width - labelWidth) / pitch));
  const x = new Float32Array(types.length);
  const y = new Float32Array(types.length);
  const bands = [];
  let top = 0;
  for (const [key, members] of ordered) {
    members.sort((a, b) => LABEL_ORDER[types[a].l] - LABEL_ORDER[types[b].l] || types[b].p - types[a].p);
    const labelHeight = labelWidth === 0 && mode !== "all" ? 22 : 0;
    members.forEach((index, k) => {
      x[index] = labelWidth + (k % columns) * pitch;
      y[index] = top + labelHeight + Math.floor(k / columns) * pitch;
    });
    const rows = Math.ceil(members.length / columns);
    const sexRelated = members.filter((i) => SEX_RELATED.has(types[i].l)).length;
    bands.push({ key, top, title: groupTitle(mode, key), n: members.length, sexRelated });
    top += labelHeight + Math.max(rows * pitch, mode === "all" ? 0 : 30) + (mode === "all" ? 0 : BAND_GAP);
  }
  return { x, y, bands, height: Math.ceil(top), labelWidth };
}

export default function TypeCensus({ types, number }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const { width } = useSize(wrap);
  const [mode, setMode] = useState("all");
  const [hover, setHover] = useState(null);
  const pitch = width < 640 ? 4 : 6;
  const current = useRef(null);
  const [height, setHeight] = useState(0);

  const target = useMemo(() => (width ? layout(types, mode, width, pitch) : null), [types, mode, width, pitch]);
  const finder = useMemo(
    () =>
      target &&
      quadtree(
        types.map((_, i) => i),
        (i) => target.x[i] + pitch / 2,
        (i) => target.y[i] + pitch / 2,
      ),
    [target, types, pitch],
  );

  useEffect(() => {
    if (!target) return undefined;
    const from = current.current && current.current.x.length === types.length ? current.current : target;
    const instant = from === target || prefersReducedMotion();
    const duration = 900;
    const start = performance.now();
    let frame;
    const colors = types.map((t) => PAPER[t.l]);
    const draw = (now) => {
      const t = instant ? 1 : easeInOutCubic(Math.min(1, (now - start) / duration));
      const h = Math.max(from.height, target.height);
      const ctx = prepareCanvas(canvas.current, width, t === 1 ? target.height : h);
      ctx.clearRect(0, 0, width, h);
      const size = pitch - 1;
      const x = new Float32Array(types.length);
      const y = new Float32Array(types.length);
      for (let i = 0; i < types.length; i += 1) {
        // Stagger by rank so the rearrangement reads as a flow rather than a jump.
        const local = instant ? 1 : easeInOutCubic(Math.min(1, Math.max(0, (t * 1.25 - (i / types.length) * 0.25))));
        x[i] = from.x[i] + (target.x[i] - from.x[i]) * local;
        y[i] = from.y[i] + (target.y[i] - from.y[i]) * local;
        ctx.fillStyle = colors[i];
        ctx.globalAlpha = types[i].l === "isomorphic" ? 0.42 : 1;
        ctx.fillRect(x[i], y[i], size, size);
      }
      ctx.globalAlpha = 1;
      if (t === 1) {
        ctx.font = `600 13px ${SANS}`;
        for (const band of target.bands) {
          if (mode === "all") continue;
          const labelTop = target.labelWidth ? band.top + 10 : band.top + 12;
          ctx.fillStyle = "#0e1216";
          ctx.fillText(band.title, 0, labelTop);
          ctx.font = `400 12px ${SANS}`;
          ctx.fillStyle = "#454f59";
          const detail = `${integer(band.n)} ${band.n === 1 ? "type" : "types"}, ${integer(band.sexRelated)} sex-related`;
          if (target.labelWidth) ctx.fillText(detail, 0, labelTop + 16);
          else {
            ctx.font = `600 13px ${SANS}`;
            const offset = ctx.measureText(band.title).width + 10;
            ctx.font = `400 12px ${SANS}`;
            ctx.fillText(detail, offset, labelTop);
          }
          ctx.font = `600 13px ${SANS}`;
        }
      }
      current.current = { x, y, height: target.height };
      if (t < 1) frame = requestAnimationFrame(draw);
      else setHeight(target.height);
    };
    let cancelled = false;
    frame = requestAnimationFrame(draw);
    document.fonts?.ready.then(() => cancelled || !instant || draw(performance.now()));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [target, types, width, pitch, mode]);

  const onMove = (event) => {
    if (!finder) return;
    const rect = canvas.current.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const i = finder.find(px, py, pitch);
    setHover(i == null ? null : { i, x: px, y: py });
  };

  const counts = useMemo(() => {
    const c = { male_specific: 0, dimorphic: 0, isomorphic: 0 };
    for (const t of types) c[t.l] += 1;
    return c;
  }, [types]);

  const type = hover ? types[hover.i] : null;
  return (
    <Figure
      number={number}
      title={`${integer(types.length)} cell types, ${integer(counts.male_specific + counts.dimorphic)} of them annotated sex-related`}
      controls={
        <Segmented
          label="Arrange cell types"
          value={mode}
          onChange={setMode}
          options={[
            { value: "all", label: "All types" },
            { value: "superclass", label: "By superclass" },
            { value: "community", label: "By wiring community" },
          ]}
        />
      }
      caption={
        <>
          Each tile is one cell type in the male central nervous system.{" "}
          <span className="label-mark label-male_specific">
            <span className="dot" />
            {integer(counts.male_specific)} male-specific
          </span>{" "}
          and{" "}
          <span className="label-mark label-dimorphic">
            <span className="dot" />
            {integer(counts.dimorphic)} dimorphic
          </span>{" "}
          types are Janelia&apos;s annotations from comparing the male and female connectomes; the other{" "}
          {integer(counts.isomorphic)} are isomorphic. Grouping by wiring community uses communities detected on
          the male graph alone, and one of them holds most of the sex-related types.
        </>
      }
    >
      <div className="census" ref={wrap} style={{ minHeight: height }}>
        <canvas
          ref={canvas}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={(event) => event.pointerType !== "touch" && setHover(null)}
          role="img"
          aria-label={`Unit chart of ${types.length} cell types colored by annotation`}
        />
        {type && (
          <Tooltip x={hover.x} y={hover.y} bounds={{ width, height }}>
            <strong>{type.t}</strong>
            <span className={`label-mark label-${type.l}`}>
              <span className="dot" />
              {LABELS[type.l]}
            </span>
            <span className="tooltip-sub">
              {superclassName(type.s)}, community {type.c < 0 ? "pooled" : type.c}
            </span>
            <span className="tooltip-sub">Classifier probability {probability(type.p)}</span>
          </Tooltip>
        )}
      </div>
    </Figure>
  );
}
