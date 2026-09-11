# review:fix-blank-page-dev-proxy:09/11 09:58

## What I did
Fixed a blank page in the browser, and closed the gap in the checks that let it
through.

**The bug.** `src/client/api/client.ts` was requested by the browser as
`/api/client.ts`, and Vite's dev proxy forwards *every* path beginning with
`/api` to the backend. So the browser's request for that module was proxied to
the API server, which correctly answered **404** — the module never loaded,
React never mounted, and the page rendered white with only the `<title>` from
index.html. Renamed the directory to `src/client/services/` (any name not
under `/api` works; `apiClient/` would not, since the proxy matches on
prefix). Annotated the proxy config with the constraint.

**Why every existing check missed it.** `vite build` bundles the module, so the
production path was genuinely fine — I had verified production mode and it
worked. The render check runs components in Node, where the dev server is not
involved. Both were green while the actual development entry point was broken.
That is the exact failure mode I flagged as unverified when I handed this over
("never rendered in a real browser"), and it was real.

**New `check:dev-server`.** Boots the real dev server and the API on ephemeral
ports, then walks the module graph from `/main.tsx` the way a browser does —
following every rewritten specifier, asserting each returns 200 — and confirms
the `/api` proxy still reaches the backend, since source and proxy compete for
the same URL space. Two guards keep it from passing vacuously: it asserts the
crawl visited at least 10 modules and that it reached the deepest component.

I verified the check is non-vacuous by reintroducing the exact bug: it fails
with `[["/api/api.ts",404]]` and exits 1, then passes again once reverted.

## Verification
`npm run check` green: typecheck (3 projects) + 36 data + 21 render + 15
live-path + 7 dev-server = **79 assertions**. `vite build` clean. Confirmed by
hand that all 12 modules now return 200 from the dev server and that
`/api/groups` still proxies.

Still true, and still the honest limit: no check executes JavaScript in a real
browser. This one proves every module *loads*, which is what broke; it would
not catch a runtime error inside a component that only occurs in a browser.
Playwright remains the fix for that and needs your approval.

## Files changed
- `src/client/services/api.ts` — moved from `src/client/api/client.ts`
- `src/client/App.tsx`, `src/client/components/ObjectTypeDetail.tsx` — imports
- `vite.config.ts` — documents the /api URL-space constraint
- `scripts/dev-server-check.ts` — new
- `package.json` — `check:dev-server` wired into `check`
- `README.md` — the new check and the directory constraint
