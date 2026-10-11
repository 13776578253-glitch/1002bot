import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import { QQWorld } from '../../src/index.ts';
import { setup, until, message, context } from '../helpers/peer.ts';

for (const phase of ['captured', 'sent', 'settled']) {
  it(`preserves original mappings after actual child process exits at ${phase}`, { timeout: 10000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'qq-crash-'));
    const script = fileURLToPath(new URL('../../scripts/crash-probe.ts', import.meta.url));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', script, directory, phase], { windowsHide: true });
      let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    const { config, peer, world, runtime } = await setup(t, { directory }); const before = await readFile(config.journalPath);
    if (phase === 'sent') {
      await assert.rejects(runtime.start(), /diagnosis/); assert.deepEqual(await readFile(config.journalPath), before); assert.equal(peer.sends.length, 0);
      const inspected = new QQWorld(config); t.after(() => inspected.stop(context().signal)); await inspected.start(context().signal);
      assert.equal(inspected.inspect().sequence, 1); assert.equal(peer.sends.length, 0);
    } else {
      await runtime.start(); peer.push(message());
      await until(() => world.inspect().savedPrefix === 1 && runtime.deliveries.progress(world.stream.streamId).settledPrefix === 1);
      assert.equal(world.inspect().sequence, 1); assert.equal(peer.sends.length, 0);
      if (phase === 'settled') assert.equal((await world.executeTool({ callId: 'sent', toolName: 'qq.get_message', arguments: { message_id: -100 } }, context())).status, 'succeeded');
    }
  });
}
