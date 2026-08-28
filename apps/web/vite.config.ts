import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server proxies API/WS/files/reader/join to the Fastify server on 8787
// (BUILD_CONVENTIONS "Ports, env, database").
const target = 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/files': target,
      '/read': target,
      '/join': target,
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
