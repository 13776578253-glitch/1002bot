/** Runtime model dependencies are acyclic and follow the feature boundaries. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../src/react/model/', import.meta.url));
const allowed = new Map([
  ['contracts', []],
  ['layout', ['contracts']],
  ['routing', ['contracts', 'layout']],
  ['labels', ['contracts', 'layout', 'routing']],
  ['freeze', ['contracts', 'layout', 'routing']],
  ['workspace', ['contracts', 'layout']],
  ['stages', ['contracts', 'layout', 'routing', 'labels', 'freeze', 'workspace']],
]);

function runtimeDependencies(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return [];
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) return [];
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length && bindings.elements.every((item) => item.isTypeOnly))) return [];
    } else if (statement.isTypeOnly || (statement.exportClause && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.length && statement.exportClause.elements.every((item) => item.isTypeOnly))) return [];
    return [resolve(dirname(file), specifier.text)];
  });
}

test('model runtime dependencies have no cycles or upward imports', () => {
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.ts') && !file.split(sep).includes('__tests__'));
  const graph = new Map(files.map((file) => [resolve(root, file), [] as string[]]));
  for (const [file, dependencies] of graph) {
    const layer = relative(root, file).split(sep)[0]!;
    assert.ok(allowed.has(layer), relative(root, file));
    for (const dependency of runtimeDependencies(file)) {
      if (!graph.has(dependency)) {
        assert.ok(relative(resolve(root, '../../core'), dependency).split(sep)[0] !== '..',
          `${relative(root, file)} -> ${relative(root, dependency)}`);
        continue;
      }
      const targetLayer = relative(root, dependency).split(sep)[0]!;
      assert.ok(layer === targetLayer || allowed.get(layer)!.includes(targetLayer),
        `${relative(root, file)} -> ${relative(root, dependency)}`);
      dependencies.push(dependency);
    }
  }
  const done = new Set<string>();
  const active = new Set<string>();
  function visit(file: string): void {
    if (done.has(file)) return;
    assert.ok(!active.has(file), [...active, file].map((item) => relative(root, item)).join(' -> '));
    active.add(file);
    for (const dependency of graph.get(file)!) visit(dependency);
    active.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) visit(file);
});
