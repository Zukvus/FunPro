/** Trigger a file download from an extension page (no external requests). */
export function downloadBlob(data: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const MIME = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export function timestampedName(base: string, ext: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${base}-${stamp}.${ext}`;
}

export async function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Maximum size accepted for user imports (protects the extension from huge files). */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
