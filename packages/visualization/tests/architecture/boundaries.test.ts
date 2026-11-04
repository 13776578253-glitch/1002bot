import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function files(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();
}

test('library dependencies stay inside the generic source boundary', async () => {
  for (const file of (await files(join(root, 'src'))).filter((item) => /\.tsx?$/.test(item) && !item.includes('__tests__'))) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /(?:from\s*|import\s*)['"][^'"]*(?:examples|datasets|playground|proposal|legacy)[\/]/, relative(root, file));
    if (relative(root, file).replaceAll('\\', '/').startsWith('src/core/')) assert.doesNotMatch(text, /from\s*['"][^'"]*(?:react|xyflow)/, file);
    if (relative(root, file).replaceAll('\\', '/').startsWith('src/adapters/')) assert.doesNotMatch(text, /from\s*['"](?:node:|react|@xyflow)|\b(?:fetch|localStorage|document)\b/, file);
  }
});

test('playground imports library internals only from the routing lab', async () => {
  const publicEntries = new Set(['../../src/index.ts', '../../src/react/index.ts', '../../src/adapters/project/index.ts']);
  const internal = new Set<string>();
  for (const file of (await files(join(root, 'playground/src'))).filter((item) => /\.tsx?$/.test(item))) {
    const text = await readFile(file, 'utf8');
    for (const [, specifier] of text.matchAll(/from\s+'(\.\.\/\.\.\/src\/[^']+)'/g)) {
      if (!specifier || publicEntries.has(specifier)) continue;
      internal.add(`${relative(root, file).replaceAll('\\', '/')} -> ${specifier}`);
    }
  }
  assert.deepEqual([...internal].sort(), [
    'playground/src/routing-lab.tsx -> ../../src/react/components/ports.tsx',
    'playground/src/routing-lab.tsx -> ../../src/react/components/relation-edge.tsx',
  ]);
});

test('persistence normalization stays internal to the react entry', async () => {
  const entry = await readFile(join(root, 'src/react/index.ts'), 'utf8');
  assert.match(entry, /export \{ createLocalStorageViewStorage \} from '\.\/persistence\/local-storage\.ts';/);
  assert.doesNotMatch(entry, /normalizeWorkspaceView|assertWorkspaceView/);
});

test('the playground has one HTML entry and composes the public canvas', async () => {
  const html = (await files(join(root, 'playground'))).filter((item) => item.endsWith('.html') && !item.includes(join('playground', 'dist')));
  assert.deepEqual(html.map((item) => relative(join(root, 'playground'), item)), ['index.html']);
  assert.match(await readFile(join(root, 'playground/src/main.tsx'), 'utf8'), /from '..\/..\/src\/react\/index.ts'/);
  assert.deepEqual((await readdir(join(root, 'src/core/layout'))).sort(), ['geometry.ts', 'input-fingerprint.ts', 'legality.ts', 'node-port-allocator.ts', 'port-policy.ts', 'search-limits.ts']);
});

test('library styles are scoped to the canvas instead of changing the host document', async () => {
  for (const file of await files(join(root, 'src/react/styles'))) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /(?:^|\n)\s*(?::root|html|body|#root|\*)\s*[{,]/, file);
  }
});
