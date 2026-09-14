/**
 * Public entry point for the Excel export: one group in, one workbook out.
 *
 * The dependency is a structural `MatrixExportSource`, not `MatrixRepository`.
 * `MatrixRepository` satisfies it as-is, and so does a stub -- which is how the
 * export check builds a real .xlsx without touching the network.
 *
 * Call cost
 * ---------
 * This adds **no** upstream endpoint of its own. It spends exactly what the
 * equivalent clicking-through would: the group matrix (3 collection + 2 catalog
 * + 1 per distinct role, all cached), plus each (role, object type) drill-down
 * at up to 2 calls cold -- 1 for that pair's per-state permissions, 1 for the
 * object type's state requirements, the latter shared across every role. So for
 * R roles reaching T object types between them, with P distinct pairs:
 *
 *   5 + R + P + 2T  calls cold, and 0 on a warm cache. The 2T is per object
 *                   type: its exit requirements and its workflow definition,
 *                   both shared across roles.
 *
 * P is the term that bites: it is bounded by R x T, not by R + T. A measured
 * live group (9 roles, 41 object types) came to ~350 pairs, so the fan-out runs
 * through `mapWithConcurrency` at the app's configured ceiling.
 *
 * Sheets
 * ------
 * **Summary** (first, and what Excel opens on) names the group and gives one
 * line per role and object type: how many states the role can edit, read, or
 * not touch. **Permission Matrix** is the flat per-state pivot source.
 * **Members** lists who is in the group.
 *
 * Deliberately not built here: the all-groups export, which grows P with the
 * whole org and would need a job queue and a progress channel rather than a
 * request handler.
 */
import type {
  GroupId,
  GroupMatrix,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  RoleId,
} from '../../shared/types/domain.ts';
import { buildMatrixRows, type ObjectTypeDetailFetcher } from './rows.ts';
import { addMatrixSheet, createWorkbook, type WorkbookOptions } from './workbook.ts';
import { addMembersSheet, addSummarySheet } from './summary.ts';
import type { MatrixExportRow } from './types.ts';
import type { Workbook } from 'exceljs';

/** The slice of `MatrixRepository` the export needs. */
export interface MatrixExportSource {
  getGroupMatrix(groupId: GroupId): Promise<GroupMatrix>;
  getObjectTypeDetail(roleId: RoleId, objectTypeId: ObjectTypeId): Promise<ObjectTypeAccessDetail>;
}

export interface ExportGroupOptions extends WorkbookOptions {
  /** Ceiling on in-flight drill-down fetches; pass `config.maxConcurrency`. */
  maxConcurrency: number;
}

export interface GroupExport {
  workbook: Workbook;
  /** The flattened rows, returned so callers can assert on them without reparsing. */
  rows: MatrixExportRow[];
  matrix: GroupMatrix;
}

export async function exportGroupWorkbook(
  source: MatrixExportSource,
  groupId: GroupId,
  options: ExportGroupOptions,
): Promise<GroupExport> {
  const matrix = await source.getGroupMatrix(groupId);

  const fetchDetail: ObjectTypeDetailFetcher = (request) =>
    source.getObjectTypeDetail(request.roleId, request.objectTypeId);

  const rows = await buildMatrixRows(matrix, fetchDetail, {
    maxConcurrency: options.maxConcurrency,
  });

  // Order matters: exceljs appends, and Excel opens on the first sheet. The
  // matrix is the pivot source, not what someone opening the file wants to
  // read first.
  const workbook = createWorkbook();
  addSummarySheet(workbook, matrix, rows);
  addMatrixSheet(workbook, rows, {
    sheetName: options.sheetName ?? 'Permission Matrix',
    ...(options.columns === undefined ? {} : { columns: options.columns }),
  });
  addMembersSheet(workbook, matrix);

  return { workbook, rows, matrix };
}

export { MATRIX_COLUMNS } from './columns.ts';
export { buildMatrixRows } from './rows.ts';
export { buildWorkbook, sanitizeSheetName, workbookToBuffer, writeWorkbookFile } from './workbook.ts';
export type { ExportCellValue, ExportColumn, MatrixExportRow } from './types.ts';
export type { ObjectTypeDetailFetcher, ObjectTypeDetailRequest } from './rows.ts';
