/**
 * Live-path integration check.
 *
 * Everything else exercises the mock source. This one stands up a fake
 * Resolver upstream, boots the real server against it with DATA_SOURCE=live,
 * and asserts the things only the live path can get wrong: the x-api-key
 * header, envelope unwrapping, the call budget, per-role failure isolation,
 * and upstream error mapping.
 *
 * No dependencies -- node:http plus the real server as a child process.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';

const UPSTREAM_PORT = 9900;
const APP_PORT = 8899;
const API_KEY = 'secret-key';

let failures = 0;

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

const seen: SeenRequest[] = [];
let failRoleId: number | null = null;

function startUpstream(): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://upstream');
    seen.push({ path: url.pathname + url.search, key: (req.headers['x-api-key'] as string) ?? null });

    const send = (data: unknown): void => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data }));
    };

    if (req.headers['x-api-key'] !== API_KEY) {
      res.statusCode = 401;
      res.end('{"message":"bad key"}');
      return;
    }

    switch (url.pathname) {
      case '/user/group':
        return send([{ id: 1, name: 'Ops', description: null, created: 'x', modified: 'x',
          createdBy: null, modifiedBy: null, org: 1, externalRefId: 'g1',
          scimdisplayname: null, numberOfUsers: '1' }]);
      case '/user/group/roles':
        return send({ '1': [{ id: 77, name: 'Analyst', description: null, isGlobal: false,
          created: 'x', modified: 'x', org: 1, externalRefId: 'r77' }] });
      case '/user/group/users':
        return send({ '1': [{ id: 5, first: 'A', last: 'B', email: 'a@b.c', externalRefId: 'u5',
          isActive: true, userType: 0, isAdmin: false, isPortalUrlAccess: false,
          lastLogin: null, lang: 'en-US' }] });
      case '/object/objectType':
        return send([{ id: 9, name: 'Case', pluralName: 'Cases', description: null, monogram: 'CS',
          nameKey: null, descriptionKey: null, pluralNameKey: null, monogramKey: null,
          color: '#123456', objectLifeCycleId: 55, externalRefId: 'ot9', created: 'x',
          modified: 'x', nextElement: 1, org: 1, assessment: false, anchor: null,
          anchorRelationship: null, dataDefinitionId: null, retentionEnabled: false,
          isSystemConfig: false, isLibraryObjectType: false }]);
      case '/object/objectLifeCycle':
        return send([{ id: 55, name: 'Case Flow', type: 1, nameKey: null, description: null,
          descriptionKey: null, created: 'x', modified: 'x', org: 1, nextStateOrdinal: 2,
          externalRefId: 'lc55', objectTypeId: 9, isSystemConfig: false,
          states: url.searchParams.get('includeStates') === 'true'
            ? [{ id: 1, name: 'New', ordinal: 0 }, { id: 2, name: 'Done', ordinal: 1 }]
            : undefined }]);
      default: {
        const role = /^\/data\/rolePermissions\/objectLifeCycles\/role\/(\d+)$/.exec(url.pathname);
        if (role !== null) {
          if (Number(role[1]) === failRoleId) {
            res.statusCode = 500;
            res.end('upstream exploded');
            return;
          }
          return send([{ objectLifeCycleId: 55 }]);
        }
        res.statusCode = 404;
        res.end('{"message":"no such endpoint"}');
      }
    }
  });
  server.listen(UPSTREAM_PORT);
  return server;
}

async function waitForServer(url: string, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} never became ready`);
}

function startApp(env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ['src/server/index.ts'], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
}

const upstream = startUpstream();
const app = startApp({
  DATA_SOURCE: 'live',
  RESOLVER_BASE_URL: `http://localhost:${UPSTREAM_PORT}`,
  RESOLVER_API_KEY: API_KEY,
  PORT: String(APP_PORT),
  NODE_ENV: 'development',
});

const base = `http://localhost:${APP_PORT}`;

try {
  await waitForServer(`${base}/api/meta`);

  console.log('live path: happy case');
  const matrix = await (await fetch(`${base}/api/groups/1`)).json();
  check('the group resolves through the live client', matrix.group?.name === 'Ops', matrix.group);
  check('access derives from live payloads',
    matrix.roles?.[0]?.objectTypes?.[0]?.name === 'Case' &&
    matrix.roles[0].objectTypes[0].coverage === 'full' &&
    matrix.roles[0].objectTypes[0].grantedStateCount === 2,
    matrix.roles?.[0]?.objectTypes?.[0]);

  const meta = await (await fetch(`${base}/api/meta`)).json();
  check('call budget is 3 collection + 2 catalog + 1 role', meta.upstreamCallCount === 6,
    meta.upstreamCallCount);
  check('every upstream request carried the api key',
    seen.every((entry) => entry.key === API_KEY), seen.filter((e) => e.key !== API_KEY));
  check('states were requested explicitly',
    seen.some((entry) => entry.path === '/object/objectLifeCycle?includeStates=true'));

  console.log('\nlive path: drill-down costs nothing');
  await (await fetch(`${base}/api/roles/77/object-types/9`)).json();
  const afterDrill = await (await fetch(`${base}/api/meta`)).json();
  check('drill-down issued no upstream call', afterDrill.upstreamCallCount === 6,
    afterDrill.upstreamCallCount);

  console.log('\nlive path: a failing role does not take down the group');
  failRoleId = 77;
  await fetch(`${base}/api/cache/clear`, { method: 'POST' });
  const degradedResponse = await fetch(`${base}/api/groups/1`);
  const degraded = await degradedResponse.json();
  check('the group still returns 200', degradedResponse.status === 200, degradedResponse.status);
  check('the failing role carries the reason',
    typeof degraded.roles?.[0]?.grantsError === 'string' &&
    degraded.roles[0].grantsError.includes('500'), degraded.roles?.[0]?.grantsError);

  const attemptsBefore = seen.filter((entry) => entry.path.includes('/role/77')).length;
  await fetch(`${base}/api/groups/1`);
  const attemptsAfter = seen.filter((entry) => entry.path.includes('/role/77')).length;
  check('failures are not cached, so a reload retries', attemptsAfter === attemptsBefore + 1,
    { attemptsBefore, attemptsAfter });
} finally {
  app.kill();
  upstream.close();
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
