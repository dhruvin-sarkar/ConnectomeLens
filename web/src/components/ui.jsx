import { useId, useRef } from "react";
import { LABELS } from "../lib/format.js";
import { href } from "../lib/route.js";

export const REPO = "https://github.com/dhruvin-sarkar/ConnectomeLens";
export const REPORT_PDF = `${REPO}/blob/main/paper/report.pdf`;

/** A numbered figure: title, optional controls, the graphic, and a caption that explains how to read it. */
export function Figure({ id, number, title, controls, caption, children, variant = "", className = "" }) {
  const fallback = useId();
  const titleId = id ? `${id}-title` : `figure-${number ?? fallback}-title`;
  return (
    <figure id={id} className={`figure ${variant ? `figure-${variant}` : ""} ${className}`} aria-labelledby={titleId}>
      <div className="figure-head">
        <h3 id={titleId} className="figure-title">
          {number != null && <span className="figure-number">Figure {number} </span>}
          {title}
        </h3>
        {controls && <div className="figure-controls">{controls}</div>}
      </div>
      <div className="figure-body">{children}</div>
      {caption && <figcaption className="figure-caption">{caption}</figcaption>}
    </figure>
  );
}

/** Exclusive choice rendered as a row of buttons, operable with arrow keys. */
export function Segmented({ label, options, value, onChange, tone = "paper" }) {
  const refs = useRef([]);
  const current = options.findIndex((o) => o.value === value);
  const onKeyDown = (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (current + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={`segmented segmented-${tone}`} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.swatch && <span className={`swatch swatch-${option.swatch}`} aria-hidden="true" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TypeLink({ name, children, className = "" }) {
  return (
    <a className={`type-link ${className}`} href={href("atlas", { type: name })}>
      {children ?? name}
    </a>
  );
}

export function LabelMark({ label, text = true }) {
  return (
    <span className={`label-mark label-${label}`}>
      <span className="dot" aria-hidden="true" />
      {text && LABELS[label]}
    </span>
  );
}

/** A marginal note beside the paragraph it annotates; inline on narrow screens. */
export function Sidenote({ children, title }) {
  return (
    <aside className="sidenote">
      {title && <strong>{title}</strong>}
      {children}
    </aside>
  );
}

export function Loading({ children = "Loading data", tone = "paper" }) {
  return <p className={`loading loading-${tone}`}>{children}</p>;
}

export function ErrorNote({ children }) {
  return (
    <p className="error-note" role="alert">
      {children}
    </p>
  );
}

/** Inline range slider with a visible label. ``valueText`` (a string, or a function of the value) is announced in place of the raw number. */
export function Slider({ label, min, max, step = 1, value, onChange, format = (v) => v, valueText, tone = "paper" }) {
  const id = useId();
  const text = typeof valueText === "function" ? valueText(value) : valueText;
  return (
    <div className={`slider slider-${tone}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}
