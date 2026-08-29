import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server proxies API/WS/files/reader to the Fastify server on 8787
// (BUILD_CONVENTIONS "Ports, env, database").
//
// `/join` is deliberately NOT proxied (LIVE-3): `/join/:code` is an SPA route —
// the QR code's target — and proxying it handed a scanning player the API's raw
// JSON instead of the join screen. The token now comes from `/api/join/:code`,
// which the `/api` rule already covers.
const target = 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/files': target,
      '/read': target,
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
