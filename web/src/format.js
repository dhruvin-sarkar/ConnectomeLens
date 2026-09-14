export const LABELS = {
  male_specific: "male-specific",
  dimorphic: "sexually dimorphic",
  isomorphic: "isomorphic",
};

export const SEX_RELATED = new Set(["male_specific", "dimorphic"]);

const SUPERCLASSES = {
  cb_intrinsic: "central brain intrinsic",
  cb_sensory: "central brain sensory",
  cb_motor: "central brain motor",
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
  cb_efferent: "central brain efferent",
  cb_endocrine: "central brain endocrine",
  vnc_efferent: "nerve cord efferent",
  vnc_endocrine: "nerve cord endocrine",
  efferent_ascending: "efferent ascending",
  efferent_descending: "efferent descending",
};

export const superclassName = (s) => SUPERCLASSES[s] ?? (s ? s.replaceAll("_", " ") : "unknown");

export const probability = (p) => (p >= 0.995 ? ">0.99" : p < 0.005 ? "<0.01" : p.toFixed(2));

export const percent = (x) => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%`;

export const integer = (n) => n.toLocaleString("en-US");
