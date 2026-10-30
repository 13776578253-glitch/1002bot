/** Strips .ts extensions from TypeScript declaration imports in dist. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function declarationFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await declarationFiles(path));
    else if (entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

const root = fileURLToPath(new URL('../dist/', import.meta.url));
for (const file of await declarationFiles(root)) {
  const source = await readFile(file, 'utf8');
  const rewritten = source.replace(/(?<=['"])([^'"\n]+)\.(tsx?|mts|cts)(?=['"])/g, '$1.js');
  if (rewritten !== source) await writeFile(file, rewritten);
}
