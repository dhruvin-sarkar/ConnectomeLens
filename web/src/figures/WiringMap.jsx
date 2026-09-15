import { quadtree, select, zoom, zoomIdentity } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { Figure, Segmented, TypeLink } from "../components/ui.jsx";
import { loadWiring } from "../lib/data.js";
import { LABELS, SEX_RELATED, integer, probability, superclassName } from "../lib/format.js";
import { prefersReducedMotion, useSize } from "../lib/hooks.js";
import { href } from "../lib/route.js";
import { SANS, Tooltip, prepareCanvas } from "./chart.jsx";

const PAD = 24;
const MIN_LABELED_COMMUNITY = 300;

function channelStyle(type, mode) {
  if (mode === "prediction") {
    const a = 0.1 + 0.9 * Math.pow(type.p, 0.6);
    return [`rgb(255 64 196 / ${a})`, type.p > 0.2 ? 1.5 : 1];
  }
  if (!SEX_RELATED.has(type.l)) return ["rgb(120 130 140 / 0.35)", 1];
  return [type.l === "male_specific" ? "rgb(69 240 144)" : "rgb(82 216 242)", 1.5];
}

export default function WiringMap({ types, xy, number }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const { width } = useSize(wrap);
  const height = Math.round(Math.min(Math.max(width * 0.68, 380), 720));
  const [mode, setMode] = useState("merge");
  const [transform, setTransform] = useState(zoomIdentity);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [wiring, setWiring] = useState(null);
  const [wiringError, setWiringError] = useState(false);
  const zoomBehavior = useRef(null);
  const coarse = useMemo(() => window.matchMedia("(pointer: coarse)").matches, []);

  const scale = useMemo(() => {
    const size = Math.min(width, height) - 2 * PAD;
    const offsetX = (width - size) / 2;
    const offsetY = (height - size) / 2;
    return { x: (v) => offsetX + (v / 1000) * size, y: (v) => offsetY + (v / 1000) * size, size };
  }, [width, height]);

  const finder = useMemo(
    () =>
      quadtree(
        types.map((_, i) => i),
        (i) => xy[2 * i],
        (i) => xy[2 * i + 1],
      ),
    [types, xy],
  );

  const centroids = useMemo(() => {
    const groups = new Map();
    types.forEach((t, i) => {
      if (t.c < 0) return;
      if (!groups.has(t.c)) groups.set(t.c, { xs: [], ys: [] });
      groups.get(t.c).xs.push(xy[2 * i]);
      groups.get(t.c).ys.push(xy[2 * i + 1]);
    });
    const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    return [...groups.entries()]
      .filter(([, g]) => g.xs.length >= MIN_LABELED_COMMUNITY)
      .map(([c, g]) => ({ c, x: median(g.xs), y: median(g.ys) }));
  }, [types, xy]);

  useEffect(() => {
    if (!width) return undefined;
    const node = canvas.current;
    const behavior = zoom()
      .scaleExtent([1, 14])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      // One finger scrolls the page past the map; two fingers pan and zoom it.
      .filter(
        (event) =>
          (event.type !== "wheel" || event.ctrlKey || event.metaKey || event.shiftKey) &&
          (event.type !== "touchstart" || event.touches.length > 1),
      )
      .on("zoom", (event) => setTransform(event.transform));
    zoomBehavior.current = behavior;
    select(node).call(behavior).on("dblclick.zoom", null);
    return () => select(node).on(".zoom", null);
  }, [width, height]);

  const neighbors = useMemo(() => {
    if (selected == null || !wiring) return null;
    const pairs = (row) => Array.from({ length: row.length / 2 }, (_, k) => [row[2 * k], row[2 * k + 1]]);
    return { inputs: pairs(wiring.inputs[selected]), outputs: pairs(wiring.outputs[selected]) };
  }, [selected, wiring]);

  // Brightest points are drawn last so they sit on top.
  const drawOrder = useMemo(() => {
    if (mode === "merge") return null;
    const rank = (i) => (mode === "prediction" ? types[i].p : Number(SEX_RELATED.has(types[i].l)));
    return types.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  }, [types, mode]);

  useEffect(() => {
    if (!width) return;
    const ctx = prepareCanvas(canvas.current, width, height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const k = transform.k;
    const px = (i) => transform.applyX(scale.x(xy[2 * i]));
    const py = (i) => transform.applyY(scale.y(xy[2 * i + 1]));
    const radius = Math.max(1.1, Math.min(3.2, (scale.size / 1000) * 1.9 * Math.sqrt(k)));

    if (mode === "merge") {
      // Additive blending: magenta (classifier) plus green (annotation) reads as white where both are present.
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < types.length; i += 1) {
        const t = types[i];
        const m = Math.pow(t.p, 0.6);
        const g = SEX_RELATED.has(t.l) ? 1 : 0;
        const alpha = 0.16 + 0.84 * Math.max(m, g);
        const r = Math.max(70, Math.round(255 * Math.min(1, m + 0.12 * g)));
        const gg = Math.max(76, Math.round(255 * Math.min(1, 0.95 * g + 0.16 * m)));
        const b = Math.max(84, Math.round(255 * Math.min(1, 0.86 * m + 0.34 * g)));
        ctx.fillStyle = `rgb(${r} ${gg} ${b} / ${alpha})`;
        ctx.beginPath();
        ctx.arc(px(i), py(i), radius * (g || m > 0.3 ? 1.35 : 1), 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    } else {
      for (const i of drawOrder) {
        const [color, grow] = channelStyle(types[i], mode);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px(i), py(i), radius * grow, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    if (k < 2.2) {
      ctx.font = `600 ${width < 520 ? 11 : 12}px ${SANS}`;
      ctx.textAlign = "center";
      const boxes = [];
      for (const { c, x, y } of centroids) {
        const label = `Community ${c}`;
        const cx = transform.applyX(scale.x(x));
        const half = ctx.measureText(label).width / 2 + 3;
        // Nudge a label up or down when it would collide with one already drawn.
        const cy = [0, -16, 16, -32, 32]
          .map((dy) => transform.applyY(scale.y(y)) + dy)
          .find((top) => !boxes.some((b) => Math.abs(b.x - cx) < b.half + half && Math.abs(b.y - top) < 16));
        if (cy == null) continue;
        boxes.push({ x: cx, y: cy, half });
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgb(0 0 0 / 0.75)";
        ctx.strokeText(label, cx, cy);
        ctx.fillStyle = "rgb(214 221 228 / 0.85)";
        ctx.fillText(label, cx, cy);
      }
      ctx.textAlign = "start";
    }

    if (selected != null) {
      const sx = px(selected);
      const sy = py(selected);
      if (neighbors) {
        ctx.lineWidth = 1.2;
        for (const [list, color] of [
          [neighbors.inputs, "rgb(150 200 255 / 0.8)"],
          [neighbors.outputs, "rgb(255 255 255 / 0.85)"],
        ]) {
          ctx.strokeStyle = color;
          for (const [j] of list) {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(px(j), py(j));
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px(j), py(j), radius + 2, 0, 2 * Math.PI);
            ctx.stroke();
          }
        }
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 6, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }, [width, height, transform, mode, types, xy, scale, centroids, selected, neighbors, drawOrder]);

  const locate = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const dataX = ((transform.invertX(px) - scale.x(0)) / scale.size) * 1000;
    const dataY = ((transform.invertY(py) - scale.y(0)) / scale.size) * 1000;
    const i = finder.find(dataX, dataY, (12 / transform.k / scale.size) * 1000);
    return { i, px, py };
  };

  const choose = (i) => {
    setSelected(i);
    if (i == null || wiring) return;
    setWiringError(false);
    loadWiring().then(setWiring, () => setWiringError(true));
  };

  const search = (event) => {
    event.preventDefault();
    const name = query.trim().toLowerCase();
    if (!name) return;
    const exact = types.findIndex((t) => t.t.toLowerCase() === name);
    const match = exact >= 0 ? exact : types.findIndex((t) => t.t.toLowerCase().startsWith(name));
    setNotFound(match < 0);
    if (match < 0) return;
    choose(match);
    const k = 5;
    const x = scale.x(xy[2 * match]);
    const y = scale.y(xy[2 * match + 1]);
    select(canvas.current)
      .transition()
      .duration(prefersReducedMotion() ? 0 : 750)
      .call(zoomBehavior.current.transform, zoomIdentity.translate(width / 2 - k * x, height / 2 - k * y).scale(k));
  };

  const reset = () => {
    select(canvas.current).transition().duration(prefersReducedMotion() ? 0 : 600).call(zoomBehavior.current.transform, zoomIdentity);
    setSelected(null);
  };

  const hovered = hover?.i != null ? types[hover.i] : null;
  const chosen = selected != null ? types[selected] : null;

  return (
    <Figure
      number={number}
      variant="field"
      title="A map of the male wiring diagram"
      controls={
        <Segmented
          tone="field"
          label="Channel"
          value={mode}
          onChange={setMode}
          options={[
            { value: "prediction", label: "Classifier", swatch: "prediction" },
            { value: "annotation", label: "Annotation", swatch: "annotation" },
            { value: "merge", label: "Merge", swatch: "merge" },
          ]}
        />
      }
      caption={
        <>
          Every dot is a cell type. Types sit close together when they send to and receive from similar partners: the
          layout is a t-SNE embedding of each type&apos;s input and output connections in the thresholded graph, so
          distance on the map is only approximate. Magenta brightness is the classifier&apos;s out-of-fold probability;
          green and cyan mark Janelia&apos;s male-specific and dimorphic annotations. In the merged view the channels add,
          so types that are both annotated and scored highly glow white.{" "}
          {coarse
            ? "Pinch or drag with two fingers to zoom and pan; tap a type to draw its six strongest inputs (blue) and outputs (white)."
            : "Hold Shift or Ctrl and scroll, or pinch, to zoom; drag to pan; click a type to draw its six strongest inputs (blue) and outputs (white)."}
        </>
      }
    >
      <div className="map-toolbar">
        <form onSubmit={search} className="map-search" role="search">
          <label className="visually-hidden" htmlFor="map-search">
            Find a cell type on the map
          </label>
          <input
            id="map-search"
            type="search"
            placeholder={width && width < 520 ? "Find a cell type" : "Find a cell type, e.g. pIP10"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setNotFound(false);
            }}
          />
          <button type="submit" className="button button-field-quiet">
            Find
          </button>
          <span className="map-search-note" role="status">
            {notFound ? `No cell type starts with “${query.trim()}”.` : ""}
          </span>
        </form>
        <button type="button" className="button button-field-quiet" onClick={reset} disabled={transform.k === 1 && selected == null}>
          Reset view
        </button>
      </div>
      <div className="map" ref={wrap} style={{ height }}>
        <canvas
          ref={canvas}
          onPointerMove={(event) => event.pointerType !== "touch" && setHover(locate(event))}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => choose(locate(event).i ?? null)}
          role="img"
          aria-label="Wiring similarity map of all cell types"
        />
        {hovered && (
          <Tooltip x={hover.px} y={hover.py} tone="field" bounds={{ width, height }}>
            <strong>{hovered.t}</strong>
            <span className={`label-mark label-${hovered.l}`}>
              <span className="dot" />
              {LABELS[hovered.l]}
            </span>
            <span className="tooltip-sub">Classifier probability {probability(hovered.p)}</span>
            <span className="tooltip-sub">{superclassName(hovered.s)}</span>
          </Tooltip>
        )}
      </div>
      <div aria-live="polite">
        {chosen && (
          <div className="map-detail">
            <div>
              <p className="map-detail-name">{chosen.t}</p>
              <p>
                <span className={`label-mark label-${chosen.l}`}>
                  <span className="dot" />
                  {LABELS[chosen.l]}
                </span>
                , probability {probability(chosen.p)}, rank {integer(selected + 1)} of {integer(types.length)}
              </p>
              <a className="button button-field" href={href("atlas", { type: chosen.t })}>
                Open in the atlas
              </a>
            </div>
            {neighbors ? (
              <>
                <PartnerList title="Strongest inputs" list={neighbors.inputs} types={types} />
                <PartnerList title="Strongest outputs" list={neighbors.outputs} types={types} />
              </>
            ) : (
              <p className="loading loading-field">{wiringError ? "Partners could not be loaded." : "Loading partners"}</p>
            )}
          </div>
        )}
      </div>
    </Figure>
  );
}

function PartnerList({ title, list, types }) {
  return (
    <div>
      <p className="map-detail-heading">{title}</p>
      {list.length === 0 ? (
        <p className="map-detail-empty">None above the 1% input threshold</p>
      ) : (
        <ol className="partner-list">
          {list.map(([j, synapses]) => (
            <li key={j}>
              <TypeLink name={types[j].t} />
              <span>{integer(synapses)} synapses</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
