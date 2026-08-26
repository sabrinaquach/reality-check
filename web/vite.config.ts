import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The scoring engine needs the Maps and Census keys, and this repo is public --
 * so it stays in the API process and never ships to the browser. The client
 * only ever talks to /api, which Vite proxies to the local server in dev.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
