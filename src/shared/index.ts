// Domain types only. Raw wire shapes (`types/resolver-api.ts`) stay server-side
// -- they are imported directly by the normalizer and the data sources, and
// must not reach the client.
export type * from './types/domain.ts';
