/** Authored layouts move only the user's targets and never resize or displace their neighbors. */
import type { StageSnapshot } from '../../core/schema/types.ts';
import { worldPosition, type CanvasNode } from './grouping.ts';
import { projectGraph } from '../../core/projection/index.ts';
import type { StageConflict } from './stage-types.ts';
import { alignNodeRect, type AlignmentGuide } from './constraints.ts';

export function manualGeometryConflict(nodes: readonly CanvasNode[], stage: StageSnapshot): StageConflict | undefined {
  const projection = projectGraph(stage, new Set(nodes.filter((node) => node.data.expanded).map((node) => node.id)));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestor = (id: string, child: CanvasNode): boolean => {
    let parent = child.parentId;
    while (parent) { if (parent === id) return true; parent = byId.get(parent)?.parentId; }
    return false;
  };
  const visible = nodes.filter((node) => projection.nodeById.has(node.id) || node.type === 'cluster' && nodes.some((child) => projection.nodeById.has(child.id) && ancestor(node.id, child)));
  for (const node of visible) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && (node.position.x < 24 || node.position.y < (parent.type === 'cluster' ? 60 : 72)
      || node.position.x + node.width! > parent.width! - 24 || node.position.y + node.height! > parent.height! - 24)) {
      return { kind: 'no-space', entityIds: [node.id], containerId: parent.id, message: `人工编排超出容器边界：${node.data.title}`, actions: ['cancel'] };
    }
    for (const peer of visible) {
      if (peer === node || ancestor(peer.id, node) || ancestor(node.id, peer)) continue;
      const a = worldPosition(node, nodes), b = worldPosition(peer, nodes);
      if (a.x < b.x + peer.width! && a.x + node.width! > b.x && a.y < b.y + peer.height! && a.y + node.height! > b.y) {
        return { kind: 'no-space', entityIds: [node.id, peer.id], message: `人工编排重叠：${node.data.title} / ${peer.data.title}`, actions: ['cancel'] };
      }
    }
  }
  return undefined;
}

export function moveAuthoredNodes(before: readonly CanvasNode[], proposed: readonly CanvasNode[], movedIds: readonly string[], stage: StageSnapshot): CanvasNode[] {
  return moveAuthoredSelection(before, proposed, movedIds, stage).nodes;
}

export function moveAlignedAuthoredNodes(before: readonly CanvasNode[], proposed: readonly CanvasNode[], movedIds: readonly string[], stage: StageSnapshot, zoom: number, visible: ReadonlySet<string>): { nodes: CanvasNode[]; guides: AlignmentGuide[] } {
  return moveAuthoredSelection(before, proposed, movedIds, stage, { zoom, visible });
}

function moveAuthoredSelection(before: readonly CanvasNode[], proposed: readonly CanvasNode[], movedIds: readonly string[], stage: StageSnapshot, alignment?: { zoom: number; visible: ReadonlySet<string> }): { nodes: CanvasNode[]; guides: AlignmentGuide[] } {
  const previous = new Map(before.map((node) => [node.id, node]));
  const movable = new Set(movedIds.filter((id) => previous.get(id)!.data.layoutMode !== 'locked'));
  const roots = before.filter((node) => movable.has(node.id) && !(() => {
    let parent = node.parentId;
    while (parent) { if (movable.has(parent)) return true; parent = previous.get(parent)?.parentId; }
    return false;
  })());
  const primary = roots[0];
  if (!primary) return { nodes: proposed.map((node) => ({ ...node, position: previous.get(node.id)!.position })), guides: [] };
  const requested = proposed.find((node) => node.id === primary.id)!;
  const delta = { x: requested.position.x - primary.position.x, y: requested.position.y - primary.position.y };
  const rootIds = new Set(roots.map((node) => node.id));
  const next = proposed.map((node) => {
    const old = previous.get(node.id)!;
    const position = rootIds.has(node.id) ? { x: old.position.x + delta.x, y: old.position.y + delta.y } : old.position;
    return position.x === node.position.x && position.y === node.position.y ? node : { ...node, position };
  });
  if (alignment) {
    const hasMovingAncestor = (node: CanvasNode): boolean => {
      let parent = node.parentId;
      while (parent) { if (rootIds.has(parent)) return true; parent = previous.get(parent)?.parentId; }
      return false;
    };
    const ancestors = new Set<string>();
    for (const root of roots) {
      let parent = root.parentId;
      while (parent) { ancestors.add(parent); parent = previous.get(parent)?.parentId; }
    }
    const rect = (node: CanvasNode) => ({ ...worldPosition(node, next), w: node.width!, h: node.height! });
    const anchor = next.find((node) => node.id === primary.id)!;
    const peers = next.filter((node) => alignment.visible.has(node.id) && node.type === primary.type && !rootIds.has(node.id) && !ancestors.has(node.id) && !hasMovingAncestor(node));
    const snap = alignNodeRect(rect(anchor), peers.map(rect), alignment.zoom);
    const snapped = next.map((node) => rootIds.has(node.id) ? { ...node, position: { x: node.position.x + snap.dx, y: node.position.y + snap.dy } } : node);
    if (!manualGeometryConflict(snapped, stage)) return { nodes: snapped, guides: snap.guides };
  }
  return { nodes: manualGeometryConflict(next, stage) ? before as CanvasNode[] : next, guides: [] };
}
