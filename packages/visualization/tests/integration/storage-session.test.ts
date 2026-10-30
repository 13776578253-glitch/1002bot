import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkspace, saveWorkspace } from '../../src/react/persistence/storage-session.ts';
import type { CanvasViewStorage, CanvasWorkspaceView } from '../../src/react/model/workspace.ts';

const view = (baselineId: string): CanvasWorkspaceView => ({ version: 1, baselineId, baselines: {} });

test('a replacement canvas waits for all outstanding writes before restoring its workspace', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const writing = new Promise<void>((resolve) => { started = resolve; });
  let saved: CanvasWorkspaceView | undefined;
  const storage: CanvasViewStorage = {
    load: () => saved,
    async save(_key, value) { started(); await gate; saved = structuredClone(value); },
  };
  const first = saveWorkspace(storage, 'workspace', view('first'));
  await writing;
  const second = saveWorkspace(storage, 'workspace', view('second'));
  const restored = loadWorkspace(storage, 'workspace');
  release();
  await Promise.all([first, second]);
  assert.equal((await restored)!.baselineId, 'second');
});

test('failed writes preserve the stored view and a later retry can commit', async () => {
  let saved = view('original'), fail = true;
  const storage: CanvasViewStorage = { load: () => saved, save(_key, value) { if (fail) throw new Error('quota'); saved = value; } };
  await assert.rejects(saveWorkspace(storage, 'workspace', view('edited')), /quota/);
  assert.equal((await loadWorkspace(storage, 'workspace'))!.baselineId, 'original');
  fail = false;
  await saveWorkspace(storage, 'workspace', view('edited'));
  assert.equal((await loadWorkspace(storage, 'workspace'))!.baselineId, 'edited');
});

test('separate workspace keys do not block each other', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const saved = new Map<string, CanvasWorkspaceView>();
  const storage: CanvasViewStorage = { load: (key) => saved.get(key), async save(key, value) { if (key === 'slow') await gate; saved.set(key, value); } };
  const slow = saveWorkspace(storage, 'slow', view('slow'));
  await saveWorkspace(storage, 'fast', view('fast'));
  assert.equal((await loadWorkspace(storage, 'fast'))!.baselineId, 'fast');
  release(); await slow;
});
