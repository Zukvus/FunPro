import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'funpay', name), 'utf8');
}

export function fixtureDoc(name: string): Document {
  return new DOMParser().parseFromString(loadFixture(name), 'text/html');
}
