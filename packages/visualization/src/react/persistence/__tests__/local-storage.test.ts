import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanvasBaselineView, CanvasWorkspaceView } from '../../model/workspace.ts';
import { createLocalStorageViewStorage } from '../local-storage.ts';

class RecordingStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  failKey?: string;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (key === this.failKey) throw new Error('quota');
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

const node = { id: 'a', type: 'card' as const, position: { x: 0, y: 0 }, width: 240, height: 80, data: {} };
const baselines = (): Record<string, CanvasBaselineView> => ({ main: { revision: 'one', nodes: [structuredClone(node)], edgeRoutes: [], frozenGroups: [] } });
const view = (): CanvasWorkspaceView => ({ version: 2, baselineId: 'main', baselines: baselines() });
const threeView = (): CanvasWorkspaceView => ({ version: 2, baselineId: 'main', viewMode: 'structure', baselines: baselines(), views: { structure: structuredClone(baselines()) } });

test('save writes the uniform backup, then the three-view backup, then the record', async () => {
  const storage = new RecordingStorage();
  const original = JSON.stringify(view());
  storage.values.set('workspace', original);

  await createLocalStorageViewStorage(storage).save('workspace', threeView());

  assert.deepEqual(storage.writes.map(({ key }) => key), ['workspace:before-uniform-cards-v1', 'workspace:before-three-views-v1', 'workspace']);
  assert.equal(storage.values.get('workspace:before-uniform-cards-v1'), original);
  assert.equal(storage.values.get('workspace:before-three-views-v1'), original);
  assert.equal(storage.values.get('workspace'), JSON.stringify(threeView()));
});

test('three-view backup is written only when the previous record has no views', async () => {
  const storage = new RecordingStorage();
  storage.values.set('workspace', JSON.stringify(threeView()));

  await createLocalStorageViewStorage(storage).save('workspace', threeView());

  assert.deepEqual(storage.writes.map(({ key }) => key), ['workspace:before-uniform-cards-v1', 'workspace']);
});

test('existing backups are never overwritten', async () => {
  const storage = new RecordingStorage();
  storage.values.set('workspace', JSON.stringify(view()));
  storage.values.set('workspace:before-uniform-cards-v1', 'uniform');
  storage.values.set('workspace:before-three-views-v1', 'three');

  await createLocalStorageViewStorage(storage).save('workspace', threeView());

  assert.deepEqual(storage.writes.map(({ key }) => key), ['workspace']);
  assert.equal(storage.values.get('workspace:before-uniform-cards-v1'), 'uniform');
  assert.equal(storage.values.get('workspace:before-three-views-v1'), 'three');
});

test('an invalid view fails before any backup or record write', async () => {
  const storage = new RecordingStorage();
  const invalid = view();
  invalid.baselines.main!.nodes[0]!.width = -1;
  storage.values.set('workspace', JSON.stringify(view()));

  await assert.rejects(async () => createLocalStorageViewStorage(storage).save('workspace', invalid), /节点视图格式不正确/);

  assert.equal(storage.writes.length, 0);
});

test('a malformed previous record leaves the uniform backup behind and the record untouched', async () => {
  const storage = new RecordingStorage();
  storage.values.set('workspace', '{broken');

  await assert.rejects(async () => createLocalStorageViewStorage(storage).save('workspace', view()), SyntaxError);

  assert.deepEqual(storage.writes.map(({ key }) => key), ['workspace:before-uniform-cards-v1']);
  assert.equal(storage.values.get('workspace'), '{broken');
  assert.equal(storage.values.has('workspace:before-three-views-v1'), false);
});

test('an invalid previous workspace also fails after the uniform backup', async () => {
  const storage = new RecordingStorage();
  const original = JSON.stringify({ version: 99, baselineId: 'main', baselines: {} });
  storage.values.set('workspace', original);

  await assert.rejects(async () => createLocalStorageViewStorage(storage).save('workspace', view()), /工作视图格式不正确/);

  assert.deepEqual(storage.writes.map(({ key }) => key), ['workspace:before-uniform-cards-v1']);
  assert.equal(storage.values.get('workspace'), original);
});

test('a failed final write keeps both backups and the original record', async () => {
  const storage = new RecordingStorage();
  const original = JSON.stringify(view());
  storage.values.set('workspace', original);
  storage.failKey = 'workspace';

  await assert.rejects(async () => createLocalStorageViewStorage(storage).save('workspace', threeView()), /quota/);

  assert.deepEqual(storage.writes.map(({ key }) => key), ['workspace:before-uniform-cards-v1', 'workspace:before-three-views-v1']);
  assert.equal(storage.values.get('workspace'), original);
});

test('load returns undefined for a missing key and surfaces malformed records', async () => {
  const storage = new RecordingStorage();
  const adapter = createLocalStorageViewStorage(storage);

  assert.equal(await adapter.load('missing'), undefined);
  storage.values.set('workspace', '{broken');
  await assert.rejects(async () => adapter.load('workspace'), SyntaxError);
  assert.equal(storage.writes.length, 0);
});
