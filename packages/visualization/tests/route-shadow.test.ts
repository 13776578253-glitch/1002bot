import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../src/core/projection/index.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import type { CanvasNode } from '../src/react/model/grouping.ts';
import { DiagramRouteCache } from '../src/react/model/route-cache.ts';
import { solveRouteGroups, type GroupEdgeInput, type GroupSolveInput } from '../src/react/model/route-groups.ts';
import { measureRoutes, type QualityRoute } from '../src/react/model/route-quality.ts';

interface Fixture {
  name: string;
  nodes: CanvasNode[];
  edges: GroupEdgeInput[];
  policy?: GroupSolveInput['policy'];
}

function build(fixture: Fixture): { nodes: CanvasNode[]; projection: ReturnType<typeof projectGraph>; inputs: { id: string; source: string; target: string; text: string }[] } {
  const stage: StageSnapshot = {
    id: fixture.name, label: fixture.name, title: fixture.name, track: 'main', order: 0,
    graph: {
      rootId: 'root',
      nodes: [
        { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
        ...fixture.nodes.map((node, index) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, order: index + 1, ports: [] })),
      ],
      edges: fixture.edges.map((edge, index) => ({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, label: edge.text, relation: 'call' as const, direction: 'directed' as const, order: index })),
    },
  };
  return {
    nodes: fixture.nodes,
    projection: projectGraph(stage, new Set()),
    inputs: fixture.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })),
  };
}

const card = (id: string, x: number, y: number, width = 260, height = 92): CanvasNode => ({ id, type: 'card', position: { x, y }, width, height, data: { title: id } });

const six: Fixture = {
  name: 'six',
  policy: { direction: 'top-down' },
  nodes: [card('event', 640, 40), card('runtime', 640, 260), card('agent', 100, 560), card('provider', 460, 560), card('world', 820, 560), card('session', 1180, 560)],
  edges: [
    { id: 'event-runtime', source: 'event', target: 'runtime', text: '提交事件' },
    { id: 'runtime-agent', source: 'runtime', target: 'agent', text: '组装模型请求' },
    { id: 'runtime-provider', source: 'runtime', target: 'provider', text: '调用模型' },
    { id: 'runtime-world', source: 'runtime', target: 'world', text: '执行工具' },
    { id: 'runtime-session', source: 'runtime', target: 'session', text: '记录与读取事实' },
  ],
};

const fan: Fixture = {
  name: 'fan',
  nodes: [card('hub', 0, 0), card('t0', -400, 400, 120, 60), card('t1', -200, 400, 120, 60), card('t2', 0, 400, 120, 60), card('t3', 200, 400, 120, 60), card('t4', 400, 400, 120, 60)],
  edges: ['t0', 't1', 't2', 't3', 't4'].map((target) => ({ id: `hub-${target}`, source: 'hub', target, text: `扇出到 ${target}` })),
};

const dense: Fixture = {
  name: 'dense',
  nodes: [card('hub', 0, 0), card('a', -260, 300, 120, 60), card('b', -130, 300, 120, 60), card('c', 0, 300, 120, 60), card('d', 130, 300, 120, 60), card('e', 260, 300, 120, 60)],
  edges: ['a', 'b', 'c', 'd', 'e'].map((target) => ({ id: `hub-${target}`, source: 'hub', target, text: `组件之间的长关系名称 ${target}` })),
};

const lockedPoints = [{ x: 260, y: 16 }, { x: 260, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 16 }];
const locked: Fixture = {
  name: 'locked',
  nodes: [card('A', 0, 0), card('B', 700, 0), card('C', 0, 400, 120, 60), card('D', 700, 400, 120, 60)],
  edges: [
    { id: 'locked', source: 'A', target: 'B', text: '锁定连接', priority: 'locked', fixed: { sourceHandle: 'right:source:0', targetHandle: 'left:target:0', points: lockedPoints, label: { x: 480, y: 300, width: 60, height: 24 }, text: '锁定连接' } },
    { id: 'free-a', source: 'A', target: 'C', text: '左侧自由连接' },
    { id: 'free-b', source: 'B', target: 'D', text: '右侧自由连接' },
  ],
};

function oldQuality(fixture: Fixture): QualityRoute[] {
  const { nodes, projection, inputs } = build(fixture);
  const cache = new DiagramRouteCache();
  const routes = cache.update(nodes, projection, inputs, [], new Map(), fixture.policy ?? {});
  return [...routes].map(([edgeId, route]) => ({
    edgeId, points: route.points, label: route.label,
    ...(route.feasible === false ? { labelState: 'space-exhausted' as const } : {}),
  }));
}

function newQuality(fixture: Fixture): { metrics: ReturnType<typeof measureRoutes>; modes: string[] } {
  const { nodes, projection } = build(fixture);
  const result = solveRouteGroups({ nodes, projection, edges: fixture.edges, ...(fixture.policy ? { policy: fixture.policy } : {}) });
  if (!result.ok) assert.fail(`${fixture.name}: ${result.reason}`);
  const routes: QualityRoute[] = result.plans.flatMap((plan) => plan.routes.map((route) => ({
    edgeId: route.edgeId, points: route.points, sourceSlot: route.sourceSlot, targetSlot: route.targetSlot,
    ...(route.trunkId ? { trunkId: route.trunkId } : {}),
    ...(route.trunkSegment ? { trunkSegment: route.trunkSegment } : {}),
    ...(route.label ? { label: { x: route.label.anchor.x, y: route.label.anchor.y, width: route.label.rect.w, height: route.label.rect.h, score: route.label.score, segmentKind: route.label.segmentKind, distanceToTarget: route.label.distanceToTarget } } : {}),
    labelRequired: route.labelRequired,
    labelState: route.labelState,
  })));
  return { metrics: measureRoutes(routes), modes: result.plans.map((plan) => plan.mode) };
}

for (const fixture of [six, fan, dense, locked]) {
  test(`shadow comparison: ${fixture.name}`, () => {
    const oldMetrics = measureRoutes(oldQuality(fixture));
    const next = newQuality(fixture);
    console.log(JSON.stringify({ fixture: fixture.name, modes: next.modes, old: oldMetrics, new: next.metrics }));
    assert.equal(next.metrics.labelOverlaps, 0, 'new labels do not overlap');
    assert.equal(next.metrics.labelOwnerMisses, 0, 'new labels stay near their own route');
    assert.ok(next.metrics.length > 0);
  });
}
