import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds `scripts/render-check.tsx` for Node so the real components can be
 * rendered outside a browser. Separate from vite.config.ts because that one
 * roots at src/client and targets the browser.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: 'scripts/render-check.tsx',
    // Node target: the entry uses top-level await, which the browser default rejects.
    target: 'node22',
    outDir: 'node_modules/.tmp/render',
    emptyOutDir: true,
    minify: false,
  },
  logLevel: 'error',
});
