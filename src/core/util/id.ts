export function newId(prefix = ''): string {
  const id = globalThis.crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}
