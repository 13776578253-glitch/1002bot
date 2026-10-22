import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const required = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/react/index.js',
  'dist/react/index.d.ts',
];

for (const relative of required) await access(join(packageRoot, relative));
for (const target of Object.values(packageJson.exports)) {
  for (const relative of [target.import, target.types]) {
    if (relative) await access(join(packageRoot, relative));
  }
}

const declarations = await readFile(join(packageRoot, 'dist/react/index.d.ts'), 'utf8');
if (/\.tsx?['"]/.test(declarations)) throw new Error('React declarations contain source TypeScript extensions');
console.log(`visualization dist verified (${required.length} required artifacts)`);
