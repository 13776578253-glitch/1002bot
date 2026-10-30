/**
 * Graph-level semantic validation and indexing.
 *
 * Schema validation checks local object shape. This module owns identity,
 * hierarchy and endpoint semantics for a canonical flat graph.
 */

import type {
  CanonicalEdge,
  CanonicalGraph,
  CanonicalNode,
  GraphEdgeId,
  GraphNodeId,
  GraphPatch,
  GraphPatchOperation,
  StageSnapshot,
} from '../schema/types.ts';
import { validateSnapshot, type ValidationIssue } from '../schema/validate.ts';

export function validateGraph(graph: CanonicalGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = new Map<GraphNodeId, CanonicalNode>();
  const edges = new Set<GraphEdgeId>();

  for (const node of graph.nodes) {
    if (nodes.has(node.id)) issues.push({ message: 'duplicate node id "' + node.id + '"', path: 'graph.nodes' });
    nodes.set(node.id, node);
    const portIds = new Set<string>();
    for (const port of node.ports) {
      if (portIds.has(port.id)) issues.push({ message: 'duplicate port "' + port.id + '"', path: 'node:' + node.id });
      portIds.add(port.id);
    }
  }

  const root = nodes.get(graph.rootId);
  if (!root) issues.push({ message: 'graph rootId references unknown node "' + graph.rootId + '"', path: 'graph.rootId' });
  else if (root.parentId !== null) issues.push({ message: 'graph root must have parentId null', path: 'node:' + root.id });

  const roots = graph.nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) issues.push({ message: 'graph must contain exactly one parentless root', path: 'graph.nodes' });

  for (const node of graph.nodes) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      issues.push({ message: 'node "' + node.id + '" references unknown parent "' + node.parentId + '"', path: 'node:' + node.id });
    }
  }

  const visiting = new Set<GraphNodeId>();
  const visited = new Set<GraphNodeId>();
  const visit = (id: GraphNodeId): void => {
    if (visiting.has(id)) {
      issues.push({ message: 'parent cycle includes "' + id + '"', path: 'node:' + id });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const parent = nodes.get(id)?.parentId;
    if (parent !== null && parent !== undefined && nodes.has(parent)) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of graph.nodes) visit(node.id);

  const checkPort = (nodeId: GraphNodeId, portId: string | undefined, side: 'source' | 'target', edgeId: GraphEdgeId): void => {
    if (portId === undefined) return;
    const node = nodes.get(nodeId);
    const port = node?.ports.find((candidate) => candidate.id === portId);
    if (!node || !port) {
      issues.push({ message: 'edge "' + edgeId + '" references unknown ' + side + ' port "' + portId + '"', path: 'edge:' + edgeId });
      return;
    }
    if (side === 'source' && port.direction === 'in') issues.push({ message: 'source port "' + portId + '" is input-only', path: 'edge:' + edgeId });
    if (side === 'target' && port.direction === 'out') issues.push({ message: 'target port "' + portId + '" is output-only', path: 'edge:' + edgeId });
  };

  for (const edge of graph.edges) {
    if (edges.has(edge.id)) issues.push({ message: 'duplicate edge id "' + edge.id + '"', path: 'graph.edges' });
    edges.add(edge.id);
    if (!nodes.has(edge.source.nodeId)) issues.push({ message: 'edge "' + edge.id + '" references unknown source node "' + edge.source.nodeId + '"', path: 'edge:' + edge.id });
    if (!nodes.has(edge.target.nodeId)) issues.push({ message: 'edge "' + edge.id + '" references unknown target node "' + edge.target.nodeId + '"', path: 'edge:' + edge.id });
    checkPort(edge.source.nodeId, edge.source.portId, 'source', edge.id);
    checkPort(edge.target.nodeId, edge.target.portId, 'target', edge.id);
  }

  return issues;
}

export function assertValidGraph(graph: CanonicalGraph): void {
  const issues = validateGraph(graph);
  if (issues.length) {
    const detail = issues.map((issue) => (issue.path ? issue.path + ': ' + issue.message : issue.message)).join('\n');
    throw new Error('invalid graph:\n' + detail);
  }
}

export interface IndexedGraph {
  snapshot: StageSnapshot;
  graph: CanonicalGraph;
  byId: Map<GraphNodeId, CanonicalNode>;
  parentOf: Map<GraphNodeId, GraphNodeId>;
  childrenOf: Map<GraphNodeId, GraphNodeId[]>;
  edgesById: Map<GraphEdgeId, CanonicalEdge>;
  edges: CanonicalEdge[];
}

export function indexGraph(snapshot: StageSnapshot): IndexedGraph {
  const schemaIssues = validateSnapshot(snapshot);
  if (schemaIssues.length) {
    const detail = schemaIssues.map((issue) => (issue.path ? issue.path + ': ' + issue.message : issue.message)).join('\n');
    throw new Error('invalid snapshot "' + snapshot.id + '":\n' + detail);
  }
  assertValidGraph(snapshot.graph);

  const byId = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
  const parentOf = new Map<GraphNodeId, GraphNodeId>();
  const childrenOf = new Map<GraphNodeId, GraphNodeId[]>();

  for (const node of snapshot.graph.nodes) {
    if (node.parentId !== null) {
      parentOf.set(node.id, node.parentId);
      const siblings = childrenOf.get(node.parentId) ?? [];
      siblings.push(node.id);
      childrenOf.set(node.parentId, siblings);
    }
  }
  for (const siblings of childrenOf.values()) siblings.sort((a, b) => (byId.get(a)?.order ?? 0) - (byId.get(b)?.order ?? 0));

  const edgesById = new Map(snapshot.graph.edges.map((edge) => [edge.id, edge]));
  const indexed: IndexedGraph = {
    snapshot,
    graph: snapshot.graph,
    byId,
    parentOf,
    childrenOf,
    edgesById,
    edges: [...snapshot.graph.edges].sort((a, b) => a.order - b.order),
  };
  return indexed;
}

export function edgesTouching(graph: IndexedGraph, nodeId: GraphNodeId): CanonicalEdge[] {
  const descendants = new Set<GraphNodeId>([nodeId]);
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.pop()!;
    for (const child of graph.childrenOf.get(current) ?? []) {
      if (!descendants.has(child)) {
        descendants.add(child);
        queue.push(child);
      }
    }
  }
  return graph.edges.filter((edge) => descendants.has(edge.source.nodeId) || descendants.has(edge.target.nodeId));
}

function cloneNode(node: CanonicalNode): CanonicalNode {
  return {
    ...node,
    ports: node.ports.map((port) => ({ ...port })),
    ...(node.details === undefined ? {} : { details: [...node.details] }),
    ...(node.sourceRefs === undefined ? {} : { sourceRefs: [...node.sourceRefs] }),
  };
}

function applyOperation(graph: CanonicalGraph, operation: GraphPatchOperation): CanonicalGraph {
  const nodes = new Map(graph.nodes.map((node) => [node.id, cloneNode(node)]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, { ...edge, source: { ...edge.source }, target: { ...edge.target } }]));
  switch (operation.kind) {
    case 'upsertNode':
      nodes.set(operation.node.id, cloneNode(operation.node));
      break;
    case 'removeNode': {
      const removed = new Set<GraphNodeId>();
      const visit = (id: GraphNodeId): void => {
        if (removed.has(id)) return;
        removed.add(id);
        for (const node of nodes.values()) if (node.parentId === id) visit(node.id);
      };
      visit(operation.id);
      for (const id of removed) nodes.delete(id);
      for (const [edgeId, edge] of edges) if (removed.has(edge.source.nodeId) || removed.has(edge.target.nodeId)) edges.delete(edgeId);
      break;
    }
    case 'reparentNode': {
      const node = nodes.get(operation.id);
      if (!node) throw new Error('cannot reparent unknown node "' + operation.id + '"');
      nodes.set(operation.id, { ...node, parentId: operation.parentId });
      break;
    }
    case 'upsertPort': {
      const node = nodes.get(operation.nodeId);
      if (!node) throw new Error('cannot update port on unknown node "' + operation.nodeId + '"');
      const ports = node.ports.filter((port) => port.id !== operation.port.id);
      ports.push({ ...operation.port });
      nodes.set(node.id, { ...node, ports: ports.sort((a, b) => a.order - b.order) });
      break;
    }
    case 'removePort': {
      const node = nodes.get(operation.nodeId);
      if (!node) throw new Error('cannot remove port from unknown node "' + operation.nodeId + '"');
      nodes.set(node.id, { ...node, ports: node.ports.filter((port) => port.id !== operation.portId) });
      break;
    }
    case 'upsertEdge':
      edges.set(operation.edge.id, { ...operation.edge, source: { ...operation.edge.source }, target: { ...operation.edge.target } });
      break;
    case 'removeEdge':
      edges.delete(operation.id);
      break;
  }
  return {
    ...graph,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    ...(graph.revision === undefined ? {} : { revision: graph.revision }),
  };
}

export function applyGraphPatch(graph: CanonicalGraph, patch: GraphPatch): CanonicalGraph {
  const currentRevision = graph.revision ?? '0';
  if (currentRevision !== patch.baseRevision) {
    throw new Error('graph revision mismatch: expected "' + patch.baseRevision + '", got "' + currentRevision + '"');
  }
  let next = graph;
  for (const operation of patch.operations) next = applyOperation(next, operation);
  next = { ...next, revision: patch.nextRevision };
  assertValidGraph(next);
  return next;
}
