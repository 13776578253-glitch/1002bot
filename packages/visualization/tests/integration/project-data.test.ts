import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptProject, type ArchitectureProject, type ProjectManifest } from '../../src/adapters/project/index.ts';
import { baselineNodes } from '../../src/react/model/hierarchy.ts';
import { captureContent } from '../../src/react/model/workspace.ts';
import { rebaseSavedView } from '../../src/react/model/stage-navigation.ts';
import { createProjectViewStorage, normalizeProjectWorkspace } from '../../src/react/persistence/project-storage.ts';
import { projectWorkspaceToCanvas } from '../../src/react/model/project-workspace.ts';

const directory = new URL('../../datasets/progress-reports/', import.meta.url);
const read = async (path: string) => JSON.parse(await readFile(new URL(path, directory), 'utf8'));
const manifest: ProjectManifest = await read('project.json');
const project: ArchitectureProject = { ...manifest, source: { stages: await Promise.all(manifest.source.stages.map(read)) }, views: await Promise.all(manifest.views.map(read)) };
const baseline = adaptProject(project)[0]!;

test('M0 selects the six report overview components while retaining supporting source facts and original relations', async () => {
  assert.equal(baseline.id, 'M0');
  assert.deepEqual(baseline.stage.graph.nodes.filter((node) => node.parentId !== null).map((node) => node.id), ['event-caller', 'runtime', 'agent', 'provider', 'world', 'session']);
  assert.equal(baseline.stage.graph.edges.length, 5);
  assert.deepEqual(baseline.stage.presentation!.relations['runtime-session']!.sourceRelationIds, ['runtime-session-append', 'runtime-session-read']);
  assert.ok(project.source.stages[0]!.upsert.components.some((node) => node.id === 'state'));
  assert.ok(project.source.stages[0]!.upsert.contracts.some((contract) => contract.id === 'state-store'));
  assert.ok(project.source.stages[0]!.upsert.components.every((node) => !('frame' in node) && !('position' in node)));
  const seed = normalizeProjectWorkspace(await read(manifest.workspace), project.id);
  assert.deepEqual(seed.stages.M0!.draft.nodes, captureContent(baselineNodes(baseline)).nodes);
  assert.equal(seed.stages.M0!.confirmed, undefined);
  assert.deepEqual(seed.stages.M0!.checkpoints, []);
});

test('a source revision becomes a saveable draft and preserves its previous confirmed checkpoint', async () => {
  const records = new Map<string, string>();
  const storage = createProjectViewStorage({ getItem: (key) => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); } }, project.id);
  const view = projectWorkspaceToCanvas(normalizeProjectWorkspace(await read(manifest.workspace), project.id));
  const content = captureContent(baselineNodes(baseline));
  view.baselines.M0 = { ...view.baselines.M0!, confirmed: content, confirmedAt: '2026-11-01T00:00:00Z', confirmationId: 'initial-confirmation' };
  await storage.save('project', view);
  const changed = structuredClone(baseline);
  changed.stage.graph.revision = 'revised-source';
  changed.stage.graph.nodes.find((node) => node.id === 'agent')!.summary = 'Updated source description';
  view.baselines.M0 = rebaseSavedView(changed, view.baselines.M0);
  assert.equal(view.baselines.M0.confirmationId, undefined);
  assert.equal(view.baselines.M0.confirmed, undefined);
  await storage.save('project', view);
  const restored = await storage.load('project');
  assert.equal(restored!.baselines.M0!.revision, 'revised-source');
  const persisted = normalizeProjectWorkspace(JSON.parse(records.get('project')!), project.id);
  assert.equal(persisted.stages.M0!.checkpoints.length, 1);
  assert.deepEqual(persisted.stages.M0!.checkpoints[0]!.content, content);
});
