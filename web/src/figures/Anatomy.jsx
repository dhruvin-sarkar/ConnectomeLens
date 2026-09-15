import { scaleLinear, scaleSqrt } from "d3";
import { useMemo, useRef, useState } from "react";
import { Figure } from "../components/ui.jsx";
import { css, stain } from "../lib/color.js";
import { featureLabel, integer, neuropilName, percent } from "../lib/format.js";
import { useSize } from "../lib/hooks.js";
import { AxisBottom, AxisLeft, Tooltip } from "./chart.jsx";

const MARGIN = { top: 30, right: 20, bottom: 50, left: 52 };

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export function NeuropilAgreementFigure({ diagnostics, number }) {
  const wrap = useRef(null);
  const { width } = useSize(wrap);
  const [hover, setHover] = useState(null);
  const agreement = diagnostics.neuropil_agreement;
  const points = agreement.neuropils.filter((n) => n.synapses >= agreement.min_synapses);
  const height = Math.round(Math.min(Math.max(width * 0.62, 340), 560));
  const maxShare = Math.max(...points.map((p) => p.annotated_share));
  const maxScore = Math.max(...points.map((p) => p.score));
  const x = scaleSqrt().domain([0, maxShare * 1.05]).range([MARGIN.left, width - MARGIN.right]);
  const y = scaleSqrt().domain([0, maxScore * 1.05]).range([height - MARGIN.bottom, MARGIN.top]);
  const r = scaleSqrt().domain([0, Math.max(...points.map((p) => p.synapses))]).range([2, 13]);
  // Label the ten highest-scoring neuropils, trying positions around each circle until one is free.
  const labels = new Map();
  const top = [...points].sort((a, b) => b.score - a.score).slice(0, 10);
  const placed = top.map((p) => {
    const radius = r(p.synapses) + 2;
    const cx = x(p.annotated_share);
    const cy = y(p.score);
    return { x0: cx - radius, x1: cx + radius, y0: cy - radius, y1: cy + radius };
  });
  for (const p of top) {
    const cx = x(p.annotated_share);
    const cy = y(p.score);
    const w = p.neuropil.length * 7 + 4;
    const gap = r(p.synapses) + 5;
    const options = [
      { x: cx - gap, anchor: "end", dy: 0 },
      { x: cx + gap, anchor: "start", dy: 0 },
      { x: cx - gap, anchor: "end", dy: 14 },
      { x: cx + gap, anchor: "start", dy: 14 },
      { x: cx - gap, anchor: "end", dy: -14 },
      { x: cx, anchor: "middle", dy: -(gap + 6) },
      { x: cx, anchor: "middle", dy: gap + 6 },
      { x: cx - gap, anchor: "end", dy: 28 },
    ];
    const boxes = options.map((o) => {
      const x0 = o.anchor === "end" ? o.x - w : o.anchor === "middle" ? o.x - w / 2 : o.x;
      return { x0, x1: x0 + w, y0: cy + o.dy - 7, y1: cy + o.dy + 7 };
    });
    const free = boxes.findIndex(
      (box) => box.x0 >= 0 && box.x1 <= width && !placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0),
    );
    const k = free < 0 ? 0 : free;
    placed.push(boxes[k]);
    labels.set(p.neuropil, options[k]);
  }

  return (
    <Figure
      number={number}
      variant="field"
      title="The classifier's map of the brain matches the annotations"
      caption={
        <>
          Each circle is a neuropil with at least {integer(agreement.min_synapses)} synapses, sized by synapse count.
          Across: the share of its synapses made by cell types Janelia annotates as dimorphic or male-specific. Up: the mean out-of-fold
          probability of the types making those synapses, weighted by synapse count. Colors use the same channels as the
          brain at the top of the page. The measures agree closely (Spearman ρ = {agreement.spearman_rho.toFixed(2)}{" "}
          across {agreement.n_neuropils} neuropils). That is expected rather than independent confirmation: the
          probabilities were learned from the same annotations, even though each type was scored without its own. Both
          axes use a square-root scale.
        </>
      }
    >
      <div ref={wrap} className="agreement" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Scatter plot of neuropil probability against annotated share"
            onPointerUp={(event) => event.pointerType === "touch" && event.target === event.currentTarget && setHover(null)}
          >
            <AxisLeft
              scale={y}
              x={MARGIN.left}
              tickValues={[0, 0.02, 0.1, 0.2, 0.3, 0.4, 0.5].filter((v) => v <= maxScore * 1.05)}
              format={(v) => v.toFixed(2)}
              tone="field"
              grid={width - MARGIN.left - MARGIN.right}
              label="mean classifier probability"
            />
            <AxisBottom
              scale={x}
              y={height - MARGIN.bottom}
              tickValues={[0, 0.02, 0.1, 0.2, 0.3, 0.4].filter((v) => v <= maxShare * 1.05)}
              format={(v) => percent(v, 0)}
              tone="field"
              label="synapses made by annotated sex-related types"
            />
            {[...points]
              .sort((a, b) => b.synapses - a.synapses)
              .map((p) => (
                <g
                  key={p.neuropil}
                  onPointerEnter={(event) => event.pointerType !== "touch" && setHover(p)}
                  onPointerLeave={(event) => event.pointerType !== "touch" && setHover(null)}
                  onPointerUp={(event) => event.pointerType === "touch" && setHover((h) => (h?.neuropil === p.neuropil ? null : p))}
                >
                  <circle
                    cx={x(p.annotated_share)}
                    cy={y(p.score)}
                    r={r(p.synapses)}
                    fill={css(stain("merge", p.score / maxScore, p.annotated_share / maxShare))}
                    className="agreement-dot"
                  />
                </g>
              ))}
            {/* Labels are drawn after every circle so no circle covers them. */}
            <g aria-hidden="true" pointerEvents="none">
              {top.map((p) => (
                <text
                  key={p.neuropil}
                  x={labels.get(p.neuropil).x}
                  y={y(p.score) + labels.get(p.neuropil).dy}
                  dy="0.32em"
                  textAnchor={labels.get(p.neuropil).anchor}
                  className="agreement-label"
                >
                  {p.neuropil}
                </text>
              ))}
            </g>
          </svg>
        )}
        {hover && (
          <Tooltip x={x(hover.annotated_share)} y={y(hover.score)} tone="field" bounds={{ width, height }}>
            <strong>{hover.neuropil}</strong>
            {neuropilName(hover.neuropil) && <span className="tooltip-sub">{neuropilName(hover.neuropil)}</span>}
            <dl className="tooltip-values">
              <dt className="channel-prediction">Mean probability</dt>
              <dd>{hover.score.toFixed(3)}</dd>
              <dt className="channel-annotation">Annotated sex-related</dt>
              <dd>{percent(hover.annotated_share)}</dd>
              <dt>Synapses</dt>
              <dd>{integer(hover.synapses)}</dd>
            </dl>
          </Tooltip>
        )}
      </div>
    </Figure>
  );
}

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

const NO_ROUTE_HOPS = 7;

function tickLabel(scale, v, feature) {
  if (scale === "count") return feature === "hops_to_motor" && v === NO_ROUTE_HOPS ? "none" : String(v);
  if (scale === "log10") return `10${String(v).replace("-", "⁻").replace(/\d/g, (d) => SUPERSCRIPT_DIGITS[d])}`;
  const n = Math.round(10 ** v - 1);
  return n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n);
}

function Distribution({ row, width, height = 132 }) {
  const margin = { top: 10, right: 8, bottom: 26, left: 8 };
  const { edges, histograms } = row;
  const { isomorphic, sexRelated } = useMemo(() => {
    const normalize = (counts) => {
      const total = counts.reduce((a, b) => a + b, 0) || 1;
      return counts.map((c) => c / total);
    };
    return {
      isomorphic: normalize(histograms.isomorphic),
      sexRelated: normalize(histograms.male_specific.map((c, i) => c + histograms.dimorphic[i])),
    };
  }, [histograms]);
  const peak = Math.max(...isomorphic, ...sexRelated);
  const x = scaleLinear().domain([edges[0], edges[edges.length - 1]]).range([margin.left, width - margin.right]);
  const y = scaleLinear().domain([0, peak]).range([height - margin.bottom, margin.top]);
  const step = (values) => values.map((v, i) => `${i === 0 ? "M" : "L"}${x(edges[i])},${y(v)}L${x(edges[i + 1])},${y(v)}`).join("");
  const area = (values) => `${step(values)}L${x(edges[edges.length - 1])},${y(0)}L${x(edges[0])},${y(0)}Z`;
  let ticks;
  if (row.scale === "count") {
    const values = edges.slice(0, -1).map((e) => Math.round(e + 0.5));
    ticks = values.length > 9 ? values.filter((_, i) => i % 2 === 0) : values;
  } else if (row.scale === "log10") {
    ticks = [];
    for (let e = Math.ceil(edges[0]); e <= Math.floor(edges[edges.length - 1]); e += 1) ticks.push(e);
  } else {
    // Values are log10(1 + x); ticks sit at round counts of x.
    ticks = [0, 1, 10, 100, 1e3, 1e4, 1e5, 1e6].map((n) => Math.log10(1 + n)).filter((v) => v >= edges[0] && v <= edges[edges.length - 1]);
    if (x(ticks[1]) - x(ticks[0]) < 24) ticks.splice(1, 1);
  }

  return (
    <svg width={width} height={height} role="img" aria-label={`Distribution of ${featureLabel(row.feature)} by annotation`}>
      <path d={area(isomorphic)} className="dist-isomorphic" />
      <path d={step(sexRelated)} className="dist-sex-related" />
      <AxisBottom scale={x} y={height - margin.bottom} tickValues={ticks} format={(v) => tickLabel(row.scale, v, row.feature)} tickSize={4} />
    </svg>
  );
}

export function TopologyFigure({ diagnostics, number }) {
  const wrap = useRef(null);
  const { width } = useSize(wrap);
  const columns = width >= 900 ? 4 : width >= 540 ? 2 : 1;
  const cellWidth = (width - (columns - 1) * 24) / columns;
  return (
    <Figure
      number={number}
      title="Where sex-related types sit in the graph"
      caption={
        <>
          Distribution of each topology feature among isomorphic types (gray area) and annotated sex-related types
          (green line), each normalized to its own total. Degree, strength, PageRank and betweenness use logarithmic
          axes, and “none” marks types with no route to motor output. The percentage under each panel is the chance that a
          randomly chosen sex-related type has a higher value
          than a randomly chosen isomorphic one; 50% would mean no difference. Sex-related types tend to be more
          connected and more central, further from sensory input and closer to motor output. Every difference is
          significant by a two-sided Mann–Whitney test, yet the distributions overlap heavily, so no single feature
          separates the classes.
        </>
      }
    >
      <div className="topology-grid" ref={wrap} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {width > 0 &&
          diagnostics.topology_by_label.map((row) => (
            <div key={row.feature} className="topology-cell">
              <p className="topology-title">{capitalize(featureLabel(row.feature))}</p>
              <Distribution row={row} width={cellWidth} height={columns === 1 ? 104 : 132} />
              <p className="topology-stat">{percent(row.probability_sex_related_higher, 0)} chance a sex-related type is higher</p>
            </div>
          ))}
      </div>
    </Figure>
  );
}
