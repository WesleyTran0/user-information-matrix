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
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
