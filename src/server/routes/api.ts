import express, { type NextFunction, type Request, type Response } from 'express';
import type { ApiErrorBody } from '../../shared/types/domain.ts';
import { MatrixRepository, NotFoundError } from '../data/repository.ts';
import { ResolverApiError } from '../http/resolverClient.ts';

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Ids are numeric everywhere upstream; reject anything else at the edge. */
function requireId(raw: string | undefined, label: string): number {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new BadRequestError(`${label} must be a positive integer, received "${raw ?? ''}"`);
  }
  return Number.parseInt(raw, 10);
}

/** Express 4 does not forward rejected promises, so wrap async handlers. */
function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export interface ApiRouterOptions {
  /**
   * Cache invalidation forces a full re-fetch (3 + 2 + one call per role), so
   * it is only mounted where that cannot be triggered by a stranger.
   */
  exposeCacheControl: boolean;
}

export function createApiRouter(
  repository: MatrixRepository,
  options: ApiRouterOptions,
): express.Router {
  const router = express.Router();

  router.get('/meta', (_req, res) => {
    res.json(repository.meta());
  });

  router.get(
    '/groups',
    asyncRoute(async (_req, res) => {
      res.json(await repository.listGroups());
    }),
  );

  router.get(
    '/groups/:groupId',
    asyncRoute(async (req, res) => {
      const groupId = requireId(req.params.groupId, 'groupId');
      res.json(await repository.getGroupMatrix(groupId));
    }),
  );

  router.get(
    '/roles/:roleId/object-types/:objectTypeId',
    asyncRoute(async (req, res) => {
      const roleId = requireId(req.params.roleId, 'roleId');
      const objectTypeId = requireId(req.params.objectTypeId, 'objectTypeId');
      res.json(await repository.getObjectTypeDetail(roleId, objectTypeId));
    }),
  );

  if (options.exposeCacheControl) {
    router.post('/cache/clear', (_req, res) => {
      repository.clearCaches();
      res.json({ cleared: true });
    });
  }

  // Terminal: anything under /api that matched no route above is a 404 in the
  // JSON error contract, never Express's HTML page and never the SPA shell.
  router.use((req, _res, next) => {
    next(new NotFoundError(`No API route matches ${req.method} /api${req.path}`));
  });

  return router;
}

/** Single place that turns internal errors into the client's error contract. */
export function apiErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  let status = 500;
  let message = 'Unexpected server error';
  let upstream: string | undefined;

  if (error instanceof BadRequestError) {
    status = 400;
    message = error.message;
  } else if (error instanceof NotFoundError) {
    status = 404;
    message = error.message;
  } else if (error instanceof ResolverApiError) {
    // 4xx from upstream is usually auth/config, not a client mistake here.
    status = error.status >= 500 || error.status < 400 ? 502 : error.status;
    message = error.message;
    upstream = error.upstreamPath;
  } else if (error instanceof Error) {
    message = error.message;
  }

  if (status >= 500) {
    console.error('[api] request failed:', error);
  }

  const body: ApiErrorBody = { error: { message, status, ...(upstream ? { upstream } : {}) } };
  res.status(status).json(body);
}
