import { line, scaleLinear } from "d3";
import { useRef, useState } from "react";
import { Figure, Segmented, Slider } from "../components/ui.jsx";
import { integer, percent } from "../lib/format.js";
import { useSize } from "../lib/hooks.js";
import { AxisBottom, AxisLeft } from "./chart.jsx";

const SERIES = [
  { key: "full", label: "All 89 features" },
  { key: "static_only", label: "Neuropil and transmitter only" },
  { key: "hemilineage_grouped", label: "Hemilineage-grouped folds" },
  { key: "topology_only", label: "Graph topology only" },
];

const MARGIN = { top: 24, right: 16, bottom: 44, left: 44 };

function nearestIndex(values, target) {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
  return best;
}

export default function RankingExplorer({ diagnostics, number, nSexRelated, baseline }) {
  const wrap = useRef(null);
  const { width } = useSize(wrap);
  const [series, setSeries] = useState("full");
  const [space, setSpace] = useState("pr");
  const curve = diagnostics.curves[series];
  const [index, setIndex] = useState(() => nearestIndex(diagnostics.curves.full.k, 118));
  const i = Math.min(index, curve.k.length - 1);

  const chartWidth = Math.max(280, Math.min(width >= 760 ? width * 0.58 : width, 580));
  const chartHeight = Math.round(Math.min(chartWidth * 0.82, width >= 760 ? Infinity : 400));
  const x = scaleLinear().domain([0, 1]).range([MARGIN.left, chartWidth - MARGIN.right]);
  const y = scaleLinear().domain([0, 1]).range([chartHeight - MARGIN.bottom, MARGIN.top]);

  const path = (c) =>
    line()
      .x((_, j) => x(space === "pr" ? c.recall[j] : c.fpr[j]))
      .y((_, j) => y(space === "pr" ? c.precision[j] : c.recall[j]))(c.k);

  const k = curve.k[i];
  const tp = curve.tp[i];
  const precision = curve.precision[i];
  const recall = curve.recall[i];
  const markerX = x(space === "pr" ? recall : curve.fpr[i]);
  const markerY = y(space === "pr" ? precision : recall);

  const onPointer = (event) => {
    if (event.pointerType === "touch" && event.type === "pointermove") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const value = x.invert(event.clientX - rect.left);
    setIndex(nearestIndex(space === "pr" ? curve.recall : curve.fpr, value));
  };

  const found = Math.round(recall * nSexRelated);

  return (
    <Figure
      number={number}
      title="How well the ranking separates sex-related types"
      controls={
        <Segmented
          label="Curve"
          value={space}
          onChange={setSpace}
          options={[
            { value: "pr", label: "Precision and recall" },
            { value: "roc", label: "ROC" },
          ]}
        />
      }
      caption={
        <>
          The classifier ranks all {integer(diagnostics.n_types)} types by out-of-fold probability. Moving down the
          ranking flags more types: precision is the share of flagged types that are annotated sex-related, and recall is
          the share of all {integer(nSexRelated)} sex-related types found so far. Ranking at random would give the
          dashed line. AUC-PR summarizes the whole curve. The hemilineage-grouped curve uses all features and keeps every developmental
          hemilineage inside one cross-validation fold, so related types cannot help predict each other.
        </>
      }
    >
      <div className="ranking" ref={wrap}>
        <div className="ranking-chart">
          <svg
            width={chartWidth}
            height={chartHeight}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            role="img"
            aria-label={space === "pr" ? "Precision-recall curves" : "ROC curves"}
          >
            <AxisLeft
              scale={y}
              x={MARGIN.left}
              ticks={5}
              format={(v) => v.toFixed(1)}
              label={space === "pr" ? "precision" : "recall"}
              grid={chartWidth - MARGIN.left - MARGIN.right}
            />
            <AxisBottom
              scale={x}
              y={chartHeight - MARGIN.bottom}
              ticks={5}
              format={(v) => v.toFixed(1)}
              label={space === "pr" ? "recall" : "false positive rate"}
            />
            {space === "pr" ? (
              <line className="chance" x1={x(0)} x2={x(1)} y1={y(baseline)} y2={y(baseline)} />
            ) : (
              <line className="chance" x1={x(0)} x2={x(1)} y1={y(0)} y2={y(1)} />
            )}
            {SERIES.filter((s) => s.key !== series).map((s) => (
              <path key={s.key} d={path(diagnostics.curves[s.key])} className="curve curve-muted" />
            ))}
            <path d={path(curve)} className="curve curve-active" />
            <line className="marker-guide" x1={markerX} x2={markerX} y1={markerY} y2={y(0)} />
            <circle cx={markerX} cy={markerY} r={6} className="marker" />
          </svg>
        </div>
        <div className="ranking-side">
          <fieldset className="series-picker">
            <legend>Features used</legend>
            {SERIES.map((s) => (
              <label key={s.key} className={s.key === series ? "on" : ""}>
                <input type="radio" name="ranking-series" value={s.key} checked={s.key === series} onChange={() => setSeries(s.key)} />
                <span className="series-name">{s.label}</span>
                <span className="series-value">{diagnostics.curves[s.key].auc_pr.toFixed(3)}</span>
              </label>
            ))}
            <p className="series-note">AUC-PR; ranking at random gives {baseline.toFixed(3)}</p>
          </fieldset>
          <Slider
            label="Types flagged"
            min={0}
            max={curve.k.length - 1}
            value={i}
            onChange={setIndex}
            format={(v) => integer(curve.k[v])}
            valueText={`${integer(k)} types flagged, ${integer(tp)} annotated sex-related, precision ${percent(precision)}`}
          />
          <p className="ranking-readout">
            Of the top <strong>{integer(k)}</strong> types, <strong>{integer(tp)}</strong> are annotated sex-related.
            Precision is <strong>{percent(precision)}</strong>, and they are <strong>{percent(recall)}</strong> of all{" "}
            {integer(nSexRelated)} sex-related types.
          </p>
          <div className="found-strip" aria-hidden="true">
            {Array.from({ length: nSexRelated }, (_, j) => (
              <span key={j} className={j < found ? "found" : ""} />
            ))}
          </div>
          <p className="found-note">Each mark is one annotated sex-related type; filled marks are in the flagged set.</p>
        </div>
      </div>
    </Figure>
  );
}
