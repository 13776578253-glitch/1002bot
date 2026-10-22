/**
 * Evolution analysis over canonical graph revisions.
 *
 * Diffs use stable node and edge ids. Derived paths are retained only as
 * display context for the inspector.
 */

import type {
  CanonicalEdge,
  CanonicalEndpoint,
  EvolutionEvent,
  EvolutionStep,
  GraphEdgeId,
  GraphNodeId,
  StageSnapshot,
} from '../schema/types.ts';
import { indexGraph } from '../graph/index.ts';

export type NodeDeltaKind = 'baseline' | 'added' | 'modified' | 'moved' | 'split' | 'merged' | 'removed' | 'inherited';

export interface NodeDelta {
  id: GraphNodeId;
  kind: NodeDeltaKind;
  path?: string;
  beforePath?: string;
  relatedIds?: GraphNodeId[];
  note?: string;
}

export interface EdgeDelta {
  id: GraphEdgeId;
  kind: 'added' | 'removed' | 'rewired' | 'inherited';
  source: CanonicalEndpoint;
  target: CanonicalEndpoint;
  relation: CanonicalEdge['relation'];
  direction: CanonicalEdge['direction'];
  label?: string;
  before?: { source: CanonicalEndpoint; target: CanonicalEndpoint };
  note?: string;
}

export interface StageDelta {
  nodes: NodeDelta[];
  edges: EdgeDelta[];
}

function endpointSignature(endpoint: CanonicalEndpoint): string {
  return endpoint.nodeId + '#' + (endpoint.portId ?? '');
}

function edgeEndpointSignature(edge: CanonicalEdge): string {
  return endpointSignature(edge.source) + '>' + endpointSignature(edge.target);
}

function nodeSignature(node: StageSnapshot['graph']['nodes'][number]): string {
  return JSON.stringify({
    id: node.id,
    kind: node.kind,
    label: node.label,
    summary: node.summary ?? '',
    details: node.details ?? [],
    ports: node.ports,
    sourceRefs: node.sourceRefs ?? [],
    introducedAt: node.introducedAt ?? '',
    planned: node.planned ?? false,
    order: node.order,
  });
}

function edgeDelta(edge: CanonicalEdge, kind: EdgeDelta['kind'], graphPath?: (id: GraphNodeId) => string | undefined): EdgeDelta {
  return {
    id: edge.id,
    kind,
    source: { ...edge.source },
    target: { ...edge.target },
    relation: edge.relation,
    direction: edge.direction,
    ...(edge.label === undefined ? {} : { label: edge.label }),
  };
}

export function edgeDeltaIdentity(edge: Pick<EdgeDelta, 'source' | 'target' | 'relation' | 'direction' | 'label'>): string {
  return JSON.stringify([
    endpointSignature(edge.source),
    endpointSignature(edge.target),
    edge.relation,
    edge.direction,
    edge.label ?? '',
  ]);
}

export function diffSnapshots(before: StageSnapshot | undefined, after: StageSnapshot): StageDelta {
  const afterGraph = indexGraph(after);
  if (!before) {
    return {
      nodes: after.graph.nodes.map((node) => {
        const path = afterGraph.pathById.get(node.id);
        return { id: node.id, kind: 'baseline', ...(path === undefined ? {} : { path }) };
      }),
      edges: after.graph.edges.map((edge) => edgeDelta(edge, 'added')),
    };
  }

  const beforeGraph = indexGraph(before);
  const beforeNodes = before.graph.nodes.reduce((map, node) => map.set(node.id, node), new Map<GraphNodeId, typeof before.graph.nodes[number]>());
  const afterNodes = after.graph.nodes.reduce((map, node) => map.set(node.id, node), new Map<GraphNodeId, typeof after.graph.nodes[number]>());
  const nodes: NodeDelta[] = [];

  for (const node of after.graph.nodes) {
    const old = beforeNodes.get(node.id);
    const path = afterGraph.pathById.get(node.id);
    const beforePath = beforeGraph.pathById.get(node.id);
    if (!old) {
      nodes.push({ id: node.id, kind: 'added', ...(path === undefined ? {} : { path }) });
    } else if (old.parentId !== node.parentId) {
      nodes.push({ id: node.id, kind: 'moved', ...(path === undefined ? {} : { path }), ...(beforePath === undefined ? {} : { beforePath }) });
    } else if (nodeSignature(node) !== nodeSignature(old)) {
      nodes.push({ id: node.id, kind: 'modified', ...(path === undefined ? {} : { path }), ...(beforePath === undefined ? {} : { beforePath }) });
    } else {
      nodes.push({ id: node.id, kind: 'inherited', ...(path === undefined ? {} : { path }), ...(beforePath === undefined ? {} : { beforePath }) });
    }
  }
  for (const node of before.graph.nodes) {
    if (!afterNodes.has(node.id)) {
      const beforePath = beforeGraph.pathById.get(node.id);
      nodes.push({ id: node.id, kind: 'removed', ...(beforePath === undefined ? {} : { beforePath }) });
    }
  }

  const beforeEdges = new Map(before.graph.edges.map((edge) => [edge.id, edge]));
  const afterEdges = new Map(after.graph.edges.map((edge) => [edge.id, edge]));
  const edges: EdgeDelta[] = [];
  for (const edge of after.graph.edges) {
    const old = beforeEdges.get(edge.id);
    if (!old) {
      edges.push(edgeDelta(edge, 'added'));
    } else if (
      edgeEndpointSignature(old) !== edgeEndpointSignature(edge)
      || old.relation !== edge.relation
      || old.direction !== edge.direction
      || old.label !== edge.label
    ) {
      edges.push({ ...edgeDelta(edge, 'rewired'), before: { source: { ...old.source }, target: { ...old.target } } });
    } else {
      edges.push(edgeDelta(edge, 'inherited'));
    }
  }
  for (const edge of before.graph.edges) {
    if (!afterEdges.has(edge.id)) edges.push(edgeDelta(edge, 'removed'));
  }

  return { nodes, edges };
}

export function applyEvolutionEvents(delta: StageDelta, step: EvolutionStep | undefined): StageDelta {
  if (!step) return delta;
  const nodes = new Map(delta.nodes.map((item) => [item.id, item]));
  const edges = [...delta.edges];

  for (const event of step.events) {
    switch (event.kind) {
      case 'added':
      case 'modified':
        for (const id of event.ids) {
          const current = nodes.get(id);
          if (current) nodes.set(id, { ...current, kind: event.kind, ...(event.note === undefined ? {} : { note: event.note }) });
        }
        break;
      case 'moved': {
        const current = nodes.get(event.id);
        if (current) nodes.set(event.id, { ...current, kind: 'moved', ...(event.note === undefined ? {} : { note: event.note }) });
        break;
      }
      case 'split':
        for (const id of event.into) {
          const current = nodes.get(id);
          if (current) nodes.set(id, { ...current, kind: 'split', relatedIds: [event.from], ...(event.note === undefined ? {} : { note: event.note }) });
        }
        break;
      case 'merged': {
        const current = nodes.get(event.into);
        if (current) nodes.set(event.into, { ...current, kind: 'merged', relatedIds: [...event.from], ...(event.note === undefined ? {} : { note: event.note }) });
        break;
      }
      case 'removed':
        for (const id of event.ids) {
          const current = nodes.get(id);
          if (current) nodes.set(id, { ...current, kind: 'removed', ...(event.note === undefined ? {} : { note: event.note }) });
        }
        break;
      case 'rewired': {
        for (let index = 0; index < edges.length; index++) {
          const current = edges[index];
          if (!current) continue;
          const matchesId = event.edgeId === undefined || current.id === event.edgeId;
          const matchesAfter = endpointSignature(current.source) === endpointSignature(event.after.source)
            && endpointSignature(current.target) === endpointSignature(event.after.target);
          if (matchesId && matchesAfter) {
            edges[index] = {
              ...current,
              kind: 'rewired',
              before: { source: { ...event.before.source }, target: { ...event.before.target } },
              ...(event.note === undefined ? {} : { note: event.note }),
            };
          }
        }
        break;
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}
