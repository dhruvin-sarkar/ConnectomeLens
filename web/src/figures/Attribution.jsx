import { interpolateRgb, scaleLinear } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { Figure, Segmented, TypeLink } from "../components/ui.jsx";
import { PAPER } from "../lib/color.js";
import { LABELS, SET_LABELS, featureLabel, integer, isUnassignedRegion, neuropilName, percent } from "../lib/format.js";
import { useSize } from "../lib/hooks.js";
import { AxisBottom, SANS, Tooltip, prepareCanvas } from "./chart.jsx";

const GROUPS = [
  { key: "neuropil", label: "Where a type sends its synapses", detail: "79 output shares: 75 neuropils and 4 unassigned regions" },
  { key: "topology", label: "Position in the wiring graph", detail: "9 topology features" },
  { key: "transmitter", label: "Predicted transmitter", detail: "1 feature" },
];

function GroupShares({ groups }) {
  return (
    <div className="group-shares">
      <div className="group-bar" role="img" aria-label="Share of attribution by feature group">
        {GROUPS.map((g) => (
          <span key={g.key} className={`group-segment group-${g.key}`} style={{ flexGrow: groups[g.key].share }} />
        ))}
      </div>
      <ul className="group-legend">
        {GROUPS.map((g) => (
          <li key={g.key}>
            <span className={`group-key group-${g.key}`} aria-hidden="true" />
            <span className="group-share">{percent(groups[g.key].share, 0)}</span>
            <span>
              {g.label} <span className="group-detail">({g.detail})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROW = 38;
const LABEL_WIDTH = 230;

function Beeswarm({ swarm, colorBy }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const { width } = useSize(wrap);
  const [hover, setHover] = useState(null);
  const narrow = width < 620;
  const labelWidth = narrow ? 0 : LABEL_WIDTH;
  const rowHeight = narrow ? ROW + 18 : ROW;
  const top = narrow ? 14 : 0;
  const height = swarm.panels.length * rowHeight + top;

  const extent = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const p of swarm.panels) {
      for (const v of p.shap) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    return [Math.max(lo, -4), Math.min(hi, 6)];
  }, [swarm]);

  const x = useMemo(
    () => scaleLinear().domain(extent).nice().range([labelWidth + (narrow ? 14 : 8), Math.max(labelWidth + 40, width - 12)]),
    [extent, width, labelWidth, narrow],
  );

  const layout = useMemo(() => {
    if (!width) return [];
    return swarm.panels.map((panel, row) => {
      const center = top + row * rowHeight + rowHeight / 2 + (narrow ? 8 : 0);
      const order = panel.shap.map((_, i) => i).sort((a, b) => panel.shap[a] - panel.shap[b]);
      const buckets = new Map();
      const px = new Float32Array(panel.shap.length);
      const py = new Float32Array(panel.shap.length);
      const limit = rowHeight / 2 - (narrow ? 10 : 4);
      for (const i of order) {
        const sx = x(Math.max(extent[0], Math.min(extent[1], panel.shap[i])));
        const bucket = Math.round(sx / 2.4);
        const n = buckets.get(bucket) ?? 0;
        buckets.set(bucket, n + 1);
        const offset = (n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * 2.2;
        px[i] = sx;
        py[i] = center + Math.max(-limit, Math.min(limit, offset));
      }
      return { px, py, center };
    });
  }, [swarm, x, width, rowHeight, narrow, extent, top]);

  useEffect(() => {
    if (!width || !layout.length) return;
    const ctx = prepareCanvas(canvas.current, width, height);
    ctx.clearRect(0, 0, width, height);
    const valueColor = interpolateRgb("#c3ccd4", "#b8166f");
    ctx.strokeStyle = "#aab3bb";
    ctx.beginPath();
    ctx.moveTo(x(0), 0);
    ctx.lineTo(x(0), height);
    ctx.stroke();
    swarm.panels.forEach((panel, row) => {
      const { px, py, center } = layout[row];
      ctx.fillStyle = "#0e1216";
      ctx.font = `600 13px ${SANS}`;
      const text = featureLabel(panel.feature);
      let label = text.charAt(0).toUpperCase() + text.slice(1);
      while (!narrow && label.length > 4 && ctx.measureText(label).width > labelWidth - 16) label = `${label.slice(0, -2)}…`;
      if (narrow) {
        ctx.fillText(label, 0, center - rowHeight / 2 + 4);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(label, labelWidth - 12, center + 4);
        ctx.textAlign = "left";
      }
      for (let i = 0; i < panel.shap.length; i += 1) {
        const code = swarm.label[i];
        ctx.fillStyle =
          colorBy === "annotation" ? (code === 2 ? "rgb(138 147 156 / 0.45)" : PAPER[swarm.labels[code]]) : valueColor(panel.value[i]);
        ctx.fillRect(px[i] - 1.2, py[i] - 1.2, 2.4, 2.4);
      }
    });
  }, [width, height, layout, swarm, colorBy, x, narrow, labelWidth, rowHeight]);

  const onMove = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let best = null;
    let distance = 36;
    layout.forEach(({ px, py }, row) => {
      for (let i = 0; i < px.length; i += 1) {
        const d = (px[i] - mx) ** 2 + (py[i] - my) ** 2;
        if (d < distance) {
          distance = d;
          best = { row, i, x: mx, y: my };
        }
      }
    });
    setHover(best);
  };

  const panel = hover && swarm.panels[hover.row];
  const label = hover && swarm.labels[swarm.label[hover.i]];
  return (
    <div className="beeswarm" ref={wrap}>
      <canvas
        ref={canvas}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={(event) => event.pointerType !== "touch" && setHover(null)}
        role="img"
        aria-label="SHAP values per type for the twelve most important features"
      />
      {width > 0 && (
        <svg width={width} height={48} className="beeswarm-axis" aria-hidden="true">
          <AxisBottom scale={x} y={2} ticks={narrow ? 5 : 8} format={(v) => (v > 0 ? `+${v}` : String(v))} />
          <text className="axis-label" x={x(0) - 8} y={42} textAnchor="end">
            towards isomorphic
          </text>
          <text className="axis-label" x={x(0) + 8} y={42}>
            towards sex-related
          </text>
        </svg>
      )}
      {panel && (
        <Tooltip x={hover.x} y={hover.y} bounds={{ width, height }}>
          <strong>{swarm.types[hover.i]}</strong>
          <span className={`label-mark label-${label}`}>
            <span className="dot" />
            {LABELS[label]}
          </span>
          <span className="tooltip-sub">
            {featureLabel(panel.feature)}:{" "}
            {panel.kind === "categorical"
              ? panel.value[hover.i]
                ? `Community ${panel.highlight}`
                : `Not community ${panel.highlight}`
              : `higher than ${percent(panel.value[hover.i], 0)} of types`}
          </span>
          <span className="tooltip-sub">
            Contribution {panel.shap[hover.i] > 0 ? "+" : ""}
            {panel.shap[hover.i].toFixed(2)} log-odds
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export function AttributionFigure({ diagnostics, number }) {
  const [colorBy, setColorBy] = useState("value");
  const { attribution, beeswarm } = diagnostics;
  const community = beeswarm.panels.find((p) => p.kind === "categorical")?.highlight;
  return (
    <Figure
      number={number}
      title="What pushes a type's score up or down"
      controls={
        <Segmented
          label="Color points by"
          value={colorBy}
          onChange={setColorBy}
          options={[
            { value: "value", label: "Feature value" },
            { value: "annotation", label: "Annotation" },
          ]}
        />
      }
      caption={
        <>
          SHAP values split each type&apos;s score into contributions from its features, in log-odds, using the
          cross-validation model that scored the type. The bar shows how the total contribution over all{" "}
          {integer(diagnostics.n_types)} types divides between feature groups. Below, each point is one type (all{" "}
          {integer(beeswarm.label.filter((l) => l < 2).length)} annotated sex-related types plus{" "}
          {integer(beeswarm.label.filter((l) => l === 2).length)} isomorphic types drawn at random) for the twelve features
          with the largest average effect. Colored by feature value, darker magenta marks a higher value than most types;
          in the community row it marks membership of community {community}. Attributions describe the model, not biology.
        </>
      }
    >
      <GroupShares groups={attribution.groups} />
      <Beeswarm swarm={beeswarm} colorBy={colorBy} />
    </Figure>
  );
}

export { SET_LABELS };

export function FeatureSetsFigure({ diagnostics, baseline, number }) {
  const wrap = useRef(null);
  const { width } = useSize(wrap);
  const rows = Object.entries(diagnostics.feature_sets).sort((a, b) => b[1].auc_pr - a[1].auc_pr);
  const narrow = width < 600;
  const left = narrow ? 8 : 260;
  const rowHeight = narrow ? 52 : 34;
  const height = rows.length * rowHeight + 54;
  const x = scaleLinear().domain([0, 1]).range([left, Math.max(left + 50, width - 64)]);
  return (
    <Figure
      number={number}
      title="Which features carry the signal"
      caption={
        <>
          Cross-validated AUC-PR of the same classifier trained on subsets of the 89 features; the small number after
          each name is how many features the subset has. Filled points were specified before the null-model test. Open
          points were run afterwards to describe where the signal sits and did not change the model. The dashed line is
          what a random ranking would achieve.
        </>
      }
    >
      <div ref={wrap} className="feature-sets">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="AUC-PR by feature subset">
            {!narrow && <line className="chance" x1={x(baseline)} x2={x(baseline)} y1={0} y2={height - 46} />}
            {rows.map(([name, v], i) => {
              const cy = i * rowHeight + rowHeight / 2 + (narrow ? 12 : 0);
              return (
                <g key={name} className={name === "full" ? "set-row set-row-full" : "set-row"}>
                  {/* Labels sit above the tracks on narrow plots, so the chance line breaks around them. */}
                  {narrow && (
                    <line
                      className="chance"
                      x1={x(baseline)}
                      x2={x(baseline)}
                      y1={cy - 8}
                      y2={i === rows.length - 1 ? height - 46 : cy + rowHeight - 25}
                    />
                  )}
                  <text x={narrow ? 0 : left - 16} y={narrow ? cy - 16 : cy} dy="0.32em" textAnchor={narrow ? "start" : "end"} className="set-label">
                    {SET_LABELS[name] ?? name}
                    <tspan className="set-count" dx="6">
                      {v.n_features}
                    </tspan>
                  </text>
                  <line x1={x(0)} x2={x(1)} y1={cy} y2={cy} className="set-track" />
                  <line x1={x(0)} x2={x(v.auc_pr)} y1={cy} y2={cy} className="set-stem" />
                  <circle cx={x(v.auc_pr)} cy={cy} r={6} className={v.exploratory ? "set-dot open" : "set-dot"} />
                  <text x={x(v.auc_pr) + 12} y={cy} dy="0.32em" className="set-value">
                    {v.auc_pr.toFixed(3)}
                  </text>
                </g>
              );
            })}
            <AxisBottom scale={x} y={height - 44} ticks={5} format={(v) => v.toFixed(1)} label="cross-validated AUC-PR" />
          </svg>
        )}
      </div>
    </Figure>
  );
}

const regionName = (n) => (isUnassignedRegion(n) ? `Outside the named ${n.split("-")[0]} neuropils` : (neuropilName(n) ?? n));

export function CommunitiesFigure({ diagnostics, number }) {
  const [scaleMode, setScaleMode] = useState("count");
  const [open, setOpen] = useState(null);
  const rows = diagnostics.communities.communities.filter((c) => c.community >= 0);
  const max = Math.max(...rows.map((c) => c.n_types));
  const totalSexRelated = rows.reduce((s, c) => s + c.male_specific + c.dimorphic, 0);
  const hottest = rows.reduce((a, b) => (b.mean_probability > a.mean_probability ? b : a));
  return (
    <Figure
      number={number}
      title="Most sex-related types share one wiring community"
      controls={
        <Segmented
          label="Bar length"
          value={scaleMode}
          onChange={setScaleMode}
          options={[
            { value: "count", label: "Number of types" },
            { value: "share", label: "Share of community" },
          ]}
        />
      }
      caption={
        <>
          Leiden communities are groups of cell types more densely connected to each other than to the rest of the
          graph, found in the male wiring without using any labels. Bars split each community into{" "}
          <span className="label-mark label-male_specific">
            <span className="dot" />
            male-specific
          </span>
          ,{" "}
          <span className="label-mark label-dimorphic">
            <span className="dot" />
            dimorphic
          </span>{" "}
          and isomorphic types. The neuropils listed receive the largest average share of each community&apos;s output;
          hover an abbreviation, or tap a community&apos;s list, for full names. Communities with fewer than 25 types are pooled and not shown.
        </>
      }
    >
      <ol className="communities">
        {rows.map((c) => {
          const sexRelated = c.male_specific + c.dimorphic;
          const total = scaleMode === "count" ? c.n_types / max : 1;
          return (
            <li key={c.community} className={sexRelated / totalSexRelated > 0.3 ? "community-major" : ""}>
              <span className="community-name">Community {c.community}</span>
              <span className="community-track">
                <span className="community-bar" style={{ transform: `scaleX(${Math.max(total, 0.008)})` }}>
                  <span className="seg seg-male_specific" style={{ flexGrow: c.male_specific }} />
                  <span className="seg seg-dimorphic" style={{ flexGrow: c.dimorphic }} />
                  <span className="seg seg-isomorphic" style={{ flexGrow: c.isomorphic }} />
                </span>
              </span>
              <span className="community-count">
                {integer(sexRelated)} of {integer(c.n_types)}
              </span>
              <button
                type="button"
                className="community-where"
                aria-expanded={open === c.community}
                onClick={() => setOpen(open === c.community ? null : c.community)}
              >
                {c.top_neuropils.map(([n]) => (
                  <abbr key={n} title={regionName(n)}>
                    {isUnassignedRegion(n) ? `${n.split("-")[0]} other` : n}
                  </abbr>
                ))}
              </button>
              {open === c.community && (
                <span className="community-names">
                  {c.top_neuropils.map(([n]) => regionName(n)).join("; ")}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="communities-note">
        Highest-scoring types in community {hottest.community}:{" "}
        {hottest.top_types.map(([t], i, list) => (
          <span key={t}>
            <TypeLink name={t} />
            {i < list.length - 1 ? ", " : ""}
          </span>
        ))}
      </p>
    </Figure>
  );
}
