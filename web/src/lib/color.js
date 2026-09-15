// Channel colors as linear 0–1 RGB for WebGL and canvas, mirroring the CSS tokens.
export const GLOW = {
  prediction: [1.0, 0.31, 0.76],
  male_specific: [0.27, 0.94, 0.56],
  dimorphic: [0.32, 0.85, 0.95],
  isomorphic: [0.42, 0.46, 0.5],
};

export const PAPER = {
  prediction: "#b8166f",
  male_specific: "#0a8448",
  dimorphic: "#0a7690",
  isomorphic: "#8a939c",
};

// Unstained tissue on the black field.
export const TISSUE = [0.075, 0.085, 0.095];

// Pure channel primaries used for additive merging: magenta + green = white.
const MAGENTA = [1.0, 0.16, 0.86];
const GREEN = [0.12, 1.0, 0.34];
const WHITE = [0.94, 0.95, 0.97];

export const CHANNELS = ["prediction", "annotation", "merge"];

/**
 * Color of a region on the field for one channel mode.
 * ``prediction`` and ``annotation`` are each normalised to 0–1 before calling.
 */
export function stain(mode, prediction, annotation, strength = 1) {
  const m = mode === "annotation" ? 0 : Math.pow(Math.max(0, prediction), 1.1) * strength;
  const g = mode === "prediction" ? 0 : Math.pow(Math.max(0, annotation), 1.1) * strength;
  // The shared part of both channels is white; whichever channel exceeds the other keeps its hue.
  const both = Math.min(m, g);
  const boost = mode === "merge" ? 1.8 : 1;
  const dm = Math.min(1, (m - both) * boost);
  const dg = Math.min(1, (g - both) * boost);
  return [0, 1, 2].map((k) =>
    Math.min(1, TISSUE[k] * (1 - Math.max(m, g)) + WHITE[k] * both + MAGENTA[k] * dm + GREEN[k] * dg),
  );
}

export const css = ([r, g, b], alpha = 1) =>
  alpha < 1
    ? `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`
    : `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

/** Mix two hex colors; ``t`` = 0 gives ``a``. */
export function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(" ")})`;
}
