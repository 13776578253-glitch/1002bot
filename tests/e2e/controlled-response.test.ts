import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { it } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
function child(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errors = '';
    const timer = setTimeout(() => { processChild.kill(); reject(new Error(`M6 child exceeded deadline: ${errors}`)); }, 6000);
    processChild.stdout.on('data', data => { output += String(data); }); processChild.stderr.on('data', data => { errors += String(data); });
    processChild.once('error', error => { clearTimeout(timer); reject(error); });
    processChild.once('close', code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error(`M6 child ${code}: ${errors}\n${output}`)); });
    processChild.stdin.end(input);
  });
}
it('runs a complete M6 child process and audits its late records in an independent reader without restarting work', { timeout: 12000 }, async () => {
  const sample = JSON.parse(await child(['--experimental-strip-types', join(root, 'scripts/m6-console.ts'), '--sample']));
  assert.equal(sample.a.code, 'yielded'); assert.equal(sample.b.status, 'succeeded'); assert.equal(sample.diagnosis.status, 'ready');
  const runtimeModule = pathToFileURL(join(root, 'src/runtime/runtime.ts')).href;
  const storeModule = pathToFileURL(join(root, 'src/state/jsonl-session.ts')).href;
  const agentModule = pathToFileURL(join(root, 'src/agent/conversation-agent.ts')).href;
  const worldModule = pathToFileURL(join(root, 'tests/fixtures/response-world.ts')).href;
  const providerModule = pathToFileURL(join(root, 'src/providers/scripted-provider.ts')).href;
  const stateModule = pathToFileURL(join(root, 'src/state/memory-state.ts')).href;
  const reader = `import { Runtime } from ${JSON.stringify(runtimeModule)}; import { JsonlSessionStore } from ${JSON.stringify(storeModule)};
    import { ConversationAgent } from ${JSON.stringify(agentModule)}; import { ResponseWorld } from ${JSON.stringify(worldModule)};
    import { ScriptedProvider } from ${JSON.stringify(providerModule)}; import { MemoryState } from ${JSON.stringify(stateModule)};
    import { join } from 'node:path'; const [folder, runId] = process.argv.slice(1);
    const runtime = new Runtime({ world: new ResponseWorld(join(folder,'world.json')), session: new JsonlSessionStore(join(folder,'session.jsonl')),
      agent:new ConversationAgent({sessionId:'m6-sample'}), provider:new ScriptedProvider([]), state:new MemoryState(), responsiveness:{} });
    console.log(JSON.stringify({status:runtime.status, diagnosis:await runtime.inspectSession(), late:await runtime.responses.readLate({runId,callId:'call-1'})}));`;
  const read = JSON.parse(await child(['--experimental-strip-types', '--input-type=module', '-e', reader, sample.folder, sample.late.origin.runId]));
  assert.equal(read.status, 'new'); assert.equal(read.diagnosis.status, 'ready'); assert.equal(read.diagnosis.issueCount, 0);
  assert.equal(read.late.origin.runId, sample.late.origin.runId); assert.equal(read.late.result.outcome.output.observation.version, 0);
  assert.equal(JSON.parse(await readFile(join(sample.folder, 'world.json'), 'utf8')).value, 7);
});

it('accepts piped operator commands through startup and finishes yield, late settlement and clean restart', { timeout: 10000 }, async () => {
  const commands = ['input observe A', 'wait A', 'input current', 'push 7', 'yield', 'finish input-1', 'finish input-2',
    'release A', 'settle', 'diagnose', 'stop', 'start', 'input resumed', 'finish input-3', 'quit'].join('\n') + '\n';
  const output = await child(['--experimental-strip-types', join(root, 'scripts/m6-console.ts')], commands);
  const lines = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.ok(lines.every(line => line.error === undefined));
  assert.ok(lines.some(line => line.status === 'requested'));
  assert.ok(lines.some(line => line.event === 'run_finished' && line.inputId === 'input-1' && line.result.code === 'yielded'));
  assert.ok(lines.some(line => line.status === 'ready' && line.issueCount === 0));
  assert.ok(lines.some(line => line.runtime === 'stopped'));
  assert.ok(lines.some(line => line.event === 'run_finished' && line.inputId === 'input-3' && line.result.reply === 'resumed'));
});
