/**
 * UI-independent canonical graph contracts.
 *
 * A stage owns a flat graph. Parentage, endpoint identity and ports are
 * explicit references. Stable IDs carry identity across stages.
 */

import type { PortPolicy } from '../layout/port-policy.ts';

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

/** 节点显式连接桩，定义连线附着方位与方向约束。 */
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
  /** 父节点 ID；图根节点固定为 null，子节点通过显式父引用构成扁平树。 */
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

/** 关系端点，未指定 portId 时由布局与连线算法计算表面吸附点。 */
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
  /** 唯一顶层根节点 ID；其 parentId 必须为 null。 */
  rootId: GraphNodeId;
  nodes: readonly CanonicalNode[];
  edges: readonly CanonicalEdge[];
  /** 图快照版本号；源数据替换时递增以触发画布会话重建。 */
  revision?: string;
}

/** 增量图更新补丁；执行时核验 baseRevision 并原子产出 nextRevision。 */
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

/** 阶段完整快照，包含单阶段元数据与完整 CanonicalGraph。 */
export interface StageSnapshot extends StageMeta {
  id: string;
  label: string;
  track: 'main' | 'qq' | 'tui' | (string & {});
  order: number;
  title: string;
  graph: CanonicalGraph;
  presentation?: {
    portPolicy?: PortPolicy;
    relations: Readonly<Record<string, {
      expanded: readonly string[];
      collapsed: readonly string[];
      sourceRelationIds: readonly string[];
      refines?: string;
    }>>;
  };
}
