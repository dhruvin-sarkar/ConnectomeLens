import * as THREE from "three";

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map();

function once(key, load) {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key);
}

async function fetchOk(name) {
  const response = await fetch(BASE + name);
  if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status})`);
  return response;
}

export const loadJSON = (name) => once(name, async () => (await fetchOk(name)).json());

export const loadSkeleton = (bodyId) => loadJSON(`skeletons/${bodyId}.json`);

export const loadTypes = () =>
  once("types", async () => {
    const list = await loadJSON("types.json");
    return { list, byName: new Map(list.map((t) => [t.t, t])) };
  });

/** Neuropil manifest with one shared BufferGeometry per mesh, built once for every viewer. */
export const loadNeuropils = () =>
  once("neuropils", async () => {
    const [manifest, positions, indices] = await Promise.all([
      loadJSON("neuropils.json"),
      fetchOk("neuropil_positions.f32").then((r) => r.arrayBuffer()),
      fetchOk("neuropil_indices.u32").then((r) => r.arrayBuffer()),
    ]);
    const last = manifest[manifest.length - 1];
    if (positions.byteLength !== 12 * (last.vertexStart + last.vertexCount) || indices.byteLength !== 4 * (last.indexStart + last.indexCount)) {
      throw new Error("Neuropil geometry is incomplete (buffer sizes do not match the manifest)");
    }
    const allPositions = new Float32Array(positions);
    const allIndices = new Uint32Array(indices);
    return manifest.map((entry) => {
      const geometry = new THREE.BufferGeometry();
      const start = entry.vertexStart * 3;
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(allPositions.slice(start, start + entry.vertexCount * 3), 3),
      );
      geometry.setIndex(
        new THREE.BufferAttribute(allIndices.slice(entry.indexStart, entry.indexStart + entry.indexCount), 1),
      );
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return { ...entry, geometry };
    });
  });
