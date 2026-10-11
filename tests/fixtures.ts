import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadFixture(name: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'funpay', name), 'utf8');
}

export function fixtureDoc(name: string): Document {
  return new DOMParser().parseFromString(loadFixture(name), 'text/html');
}
