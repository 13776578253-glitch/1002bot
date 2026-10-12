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

for (const path of ['packages/shared/control-api', '.', 'packages/apps/tui', 'packages/extensions/world-qq']) {
  pnpm(['pack', '--pack-destination', artifacts], resolve(root, path));
}
function archive(path) {
  const pkg = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'));
  return join(artifacts, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
}
const coreArchive = archive('.');
const apiArchive = archive('packages/shared/control-api');
const tuiArchive = archive('packages/apps/tui');
const qqArchive = archive('packages/extensions/world-qq');
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
assert.ok(!existsSync(join(coreSource, 'node_modules/@1002bot/world-qq')));
assert.ok(!readdirSync(join(coreSource, 'node_modules/.pnpm')).some(name => /^ws@|types\+ws@/.test(name)));
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
assert.ok(!existsSync(join(coreConsumer, 'node_modules/@1002bot/world-qq')));
assert.ok(!readdirSync(join(coreConsumer, 'node_modules/.pnpm')).some(name => /^ws@|types\+ws@/.test(name)));
const fixture = ts.transpileModule(readFileSync(join(root, 'tests/fixtures/fixture-world.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
write(join(coreConsumer, 'fixture-world.js'), fixture);
write(join(coreConsumer, 'check.mjs'), `
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import { composeRuntime, ConversationAgent, ScriptedProvider, JsonlSessionStore, MemorySessionStore, MemoryState, OpenAIResponsesProvider } from '1002bot';
import { composeRuntime as publicCompose } from '1002bot/control';
import { FixtureWorld } from './fixture-world.js';
assert.equal(composeRuntime, publicCompose);
const memory = new MemorySessionStore();
await memory.append({kind:'heartbeat',at:'2026-10-11T00:00:00Z',heartbeat:{kind:'heartbeat',heartbeatId:'fixture',generation:1,sequence:1,scheduledAt:'2026-10-11T00:00:00Z',expiresAt:'2026-10-11T00:00:01Z'}});
assert.equal((await memory.read()).length,1);
assert.equal(new ConversationAgent({sessionId:'memory',persistent:false}).declareSession().persistent,false);
const transport = new OpenAIResponsesProvider({apiKey:'fixture',model:'fixture-model'});
const wire = JSON.parse(transport.serializeRequest({sessionId:'memory',messages:[],tools:[{name:'domain.read',description:'read',inputSchema:{type:'object'}}]}));
assert.match(wire.tools[0].name,/^[a-zA-Z0-9_-]+$/);
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

const responseFixture = ts.transpileModule(readFileSync(join(root, 'tests/fixtures/response-world.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
write(join(coreConsumer, 'response-world.js'), responseFixture);
write(join(coreConsumer, 'check-response.mjs'), `
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Runtime,ConversationAgent,ScriptedProvider,MemorySessionStore,MemoryState,STANDARD_RESPONSE_LIMITS} from '1002bot';
import {ResponseWorld} from './response-world.js';
const world=new ResponseWorld(fileURLToPath(new URL('./response-world.json',import.meta.url)));
const runtime=new Runtime({world,session:new MemorySessionStore(),state:new MemoryState(),responsiveness:{},cleanupDeadlineMs:1000,
  agent:new ConversationAgent({sessionId:'response-package',persistent:false,operations:true}),
  provider:new ScriptedProvider(request=>request.messages.at(-1).content==='observe'?
    {finishReason:'tool_calls',toolCalls:[{callId:'read',toolName:'fixture.observe',arguments:{label:'archive'}}]}:
    {finishReason:'stop',toolCalls:[],message:{role:'assistant',content:'done'}})});
await runtime.start();
try {
  assert.deepEqual(runtime.responses.limits,STANDARD_RESPONSE_LIMITS);
  world.hold('archive');await runtime.inputs.submit({inputId:'A',source:'package',content:{kind:'text',text:'observe'}});await world.entered('archive');
  const target=runtime.responses.snapshot().active;
  assert.equal(runtime.responses.snapshot().operations[0].state,'running');
  await runtime.inputs.submit({inputId:'B',source:'package',content:{kind:'text',text:'B'}});
  assert.equal(runtime.responses.yield(target).status,'requested');await runtime.inputs.idle();
  assert.equal(runtime.responses.snapshot().operations[0].state,'detached');
  assert.equal(runtime.inputs.inspect('A').result.status,'cancelled');assert.equal(runtime.inputs.inspect('B').result.status,'succeeded');
  world.release('archive');const deadline=Date.now()+3000;
  while(runtime.responses.snapshot().operations.length){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,2));}
  const late=await runtime.responses.readLate({runId:target.runId,callId:'read'});
  assert.equal(late.result.status,'returned');assert.equal(late.origin.worldId,world.id);
  assert.equal((await runtime.inspectSession()).status,'ready');
  console.log(JSON.stringify({yielded:true,lateEvidence:true,diagnosis:'ready',optionalWorldInstalled:false}));
} finally {world.releaseAll();await runtime.stop();}
`);
phases.coreResponseArchive = JSON.parse(node(['check-response.mjs'], coreConsumer).trim());
write(join(coreConsumer, 'check-response.ts'), `import {Runtime,STANDARD_RESPONSE_LIMITS,type ResponseControl,type OperationRecord,type ToolDefinition,type ToolExecutionContext} from '1002bot';
declare const runtime:Runtime;const control:ResponseControl|undefined=runtime.responses;
const tool:ToolDefinition={name:'domain.observe',description:'read',inputSchema:{type:'object'},effects:'none'};
declare const record:OperationRecord;declare const context:ToolExecutionContext;
if(record.origin.kind==='world'){const worldId:string=record.origin.worldId;void worldId;}
if(control){control.yield({runId:'fixture',generation:1});const result=control.readLate({runId:'fixture',callId:'read'});const state=control.snapshot().operations[0]?.state;void result;void state;}
void tool;void context.origin;void STANDARD_RESPONSE_LIMITS;`);
json(join(coreConsumer, 'tsconfig.response.json'), { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true }, include: ['check-response.ts'] });
node([join(coreSource, 'node_modules/typescript/lib/tsc.js'), '-p', 'tsconfig.response.json'], coreConsumer);

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

const qqConsumer = join(directory, 'qq-consumer');
mkdirSync(qqConsumer);
json(join(qqConsumer, 'package.json'), {
  name: 'qq-consumer', private: true, type: 'module',
  dependencies: { '1002bot': `file:${coreArchive}`, '@1002bot/world-qq': `file:${qqArchive}` },
  devDependencies: { typescript: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies.typescript, '@types/node': '^22.10.0' },
  pnpm: { overrides: { '@1002bot/control-api': `file:${apiArchive}` } }
});
pnpm(install, qqConsumer);
write(join(qqConsumer, 'check.mjs'), `
import assert from 'node:assert/strict';
import {QQWorld} from '@1002bot/world-qq';
const world = new QQWorld({endpoint:'ws://127.0.0.1:3001/',accessToken:'offline',journalPath:'unused.jsonl',binding:{worldId:'qq',sessionId:'install',streamId:'messages',epoch:'first',accountId:10001,conversation:{kind:'group',id:20001}}});
assert.deepEqual(world.tools().map(tool=>tool.name),['qq.get_message','qq.send_text']);
assert.equal(world.inspect().running,false);
const memory = new QQWorld({endpoint:'ws://127.0.0.1:3001/',accessToken:'offline',storage:'memory',binding:{worldId:'qq',sessionId:'memory',streamId:'messages',epoch:'first',accountId:10001,conversation:{kind:'group',id:20001}}});
assert.equal(memory.inspect().storage,'memory');
`);
node(['check.mjs'], qqConsumer);
write(join(qqConsumer, 'check.ts'), "import {QQWorld,type QQConfig,type QQMemoryConfig} from '@1002bot/world-qq'; import {MemorySessionStore,type MemorySessionLimits} from '1002bot'; import type {World} from '1002bot/protocol'; declare const config:QQConfig; declare const memoryConfig:QQMemoryConfig; const world:World=new QQWorld(config); const memoryWorld:World=new QQWorld(memoryConfig); const limits:MemorySessionLimits={bytes:4096}; const session=new MemorySessionStore(limits); void world; void memoryWorld; void session;\n");
json(join(qqConsumer, 'tsconfig.json'), { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true }, include: ['check.ts'] });
pnpm(['exec', 'tsc', '-p', 'tsconfig.json'], qqConsumer);
assert.ok(!existsSync(join(qqConsumer, 'node_modules/@1002bot/tui')));
phases.qqArchive = { import: 'passed', typecheck: 'passed', frontendInstalled: false };

const report = { directory, phases };
mkdirSync(join(root, 'scratch'), { recursive: true });
json(join(root, 'scratch/package-install-check.json'), report);
console.log(JSON.stringify(report, null, 2));
