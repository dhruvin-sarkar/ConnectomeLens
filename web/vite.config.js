import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const GEOMETRY_ID = "virtual:three-geometry";
const REPORT = fileURLToPath(new URL("../paper/report.pdf", import.meta.url));

/** Publishes the technical report beside the site, so links open the PDF itself rather than a repository viewer. */
function reportPdf() {
  return {
    name: "report-pdf",
    configureServer(server) {
      server.middlewares.use("/ConnectomeLens/report.pdf", (_req, res) => {
        res.setHeader("Content-Type", "application/pdf");
        res.end(readFileSync(REPORT));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "report.pdf", source: readFileSync(REPORT) });
    },
  };
}

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
  plugins: [react(), threeGeometry(), reportPdf()],
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
