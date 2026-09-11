/** Environment parsing, done once at boot so misconfiguration fails loudly. */

export interface ServerConfig {
  dataSource: 'mock' | 'live';
  baseUrl: string | null;
  apiKey: string | null;
  port: number;
  timeoutMs: number;
  maxConcurrency: number;
  cacheTtlMs: number;
  isProduction: boolean;
}

function readInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  // parseInt would accept "8787abc"; require the whole value to be digits.
  const parsed = /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(
      `${name} must be an integer >= ${min}, received "${raw}"`,
    );
  }
  return parsed;
}

function readString(name: string): string | null {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

export function loadConfig(): ServerConfig {
  const requested = (readString('DATA_SOURCE') ?? 'mock').toLowerCase();
  if (requested !== 'mock' && requested !== 'live') {
    throw new Error(`DATA_SOURCE must be "mock" or "live", received "${requested}"`);
  }

  const baseUrl = readString('RESOLVER_BASE_URL');
  const apiKey = readString('RESOLVER_API_KEY');

  if (requested === 'live') {
    const missing = [
      baseUrl === null ? 'RESOLVER_BASE_URL' : null,
      apiKey === null ? 'RESOLVER_API_KEY' : null,
    ].filter((entry): entry is string => entry !== null);
    if (missing.length > 0) {
      throw new Error(`DATA_SOURCE=live requires ${missing.join(' and ')}. See .env.example.`);
    }
  }

  return {
    dataSource: requested,
    // Trailing slash removed so path joining stays a plain concatenation.
    baseUrl: baseUrl === null ? null : baseUrl.replace(/\/+$/, ''),
    apiKey,
    // 0 is allowed and means "let the OS pick a free port"; the bound port
    // is reported on startup. Used by scripts/live-path-check.ts.
    port: readInt('PORT', 8787, 0),
    timeoutMs: readInt('RESOLVER_TIMEOUT_MS', 30_000),
    maxConcurrency: readInt('RESOLVER_MAX_CONCURRENCY', 6),
    cacheTtlMs: readInt('CACHE_TTL_MS', 300_000),
    isProduction: process.env['NODE_ENV'] === 'production',
  };
}
