import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The build stamp baked into the bundle (`src/build.ts`): the image build
 * passes SAFEHOUSE_VERSION / SAFEHOUSE_BUILT_AT through the Dockerfile; a
 * checkout asks git; neither means `dev`. The same rule the server applies in
 * `apps/server/src/version.ts`, so the two agree on what "this build" means.
 */
function buildStamp(): { version: string; builtAt: string } {
  const stamped = (process.env['SAFEHOUSE_VERSION'] ?? '').trim();
  if (stamped.length > 0) return { version: stamped, builtAt: (process.env['SAFEHOUSE_BUILT_AT'] ?? '').trim() };
  try {
    const opts = { encoding: 'utf8' as const, timeout: 3_000, stdio: 'pipe' as const };
    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], opts).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], opts).trim().length > 0;
    return { version: dirty ? `${sha}-dirty` : sha, builtAt: '' };
  } catch {
    return { version: 'dev', builtAt: '' };
  }
}
const stamp = buildStamp();

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
  define: {
    __SAFEHOUSE_VERSION__: JSON.stringify(stamp.version),
    __SAFEHOUSE_BUILT_AT__: JSON.stringify(stamp.builtAt),
  },
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
