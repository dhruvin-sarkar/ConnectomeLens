export const LABELS = {
  male_specific: "male-specific",
  dimorphic: "dimorphic",
  isomorphic: "isomorphic",
};

export const SEX_RELATED = new Set(["male_specific", "dimorphic"]);

const SUPERCLASSES = {
  cb_intrinsic: "central brain intrinsic",
  cb_sensory: "central brain sensory",
  cb_motor: "central brain motor",
  cb_efferent: "central brain efferent",
  cb_endocrine: "central brain endocrine",
  ol_intrinsic: "optic lobe intrinsic",
  ol_sensory: "optic lobe sensory",
  visual_projection: "visual projection",
  visual_centrifugal: "visual centrifugal",
  descending_neuron: "descending",
  ascending_neuron: "ascending",
  sensory_ascending: "sensory ascending",
  sensory_descending: "sensory descending",
  vnc_intrinsic: "nerve cord intrinsic",
  vnc_sensory: "nerve cord sensory",
  vnc_motor: "nerve cord motor",
  vnc_efferent: "nerve cord efferent",
  vnc_endocrine: "nerve cord endocrine",
  efferent_ascending: "efferent ascending",
  efferent_descending: "efferent descending",
};

export const superclassName = (s) => SUPERCLASSES[s] ?? (s ? s.replaceAll("_", " ") : "unassigned");

// Standard neuropil nomenclature for the brain (Ito et al. 2014) and ventral nerve cord (Court et al. 2020).
const NEUROPILS = {
  AB: "asymmetrical body",
  AL: "antennal lobe",
  AME: "accessory medulla",
  AMMC: "antennal mechanosensory and motor center",
  ANm: "abdominal neuromeres",
  AOTU: "anterior optic tubercle",
  ATL: "antler",
  AVLP: "anterior ventrolateral protocerebrum",
  BU: "bulb",
  CA: "mushroom body calyx",
  CAN: "cantle",
  CRE: "crepine",
  EB: "ellipsoid body",
  EPA: "epaulette",
  FB: "fan-shaped body",
  FLA: "flange",
  GNG: "gnathal ganglia",
  GOR: "gorget",
  HTct: "haltere tectulum",
  IB: "inferior bridge",
  ICL: "inferior clamp",
  IntTct: "intermediate tectulum",
  IPS: "inferior posterior slope",
  LA: "lamina",
  LAL: "lateral accessory lobe",
  LegNp: "leg neuropil",
  LH: "lateral horn",
  LO: "lobula",
  LOP: "lobula plate",
  LTct: "lower tectulum",
  ME: "medulla",
  NO: "noduli",
  NTct: "neck tectulum",
  Ov: "ovoid",
  PB: "protocerebral bridge",
  PED: "mushroom body pedunculus",
  PLP: "posterior lateral protocerebrum",
  PRW: "prow",
  PVLP: "posterior ventrolateral protocerebrum",
  SAD: "saddle",
  SCL: "superior clamp",
  SIP: "superior intermediate protocerebrum",
  SLP: "superior lateral protocerebrum",
  SMP: "superior medial protocerebrum",
  SPS: "superior posterior slope",
  VES: "vest",
  WED: "wedge",
  WTct: "wing tectulum",
  mVAC: "medial ventral association center",
  aL: "mushroom body α lobe",
  "a'L": "mushroom body α′ lobe",
  bL: "mushroom body β lobe",
  "b'L": "mushroom body β′ lobe",
  gL: "mushroom body γ lobe",
};

const SIDES = { L: "left", R: "right" };

/** Full name of a neuropil ROI such as ``SIP(R)``, or ``null`` when the abbreviation is not a standard neuropil. */
export function neuropilName(roi) {
  const side = roi.match(/\(([LR])\)$/)?.[1];
  const base = roi.replace(/\([LR]\)$/, "").replace(/\([^)]*\)$/, "");
  const name = NEUROPILS[base];
  if (!name) return null;
  return side ? `${name}, ${SIDES[side]}` : name;
}

export const isUnassignedRegion = (roi) => roi.includes("unspecified");

const FEATURES = {
  in_degree: "input partner types",
  out_degree: "output partner types",
  in_strength: "synapses received",
  out_strength: "synapses sent",
  pagerank: "PageRank",
  betweenness: "betweenness centrality",
  community: "wiring community",
  hops_from_sensory: "hops from sensory types",
  hops_to_motor: "hops to motor output",
  nt: "predicted transmitter",
};

const UNASSIGNED = { CentralBrain: "central brain", Optic: "optic lobe", VNC: "nerve cord", CV: "cervical connective" };

/** Short plain-language label for a model feature. */
export function featureLabel(name) {
  if (name.startsWith("out_frac_")) {
    const roi = name.slice("out_frac_".length);
    if (!isUnassignedRegion(roi)) return `output share in ${roi}`;
    const region = roi.split("-")[0];
    return `output in unnamed ${UNASSIGNED[region] ?? region}`;
  }
  return FEATURES[name] ?? name;
}

/** Readable form of a fru/dsx annotation such as "fru_low (2/2 neurons)", e.g. "low fru (2 of 2 neurons)". */
export function fruDsxText(value) {
  const match = /^(fru|dsx)_([a-z]+) \((\d+)\/(\d+) neurons?\)$/.exec(value ?? "");
  if (!match) return (value ?? "").replace("_", " ");
  const [, gene, level, n, total] = match;
  return `${level} ${gene} (${n} of ${total} neurons)`;
}

export const featureGroupLabel = { neuropil: "where it sends synapses", topology: "position in the graph", transmitter: "transmitter" };

export const probability = (p) => (p >= 0.995 ? ">0.99" : p < 0.005 ? "<0.01" : p.toFixed(2));

export const percent = (x, digits) => {
  const d = digits ?? (Math.abs(x) < 0.1 && x !== 0 ? 1 : 0);
  return `${(100 * x).toFixed(d)}%`;
};

export const integer = (n) => Math.round(n).toLocaleString("en-US");

export const fixed = (x, digits = 3) => x.toFixed(digits);

/** Large counts as "3.83 million". */
export function millions(n, digits = 2) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 1 : digits)} million`;
  return integer(n);
}

const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

/** Scientific notation with a real multiplication sign and superscript exponent, e.g. 9.45 × 10⁻⁴. */
export function scientific(x, digits = 2) {
  const [mantissa, exponent] = x.toExponential(digits).split("e");
  const power = String(Number(exponent)).replace(/[-\d]/g, (c) => SUPERSCRIPT[c]);
  return `${mantissa} × 10${power}`;
}

export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${integer(n)}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const OUTCOMES = {
  "rerouted, longer": "the best remaining route is longer",
  "rerouted, same length": "the best remaining route has the same number of hops",
  "rerouted, fewer hops": "the best remaining route has fewer hops but carries a smaller share of output",
  disconnected: "no directed route remains",
  unchanged: "the route does not change",
};

/** Plain sentence fragment for an ablation outcome label written by the pipeline. */
export const outcomeText = (outcome) => OUTCOMES[outcome] ?? outcome;

/** "p = 0.002" style value, never rounding a nonzero p-value down to zero. */
export function pValue(p) {
  if (p < 1e-3) return `p = ${scientific(p, 1)}`;
  return `p = ${p.toFixed(3)}`;
}
