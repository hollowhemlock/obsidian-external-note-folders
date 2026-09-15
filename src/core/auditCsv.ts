import {
  finishAuditSteps,
  sortAuditSteps
} from './auditSteps.ts';

export interface AuditTable {
  columns: string[];
  rows: CsvRow[];
}
export type CsvRow = Record<string, string>;
export function serializeAuditCsv(table: AuditTable): string {
  return finishAuditSteps(serializeAuditCsvSteps(table));
}
export function* serializeAuditCsvSteps(table: AuditTable): Generator<void, string> {
  const rows: { cells: string[]; key: string }[] = [];
  for (const row of table.rows) {
    const cells = table.columns.map((column) => row[column] ?? '');
    rows.push({ cells, key: JSON.stringify(cells) });
    yield;
  }
  const sorted = yield* sortAuditSteps(rows, (a, b) => a.key.localeCompare(b.key));
  const lines = [table.columns.map(escapeCell).join(',')];
  for (const row of sorted) {
    lines.push(row.cells.map(escapeCell).join(','));
    yield;
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
function escapeCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
