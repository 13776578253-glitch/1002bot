import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '../src/__tests__');
for (const name of (await readdir(directory)).sort()) {
  if (name.endsWith('.test.ts')) await import(pathToFileURL(resolve(directory, name)).href);
}
