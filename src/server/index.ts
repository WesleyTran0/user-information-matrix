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
  app.use('/api', createApiRouter(repository));

  if (config.isProduction) {
    // Vite's build output; `npm run build` must have run first.
    const clientDir = path.join(projectRoot, 'dist/client');
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use(apiErrorHandler);

  app.listen(config.port, () => {
    console.log(
      `[server] listening on http://localhost:${config.port} (data source: ${config.dataSource})`,
    );
    if (!config.isProduction) {
      console.log('[server] run `npm run dev:client` for the UI on http://localhost:5173');
    }
  });
}

try {
  main();
} catch (error) {
  console.error('[server] failed to start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
