/**
 * Pure graph projection.
 *
 * Expansion is keyed by canonical node id. The projection resolves each
 * endpoint to the nearest visible ancestor and creates deterministic boundary
 * ports for folded endpoints; it never computes layout or React data.
 */

import type {
  CanonicalEndpoint,
  CanonicalEdge,
  GraphNodeId,
  StageSnapshot,
} from '../schema/types.ts';
import { indexGraph, type IndexedGraph } from '../graph/index.ts';

export interface ExpansionState {
  expanded: ReadonlySet<GraphNodeId>;
}

/** 投影后的可见节点；仅包含处于展开路径上的节点。 */
export interface VisibleNode {
  id: GraphNodeId;
  canonicalId: GraphNodeId;
  parentId?: GraphNodeId;
  depth: number;
  expanded: boolean;
  expandable: boolean;
}

/** 投影后的可见连线端点；被收起的内部端点坍缩至最近可见祖先。 */
export interface VisibleEndpoint {
  nodeId: GraphNodeId;
  portId?: string;
  canonicalNodeId: GraphNodeId;
  canonicalPortId?: string;
  /** 当端点被折叠坍缩时，记录其实际来源的隐藏后代节点 ID。 */
  foldedFrom?: GraphNodeId;
  boundary: boolean;
}

/** 投影后的有效可见连线；两端已绑定至当前可见节点。 */
export interface ProjectedEdge {
  id: string;
  canonicalEdgeId: string;
  source: VisibleEndpoint;
  target: VisibleEndpoint;
  folded: boolean;
  label?: string;
  relation: CanonicalEdge['relation'];
  direction: CanonicalEdge['direction'];
  edge: CanonicalEdge;
}

/** 纯图投影产物，保持无状态且不包含任何 UI 坐标或 DOM 状态。 */
export interface Projection {
  rootId: GraphNodeId;
  nodes: VisibleNode[];
  edges: ProjectedEdge[];
  nodeById: Map<GraphNodeId, VisibleNode>;
  /** 隐藏节点到其最近可见祖先节点的映射。 */
  hiddenToVisible: Map<GraphNodeId, GraphNodeId>;
}

function hasChildren(graph: IndexedGraph, id: GraphNodeId): boolean {
  return (graph.childrenOf.get(id)?.length ?? 0) > 0;
}

/** 节点可见性判断：当且仅当其到图根路径上的所有祖先节点均处于展开状态时可见。 */
function isVisible(id: GraphNodeId, graph: IndexedGraph, expanded: ReadonlySet<GraphNodeId>): boolean {
  const node = graph.byId.get(id);
  if (!node) return false;
  let cursor: GraphNodeId | null = id;
  while (cursor !== null) {
    const current = graph.byId.get(cursor);
    if (!current) return false;
    if (cursor !== id && !expanded.has(cursor) && cursor !== graph.graph.rootId) return false;
    cursor = current.parentId;
  }
  return true;
}

/** 为折叠坍缩的端点生成确定性虚拟边界端口标识。 */
function boundaryPort(endpoint: CanonicalEndpoint, edgeId: string, role: 'source' | 'target'): string {
  return 'boundary:' + edgeId + ':' + role + ':' + endpoint.nodeId + ':' + (endpoint.portId ?? 'surface');
}

/** 将端点解析为当前展开状态下的可见端点；隐藏节点向外坍缩至最近可见祖先。 */
export function resolveVisibleEndpoint(
  endpoint: CanonicalEndpoint,
  graph: IndexedGraph,
  expanded: ReadonlySet<GraphNodeId>,
  edgeId = 'endpoint',
  role: 'source' | 'target' = 'source',
): VisibleEndpoint {
  const canonical = endpoint;
  const original = graph.byId.get(canonical.nodeId);
  if (!original) throw new Error('unknown endpoint node "' + canonical.nodeId + '"');
  if (isVisible(canonical.nodeId, graph, expanded)) {
    return {
      nodeId: canonical.nodeId,
      canonicalNodeId: canonical.nodeId,
      ...(canonical.portId === undefined ? {} : { portId: canonical.portId, canonicalPortId: canonical.portId }),
      boundary: false,
    };
  }

  let cursor = original.parentId;
  while (cursor !== null) {
    if (isVisible(cursor, graph, expanded)) {
      return {
        nodeId: cursor,
        canonicalNodeId: canonical.nodeId,
        portId: boundaryPort(canonical, edgeId, role),
        ...(canonical.portId === undefined ? {} : { canonicalPortId: canonical.portId }),
        foldedFrom: canonical.nodeId,
        boundary: true,
      };
    }
    cursor = graph.byId.get(cursor)?.parentId ?? null;
  }
  return {
    nodeId: graph.graph.rootId,
    canonicalNodeId: canonical.nodeId,
    portId: boundaryPort(canonical, edgeId, role),
    ...(canonical.portId === undefined ? {} : { canonicalPortId: canonical.portId }),
    foldedFrom: canonical.nodeId,
    boundary: true,
  };
}

/** 根据展开节点集合计算投影图；自动过滤不可见节点并收束跨层连线。 */
export function projectGraph(
  snapshot: StageSnapshot,
  expandedInput: Iterable<GraphNodeId> | ExpansionState,
): Projection {
  const graph = indexGraph(snapshot);
  const requested = expandedInput instanceof Set
    ? expandedInput
    : 'expanded' in expandedInput
      ? expandedInput.expanded
      : new Set(expandedInput);
  const expanded = new Set<GraphNodeId>();
  for (const id of requested) if (graph.byId.has(id) && hasChildren(graph, id)) expanded.add(id);

  const nodes: VisibleNode[] = [];
  const nodeById = new Map<GraphNodeId, VisibleNode>();
  const hiddenToVisible = new Map<GraphNodeId, GraphNodeId>();

  for (const node of graph.graph.nodes) {
    if (node.id === graph.graph.rootId || !isVisible(node.id, graph, expanded)) continue;
    let parentId: GraphNodeId | undefined;
    if (node.parentId !== null && node.parentId !== graph.graph.rootId) parentId = node.parentId;
    let depth = 0, ancestor: string | null = node.parentId;
    while (ancestor !== null) { depth += 1; ancestor = graph.byId.get(ancestor)!.parentId; }
    const visible: VisibleNode = {
      id: node.id,
      canonicalId: node.id,
      ...(parentId === undefined ? {} : { parentId }),
      depth,
      expanded: expanded.has(node.id),
      expandable: hasChildren(graph, node.id),
    };
    nodes.push(visible);
    nodeById.set(node.id, visible);
  }

  for (const node of graph.graph.nodes) {
    if (node.id === graph.graph.rootId) continue;
    let cursor = node.id;
    while (!nodeById.has(cursor)) {
      const parent = graph.byId.get(cursor)?.parentId;
      if (parent === null || parent === undefined) {
        cursor = graph.graph.rootId;
        break;
      }
      cursor = parent;
    }
    hiddenToVisible.set(node.id, cursor);
  }

  const edges: ProjectedEdge[] = [];
  for (const edge of graph.edges) {
    const rule = snapshot.presentation?.relations[edge.id];
    if (rule && (rule.expanded.some((id) => !expanded.has(id) || !isVisible(id, graph, expanded))
      || rule.collapsed.some((id) => expanded.has(id)))) continue;
    const source = resolveVisibleEndpoint(edge.source, graph, expanded, edge.id, 'source');
    const target = resolveVisibleEndpoint(edge.target, graph, expanded, edge.id, 'target');
    // 折叠至同一父容器或端点不可见时剔除该连线
    if (source.nodeId === target.nodeId) continue;
    if (!nodeById.has(source.nodeId) || !nodeById.has(target.nodeId)) continue;
    edges.push({
      id: edge.id + '@' + source.nodeId + '>' + target.nodeId,
      canonicalEdgeId: edge.id,
      source,
      target,
      folded: source.boundary || target.boundary,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      relation: edge.relation,
      direction: edge.direction,
      edge,
    });
  }

  return { rootId: graph.graph.rootId, nodes, edges, nodeById, hiddenToVisible };
}
