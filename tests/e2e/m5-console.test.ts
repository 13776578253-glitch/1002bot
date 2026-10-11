import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { it } from 'node:test';
import type { JsonObject, TaskSnapshot, WorldProgress } from '../../src/protocol/index.ts';

it('closes Console and World task requests through manual ticks, restart and piped EOF', { timeout: 10000 }, async () => {
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/m5-console.ts'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('M5 console exceeded 8 seconds')); }, 8000);
    child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { output += String(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.end('input wait answer 7 1000\ntasks\nadvance 1000\nread task-1\ntick\nrestart\ntick\nfact wait answer 8 1000\nadvance 1000\nget answer\ndiagnose\n');
  });
  assert.equal(result.code, 0, result.output);
  type Row = { task?: TaskSnapshot; heartbeat?: string; modelCalls?: number; observation?: JsonObject; progress?: WorldProgress; status?: string; error?: string };
  const rows = result.output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as Row);
  assert.equal(rows.some(row => row.task?.status === 'completed'), true);
  const idleTicks = rows.filter(row => row.heartbeat === 'settled' && row.modelCalls === 0); assert.equal(idleTicks.length, 2);
  assert.equal(rows.find(row => row.observation)?.observation?.value, 8); assert.equal(rows.find(row => row.observation)?.observation?.version, 2);
  assert.equal(rows.some(row => row.progress?.settledPrefix === 1), true);
  assert.equal(rows.at(-1)?.status, 'ready'); assert.equal(rows.some(row => row.error), false, result.output);
});
