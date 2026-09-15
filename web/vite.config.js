import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const GEOMETRY_ID = "virtual:three-geometry";

/** Named re-exports from three, so a dynamic import of geometry classes does not retain the whole namespace. */
function threeGeometry() {
  return {
    name: "three-geometry",
    resolveId: (source) => (source === GEOMETRY_ID ? `\0${GEOMETRY_ID}` : null),
    load: (id) => (id === `\0${GEOMETRY_ID}` ? 'export { BufferAttribute, BufferGeometry } from "three";' : null),
  };
}

// Served from https://<user>.github.io/ConnectomeLens/
export default defineConfig({
  base: "/ConnectomeLens/",
  plugins: [react(), threeGeometry()],
  build: {
    // The three.js chunk (about 560 kB minified, 140 kB gzipped) is its renderer core, which does not split further.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: "three", test: /node_modules[\\/]three[\\/]/, priority: 2 },
            {
              name: "d3",
              test: /node_modules[\\/](d3|d3-[^\\/]+|internmap|delaunator|robust-predicates)[\\/]/,
              priority: 1,
            },
            // Keeps the chunk name free of the leading underscore rolldown derives from the virtual id.
            { name: "three-geometry", test: GEOMETRY_ID, priority: 0 },
          ],
        },
      },
    },
  },
});
