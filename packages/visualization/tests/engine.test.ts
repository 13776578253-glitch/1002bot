import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasModel } from '../src/core/engine/index.ts';
import { canvasModelToFlow } from '../src/react/canvas/projection-to-flow.ts';
import { normalizeTrackSeries } from '../src/core/schema/normalize.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';

const stage: StageSnapshot = {
  id: 'engine', label: 'Engine', track: 'main', order: 1, title: 'Engine',
  root: {
    key: 'system', title: 'System', children: [
      { key: 'runtime', title: 'Runtime', children: [
        { key: 'execution', title: 'Execution', ports: [{ id: 'provider' }] },
      ] },
      { key: 'provider', title: 'Provider' },
    ],
  },
  edges: [{ from: 'system/runtime/execution#provider', to: 'system/provider', label: 'model' }],
};

test('canvas engine returns one model with routed edges and port handles', () => {
  const model = createCanvasModel(stage, undefined, ['system/runtime']);
  const execution = model.nodes.find((node) => node.path === 'system/runtime/execution');
  const edge = model.edges[0];

  assert.equal(execution?.parentPath, 'system/runtime');
  assert.equal(edge?.sourceHandle, 'provider');
  assert.equal(edge?.label, 'model');
  assert.equal(edge?.route?.points.length, 4);
  assert.equal(model.layout.edges.length, 1);

  const flow = canvasModelToFlow(model);
  assert.equal(flow.edges[0]?.sourceHandle, 'provider');
  assert.equal(flow.nodes.find((node) => node.id === 'system/runtime')?.parentId, undefined);
  assert.equal(flow.nodes.find((node) => node.id === 'system/runtime/execution')?.parentId, 'system/runtime');
  assert.ok(flow.nodes.findIndex((node) => node.id === 'system/runtime') < flow.nodes.findIndex((node) => node.id === 'system/runtime/execution'));
});

test('canvas engine applies an explicit evolution step to the computed delta', () => {
  const previous: StageSnapshot = {
    ...stage,
    id: 'previous',
    root: { key: 'system', title: 'System', children: [{ key: 'runtime', title: 'Runtime' }] },
    edges: [],
  };
  const model = createCanvasModel(stage, previous, [], {
    stage: 'engine',
    events: [{ kind: 'added', keys: ['provider'], note: 'provider introduced' }],
  });
  assert.equal(model.delta?.nodes.find((node) => node.key === 'provider')?.note, 'provider introduced');
});

test('track normalization orders stages and keeps destination keyed events', () => {
  const first = { ...stage, id: 'first', order: 1 };
  const second = { ...stage, id: 'second', order: 2 };
  const normalized = normalizeTrackSeries({
    track: 'main',
    name: 'Main',
    stages: [second, first],
    events: [{ stage: 'second', events: [] }],
  });
  assert.deepEqual(normalized.stages.map((item) => item.id), ['first', 'second']);
  assert.deepEqual(normalized.events?.map((item) => item.stage), ['second']);
});
