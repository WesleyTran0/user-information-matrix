/**
 * Live-path integration check.
 *
 * Everything else exercises the mock source. This stands up a fake Resolver
 * upstream, boots the real server against it with DATA_SOURCE=live, and
 * asserts what only the live path can get wrong: the x-api-key header,
 * envelope unwrapping, the call budget (including that a role shared by two
 * groups is fetched once and that concurrent requests single-flight),
 * per-role failure isolation, and upstream error mapping.
 *
 * Ports are ephemeral on both sides and every child is tracked, so a stale
 * process from an earlier run can neither collide with this one nor be
 * mistaken for it -- a check that can pass against someone else's server is
 * worse than no check. No dependencies.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const API_KEY = 'secret-key';

let failures = 0;
const children = new Set<ChildProcess>();

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

interface SeenRequest {
  path: string;
  key: string | null;
}

/* -------------------------------------------------------------------------- */
/* Fake upstream                                                              */
/* -------------------------------------------------------------------------- */

interface Upstream {
  server: Server;
  port: number;
  seen: SeenRequest[];
  /** Role id whose permissions call should fail with 500. */
  failRoleId: number | null;
  /** When true, /user/group fails, to exercise total-failure mapping. */
  failGroups: boolean;
}

function lifeCycle(includeStates: boolean): unknown {
  return {
    id: 55, name: 'Case Flow', type: 1, nameKey: null, description: null, descriptionKey: null,
    created: 'x', modified: 'x', org: 1, nextStateOrdinal: 2, externalRefId: 'lc55',
    objectTypeId: 9, isSystemConfig: false,
    ...(includeStates
      ? { states: [{ id: 1, name: 'New', ordinal: 0 }, { id: 2, name: 'Done', ordinal: 1 }] }
      : {}),
  };
}

function role(id: number, name: string): unknown {
  return { id, name, description: null, isGlobal: false, created: 'x', modified: 'x', org: 1,
    externalRefId: `r${id}` };
}

function group(id: number, name: string): unknown {
  return { id, name, description: null, created: 'x', modified: 'x', createdBy: null,
    modifiedBy: null, org: 1, externalRefId: `g${id}`, scimdisplayname: null, numberOfUsers: '1' };
}

async function startUpstream(): Promise<Upstream> {
  const state: Upstream = {
    server: undefined as unknown as Server,
    port: 0,
    seen: [],
    failRoleId: null,
    failGroups: false,
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://upstream');
    state.seen.push({
      path: url.pathname + url.search,
      key: (req.headers['x-api-key'] as string | undefined) ?? null,
    });

    const send = (data: unknown): void => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data }));
    };

    if (req.headers['x-api-key'] !== API_KEY) {
      res.statusCode = 401;
      res.end('{"message":"bad key"}');
      return;
    }

    if (url.pathname === '/user/group') {
      if (state.failGroups) {
        res.statusCode = 500;
        res.end('upstream exploded');
        return;
      }
      // Two groups; role 77 belongs to both, so "fetched once" is observable.
      send([group(1, 'Ops'), group(2, 'Risk')]);
      return;
    }
    if (url.pathname === '/user/group/roles') {
      send({ '1': [role(77, 'Analyst')], '2': [role(77, 'Analyst'), role(78, 'Reviewer')] });
      return;
    }
    if (url.pathname === '/user/group/users') {
      send({
        '1': [{ id: 5, first: 'A', last: 'B', email: 'a@b.c', externalRefId: 'u5', isActive: true,
          userType: 0, isAdmin: false, isPortalUrlAccess: false, lastLogin: null, lang: 'en-US' }],
        '2': [],
      });
      return;
    }
    if (url.pathname === '/object/objectType') {
      send([{ id: 9, name: 'Case', pluralName: 'Cases', description: null, monogram: 'CS',
        nameKey: null, descriptionKey: null, pluralNameKey: null, monogramKey: null,
        color: '#123456', objectLifeCycleId: 55, externalRefId: 'ot9', created: 'x',
        modified: 'x', nextElement: 1, org: 1, assessment: false, anchor: null,
        anchorRelationship: null, dataDefinitionId: null, retentionEnabled: false,
        isSystemConfig: false, isLibraryObjectType: false }]);
      return;
    }
    if (url.pathname === '/object/objectLifeCycle') {
      send([lifeCycle(url.searchParams.get('includeStates') === 'true')]);
      return;
    }

    const roleMatch = /^\/data\/rolePermissions\/objectLifeCycles\/role\/(\d+)$/.exec(url.pathname);
    if (roleMatch !== null) {
      if (Number(roleMatch[1]) === state.failRoleId) {
        res.statusCode = 500;
        res.end('upstream exploded');
        return;
      }
      send([{ objectLifeCycleId: 55 }]);
      return;
    }

    res.statusCode = 404;
    res.end('{"message":"no such endpoint"}');
  });

  state.server = server;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port 0: the OS picks a free one, so two concurrent runs cannot collide
    // and a leftover process cannot be mistaken for this upstream.
    server.listen(0, '127.0.0.1', () => {
      state.port = (server.address() as AddressInfo).port;
      server.removeListener('error', reject);
      resolve();
    });
  });

  return state;
}

/* -------------------------------------------------------------------------- */
/* App under test                                                             */
/* -------------------------------------------------------------------------- */

interface App {
  child: ChildProcess;
  baseUrl: string;
}

/**
 * Boots the real server on an ephemeral port and resolves only once *this*
 * child reports the port it bound. Nothing is assumed about what is listening
 * where, so the assertions cannot be served by a process we did not start.
 */
async function startApp(env: Record<string, string>): Promise<App> {
  const child = spawn(process.execPath, ['src/server/index.ts'], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);

  let output = '';
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never started. output:\n${output}`)), 30_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      const match = /listening on http:\/\/localhost:(\d+)/.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code} before listening. output:\n${output}`));
    });
  });

  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

function stopApp(app: App): void {
  app.child.kill();
  children.delete(app.child);
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

/* -------------------------------------------------------------------------- */

const upstream = await startUpstream();
const liveEnv = {
  DATA_SOURCE: 'live',
  RESOLVER_BASE_URL: `http://127.0.0.1:${upstream.port}`,
  RESOLVER_API_KEY: API_KEY,
  NODE_ENV: 'development',
};

try {
  console.log('live path: happy case + call budget');
  {
    const app = await startApp(liveEnv);
    try {
      // Both groups in parallel, cold: exercises single-flight and the shared role.
      const [first, second] = await Promise.all([
        getJson(`${app.baseUrl}/api/groups/1`),
        getJson(`${app.baseUrl}/api/groups/2`),
      ]);
      check('both groups resolve through the live client',
        first.body.group?.name === 'Ops' && second.body.group?.name === 'Risk',
        [first.body.group?.name, second.body.group?.name]);
      check('access derives from live payloads',
        first.body.roles?.[0]?.objectTypes?.[0]?.name === 'Case' &&
        first.body.roles[0].objectTypes[0].coverage === 'full' &&
        first.body.roles[0].objectTypes[0].grantedStateCount === 2,
        first.body.roles?.[0]?.objectTypes?.[0]);

      const meta = (await getJson(`${app.baseUrl}/api/meta`)).body;
      check('budget is 3 collection + 2 catalog + 1 per distinct role',
        meta.upstreamCallCount === 7, meta.upstreamCallCount);

      const roleCalls = upstream.seen.filter((entry) => entry.path.includes('/role/77')).length;
      check('a role in two groups is fetched once, even concurrently', roleCalls === 1, roleCalls);

      check('some upstream traffic happened at all', upstream.seen.length > 0);
      check('every upstream request carried the api key',
        upstream.seen.length > 0 && upstream.seen.every((entry) => entry.key === API_KEY),
        upstream.seen.filter((entry) => entry.key !== API_KEY));
      check('states were requested explicitly',
        upstream.seen.some((entry) => entry.path === '/object/objectLifeCycle?includeStates=true'));

      await getJson(`${app.baseUrl}/api/roles/77/object-types/9`);
      const afterDrill = (await getJson(`${app.baseUrl}/api/meta`)).body;
      check('drill-down issues no upstream call', afterDrill.upstreamCallCount === 7,
        afterDrill.upstreamCallCount);
    } finally {
      stopApp(app);
    }
  }

  console.log('\nlive path: a failing role does not take down the group');
  {
    // A fresh child rather than POST /api/cache/clear: that endpoint is
    // dev-only, so depending on it would couple this check to its gating.
    upstream.failRoleId = 77;
    const app = await startApp(liveEnv);
    try {
      const before = upstream.seen.filter((entry) => entry.path.includes('/role/77')).length;
      const degraded = await getJson(`${app.baseUrl}/api/groups/1`);
      check('the group still returns 200', degraded.status === 200, degraded.status);
      check('the failing role carries the reason',
        typeof degraded.body.roles?.[0]?.grantsError === 'string' &&
        degraded.body.roles[0].grantsError.includes('500'),
        degraded.body.roles?.[0]?.grantsError);
      check('healthy data around it still renders', degraded.body.group?.name === 'Ops');

      await getJson(`${app.baseUrl}/api/groups/1`);
      const after = upstream.seen.filter((entry) => entry.path.includes('/role/77')).length;
      check('failures are not cached, so a reload retries', after === before + 2,
        { before, after });
    } finally {
      stopApp(app);
      upstream.failRoleId = null;
    }
  }

  console.log('\nlive path: upstream errors are mapped, not swallowed');
  {
    upstream.failGroups = true;
    const app = await startApp(liveEnv);
    try {
      const failed = await getJson(`${app.baseUrl}/api/groups`);
      check('an upstream 500 surfaces as 502', failed.status === 502, failed.status);
      check('the error names the upstream path', failed.body.error?.upstream === '/user/group',
        failed.body.error);
    } finally {
      stopApp(app);
      upstream.failGroups = false;
    }
  }
  {
    const app = await startApp({ ...liveEnv, RESOLVER_API_KEY: 'wrong-key' });
    try {
      const rejected = await getJson(`${app.baseUrl}/api/groups`);
      check('a rejected api key passes 401 through', rejected.status === 401, rejected.status);
    } finally {
      stopApp(app);
    }
  }
} finally {
  for (const child of children) child.kill();
  upstream.server.close();
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
