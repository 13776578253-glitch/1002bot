/**
 * Evolution analysis: compare adjacent snapshots and merge the automatic
 * diff with explicit evolution events (moved/split/merged semantics).
 */

import type {
  EvolutionEvent,
  EvolutionStep,
  GraphEdge,
  GraphNode,
  NodeKey,
  NodePath,
  StageSnapshot,
} from '../schema/types.ts';
import { indexGraph, splitEndpoint } from '../graph/index.ts';

export type NodeDeltaKind = 'baseline' | 'added' | 'modified' | 'moved' | 'split' | 'merged' | 'removed' | 'inherited';

export interface NodeDelta {
  key: NodeKey;
  kind: NodeDeltaKind;
  path?: NodePath | undefined;
  beforePath?: NodePath | undefined;
  /** For split: the keys this node came from. For merged: the keys merged into it. */
  relatedKeys?: NodeKey[] | undefined;
  note?: string | undefined;
}

export interface EdgeDelta {
  kind: 'added' | 'removed' | 'rewired' | 'inherited';
  from: NodeKey;
  to: NodeKey;
  fromPort?: string | undefined;
  toPort?: string | undefined;
  twoWay?: boolean | undefined;
  label?: string | undefined;
  /** For rewired: the old endpoints. */
  before?: { from: NodeKey; to: NodeKey } | undefined;
  note?: string | undefined;
}

export interface StageDelta {
  nodes: NodeDelta[];
  edges: EdgeDelta[];
}

function nodeSignature(node: GraphNode): string {
  return JSON.stringify([
    node.title,
    node.desc ?? '',
    node.details ?? [],
    node.ports ?? [],
    node.source ?? '',
    node.intro ?? '',
    (node.children ?? []).map((child) => child.key),
    node.planned ?? false,
  ]);
}

interface EdgeKey {
  from: NodeKey;
  to: NodeKey;
  fromPort?: string;
  toPort?: string;
  label?: string;
  twoWay?: boolean;
}

function edgeKeyOf(edge: GraphEdge, byPath: Map<NodePath, GraphNode>): EdgeKey {
  const keyFor = (endpoint: string): { key: NodeKey; port?: string } => {
    const { path, port } = splitEndpoint(endpoint);
    // Walk up until a registered node path is found, then read its key.
    let cursor = path;
    while (cursor && !byPath.has(cursor)) {
      const cut = cursor.lastIndexOf('/');
      if (cut < 0) break;
      cursor = cursor.slice(0, cut);
    }
    return { key: byPath.get(cursor)?.key ?? cursor, ...(port === undefined ? {} : { port }) };
  };
  const from = keyFor(edge.from);
  const to = keyFor(edge.to);
  return {
    from: from.key,
    to: to.key,
    ...(from.port === undefined ? {} : { fromPort: from.port }),
    ...(to.port === undefined ? {} : { toPort: to.port }),
    ...(edge.label === undefined ? {} : { label: edge.label }),
    ...(edge.twoWay === undefined ? {} : { twoWay: edge.twoWay }),
  };
}

function edgeId(edge: EdgeKey): string {
  return JSON.stringify([
    edge.from,
    edge.to,
    edge.fromPort ?? '',
    edge.toPort ?? '',
    edge.label ?? '',
    edge.twoWay ?? false,
  ]);
}

/** Stable identity for an edge delta, including interface and display semantics. */
export function edgeDeltaIdentity(edge: Pick<EdgeDelta, 'from' | 'to' | 'fromPort' | 'toPort' | 'label' | 'twoWay'>): string {
  return JSON.stringify([
    edge.from,
    edge.to,
    edge.fromPort ?? '',
    edge.toPort ?? '',
    edge.label ?? '',
    edge.twoWay ?? false,
  ]);
}

/** Automatic diff between two snapshots, by node key. */
export function diffSnapshots(before: StageSnapshot | undefined, after: StageSnapshot): StageDelta {
  const afterGraph = indexGraph(after);
  if (!before) {
    return {
      nodes: [...afterGraph.byKey.keys()].map((key) => ({ key, kind: 'baseline', path: afterGraph.byKey.get(key) })),
      edges: afterGraph.edges.map((e) => ({ kind: 'added', ...edgeKeyOf(e, afterGraph.byPath), label: e.label })),
    };
  }
  const beforeGraph = indexGraph(before);
  const nodes: NodeDelta[] = [];

  for (const [key, path] of afterGraph.byKey) {
    const oldPath = beforeGraph.byKey.get(key);
    if (oldPath === undefined) {
      nodes.push({ key, kind: 'added', path });
      continue;
    }
    const node = afterGraph.byPath.get(path)!;
    const oldNode = beforeGraph.byPath.get(oldPath)!;
    const oldParent = beforeGraph.parentOf.get(oldPath);
    const newParent = afterGraph.parentOf.get(path);
    if (oldParent !== newParent) {
      nodes.push({ key, kind: 'moved', path, beforePath: oldPath });
    } else if (nodeSignature(node) !== nodeSignature(oldNode)) {
      nodes.push({ key, kind: 'modified', path, beforePath: oldPath });
    } else {
      nodes.push({ key, kind: 'inherited', path, beforePath: oldPath });
    }
  }
  for (const [key, oldPath] of beforeGraph.byKey) {
    if (!afterGraph.byKey.has(key)) nodes.push({ key, kind: 'removed', beforePath: oldPath });
  }

  const edges: EdgeDelta[] = [];
  const beforeEdges = new Map(beforeGraph.edges.map((e) => [edgeId(edgeKeyOf(e, beforeGraph.byPath)), e]));
  const afterEdges = new Map(afterGraph.edges.map((e) => [edgeId(edgeKeyOf(e, afterGraph.byPath)), e]));
  for (const [id, edge] of afterEdges) {
    const ep = edgeKeyOf(edge, afterGraph.byPath);
    if (!beforeEdges.has(id)) edges.push({ kind: 'added', ...ep, label: edge.label });
    else edges.push({ kind: 'inherited', ...ep, label: edge.label });
  }
  for (const [id, edge] of beforeEdges) {
    if (!afterEdges.has(id)) {
      const ep = edgeKeyOf(edge, beforeGraph.byPath);
      edges.push({ kind: 'removed', ...ep, label: edge.label });
    }
  }

  return { nodes, edges };
}

/** Merge explicit evolution events into an automatic diff. */
export function applyEvolutionEvents(delta: StageDelta, step: EvolutionStep | undefined): StageDelta {
  if (!step) return delta;
  const nodes = new Map(delta.nodes.map((n) => [n.key, n]));
  const edges = [...delta.edges];

  for (const event of step.events) {
    applyEvent(event, nodes, edges);
  }
  return { nodes: [...nodes.values()], edges };
}

function applyEvent(event: EvolutionEvent, nodes: Map<NodeKey, NodeDelta>, edges: EdgeDelta[]): void {
  switch (event.kind) {
    case 'added':
    case 'modified':
      for (const key of event.keys) {
        const entry = nodes.get(key);
        if (entry) nodes.set(key, { ...entry, kind: event.kind === 'added' ? 'added' : 'modified', note: event.note });
      }
      return;
    case 'moved': {
      const entry = nodes.get(event.key);
      if (entry) nodes.set(event.key, { ...entry, kind: 'moved', note: event.note });
      return;
    }
    case 'split': {
      for (const key of event.into) {
        const entry = nodes.get(key);
        if (entry) nodes.set(key, { ...entry, kind: 'split', relatedKeys: [event.from], note: event.note });
      }
      // The source key survives as an aggregate or is removed.
      const source = nodes.get(event.from);
      if (source?.kind === 'removed') nodes.set(event.from, { ...source, note: event.note });
      return;
    }
    case 'merged': {
      const entry = nodes.get(event.into);
      if (entry) nodes.set(event.into, { ...entry, kind: 'merged', relatedKeys: [...event.from], note: event.note });
      return;
    }
    case 'removed':
      for (const key of event.keys) {
        const entry = nodes.get(key);
        if (entry) nodes.set(key, { ...entry, kind: 'removed', note: event.note });
      }
      return;
    case 'rewired': {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        if (e.kind === 'added' && e.from === event.to.from && e.to === event.to.to) {
          edges[i] = { ...e, kind: 'rewired', before: { ...event.from }, note: event.note };
        }
        if (e.kind === 'removed' && e.from === event.from.from && e.to === event.from.to) {
          edges[i] = { ...e, kind: 'rewired', note: event.note };
        }
      }
      return;
    }
  }
}
