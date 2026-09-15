const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map();

function once(key, load) {
  if (!cache.has(key)) {
    const promise = load();
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return cache.get(key);
}

async function fetchOk(name) {
  const response = await fetch(BASE + name);
  if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status}). Reload the page to try again.`);
  return response;
}

export const loadJSON = (name) => once(name, async () => (await fetchOk(name)).json());

export const loadSummary = () => loadJSON("summary.json");
export const loadDiagnostics = () => loadJSON("diagnostics.json");
export const loadRoutes = () => loadJSON("routes.json");
export const loadCandidates = () => loadJSON("candidates.json");
export const loadGame = () => loadJSON("game.json");
export const loadExplanations = () => loadJSON("explanations.json");
export const loadSkeleton = (bodyId) => loadJSON(`skeletons/${bodyId}.json`);

/** Types ranked by out-of-fold probability, with lookups by name and rank index. */
export const loadTypes = () =>
  once("types", async () => {
    const list = await loadJSON("types.json");
    const index = new Map(list.map((t, i) => [t.t, i]));
    return { list, index, byName: new Map(list.map((t) => [t.t, t])) };
  });

/** Wiring-map coordinates (0–1000) as a Float32Array aligned with the type ranking. */
export const loadMap = () =>
  once("map", async () => {
    const { xy } = await loadJSON("map.json");
    return Float32Array.from(xy);
  });

/** Topology values and strongest partners per type, aligned with the type ranking. */
export const loadWiring = () =>
  once("wiring", async () => {
    const wiring = await loadJSON("wiring.json");
    const sorted = wiring.columns.map((_, c) => Float64Array.from(wiring.values, (row) => row[c]).sort());
    return { ...wiring, sorted };
  });

/** Neuropil manifest with one shared BufferGeometry per mesh, built once for every viewer. */
export const loadNeuropils = () =>
  once("neuropils", async () => {
    const [{ BufferAttribute, BufferGeometry }, manifest, positions, indices] = await Promise.all([
      import("virtual:three-geometry"),
      loadJSON("neuropils.json"),
      fetchOk("neuropil_positions.f32").then((r) => r.arrayBuffer()),
      fetchOk("neuropil_indices.u32").then((r) => r.arrayBuffer()),
    ]);
    const last = manifest[manifest.length - 1];
    if (
      positions.byteLength !== 12 * (last.vertexStart + last.vertexCount) ||
      indices.byteLength !== 4 * (last.indexStart + last.indexCount)
    ) {
      throw new Error("Neuropil geometry is incomplete. Reload the page to try again.");
    }
    const allPositions = new Float32Array(positions);
    const allIndices = new Uint32Array(indices);
    return manifest.map((entry) => {
      const geometry = new BufferGeometry();
      const start = entry.vertexStart * 3;
      geometry.setAttribute(
        "position",
        new BufferAttribute(allPositions.slice(start, start + entry.vertexCount * 3), 3),
      );
      geometry.setIndex(
        new BufferAttribute(allIndices.slice(entry.indexStart, entry.indexStart + entry.indexCount), 1),
      );
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return { ...entry, geometry };
    });
  });

/** Fraction of all types whose value in ``column`` is at or below ``value``. */
export function percentile(wiring, column, value) {
  const sorted = wiring.sorted[column];
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}
