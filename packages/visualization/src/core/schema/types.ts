/**
 * UI-independent canonical graph contracts.
 *
 * A stage owns a flat graph. Parentage, endpoint identity and ports are
 * explicit references. Stable IDs carry identity across stages.
 */

export type GraphNodeId = string;
export type GraphEdgeId = string;
export type GraphPortId = string;

export type NodeKind =
  | 'root'
  | 'group'
  | 'component'
  | 'actor'
  | 'store'
  | 'adapter'
  | 'planned';

export interface CanonicalPort {
  id: GraphPortId;
  label?: string;
  direction: 'in' | 'out' | 'bidirectional';
  side: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  order: number;
  role?: string;
}

export interface CanonicalNode {
  id: GraphNodeId;
  parentId: GraphNodeId | null;
  kind: NodeKind;
  label: string;
  summary?: string;
  details?: readonly string[];
  ports: readonly CanonicalPort[];
  sourceRefs?: readonly string[];
  introducedAt?: string;
  planned?: boolean;
  order: number;
}

export interface CanonicalEndpoint {
  nodeId: GraphNodeId;
  portId?: GraphPortId;
}

export interface CanonicalEdge {
  id: GraphEdgeId;
  source: CanonicalEndpoint;
  target: CanonicalEndpoint;
  relation: 'data' | 'control' | 'call' | 'event' | 'storage' | 'unknown';
  direction: 'directed' | 'bidirectional';
  label?: string;
  order: number;
}

export interface CanonicalGraph {
  rootId: GraphNodeId;
  nodes: readonly CanonicalNode[];
  edges: readonly CanonicalEdge[];
  revision?: string;
}

export interface GraphPatch {
  baseRevision: string;
  nextRevision: string;
  operations: readonly GraphPatchOperation[];
}

export type GraphPatchOperation =
  | { kind: 'upsertNode'; node: CanonicalNode }
  | { kind: 'removeNode'; id: GraphNodeId }
  | { kind: 'reparentNode'; id: GraphNodeId; parentId: GraphNodeId | null }
  | { kind: 'upsertPort'; nodeId: GraphNodeId; port: CanonicalPort }
  | { kind: 'removePort'; nodeId: GraphNodeId; portId: GraphPortId }
  | { kind: 'upsertEdge'; edge: CanonicalEdge }
  | { kind: 'removeEdge'; id: GraphEdgeId };

export interface StageMeta {
  subtitle?: string;
  date?: string;
  scope?: string;
  status?: string;
  changes?: readonly string[];
  verified?: string;
  doc?: string;
}

export interface StageSnapshot extends StageMeta {
  id: string;
  label: string;
  track: 'main' | 'qq' | 'tui' | (string & {});
  order: number;
  title: string;
  graph: CanonicalGraph;
}
