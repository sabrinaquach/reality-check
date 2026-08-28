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
    /**
     * Listen on the LAN, not just the loopback, so the phone layout can be
     * opened on an actual phone. The proxy below is resolved by this process,
     * so the phone only needs to reach this port -- but note that the API's
     * own `server.listen(PORT)` binds every interface as well, so :8787 is
     * reachable from the network too, and anything on it can spend the Google
     * and RentCast budgets. Dev-machine-on-a-trusted-network only.
     */
    host: true,
    proxy: { "/api": "http://localhost:8787" },
  },
});
