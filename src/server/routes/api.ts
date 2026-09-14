import express, { type NextFunction, type Request, type Response } from 'express';
import type { ApiErrorBody } from '../../shared/types/domain.ts';
import { MatrixRepository, NotFoundError } from '../data/repository.ts';
import { exportGroupWorkbook } from '../export/index.ts';
import { workbookToBuffer } from '../export/workbook.ts';
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

/**
 * A safe, recognisable download name.
 *
 * Group names contain spaces, parentheses and slashes; anything outside a
 * conservative set becomes a hyphen so the filename cannot break the
 * Content-Disposition header or the user's filesystem.
 */
function exportFileName(groupName: string): string {
  const safe = groupName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  return `${safe === '' ? 'user-group' : safe}-permissions-${date}.xlsx`;
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
  /** Ceiling on the export's parallel drill-down fetches. */
  maxConcurrency: number;
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

  /**
   * Streams the group's workbook.
   *
   * Cost is the group matrix plus one drill-down per (role, object type)
   * pair, so this is by far the most expensive route -- a large group is
   * hundreds of upstream calls. It is a plain GET so the browser can download
   * it directly, and everything it fetches lands in the same caches the UI
   * uses, so an export right after browsing a group is largely free.
   */
  router.get(
    '/groups/:groupId/export',
    asyncRoute(async (req, res) => {
      const groupId = requireId(req.params.groupId, 'groupId');
      const { workbook, matrix, rows } = await exportGroupWorkbook(repository, groupId, {
        maxConcurrency: options.maxConcurrency,
      });
      const buffer = await workbookToBuffer(workbook);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(matrix.group.name)}"`);
      res.setHeader('Content-Length', String(buffer.byteLength));
      // Lets the client report what it downloaded without parsing the file.
      res.setHeader('X-Export-Row-Count', String(rows.length));
      res.end(buffer);
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
