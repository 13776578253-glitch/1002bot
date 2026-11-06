/** User-authored label positions belong to one exact projected connection. */
import type { CanonicalEdge, StageSnapshot } from '../../../core/schema/types.ts';
import type { DisplayEdge } from '../routing/display-edges.ts';
import type { EdgeLabelPlacement } from '../contracts/label-types.ts';
import type { CanvasNodeView, EdgeLabelPin } from '../contracts/snapshot-types.ts';

function memberFingerprint(edge: CanonicalEdge): string {
  return JSON.stringify([edge.id, edge.source.nodeId, edge.source.portId ?? null, edge.target.nodeId, edge.target.portId ?? null]);
}

export function labelPinKey(pin: Pick<EdgeLabelPin, 'id' | 'source' | 'target' | 'memberIds'>): string {
  return JSON.stringify([pin.id, pin.source, pin.target, [...pin.memberIds].sort()]);
}

export function pinLabelForEdge(edge: DisplayEdge, label: EdgeLabelPlacement): EdgeLabelPin {
  const members = [...edge.members].sort((a, b) => a.canonicalEdgeId.localeCompare(b.canonicalEdgeId));
  return { id: edge.id, source: edge.source, target: edge.target, memberIds: members.map((member) => member.canonicalEdgeId),
    memberFingerprints: Object.fromEntries(members.map((member) => [member.canonicalEdgeId, memberFingerprint(member.edge)])), label: { ...label } };
}

export function labelPinForEdge(pins: readonly EdgeLabelPin[], edge: DisplayEdge): EdgeLabelPin | undefined {
  if (!pins.length) return undefined;
  const current = pinLabelForEdge(edge, { x: 0, y: 0, width: 1, height: 1 });
  const key = labelPinKey(current);
  return pins.find((pin) => labelPinKey(pin) === key && (!pin.memberFingerprints || pin.memberIds.every((id) => pin.memberFingerprints![id] === current.memberFingerprints![id])));
}

export function upsertLabelPin(pins: readonly EdgeLabelPin[], pin: EdgeLabelPin): EdgeLabelPin[] {
  const key = labelPinKey(pin);
  return [...pins.filter((item) => labelPinKey(item) !== key), structuredClone(pin)];
}

export function removeLabelPin(pins: readonly EdgeLabelPin[], id: string): EdgeLabelPin[] {
  return pins.filter((pin) => pin.id !== id);
}

export function removeLabelPinForEdge(pins: readonly EdgeLabelPin[], edge: DisplayEdge): EdgeLabelPin[] {
  const key = labelPinKey(pinLabelForEdge(edge, { x: 0, y: 0, width: 1, height: 1 }));
  return pins.filter((pin) => labelPinKey(pin) !== key);
}

/** 成员集合必须精确匹配；规范端点变化或移除后需要重新固定。 */
export function retainLabelPins(pins: readonly EdgeLabelPin[], stage: StageSnapshot, nodes: readonly CanvasNodeView[], sourceStage?: StageSnapshot): EdgeLabelPin[] {
  const edges = new Map(stage.graph.edges.map((edge) => [edge.id, edge]));
  const oldEdges = sourceStage ? new Map(sourceStage.graph.edges.map((edge) => [edge.id, edge])) : undefined;
  const nodeIds = new Set([...stage.graph.nodes.map((node) => node.id), ...nodes.map((node) => node.id)]);
  return pins.flatMap((pin) => {
    if (!nodeIds.has(pin.source) || !nodeIds.has(pin.target) || !pin.memberIds.every((id) => {
      const edge = edges.get(id), old = oldEdges?.get(id);
      if (!edge || oldEdges && (!old || memberFingerprint(old) !== memberFingerprint(edge))) return false;
      return !pin.memberFingerprints || pin.memberFingerprints[id] === memberFingerprint(edge);
    })) return [];
    const copy = structuredClone(pin);
    if (!copy.memberFingerprints && oldEdges) copy.memberFingerprints = Object.fromEntries(copy.memberIds.map((id) => [id, memberFingerprint(oldEdges.get(id)!)]));
    return [copy];
  });
}
