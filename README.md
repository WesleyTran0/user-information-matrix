# User Information Matrix

Reconstructs, from the Resolver API, **which object types each role can reach for
each user group — and which lifecycle states of those object types**.

## Why there is a derivation step

Resolver exposes no per-state permission endpoint. Access is granted per *object
lifecycle*. The matrix is rebuilt from three facts:

| source | gives |
| --- | --- |
| `/data/rolePermissions/objectLifeCycles/role/{roleId}` | the lifecycle ids granted to a role |
| `/object/objectLifeCycle?includeStates=true` | each lifecycle's `objectTypeId` and its states |
| `/object/objectType` | every object type, and which lifecycles belong to it |

A grant is lifecycle-wide, so **every state of a granted lifecycle is reachable**;
states of a non-granted lifecycle on the same object type are not. An object type
owning several lifecycles is what produces *partial* coverage. The UI labels this
as derived rather than reported — see the "Derived" banner above the role list.

## Upstream call budget

Per cache window (`CACHE_TTL_MS`, default 5 min):

- **3** collection calls — `/user/group`, `/user/group/roles`, `/user/group/users`
- **2** catalog calls — `/object/objectType`, `/object/objectLifeCycle?includeStates=true`
- **1** call per *distinct* role inspected — shared roles are fetched once, and
  the cache is single-flight so concurrent requests for the same role collapse

Object-type drill-downs cost **0** additional calls; they are computed from the
catalog and the role's cached grants.

## Running it

```bash
npm install
cp .env.example .env      # defaults to DATA_SOURCE=mock

npm run dev               # API on :8787
npm run dev:client        # UI on :5173, proxies /api to the API
```

Against the real API, set in `.env`:

```
DATA_SOURCE=live
RESOLVER_BASE_URL=https://<host>/api    # the endpoints above are appended to this
RESOLVER_API_KEY=<key>                  # sent as x-api-key
```

The key stays on the server; the browser only ever talks to this app's `/api`.

Production: `npm run build && npm start` (one process serves the API and the
static bundle).

## Checks

```bash
npm run check          # all five of the below
npm run typecheck      # tsc -b: client, server and scripts projects
npm run check:data     # 36 data-layer assertions against the fixtures
npm run check:render   # 21 assertions rendering the real components
npm run check:live-path # 15 assertions: real server vs. a fake Resolver upstream
npm run check:dev-server # 7 assertions: the dev server's module graph + proxy
```

`check:data` and `check:live-path` need no dependencies at all -- Node strips
the types natively, so `node scripts/smoke.ts` runs them directly.
`check:dev-server` exists because `vite build` and the render check both pass
even when the *dev server* cannot serve a module to a browser: it walks the
module graph the way a browser does and asserts the `/api` proxy has not
swallowed any client source.
`check:live-path` stands up a fake Resolver upstream and boots the real server
against it with `DATA_SOURCE=live`, which is the only way to cover the
`x-api-key` header, envelope unwrapping, the measured call budget and upstream
error mapping.

## Layout

```
src/shared/types/   domain.ts -- the normalized + derived model, the only
                    thing the client is allowed to see
src/server/types/   resolver-api.ts -- raw wire DTOs, server-side by design
src/server/http/    API client, TTL+single-flight cache, bounded concurrency
src/server/data/    ResolverDataSource (live | mock), repository = call budget owner
src/server/domain/  normalize -> catalog index -> access derivation
src/server/routes/  HTTP surface and the error contract
src/client/         React UI: group picker, role cards, object-type drill-down
                    (note: no client directory may sit at a URL starting with
                    /api -- the dev proxy owns that prefix)
```

The wire/domain boundary is structural, not a convention: the raw DTOs live
under `src/server/`, so the client program cannot import them even by path.

## Error contract

Every `/api` failure returns `{ error: { message, status, upstream? } }`,
including unmatched routes -- in production the SPA catch-all never swallows an
`/api` 404. A role whose permissions fail to load does not fail the group: it
comes back with `grantsError` set and the rest of the group renders.
