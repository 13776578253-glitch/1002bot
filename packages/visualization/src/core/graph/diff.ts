/** Stage-to-stage semantic diff over stable node and edge identities. */
import type { ChangeMark } from '../schema/baseline.ts';
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../schema/types.ts';

export interface StageDiff {
  fromStageId?: string;
  nodes: {
    added: string[];
    removed: string[];
    reparented: { id: string; from: string | null; to: string | null }[];
    replaced: { from: string; to: string; note?: string }[];
    updated: string[];
  };
  edges: {
    added: string[];
    removed: string[];
    replaced: { from: string; to: string; note?: string }[];
    updated: string[];
  };
}

interface Replacement {
  from: string;
  to: string;
  note?: string;
}

function replacementPairs(
  marks: Readonly<Record<string, ChangeMark>> | undefined,
  previous: ReadonlyMap<string, unknown>,
  next: ReadonlyMap<string, unknown>,
): Replacement[] {
  const pairs: Replacement[] = [];
  for (const [to, mark] of Object.entries(marks ?? {})) {
    if (mark.kind !== 'replaced' || !mark.previousId || !previous.has(mark.previousId) || !next.has(to)) continue;
    pairs.push({ from: mark.previousId, to, ...(mark.note === undefined ? {} : { note: mark.note }) });
  }
  return pairs.sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nodeUpdated(previous: CanonicalNode, next: CanonicalNode): boolean {
  return previous.label !== next.label
    || previous.summary !== next.summary
    || previous.kind !== next.kind
    || previous.order !== next.order
    || !!previous.planned !== !!next.planned
    || !sameJson(previous.details, next.details)
    || !sameJson(previous.sourceRefs, next.sourceRefs)
    || !sameJson(previous.ports, next.ports);
}

function edgeUpdated(previous: CanonicalEdge, next: CanonicalEdge): boolean {
  return previous.source.nodeId !== next.source.nodeId
    || previous.source.portId !== next.source.portId
    || previous.target.nodeId !== next.target.nodeId
    || previous.target.portId !== next.target.portId
    || previous.relation !== next.relation
    || previous.direction !== next.direction
    || previous.label !== next.label
    || previous.order !== next.order;
}

function byOrder<T extends { id: string; order: number }>(items: readonly T[], map: ReadonlyMap<string, T>): string[] {
  return [...items]
    .sort((a, b) => (map.get(a.id)?.order ?? 0) - (map.get(b.id)?.order ?? 0) || a.id.localeCompare(b.id))
    .map((item) => item.id);
}

/**
 * Compare consecutive stages by stable identity.
 *
 * Replacement marks pair an old identity with a new one, so the pair is
 * reported once under `replaced` rather than as an independent removal and
 * addition. Consumers that inherit layout map the old layout to the new ID.
 */
export function diffStages(
  previous: StageSnapshot | undefined,
  next: StageSnapshot,
  marks?: {
    nodeChanges?: Readonly<Record<string, ChangeMark>>;
    edgeChanges?: Readonly<Record<string, ChangeMark>>;
  },
): StageDiff {
  // The graph root is virtual in the canvas; layout inheritance never places it.
  const previousNodes = new Map((previous?.graph.nodes ?? [])
    .filter((node) => node.id !== previous?.graph.rootId)
    .map((node) => [node.id, node]));
  const nextNodes = new Map(next.graph.nodes
    .filter((node) => node.id !== next.graph.rootId)
    .map((node) => [node.id, node]));
  const nodeReplacements = replacementPairs(marks?.nodeChanges, previousNodes, nextNodes);
  const replacedFrom = new Set(nodeReplacements.map((pair) => pair.from));
  const replacedTo = new Set(nodeReplacements.map((pair) => pair.to));

  const addedNodes = byOrder(
    [...nextNodes.values()].filter((node) => !previousNodes.has(node.id) && !replacedTo.has(node.id)),
    nextNodes,
  );
  const removedNodes = byOrder(
    [...previousNodes.values()].filter((node) => !nextNodes.has(node.id) && !replacedFrom.has(node.id)),
    previousNodes,
  );
  const commonNodes = [...nextNodes.values()].filter((node) => previousNodes.has(node.id) && !replacedTo.has(node.id) && !replacedFrom.has(node.id));
  const reparented = commonNodes
    .filter((node) => previousNodes.get(node.id)!.parentId !== node.parentId)
    .map((node) => ({ id: node.id, from: previousNodes.get(node.id)!.parentId, to: node.parentId }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reparentedIds = new Set(reparented.map((item) => item.id));
  const updatedNodes = byOrder(
    commonNodes.filter((node) => !reparentedIds.has(node.id) && nodeUpdated(previousNodes.get(node.id)!, node)),
    nextNodes,
  );

  const previousEdges = new Map((previous?.graph.edges ?? []).map((edge) => [edge.id, edge]));
  const nextEdges = new Map(next.graph.edges.map((edge) => [edge.id, edge]));
  const edgeReplacements = replacementPairs(marks?.edgeChanges, previousEdges, nextEdges);
  const edgeReplacedFrom = new Set(edgeReplacements.map((pair) => pair.from));
  const edgeReplacedTo = new Set(edgeReplacements.map((pair) => pair.to));

  const addedEdges = byOrder(
    [...nextEdges.values()].filter((edge) => !previousEdges.has(edge.id) && !edgeReplacedTo.has(edge.id)),
    nextEdges,
  );
  const removedEdges = byOrder(
    [...previousEdges.values()].filter((edge) => !nextEdges.has(edge.id) && !edgeReplacedFrom.has(edge.id)),
    previousEdges,
  );
  const updatedEdges = byOrder(
    [...nextEdges.values()].filter((edge) => previousEdges.has(edge.id)
      && !edgeReplacedTo.has(edge.id)
      && !edgeReplacedFrom.has(edge.id)
      && edgeUpdated(previousEdges.get(edge.id)!, edge)),
    nextEdges,
  );

  return {
    ...(previous ? { fromStageId: previous.id } : {}),
    nodes: {
      added: addedNodes,
      removed: removedNodes,
      reparented,
      replaced: nodeReplacements,
      updated: updatedNodes,
    },
    edges: {
      added: addedEdges,
      removed: removedEdges,
      replaced: edgeReplacements,
      updated: updatedEdges,
    },
  };
}
