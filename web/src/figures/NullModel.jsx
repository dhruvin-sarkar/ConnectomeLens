import { scaleLinear } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { Figure, Segmented } from "../components/ui.jsx";
import { integer, pValue } from "../lib/format.js";
import { easeInOutCubic, easeOutCubic, prefersReducedMotion, useInView, useProgress, useSize } from "../lib/hooks.js";

/* Toy degree-preserving rewiring */

const NODES = ["A", "B", "C", "D", "E", "F"].map((name, i) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
  return { name, x: 170 + 112 * Math.cos(angle), y: 152 + 104 * Math.sin(angle) };
});

const START = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 0],
  [2, 4],
  [1, 5],
];

function pickSwap(edges, random) {
  const has = new Set(edges.map(([a, b]) => `${a}-${b}`));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const i = Math.floor(random() * edges.length);
    const j = Math.floor(random() * edges.length);
    const [a, b] = edges[i];
    const [c, d] = edges[j];
    if (i === j || a === c || b === d || a === d || c === b) continue;
    if (has.has(`${a}-${d}`) || has.has(`${c}-${b}`)) continue;
    return { i, j, next: [a, d], other: [c, b] };
  }
  return null;
}

function shortened(from, to, by) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: to.x - (dx / length) * by, y: to.y - (dy / length) * by };
}

export function RewireDemo({ nEdges }) {
  const ref = useRef(null);
  const visible = useInView(ref, { once: false, threshold: 0.4 });
  const [edges, setEdges] = useState(START);
  const [swap, setSwap] = useState(null);
  const [phase, setPhase] = useState(0);
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const seed = useRef(7);

  const random = () => {
    seed.current = (seed.current * 16807) % 2147483647;
    return seed.current / 2147483647;
  };

  const step = () => {
    if (swap) return;
    const chosen = pickSwap(edges, random);
    if (!chosen) return;
    setSwap(chosen);
    const begin = performance.now();
    const duration = prefersReducedMotion() ? 1 : 1600;
    const tick = (now) => {
      const t = Math.min(1, (now - begin) / duration);
      setPhase(t);
      if (t < 1) {
        requestAnimationFrame(tick);
        return;
      }
      setEdges((current) => current.map((e, k) => (k === chosen.i ? chosen.next : k === chosen.j ? chosen.other : e)));
      setCount((n) => n + 1);
      setSwap(null);
      setPhase(0);
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!visible || !playing || swap) return undefined;
    const timer = setTimeout(step, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, playing, swap, edges]);

  const degree = (index, side) => edges.filter((e) => e[side] === index).length;
  // The first 40% of a swap highlights the chosen pair; the remainder moves their targets.
  const move = swap ? easeInOutCubic(Math.max(0, (phase - 0.4) / 0.6)) : 0;
  const names = swap && {
    a: NODES[edges[swap.i][0]].name,
    b: NODES[edges[swap.i][1]].name,
    c: NODES[edges[swap.j][0]].name,
    d: NODES[edges[swap.j][1]].name,
  };

  return (
    <div className="rewire" ref={ref}>
      <svg viewBox="0 0 340 300" role="img" aria-label="Animated example of a degree-preserving edge swap">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="rewire-arrow" />
          </marker>
          <marker id="arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="rewire-arrow-hot" />
          </marker>
        </defs>
        {edges.map(([a, b], k) => {
          const active = swap && (k === swap.i || k === swap.j);
          const from = NODES[a];
          let to = NODES[b];
          if (active) {
            const target = NODES[k === swap.i ? swap.next[1] : swap.other[1]];
            to = { x: to.x + (target.x - to.x) * move, y: to.y + (target.y - to.y) * move };
          }
          const end = shortened(from, to, 21);
          const start = shortened(to, from, 19);
          return (
            <line
              key={k}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className={active ? "rewire-edge hot" : "rewire-edge"}
              markerEnd={active ? "url(#arrow-hot)" : "url(#arrow)"}
            />
          );
        })}
        {NODES.map((node, index) => (
          <g key={node.name} transform={`translate(${node.x},${node.y})`}>
            <circle r="17" className="rewire-node" />
            <text className="rewire-name" dy="0.35em" textAnchor="middle">
              {node.name}
            </text>
            <text className="rewire-degree" y={node.y > 152 ? 33 : -25} textAnchor="middle">
              {degree(index, 1)} in, {degree(index, 0)} out
            </text>
          </g>
        ))}
      </svg>
      <div className="rewire-side">
        <p>
          Pick two connections, {names ? <span className="hot-text">{names.a} → {names.b}</span> : "A → B"} and{" "}
          {names ? <span className="hot-text">{names.c} → {names.d}</span> : "C → D"}, and swap their targets. Every
          type keeps exactly as many inputs and outputs as before; only who connects to whom changes.
        </p>
        <p className="rewire-count">
          {integer(count)} {count === 1 ? "swap" : "swaps"} here. Each randomized fly graph received ten swap attempts
          per connection, {((10 * nEdges) / 1e6).toFixed(1)} million in all.
        </p>
        <div className="rewire-buttons">
          <button type="button" className="button button-quiet" onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="button button-quiet" onClick={step} disabled={Boolean(swap)}>
            Swap once
          </button>
        </div>
      </div>
    </div>
  );
}

/* Null distributions */

const BIN = 0.001;
const DOT_PITCH = 5.2;
const PLOT_HEIGHT = 300;

/** Piecewise-linear x scale over one or two domain segments, with a gap between segments. */
function segmentedScale(segments, left, right, gap) {
  const total = segments.reduce((sum, [a, b]) => sum + (b - a), 0);
  const usable = right - left - gap * (segments.length - 1);
  let cursor = left;
  const parts = segments.map(([a, b]) => {
    const span = ((b - a) / total) * usable;
    const part = { domain: [a, b], range: [cursor, cursor + span], scale: scaleLinear().domain([a, b]).range([cursor, cursor + span]) };
    cursor += span + gap;
    return part;
  });
  const at = (v) => {
    const part = parts.find((p) => v >= p.domain[0] && v <= p.domain[1]) ?? (v < parts[0].domain[0] ? parts[0] : parts[parts.length - 1]);
    return part.scale(v);
  };
  return { at, parts };
}

function NullPanel({ title, scores, summary, segments, width, start, replay }) {
  const { at, parts } = useMemo(() => segmentedScale(segments, 16, width - 16, segments.length > 1 ? 30 : 0), [segments, width]);
  const columnWidth = Math.max(4, parts[0].scale(parts[0].domain[0] + BIN) - parts[0].scale(parts[0].domain[0]));
  const perRow = Math.max(1, Math.floor(columnWidth / DOT_PITCH));

  const stacks = useMemo(() => {
    const filled = new Map();
    const positions = scores.map((score) => {
      const bin = Math.floor(score / BIN);
      const n = filled.get(bin) ?? 0;
      filled.set(bin, n + 1);
      return { bin, n };
    });
    const tallest = Math.ceil(Math.max(...filled.values()) / perRow);
    return { positions, rows: tallest };
  }, [scores, perRow]);

  // Both panels share one plot height so their axes line up; tall stacks pack their rows closer.
  const top = 40;
  const axisY = top + PLOT_HEIGHT;
  const rowPitch = Math.min(DOT_PITCH, (PLOT_HEIGHT - 16) / stacks.rows);
  const height = axisY + 40;
  const t = useProgress(start, 3200, replay);
  const shown = Math.floor(Math.min(1, t / 0.78) * scores.length);
  const lineT = easeOutCubic(Math.max(0, (t - 0.8) / 0.2));
  const realX = at(summary.real);
  const nullX = at(summary.null_mean);

  return (
    <div className="null-panel">
      <p className="null-title">{title}</p>
      <svg width={width} height={height} role="img" aria-label={`${title}: ${scores.length} randomized scores against the real score`}>
        {parts.map((p, k) => (
          <g key={k} className="axis axis-paper">
            <line x1={p.range[0]} x2={p.range[1]} y1={axisY} y2={axisY} className="axis-line" />
            {p.scale.ticks(p.range[1] - p.range[0] > 260 ? 5 : 2).map((v) => (
              <g key={v} transform={`translate(${p.scale(v)},${axisY})`}>
                <line y2={5} className="axis-tick" />
                <text y={18} textAnchor="middle">
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
          </g>
        ))}
        {parts.length > 1 && (
          <g className="axis-break" transform={`translate(${(parts[0].range[1] + parts[1].range[0]) / 2},${axisY})`}>
            <line x1={-6} x2={0} y1={7} y2={-7} />
            <line x1={0} x2={6} y1={7} y2={-7} />
          </g>
        )}
        {stacks.positions.map(({ bin, n }, trial) => (
          <circle
            key={trial}
            cx={at(bin * BIN) + DOT_PITCH / 2 + (n % perRow) * DOT_PITCH}
            cy={axisY - 5 - Math.floor(n / perRow) * rowPitch}
            r={2.1}
            className="null-dot"
            style={{ opacity: trial < shown ? 1 : 0 }}
          />
        ))}
        <line className="real-line" x1={realX} x2={realX} y1={axisY} y2={axisY - (axisY - top + 6) * lineT} />
        <text
          className="real-label"
          x={realX + (realX > width - 150 ? -6 : 6)}
          y={top + 4}
          textAnchor={realX > width - 150 ? "end" : "start"}
          style={{ opacity: lineT }}
        >
          real wiring {summary.real.toFixed(3)}
        </text>
        <text className="null-label" x={nullX} y={top - 16} textAnchor="middle" style={{ opacity: shown > 50 ? 1 : 0 }}>
          randomized
        </text>
        <text className="axis-label" x={width - 16} y={height - 4} textAnchor="end">
          cross-validated AUC-PR
        </text>
      </svg>
      <dl className="null-stats">
        <div>
          <dt>Randomized graphs</dt>
          <dd>
            {summary.null_mean.toFixed(3)} ± {summary.null_sd.toFixed(3)}
          </dd>
        </div>
        <div>
          <dt>Highest randomized</dt>
          <dd>{summary.null_max.toFixed(3)}</dd>
        </div>
        <div>
          <dt>At or above real</dt>
          <dd>
            {summary.n_exceeding} of {scores.length}
          </dd>
        </div>
        <div>
          <dt>Above the null mean</dt>
          <dd>{summary.z_score.toFixed(1)} SD</dd>
        </div>
        <div>
          <dt>Empirical p</dt>
          <dd>{summary.p_value.toFixed(3)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function NullDistribution({ diagnostics, nullModel, number }) {
  const wrap = useRef(null);
  const { width } = useSize(wrap);
  const inView = useInView(wrap, { threshold: 0.3 });
  const [replay, setReplay] = useState(0);
  const [test, setTest] = useState("full");
  const full = nullModel.full;
  const topology = nullModel.topology_only;
  const wide = width >= 900;
  const pad = (a, b) => [Math.floor((a - 0.004) * 100) / 100, Math.ceil((b + 0.004) * 100) / 100];
  const fullSegments = useMemo(() => [pad(full.null_min, full.real)], [full]);
  const topologySegments = useMemo(() => [pad(topology.null_min, topology.null_max), pad(topology.real - 0.012, topology.real + 0.012)], [topology]);
  const panelWidth = wide ? (width - 40) / 2 : width;

  return (
    <Figure
      number={number}
      title="The real wiring against 500 randomized wirings"
      controls={
        <div className="figure-control-row">
          {!wide && (
            <Segmented
              label="Test"
              value={test}
              onChange={setTest}
              options={[
                { value: "full", label: "All features" },
                { value: "topology", label: "Topology only" },
              ]}
            />
          )}
          <button type="button" className="button button-quiet" onClick={() => setReplay((r) => r + 1)}>
            Replay
          </button>
        </div>
      }
      caption={
        <>
          Each dot is the cross-validated AUC-PR of the same classifier, retrained on one of {nullModel.n_trials}{" "}
          degree-preserving randomizations of the type graph with every topology feature recomputed. Neuropil and
          transmitter features do not depend on wiring and stay fixed, which is why randomized graphs still reach about{" "}
          {full.null_mean.toFixed(2)} with all features; with topology features alone they fall to{" "}
          {topology.null_mean.toFixed(3)}. The empirical p-value is (1 + the number of randomized scores at or above the real one) / (
          {nullModel.n_trials} + 1), so {pValue(full.p_value)} is the smallest value this many trials can give. Both tests
          were specified before any randomized graph was scored and each is assessed at a Bonferroni-corrected α of{" "}
          {nullModel.alpha}. The topology axis is broken so both clusters fit.
        </>
      }
    >
      <div className={`null-grid ${wide ? "two" : ""}`} ref={wrap}>
        {width > 0 && (wide || test === "full") && (
          <NullPanel
            title="All 89 features"
            scores={diagnostics.null_scores.full}
            summary={full}
            segments={fullSegments}
            width={panelWidth}
            start={inView}
            replay={replay}
          />
        )}
        {width > 0 && (wide || test === "topology") && (
          <NullPanel
            title="Graph topology features only"
            scores={diagnostics.null_scores.topology_only}
            summary={topology}
            segments={topologySegments}
            width={panelWidth}
            start={inView}
            replay={replay}
          />
        )}
      </div>
    </Figure>
  );
}
