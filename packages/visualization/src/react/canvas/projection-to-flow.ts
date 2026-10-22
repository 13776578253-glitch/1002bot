import type { Edge, Node } from '@xyflow/react';
import type { CanonicalPort } from '../../core/schema/types.ts';
import type { CanvasScene, SceneNode } from '../../core/engine/scene.ts';

export interface FlowPortData {
  id: string;
  direction: CanonicalPort['direction'];
  side: CanonicalPort['side'];
  label?: string;
}
export interface FlowNodeData extends Record<string, unknown> {
  nodeId: string;
  path: string;
  title: string;
  summary?: string;
  details?: readonly string[];
  kind: string;
  expanded: boolean;
  expandable: boolean;
  planned: boolean;
  ports: readonly FlowPortData[];
  deltaKind?: string;
  deltaNote?: string;
  sourceRefs?: readonly string[];
  onToggle?: () => void;
  onSelect?: () => void;
}
export interface FlowEdgeData extends Record<string, unknown> {
  label?: string;
  folded: boolean;
  relation: string;
  direction: string;
  points?: readonly { x: number; y: number }[];
  deltaKind?: string;
}

function reactNodeId(id: string): string { return 'node:' + id; }
function reactEdgeId(id: string): string { return 'edge:' + id; }
export function portHandleId(nodeId: string, portId: string, direction: 'in' | 'out'): string {
  return 'port:' + nodeId + ':' + portId + ':' + direction;
}

function nodePorts(node: SceneNode): FlowPortData[] {
  return node.ports.map((port) => ({
    id: port.id,
    direction: port.direction,
    side: port.side,
    ...(port.label === undefined ? {} : { label: port.label }),
  }));
}

function flowNode(
  node: SceneNode,
  parentWorld: { x: number; y: number } | undefined,
  selected: boolean,
  interactions: { toggle(id: string): void; select(id: string): void } | undefined,
): Node<FlowNodeData> {
  const position = {
    x: node.worldRect.x - (parentWorld?.x ?? 0),
    y: node.worldRect.y - (parentWorld?.y ?? 0),
  };
  return {
    id: reactNodeId(node.id),
    type: node.expanded ? 'aggregate' : 'card',
    position,
    selected,
    style: { width: node.worldRect.w, height: node.worldRect.h },
    ...(node.parentId === undefined ? {} : { parentId: reactNodeId(node.parentId), extent: 'parent' as const }),
    data: {
      nodeId: node.id,
      path: node.path,
      title: node.label,
      ...(node.summary === undefined ? {} : { summary: node.summary }),
      ...(node.details === undefined ? {} : { details: node.details }),
      kind: node.kind,
      expanded: node.expanded,
      expandable: node.expandable,
      planned: node.planned,
      ports: nodePorts(node),
      ...(node.sourceRefs === undefined ? {} : { sourceRefs: node.sourceRefs }),
      ...(node.delta ? { deltaKind: node.delta.kind, ...(node.delta.note === undefined ? {} : { deltaNote: node.delta.note }) } : {}),
      ...(interactions ? {
        onToggle: () => interactions.toggle(node.id),
        onSelect: () => interactions.select(node.id),
      } : {}),
    },
  };
}

function endpointHandle(nodeId: string, portId: string | undefined, direction: 'in' | 'out'): string {
  return portId ? portHandleId(nodeId, portId, direction) : (direction === 'out' ? 'right' : 'left');
}

export function canvasSceneToFlow(
  scene: CanvasScene,
  positions?: ReadonlyMap<string, { x: number; y: number }>,
  selected?: string,
  interactions?: { toggle(id: string): void; select(id: string): void },
): { nodes: Node<FlowNodeData>[]; edges: Edge<FlowEdgeData>[] } {
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const nodes = scene.nodes.map((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const flow = flowNode(node, parent?.worldRect, selected === node.id, interactions);
    const saved = positions?.get(node.id);
    if (saved) flow.position = saved;
    return flow;
  });
  const edges = scene.edges.map((edge) => ({
    id: reactEdgeId(edge.id),
    source: reactNodeId(edge.source.nodeId),
    target: reactNodeId(edge.target.nodeId),
    sourceHandle: endpointHandle(edge.source.nodeId, edge.source.portId, 'out'),
    targetHandle: endpointHandle(edge.target.nodeId, edge.target.portId, 'in'),
    type: 'ortho',
    ...(edge.delta ? { className: 'av-edge-' + edge.delta.kind } : {}),
    data: {
      ...(edge.label === undefined ? {} : { label: edge.label }),
      folded: edge.folded,
      relation: edge.relation,
      direction: edge.direction,
      ...(edge.route ? { points: edge.route.points } : {}),
      ...(edge.delta ? { deltaKind: edge.delta.kind } : {}),
    },
  } satisfies Edge<FlowEdgeData>));
  return { nodes, edges };
}

export const sceneToFlow = canvasSceneToFlow;
