import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const files = [];
const coreOnly = process.argv.includes('--core');
async function collect(directory) {
  for (const item of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await collect(path);
    else if (item.name.endsWith('.test.ts') && !(coreOnly && path === join('tests', 'integration', 'tui.test.ts'))) files.push(path);
  }
}
await collect('tests');
await collect('src');
if (!coreOnly) await collect('packages/apps/tui/src/__tests__');
for (const file of files.sort()) await import(pathToFileURL(join(root, file)).href);
