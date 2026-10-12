import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_URL = process.env.WHITESPACE_API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  envDir: "..",
  server: {
    port: 5173,
    proxy: { "/api": API_URL, "/health": API_URL },
  },
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1600 },
});
