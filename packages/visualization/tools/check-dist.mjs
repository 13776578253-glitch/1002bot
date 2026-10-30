/** Verifies packaged distribution artifacts, export entry points, and relative imports. */
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();
}
for (const value of Object.values(pkg.exports)) {
  for (const target of typeof value === 'string' ? [value] : Object.values(value)) await access(resolve(root, target));
}
const files = await walk(dist);
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (/\.d\.ts$/.test(file)) assert.ok(!/\.tsx?['"]/.test(text), `Source extension in ${file}`);
  if (/\.(js|css)$/.test(file)) {
    assert.ok(!/(?:playground|examples|proposal|legacy)[\\/]/.test(text), `Example or retired dependency in ${file}`);
    const imports = file.endsWith('.css') ? [...text.matchAll(/@import\s+['"]([^'"]+)['"]/g)] : [...text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)];
    for (const [, specifier] of imports) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        assert.ok(!relative(dist, target).startsWith('..'), `Dependency leaves dist: ${specifier}`);
        await access(target);
      } else if (file.endsWith('.css')) import.meta.resolve(specifier);
    }
  }
  assert.ok(!file.includes(join('react', 'model', '__tests__')), 'Tests shipped in dist');
}
const core = await import(pathToFileURL(join(dist, 'index.js')).href);
const react = await import(pathToFileURL(join(dist, 'react/index.js')).href);
assert.equal(typeof core.assertValidBaselines, 'function');
assert.equal(typeof core.projectGraph, 'function');
assert.equal(typeof react.VisualizationCanvas, 'function');
assert.ok(!('EvolutionCanvas' in react) && !('useCanvasStore' in react));
console.log(`visualization dist verified (${files.length} JS/declaration/style artifacts)`);
