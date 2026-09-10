import type { ApiEnvelope } from '../../shared/types/resolver-api.ts';
import type { ServerConfig } from '../env.ts';

/** Error carrying enough context for the route layer to answer honestly. */
export class ResolverApiError extends Error {
  readonly status: number;
  readonly upstreamPath: string;

  constructor(message: string, status: number, upstreamPath: string) {
    super(message);
    this.name = 'ResolverApiError';
    this.status = status;
    this.upstreamPath = upstreamPath;
  }
}

/**
 * Thin typed wrapper over the Resolver REST API.
 *
 * Deliberately dumb: no caching, no retries beyond transport-level ones, no
 * knowledge of the domain. Caching lives in the repository so that the call
 * budget is visible in one place.
 */
export class ResolverClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  #callCount = 0;

  constructor(config: ServerConfig) {
    if (config.baseUrl === null || config.apiKey === null) {
      throw new Error('ResolverClient requires RESOLVER_BASE_URL and RESOLVER_API_KEY');
    }
    this.#baseUrl = config.baseUrl;
    this.#apiKey = config.apiKey;
    this.#timeoutMs = config.timeoutMs;
  }

  /** Number of upstream requests issued, surfaced on /api/meta. */
  get callCount(): number {
    return this.#callCount;
  }

  /** GETs `path` and unwraps the `{ data }` envelope. */
  async getData<TData>(path: string): Promise<TData> {
    const url = `${this.#baseUrl}${path}`;
    this.#callCount += 1;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.#apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ResolverApiError(`Request to ${path} failed: ${reason}`, 502, path);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ResolverApiError(
        `Upstream ${response.status} for ${path}${body === '' ? '' : `: ${body.slice(0, 300)}`}`,
        response.status,
        path,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ResolverApiError(`Upstream returned non-JSON for ${path}`, 502, path);
    }

    if (payload === null || typeof payload !== 'object' || !('data' in payload)) {
      throw new ResolverApiError(`Upstream payload for ${path} has no "data" key`, 502, path);
    }

    return (payload as ApiEnvelope<TData>).data;
  }
}
