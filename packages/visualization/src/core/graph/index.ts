/**
 * Graph indexes over one stage snapshot: lookup by key, by path,
 * parent/children navigation, and edge queries. Built once per stage.
 */

import type { GraphEdge, GraphNode, NodeKey, NodePath, StageSnapshot } from '../schema/types.ts';

export interface IndexedGraph {
  snapshot: StageSnapshot;
  /** key → path within this snapshot. */
  byKey: Map<NodeKey, NodePath>;
  /** path → node. */
  byPath: Map<NodePath, GraphNode>;
  /** path → parent path (root has none). */
  parentOf: Map<NodePath, NodePath>;
  /** path → direct child paths. */
  childrenOf: Map<NodePath, NodePath[]>;
  /** Edges with endpoints normalized to full paths (without port). */
  edges: GraphEdge[];
}

export function indexGraph(snapshot: StageSnapshot): IndexedGraph {
  const byKey = new Map<NodeKey, NodePath>();
  const byPath = new Map<NodePath, GraphNode>();
  const parentOf = new Map<NodePath, NodePath>();
  const childrenOf = new Map<NodePath, NodePath[]>();

  function walk(node: GraphNode, path: NodePath, parent?: NodePath): void {
    byKey.set(node.key, path);
    byPath.set(path, node);
    if (parent !== undefined) {
      parentOf.set(path, parent);
      const siblings = childrenOf.get(parent) ?? [];
      siblings.push(path);
      childrenOf.set(parent, siblings);
    }
    for (const child of node.children ?? []) walk(child, `${path}/${child.key}`, path);
  }
  walk(snapshot.root, snapshot.root.key);

  return { snapshot, byKey, byPath, parentOf, childrenOf, edges: snapshot.edges ?? [] };
}

/** Split "path#port" into its node path and optional port id. */
export function splitEndpoint(endpoint: string): { path: NodePath; port?: string } {
  const hash = endpoint.indexOf('#');
  if (hash < 0) return { path: endpoint };
  return { path: endpoint.slice(0, hash), port: endpoint.slice(hash + 1) };
}

/** All edges touching a node path, in either direction. */
export function edgesTouching(graph: IndexedGraph, path: NodePath): GraphEdge[] {
  return graph.edges.filter((e) => {
    const from = splitEndpoint(e.from).path;
    const to = splitEndpoint(e.to).path;
    return from === path || to === path || from.startsWith(path + '/') || to.startsWith(path + '/');
  });
}
