# User Information Matrix

Reconstructs, from the Resolver API, **which object types each role can reach for
each user group — and which lifecycle states of those object types**.

## Why there is a derivation step

Resolver exposes no per-state permission endpoint. Access is granted per *object
lifecycle*. The matrix is rebuilt from three facts:

| source | gives |
| --- | --- |
| `/data/rolePermissions/objectLifeCycles/role/{roleId}` | the lifecycle ids granted to a role |
| `/data/rolePermissions/role/{roleId}/objectType/{objectTypeId}` | **the reported access level and capabilities per state** |
| `/object/objectType/{objectTypeId}/objectLifeCycle/stateRequired` | what each state requires before it can be left |
| `/object/objectLifeCycle?includeStates=true` | each lifecycle's `objectTypeId` and its states |
| `/object/objectType` | every object type, and which lifecycles belong to it |

The group view is built from the **grant** alone, which is cheap but an *upper
bound*: it shows the object types a role can reach at all. Measured against the
live API, a role holding a lifecycle grant had access level 0 — none — in 19 of
that lifecycle's 25 states. So the drill-down asks the permissions endpoint and
shows what the API actually reports per state: **read & write / read only / no
access**, plus the capability flags (create, delete, merge, manage role, bulk
launch), the triggers the role may fire, and what each state requires to exit.

Where the grant claims a state the API denies, the UI says so inline rather
than quietly preferring one source. The "Derived" banner above the role list
marks the summary as the inference it is.

## Upstream call budget

Per cache window (`CACHE_TTL_MS`, default 5 min):

- **3** collection calls — `/user/group`, `/user/group/roles`, `/user/group/users`
- **2** catalog calls — `/object/objectType`, `/object/objectLifeCycle?includeStates=true`
- **1** call per *distinct* role inspected — shared roles are fetched once, and
  the cache is single-flight so concurrent requests for the same role collapse
- **2** per object-type drill-down, cold: the reported permissions for that
  (role, object type) pair, and the object type's exit requirements — the
  latter shared by every role, so it amortises. Reopening a drill-down is free.

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
npm run check          # all six of the below
npm run typecheck      # tsc -b: client, server and scripts projects
npm run check:data     # 51 data-layer assertions against the fixtures
npm run check:render   # 21 assertions rendering the real components
npm run check:live-path # 15 assertions: real server vs. a fake Resolver upstream
npm run check:dev-server # 7 assertions: the dev server's module graph + proxy
npm run check:export   # 43 assertions against a written-and-reparsed .xlsx
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
`check:export` writes a real workbook to `node_modules/.tmp/export/` and parses
the bytes back, so a column that silently stops reaching the file fails the
build. Its expected counts are hand-derived from the fixtures rather than
recomputed from the code under test.

## Excel export

`src/server/export/` turns one group's matrix into a flat, denormalized sheet --
one row per (group, role, object type, lifecycle, state) -- because that is what
an Excel PivotTable consumes.

Every column is a descriptor in `src/server/export/columns.ts`
(`{ header, key, width, value }`). **That array is the only place a column is
defined**: adding a field from the domain model to the sheet means appending one
descriptor, with no change to the row builder or the workbook writer.

Three negative outcomes are kept strictly distinct in the `Reported Access`
column, because conflating them would misstate access: `No access` (the API
reported level 0), `Not reported` (the call succeeded with no row for that
state) and `Permissions unavailable` (the call failed -- see the
`Permissions Error` column). The `Grant Overstates` column is the audit hook: it
is TRUE exactly where a role holds the lifecycle grant but the API reports no
access in that state, and blank -- never FALSE -- where nothing was reported.

Cost of one group, for R roles reaching T object types over P distinct
(role, object type) pairs: `5 + R + P + T` upstream calls cold, 0 warm. The
export adds no endpoint of its own; P is bounded by R x T, so the drill-down
fan-out runs through `mapWithConcurrency` at `RESOLVER_MAX_CONCURRENCY`.

Not built: the all-groups export (P grows with the whole org and needs a job
queue and a progress channel, not a request handler), and any HTTP route or UI
affordance. `exportGroupWorkbook` takes a structural `MatrixExportSource`, so
either can be added without touching the exporter.

## Layout

```
src/shared/types/   domain.ts -- the normalized + derived model, the only
                    thing the client is allowed to see
src/server/types/   resolver-api.ts -- raw wire DTOs, server-side by design
src/server/http/    API client, TTL+single-flight cache, bounded concurrency
src/server/data/    ResolverDataSource (live | mock), repository = call budget owner
src/server/domain/  normalize -> catalog index -> access derivation
src/server/export/  columns.ts (the only column definition) -> rows -> workbook
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
