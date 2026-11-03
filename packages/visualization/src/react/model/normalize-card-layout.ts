/** Fit only geometry affected by a card-size migration. */
import type { StageSnapshot } from '../../core/schema/types.ts';
import { projectGraph } from '../../core/projection/index.ts';
import { isLayoutProtected, worldPosition, type CanvasNode } from './grouping.ts';
import { nodeIsVisible } from './hierarchy.ts';
import { containerGrowthCeiling, fitMovedContainers } from './spacing.ts';
import type { StageConflict } from './stage-types.ts';
import type { CanvasNodeView } from './workspace.ts';

/** Preserve saved frames and unrelated positions while accommodating changed card sizes. */
export function normalizeCardLayout(input: readonly CanvasNode[], previous: readonly CanvasNodeView[], stage: StageSnapshot, repairExisting = false): { nodes: CanvasNode[]; conflict?: StageConflict } {
  const old = new Map(previous.map((node) => [node.id, node]));
  const resized = input.filter((node) => {
    const before = old.get(node.id);
    return node.type === 'card' && before && (Math.abs(node.width! - before.width) > 0.001 || Math.abs(node.height! - before.height) > 0.001);
  }).map((node) => node.id);
  const changed = repairExisting ? input.filter((node) => node.type === 'card').map((node) => node.id) : resized;
  if (!changed.length) return { nodes: [...input] };
  const conflict = (ids: string[], message: string): { nodes: CanvasNode[]; conflict: StageConflict } => ({
    nodes: input as CanvasNode[], conflict: { kind: 'no-space', entityIds: ids, message, actions: ['cancel'] },
  });
  for (const id of resized) {
    if (input.find((node) => node.id === id)!.data.frozen) return conflict([id], '冻结节点的尺寸与新卡片规格冲突，请先解冻');
  }
  const oldWorld = (node: CanvasNodeView): { x: number; y: number } => {
    const parent = node.parentId ? old.get(node.parentId) : undefined;
    const origin = parent ? oldWorld(parent) : { x: 0, y: 0 };
    return { x: origin.x + node.position.x, y: origin.y + node.position.y };
  };
  const initial = new Map(input.map((node) => [node.id, node]));
  const protectedNode = (node: CanvasNode) => isLayoutProtected(node) || !!node.data.frozen;
  const protectedOrigins = new Map(input.filter(protectedNode).map((node) => [node.id, worldPosition(node, input)]));
  const contains = (ancestorId: string, child: CanvasNode, byId: Map<string, CanvasNode>): boolean => {
    let parent = child.parentId;
    while (parent) { if (parent === ancestorId) return true; parent = byId.get(parent)?.parentId; }
    return false;
  };
  const descendantsProtected = (node: CanvasNode, nodes: readonly CanvasNode[]) => {
    const byId = new Map(nodes.map((item) => [item.id, item]));
    return protectedNode(node) || nodes.some((item) => protectedNode(item) && contains(node.id, item, byId));
  };
  const protectedConflict = (nodes: readonly CanvasNode[]): StageConflict | undefined => {
    for (const node of nodes) {
      const before = initial.get(node.id), origin = protectedOrigins.get(node.id);
      if (origin) {
        const point = worldPosition(node, nodes);
        if (Math.abs(point.x - origin.x) > 0.001 || Math.abs(point.y - origin.y) > 0.001) return { kind: 'no-space', entityIds: [node.id], message: `调整卡片会移动固定或锁定节点：${node.data.title}`, actions: ['cancel'] };
      }
      if (before && (node.type === 'structure' || node.type === 'cluster')) {
        const ceiling = containerGrowthCeiling(before);
        if (node.width! > Math.max(before.width!, ceiling.width) + 0.001 || node.height! > Math.max(before.height!, ceiling.height) + 0.001) return { kind: 'growth-ceiling', entityIds: [node.id], message: `容器达到扩容上限：${node.data.title}`, actions: ['cancel'] };
      }
    }
    return undefined;
  };
  const area = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const rect = (node: CanvasNode, nodes: readonly CanvasNode[]) => ({ ...worldPosition(node, nodes), w: node.width!, h: node.height! });
  const oldRect = (node: CanvasNode) => { const value = old.get(node.id); return value ? { ...oldWorld(value), w: value.width, h: value.height } : undefined; };
  let nodes = [...input], dirty = new Set(changed);
  for (let iteration = 0; iteration < Math.max(24, input.length * 8); iteration++) {
    const beforeFit = nodes;
    nodes = fitMovedContainers(nodes, [...dirty], { moveNeighbours: false, preserveFrozen: true, anchorFrame: true });
    for (const node of nodes) {
      const prior = beforeFit.find((item) => item.id === node.id)!;
      if (node.position.x !== prior.position.x || node.position.y !== prior.position.y || node.width !== prior.width || node.height !== prior.height) dirty.add(node.id);
    }
    const violation = protectedConflict(nodes);
    if (violation) return { nodes: input as CanvasNode[], conflict: violation };
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const projection = projectGraph(stage, new Set(nodes.filter((node) => node.data.expanded).map((node) => node.id)));
    const visible = nodes.filter((node) => nodeIsVisible(node, nodes, projection));
    let collision: [CanvasNode, CanvasNode] | undefined;
    for (let i = 0; i < visible.length && !collision; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i]!, b = visible[j]!;
      if ((!dirty.has(a.id) && !dirty.has(b.id)) || contains(a.id, b, byId) || contains(b.id, a, byId)) continue;
      const aOld = oldRect(a), bOld = oldRect(b), originalArea = !repairExisting && aOld && bOld ? area(aOld, bOld) : 0;
      if (area(rect(a, nodes), rect(b, nodes)) > originalArea + 0.001) { collision = [a, b]; break; }
    }
    if (!collision) return { nodes };
    const [a, b] = collision, aBox = rect(a, nodes), bBox = rect(b, nodes), aOld = oldRect(a) ?? aBox, bOld = oldRect(b) ?? bBox;
    const dx = (bOld.x + bOld.w / 2) - (aOld.x + aOld.w / 2), dy = (bOld.y + bOld.h / 2) - (aOld.y + aOld.h / 2);
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const ordered = vertical ? (dy >= 0 ? [a, b] : [b, a]) : (dx >= 0 ? [a, b] : [b, a]);
    const low = ordered[0]!, high = ordered[1]!;
    let moved = high, sign = 1;
    if (descendantsProtected(high, nodes)) { moved = low; sign = -1; }
    if (descendantsProtected(moved, nodes)) return conflict([a.id, b.id], `卡片尺寸调整与固定或冻结节点冲突：${a.data.title} / ${b.data.title}`);
    const first = rect(low, nodes), second = rect(high, nodes), distance = vertical ? first.y + first.h - second.y + 16 : first.x + first.w - second.x + 16;
    const amount = Math.max(0, distance) * sign;
    nodes = nodes.map((node) => node.id === moved.id ? { ...node, position: { x: node.position.x + (vertical ? 0 : amount), y: node.position.y + (vertical ? amount : 0) } } : node);
    dirty.add(moved.id);
  }
  return conflict([...dirty], '卡片尺寸调整未找到可行布局，请调整相关节点');
}
