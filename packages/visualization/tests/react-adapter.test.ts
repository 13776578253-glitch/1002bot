import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBotStages } from '../examples/1002bot/adapter.ts';
import { createCanvasModel } from '../src/core/engine/index.ts';
import { canvasModelToFlow } from '../src/react/canvas/projection-to-flow.ts';

test('React adapter preserves the Core model and interaction callbacks', () => {
  const track = loadBotStages().tracks.find((candidate) => candidate.track === 'main');
  assert.ok(track);
  const stage = track.stages[0]!;
  const base = createCanvasModel(stage, undefined, []);
  const aggregatePath = [...base.graph.byPath.keys()].find((path) => {
    const node = base.graph.byPath.get(path);
    return path !== 'system' && (node?.children?.length ?? 0) > 0;
  });
  assert.ok(aggregatePath);

  const model = createCanvasModel(stage, undefined, [aggregatePath]);
  let toggled: string | undefined;
  let selected: string | undefined;
  const flow = canvasModelToFlow(model, undefined, aggregatePath, {
    toggle: (path) => { toggled = path; },
    select: (path) => { selected = path; },
  });

  assert.equal(flow.nodes.length, model.nodes.length);
  assert.equal(flow.edges.length, model.edges.length);
  const aggregate = flow.nodes.find((node) => node.id === aggregatePath);
  assert.equal(aggregate?.type, 'aggregate');
  assert.equal(aggregate?.selected, true);
  assert.equal(aggregate?.data.expanded, true);
  aggregate?.data.onToggle?.();
  aggregate?.data.onSelect?.();
  assert.equal(toggled, aggregatePath);
  assert.equal(selected, aggregatePath);

  const child = flow.nodes.find((node) => node.parentId === aggregatePath);
  assert.ok(child);
  assert.equal(child.extent, 'parent');
});
