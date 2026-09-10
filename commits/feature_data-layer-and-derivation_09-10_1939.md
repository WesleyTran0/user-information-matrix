# feature:data-layer-and-derivation:09/10 19:39

## What I did
Scaffolded the project and built the entire server-side data layer: typed wire
contracts for the six documented Resolver endpoints, a normalization layer, and
the derivation that reconstructs per-state permissions the API never returns.

**The derivation (the gap CLAUDE.md asked me to bridge).** Resolver grants access
per *object lifecycle*, not per state. So:
`role -> granted lifecycle ids` (1 call per role) x `lifecycle -> objectTypeId + states`
(1 catalog call) x `objectType -> all of its lifecycles` (1 catalog call) yields
"which object types a role reaches, and in which states". Every state of a granted
lifecycle is reachable; states of a non-granted lifecycle on the same object type
are not. An object type owning several lifecycles is what produces *partial*
coverage. The inference is shipped to the client as a `DerivationNote` so the UI
states it rather than passing it off as reported fact.

**API call budget.** 3 collection calls (/user/group, /user/group/roles,
/user/group/users) + 2 catalog calls (/object/objectType,
/object/objectLifeCycle?includeStates=true) + 1 call per *distinct* role. Roles
shared across groups are fetched once; the TTL cache is single-flight so parallel
requests for the same role collapse. Object-type drill-downs cost 0 extra calls.

**Complexity.** No derivation exceeds linear in the data it touches:
`buildRoleAccess` is O(grants + lifecycles on touched object types),
`buildCatalogIndex` is O(objectTypes + lifeCycles). Nothing to flag.

Verified with `node scripts/smoke.ts` -- 20/20 checks pass, no dependencies
required (Node 26 strips the types natively).

## Files changed
- `.gitignore`, `.env.example` -- env contract; .env and node_modules excluded
- `package.json`, `tsconfig.{json,base,client,server}.json`, `vite.config.ts` -- toolchain
- `src/shared/types/resolver-api.ts` -- raw wire DTOs for all six endpoints
- `src/shared/types/domain.ts` -- normalized domain + derived access model
- `src/shared/index.ts` -- shared barrel
- `src/server/env.ts` -- config parsing, fails loudly on bad live config
- `src/server/http/cache.ts` -- TTL cache with single-flight
- `src/server/http/concurrency.ts` -- bounded parallel map
- `src/server/http/resolverClient.ts` -- typed API client, envelope unwrapping
- `src/server/data/source.ts` -- ResolverDataSource interface
- `src/server/data/liveSource.ts` -- live implementation + endpoint table
- `src/server/data/mockSource.ts`, `src/server/data/mock/fixtures.ts` -- fixtures
- `src/server/domain/normalize.ts` -- wire -> domain, catalog construction
- `src/server/domain/catalogIndex.ts` -- O(1) lookup maps
- `src/server/domain/access.ts` -- the derivation core + DerivationNote
- `src/server/data/repository.ts` -- call budget owner, caching, matrix assembly
- `src/server/routes/api.ts`, `src/server/index.ts` -- HTTP surface
- `scripts/smoke.ts` -- dependency-free verification of the data layer
- `.claude/agents/senior-code-reviewer.md` -- reviewer agent definition

## Note on file naming
Commit *messages* use the requested `MM/DD hour:min` stamp. Commit *files* use
`MM-DD_HHMM` because `/` and `:` are not usable in filenames.
