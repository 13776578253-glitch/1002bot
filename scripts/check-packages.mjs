/** Offline package verification installs real archives and a core-only source checkout outside the repository. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const directory = mkdtempSync(join(tmpdir(), 'bot-package-check-'));
const artifacts = join(directory, 'archives');
mkdirSync(artifacts);
const storeIndex = process.argv.indexOf('--store-dir');
const store = storeIndex < 0 ? [] : ['--store-dir', process.argv[storeIndex + 1]];
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
function pnpm(args, cwd) {
  const options = { cwd, encoding: 'utf8', windowsHide: true };
  if (process.platform === 'win32') {
    const command = `$ErrorActionPreference = 'Stop'; & pnpm ${args.map(quote).join(' ')}; exit $LASTEXITCODE`;
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], options);
  }
  return execFileSync('pnpm', args, options);
}
function node(args, cwd) { return execFileSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true }); }
function write(path, content) { writeFileSync(path, content); }
function json(path, value) { write(path, JSON.stringify(value, null, 2) + '\n'); }
const phases = {};

for (const path of ['packages/shared/control-api', '.', 'packages/apps/tui']) {
  pnpm(['pack', '--pack-destination', artifacts], resolve(root, path));
}
function archive(path) {
  const pkg = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'));
  return join(artifacts, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
}
const coreArchive = archive('.');
const apiArchive = archive('packages/shared/control-api');
const tuiArchive = archive('packages/apps/tui');
assert.ok(coreArchive && apiArchive && tuiArchive);
const install = ['install', '--offline', '--ignore-scripts', ...store];

const coreSource = join(directory, 'core-source');
mkdirSync(coreSource);
for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.json', 'tsconfig.build.json', 'src', 'scripts', 'tests', 'packages/shared/control-api']) {
  const target = join(coreSource, path);
  cpSync(join(root, path), target, { recursive: true, filter: candidate => !candidate.split(/[\\/]/).includes('node_modules') && !candidate.endsWith('tui.test.ts') && !candidate.endsWith(join('integration', 'package.json')) });
}
pnpm([...install, '--config.recursive-install=true', '--frozen-lockfile', '--filter', '1002bot...'], coreSource);
assert.ok(!existsSync(join(coreSource, 'node_modules/@1002bot/tui')));
assert.ok(!existsSync(join(coreSource, 'node_modules/string-width')));
assert.ok(!readdirSync(join(coreSource, 'node_modules/.pnpm')).some(name => /string-width|opentui|react@/.test(name)));
pnpm(['typecheck:core'], coreSource);
pnpm(['build'], coreSource);
const coreTests = pnpm(['test:core'], coreSource);
phases.coreSource = { optionalFrontendInstalled: false, typecheck: 'passed', build: 'passed', tests: coreTests.match(/ℹ (?:tests|pass|fail|skipped) \d+/g) };

const tuiSource = join(directory, 'tui-source');
mkdirSync(tuiSource);
for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'packages/shared/control-api', 'packages/apps/tui']) {
  cpSync(join(root, path), join(tuiSource, path), { recursive: true, filter: candidate => !candidate.split(/[\\/]/).includes('node_modules') });
}
pnpm([...install, '--config.recursive-install=true', '--frozen-lockfile', '--filter', '@1002bot/tui...'], tuiSource);
assert.ok(!existsSync(join(tuiSource, 'src')));
pnpm(['--filter', '@1002bot/control-api', 'build'], tuiSource);
pnpm(['--filter', '@1002bot/tui', 'build'], tuiSource);
pnpm(['--filter', '@1002bot/tui', 'typecheck'], tuiSource);
const tuiTests = pnpm(['--filter', '@1002bot/tui', 'test'], tuiSource);
phases.tuiSource = { coreSourcePresent: false, build: 'passed', typecheck: 'passed', tests: tuiTests.match(/ℹ (?:tests|pass|fail|skipped) \d+/g) };

const coreConsumer = join(directory, 'core-consumer');
mkdirSync(coreConsumer);
json(join(coreConsumer, 'package.json'), {
  name: 'core-consumer', private: true, type: 'module',
  dependencies: { '1002bot': `file:${coreArchive}` },
  pnpm: { overrides: { '@1002bot/control-api': `file:${apiArchive}` } }
});
pnpm(install, coreConsumer);
assert.ok(!existsSync(join(coreConsumer, 'node_modules/string-width')));
assert.ok(!existsSync(join(coreConsumer, 'node_modules/@1002bot/tui')));
const fixture = ts.transpileModule(readFileSync(join(root, 'tests/fixtures/fixture-world.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
write(join(coreConsumer, 'fixture-world.js'), fixture);
write(join(coreConsumer, 'check.mjs'), `
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import { composeRuntime, ConversationAgent, ScriptedProvider, JsonlSessionStore, MemoryState } from '1002bot';
import { composeRuntime as publicCompose } from '1002bot/control';
import { FixtureWorld } from './fixture-world.js';
assert.equal(composeRuntime, publicCompose);
const world = new FixtureWorld();
const session = new JsonlSessionStore(fileURLToPath(new URL('./session.jsonl', import.meta.url)));
const runtime = composeRuntime({ world, session, state: new MemoryState(), agent: new ConversationAgent({sessionId: 'package-check'}),
  provider: new ScriptedProvider([
    {finishReason: 'tool_calls', toolCalls: [{callId: 'set', toolName: 'fixture.set', arguments: {key: 'answer', value: 7}}]},
    {finishReason: 'stop', toolCalls: [], message: {role: 'assistant', content: 'stored'}},
    {finishReason: 'tool_calls', toolCalls: [{callId: 'get', toolName: 'fixture.get', arguments: {key: 'answer'}}]},
    {finishReason: 'stop', toolCalls: [], message: {role: 'assistant', content: 'read'}}
  ]) });
await runtime.start();
try {
  for (const inputId of ['set', 'get']) {
    const receipt = await runtime.inputs.submit({inputId, source: 'package-check', content: {kind: 'text', text: inputId}});
    assert.equal(receipt.status, 'accepted');
    await runtime.inputs.idle();
    assert.equal(runtime.inputs.inspect(inputId).result.persisted, true);
    assert.equal(runtime.inputs.inspect(inputId).result.status, 'succeeded');
  }
  assert.equal(world.value('answer'), 7);
  const entries = await session.read();
  assert.ok(entries.some(entry => entry.kind === 'tool_outcome' && entry.outcome.output === 7));
  console.log(JSON.stringify({value: world.value('answer'), persisted: true, entries: entries.length}));
} finally { await runtime.stop(); }
`);
phases.coreArchive = JSON.parse(node(['check.mjs'], coreConsumer).trim());

const tuiConsumer = join(directory, 'tui-consumer');
mkdirSync(tuiConsumer);
json(join(tuiConsumer, 'package.json'), {
  name: 'tui-consumer', private: true, type: 'module',
  dependencies: { '@1002bot/tui': `file:${tuiArchive}` },
  devDependencies: JSON.parse(readFileSync(join(root, 'packages/apps/tui/package.json'), 'utf8')).devDependencies,
  pnpm: { overrides: { '@1002bot/control-api': `file:${apiArchive}` } }
});
pnpm(install, tuiConsumer);
assert.ok(!existsSync(join(tuiConsumer, 'node_modules/1002bot')));
write(join(tuiConsumer, 'check.mjs'), "import assert from 'node:assert/strict'; import {runTui} from '@1002bot/tui'; assert.equal(typeof runTui, 'function'); console.log('TUI public export loads without core');\n");
node(['check.mjs'], tuiConsumer);
write(join(tuiConsumer, 'check.ts'), "import {runTui, type TuiOptions} from '@1002bot/tui'; type Control = Parameters<typeof runTui>[0]; declare const control: Control; const options: TuiOptions = {}; const running: Promise<void> = runTui(control, options); void running;\n");
json(join(tuiConsumer, 'tsconfig.json'), { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true }, include: ['check.ts'] });
pnpm(['exec', 'tsc', '-p', 'tsconfig.json'], tuiConsumer);
assert.ok(existsSync(join(tuiConsumer, 'node_modules/.bin/bot-tui-probe.cmd')) || existsSync(join(tuiConsumer, 'node_modules/.bin/bot-tui-probe')));
phases.tuiArchive = { coreInstalled: false, import: 'passed', typecheck: 'passed', probeBin: 'present' };

const report = { directory, phases };
mkdirSync(join(root, 'scratch'), { recursive: true });
json(join(root, 'scratch/package-install-check.json'), report);
console.log(JSON.stringify(report, null, 2));
