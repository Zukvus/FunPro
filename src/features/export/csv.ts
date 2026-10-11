export type Cell = string | number | boolean | null | undefined;

/**
 * RFC 4180 CSV with formula-injection protection: cells starting with = + - @ (or tab/CR) are
 * prefixed with a single quote so spreadsheet apps do not execute them.
 */
export function escapeCsvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][], delimiter = ','): string {
  const lines = [
    headers.map(escapeCsvCell).join(delimiter),
    ...rows.map((r) => r.map(escapeCsvCell).join(delimiter)),
  ];
  // BOM so Excel opens UTF-8 (Cyrillic) correctly.
  return `\ufeff${lines.join('\r\n')}`;
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const src = text.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
