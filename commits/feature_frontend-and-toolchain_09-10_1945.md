# feature:frontend-and-toolchain:09/10 19:45

## What I did
Built the React frontend and got the whole toolchain verified now that npm is
available.

**Frontend.** Pick a user group, then see: the group's name, description and
members; every role in it; and for each role the object types it can reach, with
coverage (full / partial). Clicking an object type expands the drill-down —
each lifecycle of that object type, granted or not, and every state rendered as
reachable or struck through. A filter box narrows roles by role name or by object
type name. Roles whose grants point at unknown or unbound lifecycles show that
explicitly instead of silently dropping them.

The derivation is labelled on screen ("Derived" banner with expandable caveats)
so nobody mistakes inferred state-level access for something the API reported.

**Toolchain verified end-to-end:**
- `npm install` — 156 packages, then `npm audit` flagged 2 moderate CVEs in `qs`
  reached through express 4.22.2 (already the latest 4.x, so `npm audit fix`
  could not resolve it). Added an `overrides` entry pinning the *existing*
  transitive `qs` to ^6.16.0 — no new dependency, semver-compatible. Now
  **0 vulnerabilities**, with query-string parsing re-verified against the server.
- `npm run typecheck` — clean on both projects (strict, noUncheckedIndexedAccess,
  erasableSyntaxOnly on the server).
- `npx vite build` — clean, 38 modules, 74 kB gzipped.
- Ran the server and exercised every route with curl: /api/meta, /api/groups,
  /api/groups/:id, the drill-down route, 404 on an unknown group, 400 on a
  non-numeric id, and static index.html in production mode.
- Confirmed the call budget behaves: loading a second group whose two roles were
  already seen added **zero** role fetches (cache count stayed at 3).
- `node scripts/smoke.ts` — 20/20 still passing.

## Files changed
- `src/client/index.html`, `src/client/main.tsx`, `src/client/App.tsx` — shell and state
- `src/client/api/client.ts` — typed fetch layer honoring the server error contract
- `src/client/hooks/useAsync.ts` — abortable async state
- `src/client/components/GroupPicker.tsx` — user group selection
- `src/client/components/UserList.tsx` — group members
- `src/client/components/RoleCard.tsx` — role -> object types, expandable
- `src/client/components/ObjectTypeDetail.tsx` — lifecycles + per-state access
- `src/client/components/DerivationNotice.tsx` — states the inference on screen
- `src/client/components/CoverageBadge.tsx`, `Message.tsx` — shared primitives
- `src/client/styles/app.css` — tokens, layout, components; light + dark
- `package.json`, `package-lock.json` — deps installed, qs override
- `README.md` — derivation, call budget, how to run, layout
