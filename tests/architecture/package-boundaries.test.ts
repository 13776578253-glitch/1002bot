import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { it } from 'node:test';

const root = new URL('../../', import.meta.url);
async function sources(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(new URL(directory + '/', root), { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) result.push(...await sources(path));
    else if (entry.name.endsWith('.ts')) result.push(path);
  }
  return result;
}

it('keeps core runtime dependencies and public imports independent of optional frontends', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
  assert.doesNotMatch(Object.keys(dependencies).join('\n'), /tui|react|ink|string-width/i);
  for (const path of await sources('src')) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"][^'"]*(?:@1002bot\/tui|opentui|packages\/apps)/, path);
  }
});

it('keeps TUI source imports inside the package or on public dependencies', { skip: process.argv.includes('--core') }, async () => {
  for (const path of await sources('packages/apps/tui/src')) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.doesNotMatch(source, /from\s*['"](?:1002bot(?:\/[^'"]*)?|[^'"]*(?:protocol\/|console\/|runtime\/))['"]/, path);
    for (const [, specifier] of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
      assert.ok(specifier!.startsWith('./') || specifier!.startsWith('../') || specifier!.startsWith('node:') || ['@1002bot/control-api', 'string-width'].includes(specifier!), `${path}: ${specifier}`);
      if (specifier!.startsWith('.')) {
        assert.ok(new URL(specifier!, new URL(path, root)).href.startsWith(new URL('packages/apps/tui/src/', root).href), `${path}: relative import escapes TUI package`);
      }
    }
  }
});
