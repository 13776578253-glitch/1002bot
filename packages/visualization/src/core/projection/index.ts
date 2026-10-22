/**
 * Graph Projection Engine.
 *
 * Given a snapshot and a set of expanded paths, computes what is visible:
 * which nodes render as cards, which as expanded aggregate frames, and how
 * edge endpoints resolve — folded edges attach to the nearest visible
 * ancestor, expanded edges reach the concrete internal interface.
 *
 * Pure computation; no UI dependency.
 */

import type { GraphEdge, NodePath, StageSnapshot } from '../schema/types.ts';
import { indexGraph, splitEndpoint, type IndexedGraph } from '../graph/index.ts';

export interface VisibleNode {
  path: NodePath;
  /** True when the node is expanded and its children render inside it. */
  expanded: boolean;
  /** Depth from the root (root = 0). */
  depth: number;
}

export interface ProjectedEdge {
  edge: GraphEdge;
  /** Visible endpoint after ancestor projection (port preserved when the concrete node is visible). */
  from: string;
  to: string;
  /** True when at least one endpoint was folded to an ancestor. */
  folded: boolean;
}

export interface Projection {
  nodes: VisibleNode[];
  edges: ProjectedEdge[];
}

/** A node is visible when every ancestor on its path is expanded. */
function isVisible(path: NodePath, graph: IndexedGraph, expanded: ReadonlySet<NodePath>): boolean {
  // Root itself is always visible (as the implicit container).
  if (path === graph.snapshot.root.key) return true;
  // Direct children of the root are visible when nothing blocks them.
  let cursor: NodePath | undefined = path;
  while (cursor !== undefined) {
    const parent: NodePath | undefined = graph.parentOf.get(cursor);
    if (parent === undefined || parent === graph.snapshot.root.key) return true;
    if (!expanded.has(parent)) return false;
    cursor = parent;
  }
  return true;
}

/** Nearest ancestor (or self) that is visible under the expansion state. */
export function resolveVisibleEndpoint(endpoint: string, graph: IndexedGraph, expanded: ReadonlySet<NodePath>): { endpoint: string; folded: boolean } {
  const { path, port } = splitEndpoint(endpoint);
  if (isVisible(path, graph, expanded)) return { endpoint, folded: false };
  // Walk upward from the endpoint. The first visible ancestor is the deepest
  // card that represents the hidden subtree.
  let cursor: NodePath | undefined = graph.parentOf.get(path);
  while (cursor !== undefined) {
    if (isVisible(cursor, graph, expanded)) return { endpoint: cursor, folded: true };
    cursor = graph.parentOf.get(cursor);
  }
  return { endpoint: graph.snapshot.root.key, folded: true };
}

export function projectGraph(snapshot: StageSnapshot, expandedPaths: Iterable<NodePath>): Projection {
  const graph = indexGraph(snapshot);
  const expanded = new Set(expandedPaths);
  // Expansion only applies to nodes that actually have children.
  for (const path of [...expanded]) {
    const node = graph.byPath.get(path);
    if (!node?.children?.length) expanded.delete(path);
  }

  const nodes: VisibleNode[] = [];
  for (const [path] of graph.byPath) {
    if (path === graph.snapshot.root.key) continue;
    if (!isVisible(path, graph, expanded)) continue;
    nodes.push({ path, expanded: expanded.has(path), depth: path.split('/').length - 1 });
  }

  const edges: ProjectedEdge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const from = resolveVisibleEndpoint(edge.from, graph, expanded);
    const to = resolveVisibleEndpoint(edge.to, graph, expanded);
    if (from.endpoint === to.endpoint) continue;
    // Keep distinct labels, ports, and original endpoints when projection
    // folds multiple semantic relationships onto one visible pair.
    const key = JSON.stringify([
      from.endpoint,
      to.endpoint,
      edge.from,
      edge.to,
      edge.label ?? '',
      edge.twoWay ?? false,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ edge, from: from.endpoint, to: to.endpoint, folded: from.folded || to.folded });
  }

  return { nodes, edges };
}
