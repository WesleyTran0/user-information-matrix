/**
 * Turns rows into an .xlsx.
 *
 * This module knows nothing about the domain: it walks whatever
 * `ExportColumn[]` it is handed, which is why adding a column never touches it.
 *
 * Everything it does beyond writing cells exists to make the sheet usable as a
 * PivotTable source: a single header row (pivots reject merged or multi-row
 * headers), a frozen header, an autofilter over the exact used range, and
 * booleans written as real booleans rather than the strings 'TRUE'/'FALSE'.
 */
import ExcelJS from 'exceljs';
import type { Workbook, Worksheet } from 'exceljs';
import { MATRIX_COLUMNS } from './columns.ts';
import type { ExportColumn, MatrixExportRow } from './types.ts';

export interface WorkbookOptions {
  /** Defaults to 'Permission Matrix'. Sanitized to Excel's sheet-name rules. */
  sheetName?: string;
  /** Defaults to `MATRIX_COLUMNS`. Override to add or reorder columns. */
  columns?: readonly ExportColumn[];
}

const DEFAULT_SHEET_NAME = 'Permission Matrix';

/** Excel rejects these in sheet names outright, and caps the name at 31 chars. */
const FORBIDDEN_SHEET_CHARS = /[*?:\\/\[\]]/g;

export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(FORBIDDEN_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return DEFAULT_SHEET_NAME;
  return cleaned.slice(0, 31);
}

export function buildWorkbook(
  rows: readonly MatrixExportRow[],
  options: WorkbookOptions = {},
): Workbook {
  const columns = options.columns ?? MATRIX_COLUMNS;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'user-information-matrix';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sanitizeSheetName(options.sheetName ?? DEFAULT_SHEET_NAME), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  for (const row of rows) {
    // Positional array rather than a keyed object: `sheet.columns` was built
    // from the same array in the same order, and a positional push cannot be
    // silently dropped by a key typo in a descriptor.
    sheet.addRow(columns.map((column) => column.value(row)));
  }

  styleHeader(sheet, columns.length);

  // Autofilter over the used range only -- over-reaching it makes Excel offer
  // filter dropdowns on empty columns.
  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length },
    };
  }

  return workbook;
}

function styleHeader(sheet: Worksheet, columnCount: number): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  for (let column = 1; column <= columnCount; column += 1) {
    header.getCell(column).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEDEFF2' },
    };
  }
  header.commit();
}

export async function workbookToBuffer(workbook: Workbook): Promise<Buffer> {
  // exceljs types this as its own `Buffer` shim (declared as an ArrayBuffer);
  // at runtime on Node it is a real Buffer.
  const written = await workbook.xlsx.writeBuffer();
  return written as unknown as Buffer;
}

export async function writeWorkbookFile(workbook: Workbook, filePath: string): Promise<void> {
  await workbook.xlsx.writeFile(filePath);
}
