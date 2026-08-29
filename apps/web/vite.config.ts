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
//
// `/read/:code` is BOTH: the server answers it with the offset mapping, and
// DESIGN §12 gives the same address to the reader page. Production settles it by
// content negotiation (`plugins/books.ts#wantsSpaShell`) — a browser navigation
// asking for `text/html` gets the SPA shell, a fetch gets the JSON. The `bypass`
// below is that same rule in dev, where Vite (not Fastify) holds `index.html`.
const target = 'http://localhost:8787';

function navigatingToReader(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const accept = req.headers['accept'];
  if (typeof accept !== 'string') return false;
  const lower = accept.toLowerCase();
  return lower.includes('text/html') && !lower.includes('application/json');
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/files': target,
      '/read': {
        target,
        bypass: (req) => (navigatingToReader(req) ? '/index.html' : null),
      },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
