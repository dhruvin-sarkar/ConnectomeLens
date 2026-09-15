import { useLayoutEffect, useRef, useState } from "react";

export const SANS = '"Atkinson Hyperlegible Next Variable", "Segoe UI", system-ui, sans-serif';

export function AxisBottom({ scale, y, ticks = 5, tickValues, format = String, label, tone = "paper", tickSize = 5 }) {
  const values = tickValues ?? scale.ticks(ticks);
  const [x0, x1] = scale.range();
  return (
    <g className={`axis axis-${tone}`} transform={`translate(0,${y})`}>
      <line x1={x0} x2={x1} className="axis-line" />
      {values.map((v) => (
        <g key={v} transform={`translate(${scale(v)},0)`}>
          <line y2={tickSize} className="axis-tick" />
          <text y={tickSize + 12} textAnchor="middle">
            {format(v)}
          </text>
        </g>
      ))}
      {label && (
        <text className="axis-label" x={x1} y={tickSize + 30} textAnchor="end">
          {label}
        </text>
      )}
    </g>
  );
}

export function AxisLeft({ scale, x = 0, ticks = 5, tickValues, format = String, label, tone = "paper", grid = 0 }) {
  const values = tickValues ?? scale.ticks(ticks);
  const [y0, y1] = scale.range();
  return (
    <g className={`axis axis-${tone}`} transform={`translate(${x},0)`}>
      {values.map((v) => (
        <g key={v} transform={`translate(0,${scale(v)})`}>
          {grid > 0 && <line x2={grid} className="axis-grid" />}
          <line x2={-5} className="axis-tick" />
          <text x={-8} dy="0.32em" textAnchor="end">
            {format(v)}
          </text>
        </g>
      ))}
      {label && (
        <text className="axis-label" x={0} y={Math.min(y0, y1) - 10} textAnchor="start">
          {label}
        </text>
      )}
    </g>
  );
}

/** Tooltip positioned inside a relatively positioned parent, kept within its bounds. */
export function Tooltip({ x, y, children, tone = "paper", bounds }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState({ dx: 12, dy: 12 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !bounds) return;
    const { width, height } = el.getBoundingClientRect();
    const dx = x + 14 + width > bounds.width ? -width - 14 : 14;
    const dy = y + 14 + height > bounds.height ? -height - 10 : 14;
    // On narrow plots neither side may fit, so pin the box inside the plot.
    setOffset({
      dx: Math.max(4 - x, Math.min(dx, bounds.width - width - 4 - x)),
      dy: Math.max(4 - y, dy),
    });
  }, [x, y, bounds, children]);
  if (x == null) return null;
  return (
    <div ref={ref} className={`tooltip tooltip-${tone}`} style={{ transform: `translate(${x + offset.dx}px, ${y + offset.dy}px)` }}>
      {children}
    </div>
  );
}

/** Scale a canvas for the device pixel ratio and return its 2D context. */
export function prepareCanvas(canvas, width, height) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}
