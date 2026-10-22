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

export interface VisibleNode {
  id: GraphNodeId;
  canonicalId: GraphNodeId;
  parentId?: GraphNodeId;
  depth: number;
  expanded: boolean;
  expandable: boolean;
}

export interface VisibleEndpoint {
  nodeId: GraphNodeId;
  portId?: string;
  canonicalNodeId: GraphNodeId;
  canonicalPortId?: string;
  foldedFrom?: GraphNodeId;
  boundary: boolean;
}

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

export interface Projection {
  rootId: GraphNodeId;
  nodes: VisibleNode[];
  edges: ProjectedEdge[];
  nodeById: Map<GraphNodeId, VisibleNode>;
  hiddenToVisible: Map<GraphNodeId, GraphNodeId>;
}

function parseEndpoint(endpoint: CanonicalEndpoint | string, graph: IndexedGraph): CanonicalEndpoint {
  if (typeof endpoint !== 'string') return endpoint;
  const hash = endpoint.indexOf('#');
  const path = hash < 0 ? endpoint : endpoint.slice(0, hash);
  const portId = hash < 0 ? undefined : endpoint.slice(hash + 1);
  const node = graph.byPath.get(path);
  if (!node) throw new Error('unknown endpoint path "' + path + '"');
  return portId === undefined ? { nodeId: node.id } : { nodeId: node.id, portId };
}

function hasChildren(graph: IndexedGraph, id: GraphNodeId): boolean {
  return (graph.childrenOf.get(id)?.length ?? 0) > 0;
}

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
  return node.parentId === graph.graph.rootId || node.parentId === null || id === graph.graph.rootId || (() => {
    let parent: GraphNodeId | null = node.parentId;
    while (parent !== null) {
      if (parent === graph.graph.rootId) return true;
      if (!expanded.has(parent)) return false;
      parent = graph.byId.get(parent)?.parentId ?? null;
    }
    return true;
  })();
}

function boundaryPort(endpoint: CanonicalEndpoint, edgeId: string, role: 'source' | 'target'): string {
  return 'boundary:' + edgeId + ':' + role + ':' + endpoint.nodeId + ':' + (endpoint.portId ?? 'surface');
}

export function resolveVisibleEndpoint(
  endpoint: CanonicalEndpoint | string,
  graph: IndexedGraph,
  expanded: ReadonlySet<GraphNodeId>,
  edgeId = 'endpoint',
  role: 'source' | 'target' = 'source',
): VisibleEndpoint {
  const canonical = parseEndpoint(endpoint, graph);
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
    if (node.parentId !== null && node.parentId !== graph.graph.rootId && nodeById.has(node.parentId)) parentId = node.parentId;
    const visible: VisibleNode = {
      id: node.id,
      canonicalId: node.id,
      ...(parentId === undefined ? {} : { parentId }),
      depth: graph.pathById.get(node.id)?.split('/').length ?? 1,
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
    const source = resolveVisibleEndpoint(edge.source, graph, expanded, edge.id, 'source');
    const target = resolveVisibleEndpoint(edge.target, graph, expanded, edge.id, 'target');
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
