import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanvasBaselineContent, CanvasWorkspaceView } from '../../src/react/model/workspace.ts';
import { canvasWorkspaceToProject, projectSnapshot, projectWorkspaceToCanvas } from '../../src/react/model/project-workspace.ts';
import { createProjectViewStorage, normalizeProjectWorkspace } from '../../src/react/persistence/project-storage.ts';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const content = (x: number, title: string): CanvasBaselineContent => ({
  nodes: [
    { id: 'parent', type: 'structure', position: { x: 100, y: 200 }, width: 600, height: 350, data: { expanded: true } },
    { id: 'child', type: 'card', parentId: 'parent', position: { x, y: 80 }, width: 240, height: 82, data: { title } },
  ],
  edgeRoutes: [], frozenGroups: [],
});

function view(draft: CanvasBaselineContent, confirmed?: CanvasBaselineContent, confirmationId?: string): CanvasWorkspaceView {
  return { version: 2, baselineId: 'M1', baselines: { M1: { revision: 'one', ...structuredClone(draft),
    ...(confirmed ? { confirmed: structuredClone(confirmed), confirmedAt: '2026-11-01T01:00:00Z' } : {}),
    ...(confirmationId ? { confirmationId } : {}),
    viewport: { x: 20, y: 50, zoom: 0.8 },
  } } };
}

test('project conversion keeps relative geometry and derives independently inspectable indexes', () => {
  const source = view(content(30, '自定义标题'));
  const project = canvasWorkspaceToProject(source, 'alpha');
  assert.deepEqual(project.stages.M1!.draft.nodes[1]!.position, { x: 30, y: 80 });
  assert.deepEqual(project.stages.M1!.containerStates, { parent: { expanded: true } });
  assert.deepEqual(project.stages.M1!.overrides.nodeTitles, { child: '自定义标题' });
  const converted = projectWorkspaceToCanvas(normalizeProjectWorkspace(project, 'alpha'));
  assert.deepEqual(converted.baselines, source.baselines);
  assert.equal(converted.viewMode, 'structure');
  assert.deepEqual(converted.views, { structure: source.baselines });
});

test('confirmations no longer add checkpoints while existing history is preserved', async () => {
  const memory = new MemoryStorage(), storage = createProjectViewStorage(memory, 'alpha');
  const first = content(30, '初次'), second = content(70, '再次');
  const seeded = canvasWorkspaceToProject(view(first, first, 'confirm-1'), 'alpha');
  const existing = { id: 'confirm-1', createdAt: '2026-11-01T01:00:00Z', ...projectSnapshot(first) };
  seeded.stages.M1!.checkpoints = [existing];
  seeded.stages.M1!.views!.structure!.checkpoints = [structuredClone(existing)];
  memory.setItem('new-key', JSON.stringify(seeded));

  await storage.save('new-key', view(second, first, 'confirm-1'));
  let state = JSON.parse(memory.getItem('new-key')!);
  assert.equal(state.stages.M1.checkpoints.length, 1);
  assert.deepEqual(state.stages.M1.checkpoints[0], existing);
  assert.equal(state.stages.M1.draft.nodes[1].position.x, 70);
  assert.equal(state.stages.M1.confirmed.content.nodes[1].position.x, 30);
  assert.equal((await storage.load('new-key'))!.baselines.M1!.confirmationId, 'confirm-1');
  const beforeRejected = memory.getItem('new-key');
  await assert.rejects(async () => storage.save('new-key', view(second, second, 'confirm-1')), /不一致/);
  assert.equal(memory.getItem('new-key'), beforeRejected);

  const nextStorage = createProjectViewStorage(memory, 'alpha');
  await nextStorage.save('new-key', view(second, second, 'confirm-2'));
  state = JSON.parse(memory.getItem('new-key')!);
  assert.deepEqual(state.stages.M1.checkpoints.map((item: { id: string }) => item.id), ['confirm-1']);
  assert.deepEqual(state.stages.M1.checkpoints[0], existing);
  assert.equal(state.stages.M1.confirmationId, 'confirm-2');
});

test('project identities isolate data and failed reads never replace existing records', async () => {
  const memory = new MemoryStorage(), alpha = createProjectViewStorage(memory, 'alpha'), beta = createProjectViewStorage(memory, 'beta');
  await alpha.save('alpha-key', view(content(30, 'A')));
  await beta.save('beta-key', view(content(60, 'B')));
  const existing = memory.getItem('alpha-key');
  await assert.rejects(async () => beta.load('alpha-key'), /所属项目/);
  await assert.rejects(async () => beta.save('alpha-key', view(content(60, 'B'))), /所属项目/);
  assert.equal(memory.getItem('alpha-key'), existing);
  assert.equal((await beta.load('beta-key'))!.baselines.M1!.nodes[1]!.position.x, 60);
  memory.setItem('broken', '{invalid');
  await assert.rejects(async () => alpha.save('broken', view(content(30, 'A'))), SyntaxError);
  assert.equal(memory.getItem('broken'), '{invalid');
  const bad = JSON.parse(existing!);
  bad.stages.M1.containerStates.parent.expanded = false;
  memory.setItem('broken-index', JSON.stringify(bad));
  await assert.rejects(async () => alpha.load('broken-index'), /不一致/);
});

test('saving one stage keeps checkpoints for stages absent from the current canvas view', () => {
  const first = canvasWorkspaceToProject(view(content(30, 'A'), content(30, 'A'), 'confirm-1'), 'alpha');
  const existing = { id: 'confirm-1', createdAt: '2026-11-01T01:00:00Z', ...projectSnapshot(content(30, 'A')) };
  first.stages.M1!.checkpoints = [existing];
  first.stages.M1!.views!.structure!.checkpoints = [structuredClone(existing)];
  const onlyM0: CanvasWorkspaceView = { version: 2, baselineId: 'M0', baselines: { M0: { revision: 'zero', nodes: [], edgeRoutes: [], frozenGroups: [] } } };
  const next = canvasWorkspaceToProject(onlyM0, 'alpha', first);
  assert.equal(next.stages.M1!.checkpoints[0]!.id, 'confirm-1');
  assert.equal(next.activeStageId, 'M0');
});
