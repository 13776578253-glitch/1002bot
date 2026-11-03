import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptProject, resolveSourceStages, type ArchitectureProject, type ProjectManifest, type ProjectRegistry, type ProjectSourceCatalog, type ProjectStageSelection, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { baselineNodes } from '../../src/react/model/hierarchy.ts';
import { captureContent } from '../../src/react/model/workspace.ts';
import { rebaseSavedView } from '../../src/react/model/stage-navigation.ts';
import { createProjectViewStorage, normalizeProjectWorkspace } from '../../src/react/persistence/project-storage.ts';
import { projectWorkspaceToCanvas, type ProjectWorkspace } from '../../src/react/model/project-workspace.ts';

const datasets = new URL('../../datasets/', import.meta.url);
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(new URL(path, datasets), 'utf8')) as T;
const registry = await read<ProjectRegistry>('projects.json');
const entry = registry.projects.find((item) => item.id === '1002bot')!;
const manifest = await read<ProjectManifest>(entry.manifest);
const directory = entry.manifest.slice(0, entry.manifest.lastIndexOf('/'));
const at = (path: string) => `${directory}/${path}`;
const [catalogs, stages, views] = await Promise.all([
  Promise.all(manifest.source.map((path) => read<ProjectSourceCatalog>(at(path)))),
  Promise.all(manifest.stages.map((path) => read<ProjectStageSelection>(at(path)))),
  Promise.all(manifest.views.map((path) => read<ProjectViewDefinition>(at(path)))),
]);
const project: ArchitectureProject = { version: 1, id: manifest.id, title: manifest.title, revision: manifest.revision, source: { stages: resolveSourceStages(catalogs, stages) }, views };
const snapshotId = stages[0]!.id;
const baseline = adaptProject(project)[0]!;

test('the first snapshot selects the six report overview components while retaining supporting source facts and original relations', async () => {
  assert.equal(manifest.id, '1002bot');
  assert.equal(baseline.id, snapshotId);
  assert.deepEqual(baseline.stage.graph.nodes.filter((node) => node.parentId !== null).map((node) => node.id), ['event-caller', 'runtime', 'agent', 'provider', 'world', 'session']);
  assert.equal(baseline.stage.graph.edges.length, 5);
  assert.deepEqual(baseline.stage.presentation!.relations['runtime-session']!.sourceRelationIds, ['runtime-session-append', 'runtime-session-read']);
  assert.ok(project.source.stages[0]!.upsert.components.some((node) => node.id === 'state'));
  assert.ok(project.source.stages[0]!.upsert.contracts.some((contract) => contract.id === 'state-store'));
  assert.ok(project.source.stages[0]!.upsert.components.every((node) => !('frame' in node) && !('position' in node)));
  const seed = normalizeProjectWorkspace(await read<ProjectWorkspace>(at(manifest.workspace!)), project.id);
  const comparable = (nodes: typeof seed.stages[string]['draft']['nodes']) => nodes.map((item) => {
    const copy = structuredClone(item);
    if (JSON.stringify(copy.data.layoutEdits) === JSON.stringify({ version: 1 })) delete copy.data.layoutEdits;
    return copy;
  });
  assert.deepEqual(comparable(seed.stages[snapshotId]!.draft.nodes), comparable(captureContent(baselineNodes(baseline)).nodes));
  assert.equal(seed.stages[snapshotId]!.confirmed, undefined);
  assert.deepEqual(seed.stages[snapshotId]!.checkpoints, []);
});

test('a source revision becomes a saveable draft and preserves its previous confirmed checkpoint', async () => {
  const records = new Map<string, string>();
  const storage = createProjectViewStorage({ getItem: (key) => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); } }, project.id);
  const view = projectWorkspaceToCanvas(normalizeProjectWorkspace(await read<ProjectWorkspace>(at(manifest.workspace!)), project.id));
  const content = captureContent(baselineNodes(baseline));
  view.baselines[snapshotId] = { ...view.baselines[snapshotId]!, confirmed: content, confirmedAt: '2026-11-01T00:00:00Z', confirmationId: 'initial-confirmation' };
  await storage.save('project', view);
  const changed = structuredClone(baseline);
  changed.stage.graph.revision = 'revised-source';
  changed.stage.graph.nodes.find((node) => node.id === 'agent')!.summary = 'Updated source description';
  view.baselines[snapshotId] = rebaseSavedView(changed, view.baselines[snapshotId]);
  assert.equal(view.baselines[snapshotId].confirmationId, undefined);
  assert.equal(view.baselines[snapshotId].confirmed, undefined);
  await storage.save('project', view);
  const restored = await storage.load('project');
  assert.equal(restored!.baselines[snapshotId]!.revision, 'revised-source');
  const persisted = normalizeProjectWorkspace(JSON.parse(records.get('project')!), project.id);
  assert.equal(persisted.stages[snapshotId]!.checkpoints.length, 1);
  assert.deepEqual(persisted.stages[snapshotId]!.checkpoints[0]!.content, content);
});
