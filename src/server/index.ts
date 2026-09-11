import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './env.ts';
import { MatrixRepository } from './data/repository.ts';
import { LiveResolverSource } from './data/liveSource.ts';
import { MockResolverSource } from './data/mockSource.ts';
import { ResolverClient } from './http/resolverClient.ts';
import type { ResolverDataSource } from './data/source.ts';
import { apiErrorHandler, createApiRouter } from './routes/api.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function createSource(config: ReturnType<typeof loadConfig>): ResolverDataSource {
  if (config.dataSource === 'live') {
    return new LiveResolverSource(new ResolverClient(config));
  }
  return new MockResolverSource();
}

function main(): void {
  const config = loadConfig();
  const repository = new MatrixRepository(
    createSource(config),
    config.cacheTtlMs,
    config.maxConcurrency,
  );

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  // Cache invalidation stays off in production: it is unauthenticated and
  // forces a full upstream re-fetch.
  app.use('/api', createApiRouter(repository, { exposeCacheControl: !config.isProduction }));

  if (config.isProduction) {
    // Vite's build output; `npm run build` must have run first.
    const clientDir = path.join(projectRoot, 'dist/client');
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use(apiErrorHandler);

  const server = app.listen(config.port, () => {
    // PORT=0 asks the OS for a free port, so report what was actually bound.
    const address = server.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : config.port;
    console.log(
      `[server] listening on http://localhost:${boundPort} (data source: ${config.dataSource})`,
    );
    if (!config.isProduction) {
      console.log('[server] run `npm run dev:client` for the UI on http://localhost:5173');
    }
  });

  // listen() reports EADDRINUSE asynchronously, so the try/catch around main()
  // would never see it.
  server.on('error', (error: NodeJS.ErrnoException) => {
    const detail =
      error.code === 'EADDRINUSE'
        ? `port ${config.port} is already in use (set PORT to something else)`
        : error.message;
    console.error(`[server] failed to start: ${detail}`);
    process.exitCode = 1;
  });
}

try {
  main();
} catch (error) {
  console.error('[server] failed to start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
