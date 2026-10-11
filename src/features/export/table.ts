import { toCsv, type Cell } from './csv';
import { downloadBlob, MIME, timestampedName } from './download';
import { writeXlsx } from './xlsx';

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export interface TableExport {
  name: string;
  headers: string[];
  rows: Cell[][];
  /** Raw objects for JSON exports (more faithful than the flattened rows). */
  json?: unknown;
}

export function exportTable(t: TableExport, format: ExportFormat): void {
  const filename = timestampedName(t.name, format);
  if (format === 'csv') downloadBlob(toCsv(t.headers, t.rows), filename, MIME.csv);
  else if (format === 'xlsx') {
    const bytes = writeXlsx([{ name: t.name, headers: t.headers, rows: t.rows }]);
    downloadBlob(bytes.slice().buffer, filename, MIME.xlsx);
  } else
    downloadBlob(
      JSON.stringify(
        t.json ?? t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i] ?? null]))),
        null,
        2,
      ),
      filename,
      MIME.json,
    );
}
