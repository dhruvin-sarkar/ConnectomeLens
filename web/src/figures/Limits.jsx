import { line, scaleLinear, scaleLog, scaleSqrt } from "d3";
import { useMemo, useRef } from "react";
import { Figure, TypeLink } from "../components/ui.jsx";
import { SEX_RELATED, integer, superclassName } from "../lib/format.js";
import { useSize } from "../lib/hooks.js";
import { AxisBottom, AxisLeft } from "./chart.jsx";

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function Panel({ title, children, note }) {
  return (
    <div className="limit-panel">
      <p className="limit-title">{title}</p>
      {children}
      {note && <p className="limit-note">{note}</p>}
    </div>
  );
}

function ClassCurves({ diagnostics, width, height }) {
  const m = { top: 24, right: 12, bottom: 44, left: 42 };
  const x = scaleLinear().domain([0, 1]).range([m.left, width - m.right]);
  const y = scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);
  const path = (c) =>
    line()
      .x((_, j) => x(c.recall[j]))
      .y((_, j) => y(c.precision[j]))(c.k);
  const male = diagnostics.curves.male_specific_vs_isomorphic;
  const dimorphic = diagnostics.curves.dimorphic_vs_isomorphic;
  const at = (c, recall) => c.precision[Math.max(0, c.recall.findIndex((r) => r >= recall))];
  return (
    <svg width={width} height={height} role="img" aria-label="Precision-recall curves for male-specific and dimorphic types">
      <AxisLeft scale={y} x={m.left} ticks={5} format={(v) => v.toFixed(1)} label="precision" grid={width - m.left - m.right} />
      <AxisBottom scale={x} y={height - m.bottom} ticks={5} format={(v) => v.toFixed(1)} label="recall" />
      <path d={path(dimorphic)} className="curve curve-dimorphic" />
      <path d={path(male)} className="curve curve-male" />
      <text x={x(0.5)} y={Math.max(m.top + 12, y(at(male, 0.5)) - 12)} className="curve-label curve-label-male">
        male-specific {male.auc_pr.toFixed(3)}
      </text>
      <text x={x(0.28)} y={Math.min(height - m.bottom - 8, y(at(dimorphic, 0.28)) + 22)} className="curve-label curve-label-dimorphic">
        dimorphic {dimorphic.auc_pr.toFixed(3)}
      </text>
    </svg>
  );
}

function SuperclassDumbbells({ diagnostics, width }) {
  const rows = diagnostics.superclasses.filter((s) => s.auc_pr != null).sort((a, b) => b.auc_pr - a.auc_pr);
  const narrow = width < 420;
  const left = narrow ? 8 : 160;
  const rowHeight = narrow ? 48 : 40;
  const legend = 28;
  const height = rows.length * rowHeight + 48 + legend;
  const x = scaleLinear().domain([0, 1]).range([left, width - 44]);
  return (
    <svg width={width} height={height} role="img" aria-label="AUC-PR against a random ranking within superclasses">
      <g transform={`translate(${narrow ? 6 : left},10)`} className="set-legend">
        <circle cx={0} cy={0} r={5} className="set-dot" />
        <text x={10} dy="0.32em">
          classifier
        </text>
        <circle cx={84} cy={0} r={4} className="set-dot open" />
        <text x={94} dy="0.32em">
          random ranking
        </text>
      </g>
      {rows.map((s, i) => {
        const cy = legend + i * rowHeight + rowHeight / 2 + (narrow ? 12 : 0);
        return (
          <g key={s.superclass}>
            <text x={narrow ? 0 : left - 12} y={narrow ? cy - 16 : cy} dy="0.32em" textAnchor={narrow ? "start" : "end"} className="set-label">
              {capitalize(superclassName(s.superclass))}
            </text>
            {!narrow && (
              <text x={left - 12} y={cy + 14} dy="0.32em" textAnchor="end" className="set-count">
                {integer(s.male_specific + s.dimorphic)} of {integer(s.n_types)} sex-related
              </text>
            )}
            <line x1={x(s.baseline_auc_pr)} x2={x(s.auc_pr)} y1={cy} y2={cy} className="set-stem" />
            <circle cx={x(s.baseline_auc_pr)} cy={cy} r={4.5} className="set-dot open" />
            <circle cx={x(s.auc_pr)} cy={cy} r={6} className="set-dot" />
            <text x={x(s.auc_pr) + 11} y={cy} dy="0.32em" className="set-value">
              {s.auc_pr.toFixed(2)}
            </text>
          </g>
        );
      })}
      <AxisBottom scale={x} y={height - 42} ticks={5} format={(v) => v.toFixed(1)} label="AUC-PR within superclass" />
    </svg>
  );
}

function RankStrip({ types, named, width }) {
  const height = 160;
  const x = scaleLog().domain([1, types.length]).range([14, width - 14]);
  const ranks = useMemo(() => {
    const out = [];
    types.forEach((t, i) => {
      if (SEX_RELATED.has(t.l)) out.push([i + 1, t.l]);
    });
    return out;
  }, [types]);
  const baseline = 86;
  const sorted = [...named].sort((a, b) => a.rank - b.rank);
  // Callouts read leftwards when any of them would run past the right edge.
  const flip = sorted.some((n) => x(n.rank) + 8 + `${n.cell_type}, rank ${integer(n.rank)}`.length * 6.8 > width);
  return (
    <svg width={width} height={height} role="img" aria-label="Ranks of annotated sex-related types and of the four named types">
      <rect x={x(1)} y={48} width={x(20) - x(1)} height={baseline - 40} className="rank-zone" />
      <text x={x(1) + 2} y={baseline + 22} className="rank-zone-label">
        top 20
      </text>
      {ranks.map(([rank, label]) => (
        <line key={rank} x1={x(rank)} x2={x(rank)} y1={baseline - 30} y2={baseline} className={`rank-tick rank-${label}`} />
      ))}
      {sorted.map((n, i) => {
        const label = `${n.cell_type}, rank ${integer(n.rank)}`;
        return (
          <g key={n.cell_type} transform={`translate(${x(n.rank)},${baseline})`}>
            <line y1={0} y2={18 + i * 13} className="rank-callout" />
            <text x={flip ? -6 : 6} y={22 + i * 13} textAnchor={flip ? "end" : "start"} className="rank-callout-label">
              {label}
            </text>
          </g>
        );
      })}
      <AxisBottom scale={x} y={36} tickValues={[1, 10, 100, 1000, 10000].filter((v) => v <= types.length)} format={(v) => integer(v)} tickSize={0} />
      <text className="axis-label" x={width - 14} y={14} textAnchor="end">
        rank by classifier probability
      </text>
    </svg>
  );
}

function Calibration({ calibration, width, height }) {
  const m = { top: 24, right: 12, bottom: 44, left: 46 };
  const x = scaleSqrt().domain([0, 0.6]).range([m.left, width - m.right]);
  const y = scaleSqrt().domain([0, 0.6]).range([height - m.bottom, m.top]);
  const ticks = [0, 0.01, 0.05, 0.1, 0.2, 0.4, 0.6];
  return (
    <svg width={width} height={height} role="img" aria-label="Calibration of predicted probabilities">
      <AxisLeft scale={y} x={m.left} tickValues={ticks} format={(v) => v} label="observed sex-related rate" grid={width - m.left - m.right} />
      <AxisBottom scale={x} y={height - m.bottom} tickValues={ticks} format={(v) => v} label="mean predicted probability" />
      <line x1={x(0)} y1={y(0)} x2={x(0.6)} y2={y(0.6)} className="chance" />
      <path
        d={line()
          .x((b) => x(b.mean_probability))
          .y((b) => y(b.observed_rate))(calibration.bins)}
        className="calibration-line"
      />
      {calibration.bins.map((b) => (
        <circle key={b.low} cx={x(b.mean_probability)} cy={y(b.observed_rate)} r={4.5} className="calibration-dot" />
      ))}
    </svg>
  );
}

export default function LimitsFigure({ diagnostics, types, number }) {
  const wrap = useRef(null);
  const { width } = useSize(wrap);
  const columns = width >= 820 ? 2 : 1;
  const cell = columns === 2 ? (width - 48) / 2 : width;
  const chartHeight = Math.round(Math.min(cell * 0.7, columns === 1 ? 340 : Infinity));
  const named = diagnostics.named_types;
  const cal = diagnostics.calibration;
  const top = cal.bins[cal.bins.length - 1];
  const male = diagnostics.curves.male_specific_vs_isomorphic.auc_pr;
  const dimorphic = diagnostics.curves.dimorphic_vs_isomorphic.auc_pr;
  return (
    <Figure
      number={number}
      title="Where the classifier falls short"
      caption={
        <>
          All four panels use out-of-fold predictions. The superclass panel includes only superclasses with at least ten
          sex-related and ten isomorphic types; open circles are what a random ranking would achieve. In the rank strip
          each tick is one annotated sex-related type placed at its rank on a logarithmic axis. The calibration panel
          splits types into ten equal-sized groups by predicted probability; points below the diagonal mean the model
          overstates the chance that a type is sex-related.
        </>
      }
    >
      <div className="limits" ref={wrap} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {width > 0 && (
          <>
            <Panel
              title="Dimorphic types are much harder than male-specific ones"
              note={`Each class is scored against isomorphic types only. Male-specific types reach AUC-PR ${male.toFixed(3)}. Dimorphic types exist in both sexes with different wiring and reach ${dimorphic.toFixed(3)}.`}
            >
              <ClassCurves diagnostics={diagnostics} width={cell} height={chartHeight} />
            </Panel>
            <Panel
              title="Performance depends on the part of the nervous system"
              note="Central brain intrinsic types, which include most male-specific types, are ranked well. Descending and nerve cord types are ranked much less well."
            >
              <SuperclassDumbbells diagnostics={diagnostics} width={cell} />
            </Panel>
            <Panel
              title="A pre-specified check failed"
              note={
                <>
                  Before training, the project required at least one of four sex-related types named in public
                  announcements of the connectome to rank in the top 20. None did:{" "}
                  {named.map((n, i) => (
                    <span key={n.cell_type}>
                      <TypeLink name={n.cell_type} /> ranks {integer(n.rank)}
                      {i < named.length - 2 ? ", " : i === named.length - 2 ? " and " : ""}
                    </span>
                  ))}
                  . The check was left unchanged and is reported as failed.
                </>
              }
            >
              <RankStrip types={types} named={named} width={cell} />
            </Panel>
            <Panel
              title="Probabilities rank well but are not calibrated"
              note={`Training weights sex-related types by the class ratio. In the highest-scoring tenth of types the mean predicted probability is ${top.mean_probability.toFixed(2)}, but ${Math.round(top.observed_rate * 100)}% are annotated sex-related. Read the probabilities as a ranking, not as frequencies.`}
            >
              <Calibration calibration={cal} width={cell} height={chartHeight} />
            </Panel>
          </>
        )}
      </div>
    </Figure>
  );
}
