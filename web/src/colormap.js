// Matplotlib's inferno colormap sampled at eleven stops, interpolated linearly.
const INFERNO = [
  [0, 0, 4],
  [22, 11, 57],
  [66, 10, 104],
  [106, 23, 110],
  [147, 38, 103],
  [188, 55, 84],
  [221, 81, 58],
  [243, 120, 25],
  [252, 165, 10],
  [246, 215, 70],
  [252, 255, 164],
];

export function inferno(t) {
  const x = Math.min(1, Math.max(0, t)) * (INFERNO.length - 1);
  const i = Math.min(INFERNO.length - 2, Math.floor(x));
  const f = x - i;
  return INFERNO[i].map((c, k) => (c + f * (INFERNO[i + 1][k] - c)) / 255);
}

/** Same mapping as the hero image: scores in [0, vmax] use the upper 88% of the colormap. */
export const scoreColor = (score, vmax) => inferno(0.12 + (0.88 * score) / vmax);

export const css = ([r, g, b]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
