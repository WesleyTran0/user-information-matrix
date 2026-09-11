/**
 * Types for the Excel export.
 *
 * The export is a *flat, denormalized* matrix -- one row per
 * (group, role, object type, lifecycle, state) tuple -- because that is the
 * shape an Excel PivotTable consumes. A normalized set of sheets would push
 * the join back onto the reader.
 *
 * The load-bearing decision is that `MatrixExportRow` carries the **domain
 * objects** of the join rather than a pre-flattened bag of scalars. Columns are
 * pure projections out of those objects, declared in `columns.ts`. So when the
 * domain model grows a field, adding it to the sheet is one descriptor in one
 * array -- the row builder and the workbook writer never change.
 */
import type {
  LifeCycleAccess,
  ObjectTypeAccessDetail,
  Role,
  StateAccess,
  UserGroup,
} from '../../shared/types/domain.ts';

/** What a column may put in a cell. `null` is written as a genuinely empty cell. */
export type ExportCellValue = string | number | boolean | null;

/**
 * One row of the matrix: a tuple of the domain objects being joined.
 *
 * The trailing members are nullable because the join is not always complete: a
 * role may reach nothing, an object type may own no lifecycles, a lifecycle may
 * carry no states, and a grant may not be attributable to any object type at
 * all. Those rows are still emitted -- with `note` saying why -- so a gap in
 * the data is visible in the sheet instead of being silently absent.
 *
 * `objectType` is the full drill-down detail rather than the `ObjectTypeAccess`
 * roll-up, because the detail is what carries `permissionSummary` and
 * `permissionsError`. The latter is what lets a column tell "the API reported
 * no access" apart from "the permissions call failed".
 */
export interface MatrixExportRow {
  readonly group: UserGroup;
  readonly role: Role;
  readonly objectType: ObjectTypeAccessDetail | null;
  readonly lifeCycle: LifeCycleAccess | null;
  readonly state: StateAccess | null;
  /**
   * Whether the role holds the lifecycle grant covering this state -- the cheap
   * inference the app used before per-state permissions were available. Kept
   * alongside the reported level so the two can be compared in a pivot; see the
   * `Grant Overstates` column, which is exactly where they disagree.
   */
  readonly grantCoversState: boolean;
  /**
   * Set when the (role, object type) drill-down itself could not be fetched, or
   * when the row is a placeholder for an incomplete tuple. Distinct from
   * `objectType.permissionsError`, which means the drill-down succeeded but its
   * permissions half did not.
   */
  readonly note: string | null;
}

/**
 * A single spreadsheet column, declared once and used for both the header row
 * and every data cell. `key` is the exceljs column key; it is never displayed.
 */
export interface ExportColumn {
  readonly header: string;
  readonly key: string;
  readonly width: number;
  readonly value: (row: MatrixExportRow) => ExportCellValue;
}
