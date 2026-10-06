import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('architecture boundaries', () => {
  it('keeps the runtime free of concrete worlds, OSC, VRChat, and test imports', async () => {
    const source = await readFile(new URL('../../src/runtime/runtime.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /tests[\\/]|FixtureWorld|OSC|VRChat/i);
  });
});
