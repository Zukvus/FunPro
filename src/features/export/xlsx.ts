/**
 * Minimal, dependency-light XLSX (Office Open XML) writer and reader built on fflate.
 * We avoid SheetJS (npm build has known vulnerabilities) and ExcelJS (large bundle).
 * Supports: one or more sheets, strings (inline), numbers, booleans; reading shared/inline strings.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Cell } from './csv';

export interface Sheet {
  name: string;
  headers: string[];
  rows: Cell[][];
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(value: Cell, ref: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const s = String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(s)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const all = [sheet.headers, ...sheet.rows];
  const rows = all
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(v, `${columnName(ci)}${ri + 1}`)).join('')}</row>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function safeSheetName(name: string, i: number): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
  return cleaned || `Sheet${i + 1}`;
}

export function writeXlsx(sheets: Sheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error('At least one sheet is required');
  const names = sheets.map((s, i) => safeSheetName(s.name, i));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const MAX_UNCOMPRESSED = 50 * 1024 * 1024;

/** Read the first sheet (or a named one) as a matrix of strings/numbers. */
export function readXlsx(data: Uint8Array, sheetIndex = 0): (string | number | boolean | null)[][] {
  let total = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_UNCOMPRESSED) throw new Error('XLSX file is too large (zip bomb protection)');
      return f.name.startsWith('xl/') && f.name.endsWith('.xml');
    },
  });
  const shared: string[] = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) {
    for (const si of strFromU8(ss).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  const sheet = files[`xl/worksheets/sheet${sheetIndex + 1}.xml`];
  if (!sheet) throw new Error('Worksheet not found');
  const xml = strFromU8(sheet);
  const out: (string | number | boolean | null)[][] = [];
  for (const rowMatch of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const rowNum = Number(rowMatch.match(/<row[^>]*\br="(\d+)"/)?.[1] ?? out.length + 1);
    const row: (string | number | boolean | null)[] = [];
    for (const c of rowMatch.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const ref = c.match(/\br="([A-Z]+\d+)"/)?.[1] ?? '';
      const type = c.match(/\bt="(\w+)"/)?.[1];
      const ci = ref ? columnIndex(ref) : row.length;
      let value: string | number | boolean | null = null;
      if (type === 'inlineStr') value = decodeXml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
      else {
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v !== undefined) {
          if (type === 's') value = shared[Number(v)] ?? '';
          else if (type === 'b') value = v === '1';
          else if (type === 'str' || type === 'e') value = decodeXml(v);
          else value = Number.isFinite(Number(v)) ? Number(v) : decodeXml(v);
        }
      }
      while (row.length < ci) row.push(null);
      row[ci] = value;
    }
    while (out.length < rowNum - 1) out.push([]);
    out.push(row);
  }
  return out;
}
