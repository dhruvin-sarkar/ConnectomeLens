import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://<user>.github.io/ConnectomeLens/
export default defineConfig({
  base: "/ConnectomeLens/",
  plugins: [react()],
});
