/**
 * Builds the master workbook: every user group in one file.
 *
 *   npm run export:all                      # every group, using .env
 *   npm run export:all -- --dry-run         # cost only, no per-pair calls
 *   npm run export:all -- --limit 5         # first 5 groups, for a trial run
 *   npm run export:all -- --out reports/x.xlsx
 *
 * This is a script rather than an HTTP route because the cost scales with the
 * whole org: one call per distinct (role, object type) pair. A large tenant is
 * thousands of calls and many minutes, which is a job, not a request.
 *
 * It runs in two phases and reports the cost between them, so `--dry-run`
 * answers "what would this cost?" for the price of the cheap calls alone.
 * Nothing is written until the fetch phase completes.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from '../src/server/env.ts';
import { MatrixRepository } from '../src/server/data/repository.ts';
import { LiveResolverSource } from '../src/server/data/liveSource.ts';
import { MockResolverSource } from '../src/server/data/mockSource.ts';
import { ResolverClient } from '../src/server/http/resolverClient.ts';
import type { ResolverDataSource } from '../src/server/data/source.ts';
import {
  exportAllGroupsWorkbook,
  planAllGroupsExport,
  type AllGroupsProgress,
} from '../src/server/export/allGroups.ts';
import { writeWorkbookFile } from '../src/server/export/workbook.ts';

interface Args {
  dryRun: boolean;
  limit: number | null;
  out: string;
  groupIds: number[] | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    dryRun: false,
    limit: null,
    out: `exports/all-groups-${new Date().toISOString().slice(0, 10)}.xlsx`,
    groupIds: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      index += 1;
      return value;
    };

    switch (flag) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--limit': {
        const value = Number.parseInt(next(), 10);
        if (!Number.isFinite(value) || value <= 0) throw new Error('--limit needs a positive integer');
        args.limit = value;
        break;
      }
      case '--out':
        args.out = next();
        break;
      case '--groups':
        args.groupIds = next()
          .split(',')
          .map((raw) => Number.parseInt(raw.trim(), 10))
          .filter((value) => Number.isFinite(value));
        break;
      case '--help':
        console.log(
          [
            'Usage: npm run export:all -- [options]',
            '',
            '  --dry-run          report the cost and stop',
            '  --limit N          only the first N groups',
            '  --groups 1,2,3     only these group ids',
            '  --out PATH         output file (default exports/all-groups-<date>.xlsx)',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }

  return args;
}

function createSource(config: ReturnType<typeof loadConfig>): ResolverDataSource {
  if (config.dataSource === 'live') return new LiveResolverSource(new ResolverClient(config));
  return new MockResolverSource();
}

/** Single-line progress, rewritten in place when stdout is a terminal. */
function reportProgress(progress: AllGroupsProgress): void {
  const { phase, groupsDone, groupsTotal, rowsSoFar } = progress;
  const suffix = phase === 'planning' ? '' : ` | ${rowsSoFar} rows`;
  const line = `  ${phase} ${groupsDone}/${groupsTotal}${suffix}`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line.padEnd(72)}`);
  } else if (groupsDone === groupsTotal || groupsDone % 10 === 0) {
    console.log(line);
  }
}

function endProgressLine(): void {
  if (process.stdout.isTTY) process.stdout.write('\n');
}

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const source = createSource(config);
const repository = new MatrixRepository(source, config.cacheTtlMs, config.maxConcurrency);

console.log(`Master export (data source: ${source.kind})`);

const started = Date.now();
const { plan, skipped } = await planAllGroupsExport(repository, {
  maxConcurrency: config.maxConcurrency,
  onProgress: reportProgress,
  ...(args.groupIds === null ? {} : { groupIds: args.groupIds }),
});
endProgressLine();

// --limit is applied after planning so the reported cost matches what will
// actually be fetched.
const selected = args.limit === null ? plan.groups : plan.groups.slice(0, args.limit);
const limited = selected.length !== plan.groups.length;

console.log(`
  groups                 ${plan.groups.length}${limited ? ` (exporting ${selected.length})` : ''}
  distinct roles         ${plan.distinctRoles}
  distinct object types  ${plan.distinctObjectTypes}
  role/object-type pairs ${plan.distinctPairs}
  calls so far           ${source.callCount}
  estimated remaining    ${plan.estimatedRemainingCalls}${limited ? ' (for every group)' : ''}`);

if (skipped.length > 0) {
  console.log(`  skipped groups         ${skipped.length}`);
  for (const entry of skipped.slice(0, 5)) {
    console.log(`    - ${entry.name} (${entry.groupId}): ${entry.reason}`);
  }
}

if (args.dryRun) {
  console.log('\n--dry-run: stopping before the per-pair calls.');
  process.exit(0);
}

const result = await exportAllGroupsWorkbook(repository, {
  maxConcurrency: config.maxConcurrency,
  onProgress: reportProgress,
  groupIds: selected.map((matrix) => matrix.group.id),
});
endProgressLine();

await mkdir(dirname(args.out), { recursive: true });
await writeWorkbookFile(result.workbook, args.out);

const seconds = Math.round((Date.now() - started) / 100) / 10;
console.log(`
  wrote                  ${args.out}
  sheets                 ${result.workbook.worksheets.map((sheet) => sheet.name).join(', ')}
  permission rows        ${result.rows.length}
  upstream calls         ${source.callCount}
  elapsed                ${seconds}s`);
