/**
 * Flattens a built `GroupMatrix` into the denormalized rows the sheet writes.
 *
 * Why the detail fetcher is injected
 * ----------------------------------
 * The per-state permissions that make this export worth having live in
 * `ObjectTypeAccessDetail`, which is scoped to a (role, object type) *pair* and
 * costs up to 2 upstream calls cold. One real group is a lot of pairs -- a
 * measured group had 9 roles reaching 41 object types, ~350 pairs -- so the
 * fan-out is bounded by `mapWithConcurrency` at the caller's configured limit
 * (`RESOLVER_MAX_CONCURRENCY`) rather than issued all at once.
 *
 * Taking the fetcher as a parameter also keeps this module free of the
 * repository, so the export check builds a real workbook with zero network.
 *
 * Complexity
 * ----------
 * O(pairs) fetches, then O(total states across those pairs) row construction.
 * The nesting reads as four deep but each level is bounded by the level above
 * it, so the work is linear in the number of rows produced -- there is no
 * cubic term to optimize away.
 */
import type {
  GroupMatrix,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  RoleId,
} from '../../shared/types/domain.ts';
import { mapWithConcurrency } from '../http/concurrency.ts';
import type { MatrixExportRow } from './types.ts';

/** One (role, object type) drill-down to resolve. */
export interface ObjectTypeDetailRequest {
  roleId: RoleId;
  objectTypeId: ObjectTypeId;
}

/**
 * Resolves one drill-down. `MatrixRepository.getObjectTypeDetail` satisfies
 * this; so does an in-memory stub. Rejections are caught per pair and turned
 * into a placeholder row, so one bad pair cannot lose the whole sheet.
 */
export type ObjectTypeDetailFetcher = (
  request: ObjectTypeDetailRequest,
) => Promise<ObjectTypeAccessDetail>;

export interface BuildRowsOptions {
  /** Ceiling on in-flight drill-down fetches. Pass the app's configured limit. */
  maxConcurrency: number;
}

function detailKey(roleId: RoleId, objectTypeId: ObjectTypeId): string {
  return `${roleId}:${objectTypeId}`;
}

interface DetailOutcome {
  detail: ObjectTypeAccessDetail | null;
  error: string | null;
}

export async function buildMatrixRows(
  matrix: GroupMatrix,
  fetchDetail: ObjectTypeDetailFetcher,
  options: BuildRowsOptions,
): Promise<MatrixExportRow[]> {
  // Pairs are unique within a group: a role appears once, and its object types
  // are already deduped by `buildRoleAccess`.
  const requests: ObjectTypeDetailRequest[] = [];
  for (const roleAccess of matrix.roles) {
    for (const objectType of roleAccess.objectTypes) {
      requests.push({ roleId: roleAccess.role.id, objectTypeId: objectType.objectTypeId });
    }
  }

  const outcomes = await mapWithConcurrency(
    requests,
    options.maxConcurrency,
    async (request): Promise<DetailOutcome> => {
      try {
        return { detail: await fetchDetail(request), error: null };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.warn(
          `[export] drill-down unavailable for role ${request.roleId} / object type ${request.objectTypeId}: ${message}`,
        );
        return { detail: null, error: message };
      }
    },
  );

  const detailByPair = new Map<string, DetailOutcome>();
  requests.forEach((request, position) => {
    const outcome = outcomes[position];
    if (outcome !== undefined) {
      detailByPair.set(detailKey(request.roleId, request.objectTypeId), outcome);
    }
  });

  // Emission is a second pass over the matrix rather than a map over `outcomes`
  // so row order follows the domain's own sort (roles by name, object types by
  // name, granted lifecycles first) and is stable across runs.
  const rows: MatrixExportRow[] = [];
  const group = matrix.group;

  for (const roleAccess of matrix.roles) {
    const role = roleAccess.role;
    const base = { group, role } as const;

    if (roleAccess.grantsError !== null) {
      rows.push({
        ...base,
        objectType: null,
        lifeCycle: null,
        state: null,
        grantCoversState: false,
        note: `Role permissions could not be loaded: ${roleAccess.grantsError}`,
      });
    }

    for (const objectTypeAccess of roleAccess.objectTypes) {
      const outcome = detailByPair.get(detailKey(role.id, objectTypeAccess.objectTypeId));
      const detail = outcome?.detail ?? null;

      if (detail === null) {
        rows.push({
          ...base,
          objectType: null,
          lifeCycle: null,
          state: null,
          grantCoversState: false,
          note:
            `Object type ${objectTypeAccess.name} (${objectTypeAccess.objectTypeId}) ` +
            `could not be expanded: ${outcome?.error ?? 'unknown error'}`,
        });
        continue;
      }

      if (detail.lifeCycles.length === 0) {
        rows.push({
          ...base,
          objectType: detail,
          lifeCycle: null,
          state: null,
          grantCoversState: false,
          note: 'Object type owns no lifecycles in the catalog.',
        });
        continue;
      }

      for (const lifeCycle of detail.lifeCycles) {
        if (lifeCycle.states.length === 0) {
          // Emit the lifecycle anyway: a granted lifecycle with no states is a
          // catalog gap, and dropping the row would hide the grant entirely.
          rows.push({
            ...base,
            objectType: detail,
            lifeCycle,
            state: null,
            grantCoversState: lifeCycle.granted,
            note: 'Lifecycle carries no states in the catalog.',
          });
          continue;
        }

        for (const state of lifeCycle.states) {
          rows.push({
            ...base,
            objectType: detail,
            lifeCycle,
            state,
            grantCoversState: state.granted,
            note: null,
          });
        }
      }
    }

    // Grants that point at no object type would otherwise vanish from the
    // sheet, taking the data gap with them.
    for (const lifeCycleId of roleAccess.unresolvedLifeCycleIds) {
      rows.push({
        ...base,
        objectType: null,
        lifeCycle: null,
        state: null,
        grantCoversState: true,
        note: `Granted lifecycle ${lifeCycleId} is not attributable to any object type.`,
      });
    }

    const producedNothing =
      roleAccess.objectTypes.length === 0 &&
      roleAccess.unresolvedLifeCycleIds.length === 0 &&
      roleAccess.grantsError === null;
    if (producedNothing) {
      rows.push({
        ...base,
        objectType: null,
        lifeCycle: null,
        state: null,
        grantCoversState: false,
        note: 'Role reaches no object type.',
      });
    }
  }

  return rows;
}
