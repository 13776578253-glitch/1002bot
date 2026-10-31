/** Compensate owner-relative frozen geometry when a container grows around existing content. */
import { worldPosition, type CanvasNode } from './grouping.ts';
import type { EdgeRouteSnapshot, FrozenGroupSnapshot } from './workspace.ts';

export function rebaseFrozenGrowth(before: readonly CanvasNode[], after: readonly CanvasNode[], routes: readonly EdgeRouteSnapshot[], groups: readonly FrozenGroupSnapshot[]): { routes: EdgeRouteSnapshot[]; groups: FrozenGroupSnapshot[] } {
  const offsets = new Map<string, {x:number; y:number}>();
  const nextGroups = groups.map((group) => {
    const oldRoot = before.find((node) => node.id === group.rootId)!;
    const root = after.find((node) => node.id === group.rootId)!;
    const a = worldPosition(oldRoot, before), b = worldPosition(root, after);
    const resized=root.width!==oldRoot.width||root.height!==oldRoot.height;
    const delta = resized ? {x:b.x-a.x,y:b.y-a.y} : { x: (root.data.fitOffset?.x??0)-(oldRoot.data.fitOffset?.x??0), y: (root.data.fitOffset?.y??0)-(oldRoot.data.fitOffset?.y??0) };
    if (delta.x || delta.y) offsets.set(group.rootId, delta);
    const dimensionsChanged = [group.rootId, ...group.memberIds].some((id) => {
      const old = before.find((node) => node.id === id), current = after.find((node) => node.id === id);
      return old && current && current.type !== 'card' && (old.width !== current.width || old.height !== current.height);
    });
    if (!delta.x && !delta.y && !dimensionsChanged) return group;
    const oldProtected = group.protectedFrame ?? { x: 0, y: 0, width: group.worldBounds.w, height: group.worldBounds.h };
    const frames = { ...group.frozenFrames };
    for (const id of [group.rootId, ...group.memberIds]) {
      const node = after.find((item) => item.id === id);
      if (node && node.type !== 'card') frames[id] = { width: node.width!, height: node.height! };
    }
    return { ...group,
      worldBounds: { x: b.x, y: b.y, w: root.width!, h: root.height! },
      frozenFrames: frames,
      protectedFrame: { ...oldProtected, x: oldProtected.x - delta.x, y: oldProtected.y - delta.y },
    };
  });
  if(!offsets.size&&nextGroups.every((group,index)=>group===groups[index]))return {routes:routes as EdgeRouteSnapshot[],groups:groups as FrozenGroupSnapshot[]};
  const nextRoutes = routes.map((route) => {
    const delta = route.space.kind === 'owner' ? offsets.get(route.space.ownerId) : undefined;
    const boundaries = route.frozenBoundaries?.map((boundary) => {
      const shift = offsets.get(boundary.ownerId);
      return shift ? { ...boundary, points: boundary.points.map((point) => ({ x: point.x - shift.x, y: point.y - shift.y })) } : boundary;
    });
    return { ...route,
      ...(delta ? { points: route.points.map((point) => ({ x: point.x - delta.x, y: point.y - delta.y })), ...(route.label ? { label: { ...route.label, x: route.label.x - delta.x, y: route.label.y - delta.y } } : {}) } : {}),
      ...(boundaries ? { frozenBoundaries: boundaries } : {}),
    };
  });
  return { routes: nextRoutes, groups: nextGroups };
}
