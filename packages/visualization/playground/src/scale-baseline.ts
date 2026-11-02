import type { VisualizationBaseline } from '../../src/core/schema/baseline.ts';
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';

const HUBS = 5;
const HUB_GAP = 2600;
const LEAF_COLS = 6;
const LEAF_STEP_X = 220;
const LEAF_STEP_Y = 120;

export function scaleBaseline(edgeCount: number, crossed: boolean): VisualizationBaseline {
  const leavesPerHub = Math.ceil(edgeCount / HUBS);
  const nodes: CanonicalNode[] = [{ id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] }];
  const positions: Record<string, { x: number; y: number }> = {};
  const values: Array<{ id: string; x: number; y: number }> = [];
  const hubOrigin = (hub: number) => ({ x: (hub % 3) * HUB_GAP, y: Math.floor(hub / 3) * 1300 });
  for (let hub = 0; hub < HUBS; hub += 1) {
    const id = `hub-${hub}`;
    const origin = hubOrigin(hub);
    nodes.push({ id, parentId: 'root', kind: 'group', label: `Hub ${hub}`, order: nodes.length, ports: [] });
    positions[id] = origin;
    values.push({ id, ...origin });
  }
  for (let hub = 0; hub < HUBS; hub += 1) for (let leaf = 0; leaf < leavesPerHub; leaf += 1) {
    const id = `leaf-${hub}-${leaf}`;
    const origin = hubOrigin(hub);
    const x = origin.x + (leaf % LEAF_COLS) * LEAF_STEP_X;
    const y = origin.y + 220 + Math.floor(leaf / LEAF_COLS) * LEAF_STEP_Y;
    nodes.push({ id, parentId: 'root', kind: 'component', label: `Leaf ${hub}.${leaf}`, order: nodes.length, ports: [] });
    positions[id] = { x, y };
    values.push({ id, x, y });
  }
  const all: CanonicalEdge[] = [];
  for (let hub = 0; hub < HUBS; hub += 1) for (let leaf = 0; leaf < leavesPerHub; leaf += 1) {
    all.push({ id: `hub-${hub}-leaf-${leaf}`, source: { nodeId: `hub-${hub}` }, target: { nodeId: `leaf-${hub}-${leaf}` }, label: `密集关系 数据流 组件-${hub}-${leaf}`, relation: 'call', direction: 'directed', order: all.length });
  }
  if (crossed) for (let hub = 0; hub < HUBS - 1; hub += 1) {
    all.push({ id: `cross-${hub}`, source: { nodeId: `hub-${hub}` }, target: { nodeId: `leaf-${hub + 1}-0` }, label: `跨星关系 依赖 组件-${hub}-${hub + 1}`, relation: 'call', direction: 'directed', order: all.length });
  }
  const edges = crossed ? [...all.slice(0, edgeCount - (HUBS - 1)), ...all.slice(-(HUBS - 1))] : all.slice(0, edgeCount);
  const stage: StageSnapshot = {
    id: `scale-${edgeCount}`, label: `Scale ${edgeCount}`, title: `Scale ${edgeCount}`, track: 'main', order: 0,
    graph: { rootId: 'root', nodes, edges, revision: `scale-${edgeCount}` },
    presentation: {
      portPolicy: { direction: 'top-down' },
      relations: Object.fromEntries(edges.map((edge) => [edge.id, { expanded: [], collapsed: [], sourceRelationIds: [] }])),
    },
  };
  return {
    id: stage.id, stage, positions,
    nodeChanges: Object.fromEntries(nodes.filter((node) => node.id !== 'root').map((node) => [node.id, { kind: 'baseline' as const, label: '基线' }])),
    edgeChanges: Object.fromEntries(edges.map((edge) => [edge.id, { kind: 'baseline' as const, label: '基线' }])),
  };
}
