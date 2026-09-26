import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The game server (apps/server) owns /api and /ws; in development Vite
// serves the client and proxies those two paths to it.
const serverPort = Number(process.env.PORT) || 3000;

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        jukebox: resolve(import.meta.dirname, 'jukebox.html'),
      },
    },
  },
});
