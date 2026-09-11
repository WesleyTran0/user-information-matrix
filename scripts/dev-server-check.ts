/**
 * Dev-server module graph check.
 *
 * `vite build` bundles everything, and the render check runs components in
 * Node -- so both pass even when the *dev server* cannot serve a module to a
 * browser. That is not hypothetical: client source under `src/client/api/`
 * was silently swallowed by the `/api` dev proxy and 404'd in the browser,
 * producing a blank page while every other check stayed green.
 *
 * This boots the real dev server, walks the module graph from the entry the
 * way a browser does, and fails if any module does not resolve. It also
 * asserts the API proxy still reaches the backend, since the two compete for
 * the same URL space.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createViteServer } from 'vite';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

/** Boots the API server on an ephemeral port, resolving with that port. */
async function startApi(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, ['src/server/index.ts'], {
    env: { ...process.env, PORT: '0', DATA_SOURCE: 'mock' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`api never started:\n${output}`)), 30_000);
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
      reject(new Error(`api exited with ${code} before listening:\n${output}`));
    });
  });

  return { child, port };
}

/** Module specifiers Vite rewrites to absolute dev-server paths. */
function localSpecifiers(code: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:from|import)\s*["'](\/[^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const specifier = match[1];
    // /@fs, /@vite, /@react-refresh are Vite internals and node_modules deps.
    if (specifier !== undefined && !specifier.startsWith('/@')) found.add(specifier);
  }
  return [...found];
}

const api = await startApi();
// vite.config.ts reads PORT to choose the proxy target.
process.env['PORT'] = String(api.port);

const vite = await createViteServer({
  configFile: 'vite.config.ts',
  server: { port: 0 },
  logLevel: 'error',
});

try {
  await vite.listen();
  const url = vite.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('vite reported no local url');
  const base = url.replace(/\/$/, '');

  console.log('dev server: the browser entry resolves');
  const indexResponse = await fetch(`${base}/`);
  const indexHtml = await indexResponse.text();
  check('index.html is served', indexResponse.status === 200 && indexHtml.includes('<div id="root">'));
  check('it points at the module entry', indexHtml.includes('main.tsx'));

  console.log('\ndev server: every module in the graph resolves');
  const visited = new Map<string, number>();
  const queue = ['/main.tsx'];

  while (queue.length > 0) {
    const specifier = queue.shift();
    if (specifier === undefined || visited.has(specifier)) continue;

    const response = await fetch(`${base}${specifier}`);
    visited.set(specifier, response.status);
    if (response.status !== 200) continue;

    const body = await response.text();
    for (const next of localSpecifiers(body)) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  const broken = [...visited].filter(([, status]) => status !== 200);
  check(
    `all ${visited.size} modules reachable from the entry return 200`,
    broken.length === 0,
    broken,
  );
  // Guards against the crawl silently finding nothing and passing.
  check('the crawl actually walked the app', visited.size >= 10, visited.size);
  check('it reached the deepest component', visited.has('/components/ObjectTypeDetail.tsx'),
    [...visited.keys()]);

  console.log('\ndev server: the API proxy still reaches the backend');
  const proxied = await fetch(`${base}/api/groups`);
  const groups = (await proxied.json()) as unknown[];
  check('/api/groups proxies through to the API', proxied.status === 200, proxied.status);
  check('and returns the fixture groups', Array.isArray(groups) && groups.length === 3,
    Array.isArray(groups) ? groups.length : groups);
} finally {
  await vite.close();
  api.child.kill();
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
