import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The client is served by Vite in development and proxies /api to the Node
 * server, so the API key never reaches the browser. `npm run build` emits a
 * static bundle into dist/client, which the same Node server serves in prod.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT ?? '8787';

  return {
    plugins: [react()],
    root: 'src/client',
    publicDir: false,
    build: {
      outDir: '../../dist/client',
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      port: 5173,
      proxy: {
        // NOTE: this forwards *every* dev-server path beginning with /api,
        // including requests for source modules. Client source must therefore
        // never live under a directory whose URL starts with /api -- it would
        // be proxied to the backend and 404 in the browser while the
        // production build (which bundles it) still works. `check:dev-server`
        // walks the module graph to catch exactly that.
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
