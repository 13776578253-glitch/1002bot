import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptProject, resolveSourceStages, type ArchitectureProject, type ProjectManifest, type ProjectSourceCatalog, type ProjectStageSelection, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { baselineNodes } from '../../src/react/model/layout/hierarchy.ts';
import { prepareStageNavigation } from '../../src/react/model/stages/stage-navigation.ts';
import { baselineForView } from '../../src/react/model/stages/view-projection.ts';
import { solveHierarchyExpansion } from '../../src/react/model/layout/placement.ts';
import { captureContent } from '../../src/react/model/workspace/workspace.ts';
import { type CanvasBaselineContent } from '../../src/react/model/contracts/snapshot-types.ts';

function runtimeBaselines() {
  const directory = new URL('../../datasets/projects/runtime-evolution/', import.meta.url);
  const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, directory), 'utf8')) as T;
  const manifest = read<ProjectManifest>('project.json');
  const project: ArchitectureProject = {
    version: 1, id: manifest.id, title: manifest.title, revision: manifest.revision,
    source: { stages: resolveSourceStages(manifest.source.map((path) => read<ProjectSourceCatalog>(path)), manifest.stages.map((path) => read<ProjectStageSelection>(path))) },
    views: manifest.views.map((path) => read<ProjectViewDefinition>(path)),
  };
  return adaptProject(project);
}

function frames(content: CanvasBaselineContent) {
  return content.nodes.map((node) => ({
    id: node.id, type: node.type, ...(node.parentId ? { parentId: node.parentId } : {}),
    position: node.position, width: node.width, height: node.height,
    expanded: !!node.data.expanded,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

test('returning to the previous stage preserves frames when no source or user edit occurred', () => {
  const [m1, m2] = runtimeBaselines();
  for (const mode of ['overview', 'structure', 'full'] as const) {
    const m1View = baselineForView(m1!, mode);
    const m2View = baselineForView(m2!, mode);
    const original = captureContent(baselineNodes(m1View));
    const forward = prepareStageNavigation({ parent: m1View, target: m2View, parentContent: original });
    assert.ok(forward.ok, `${mode}: ${forward.ok ? '' : JSON.stringify(forward.conflicts)}`);
    const backward = prepareStageNavigation({ parent: m2View, target: m1View, parentContent: forward.content });
    assert.ok(backward.ok, `${mode}: ${backward.ok ? '' : JSON.stringify(backward.conflicts)}`);
    assert.deepEqual(frames(backward.content), frames(original), mode);
  }
});

test('Full entry keeps the target manual frame and places every addition', () => {
  const [m1, m2] = runtimeBaselines();
  const source = captureContent(baselineNodes(baselineForView(m1!, 'full')));
  const result = prepareStageNavigation({ parent: baselineForView(m1!, 'full'), target: baselineForView(m2!, 'full'), parentContent: source });
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.conflicts));
  const nodes = new Map(result.content.nodes.map((node) => [node.id, node]));
  assert.deepEqual({ width: nodes.get('runtime')!.width, height: nodes.get('runtime')!.height }, { width: 1052, height: 900 });
  assert.deepEqual(nodes.get('input-channel')!.position, { x: 24, y: 296 });
  assert.deepEqual(nodes.get('input-run')!.position, { x: 566, y: 296 });
  assert.deepEqual(nodes.get('provider')!.position, { x: 590, y: 980 });
});

test('a source user position survives target manual placement', () => {
  const [m1, m2] = runtimeBaselines();
  const nodes = baselineNodes(baselineForView(m1!, 'full')).map((node) => node.id === 'event-caller'
    ? { ...node, position: { x: 100, y: 50 }, data: { ...node.data, layoutEdits: { version: 1 as const, position: { x: 100, y: 50, origin: 'user' as const } } } }
    : node);
  const result = prepareStageNavigation({ parent: baselineForView(m1!, 'full'), target: baselineForView(m2!, 'full'), parentContent: captureContent(nodes) });
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.conflicts));
  assert.deepEqual(result.content.nodes.find((node) => node.id === 'event-caller')!.position, { x: 100, y: 50 });
});

test('automatic source reflow from an expansion change can inherit target positions', () => {
  const [m1, m2] = runtimeBaselines();
  const sourceView = baselineForView(m1!, 'structure');
  const collapsed = solveHierarchyExpansion(baselineNodes(sourceView), 'agent', sourceView.stage);
  const result = prepareStageNavigation({ parent: sourceView, target: baselineForView(m2!, 'structure'), parentContent: captureContent(collapsed) });
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.conflicts));
  assert.deepEqual(result.content.nodes.find((node) => node.id === 'provider')!.position, { x: 560, y: 980 });
  assert.deepEqual(result.content.nodes.find((node) => node.id === 'world')!.position, { x: 0, y: 1590 });
});
