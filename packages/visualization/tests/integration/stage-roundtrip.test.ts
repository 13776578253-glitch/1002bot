import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptProject, resolveSourceStages, type ArchitectureProject, type ProjectManifest, type ProjectSourceCatalog, type ProjectStageSelection, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { baselineNodes } from '../../src/react/model/hierarchy.ts';
import { prepareStageNavigation } from '../../src/react/model/stage-navigation.ts';
import { baselineForView } from '../../src/react/model/view-projection.ts';
import { captureContent, type CanvasBaselineContent } from '../../src/react/model/workspace.ts';

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
  for (const mode of ['overview', 'structure'] as const) {
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
