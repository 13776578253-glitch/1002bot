/** Protected node anchors and sibling clearance during geometry changes. */
import { isLayoutProtected, type CanvasNode } from './node.ts';
import { siblingsOverlap } from './siblings.ts';

const GEOMETRY_EPSILON = 0.000001;

/** 自动编辑保留受保护的世界锚点；人工父级移动会携带后代。 */
export function layoutProtectionConflict(before: readonly CanvasNode[], after: readonly CanvasNode[], movedRoots: ReadonlySet<string> = new Set()): boolean {
  const protectedNodes = before.filter(isLayoutProtected);
  if (!protectedNodes.length) return false;
  const previous = new Map(before.map((node) => [node.id, node]));
  const next = new Map(after.map((node) => [node.id, node]));
  const oldWorlds = new Map<string, { x: number; y: number }>(), newWorlds = new Map<string, { x: number; y: number }>();
  const origin = (node: CanvasNode, byId: ReadonlyMap<string, CanvasNode>, cache: Map<string, { x: number; y: number }>): { x: number; y: number } => {
    const cached = cache.get(node.id);
    if (cached) return cached;
    const parent = node.parentId ? origin(byId.get(node.parentId)!, byId, cache) : { x: 0, y: 0 };
    const point = { x: parent.x + node.position.x, y: parent.y + node.position.y };
    cache.set(node.id, point);
    return point;
  };
  for (const original of protectedNodes) {
    const current = next.get(original.id);
    if (movedRoots.has(original.id) && original.data.layoutMode !== 'locked') continue;
    if (!current) return true;
    const oldWorld = origin(original, previous, oldWorlds), newWorld = origin(current, next, newWorlds);
    let owner = original.parentId, dx = 0, dy = 0;
    while (owner) {
      if (movedRoots.has(owner) && next.has(owner)) {
        const oldOwner = origin(previous.get(owner)!, previous, oldWorlds), newOwner = origin(next.get(owner)!, next, newWorlds);
        dx = newOwner.x - oldOwner.x; dy = newOwner.y - oldOwner.y;
        break;
      }
      owner = previous.get(owner)?.parentId;
    }
    const oldOffset = original.data.expandable ? original.data.fitOffset : undefined;
    const newOffset = current.data.expandable ? current.data.fitOffset : undefined;
    if (Math.abs(newWorld.x - (newOffset?.x ?? 0) - oldWorld.x + (oldOffset?.x ?? 0) - dx) > GEOMETRY_EPSILON
      || Math.abs(newWorld.y - (newOffset?.y ?? 0) - oldWorld.y + (oldOffset?.y ?? 0) - dy) > GEOMETRY_EPSILON) return true;
  }
  for (const anchor of after.filter(isLayoutProtected)) {
    for (const peer of after) {
      if (anchor.id === peer.id || anchor.parentId !== peer.parentId || !siblingsOverlap(anchor, peer)) continue;
      const oldAnchor = previous.get(anchor.id), oldPeer = previous.get(peer.id);
      if (!oldAnchor || !oldPeer || oldAnchor.parentId !== oldPeer.parentId || !siblingsOverlap(oldAnchor, oldPeer)) return true;
    }
  }
  return false;
}
