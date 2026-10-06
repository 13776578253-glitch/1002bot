import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const files = [];
async function collect(directory) {
  for (const item of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await collect(path);
    else if (item.name.endsWith('.test.ts')) files.push(path);
  }
}
await collect('tests');
for (const file of files.sort()) await import(pathToFileURL(join(root, file)).href);
