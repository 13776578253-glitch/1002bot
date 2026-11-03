/** Authored movement fits affected ancestors while preserving unrelated node positions. */
import type { StageSnapshot } from '../../core/schema/types.ts';
import { CARD_SIZE, detailCardSize, layoutProtectionConflict, structureHeaderHeight, worldPosition, type CanvasNode } from './grouping.ts';
import { projectGraph } from '../../core/projection/index.ts';
import type { StageConflict } from './stage-types.ts';
import { alignNodeRect, type AlignmentGuide } from './constraints.ts';
import { containerGrowthCeiling, fitMovedContainers } from './spacing.ts';
import { preferredEditedSize } from './layout-intent.ts';

export function manualGeometryConflict(nodes: readonly CanvasNode[], stage: StageSnapshot, ignored: ReadonlySet<string> = new Set()): StageConflict | undefined {
  const projection = projectGraph(stage, new Set(nodes.filter((node) => node.data.expanded).map((node) => node.id)));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestor = (id: string, child: CanvasNode): boolean => {
    let parent = child.parentId;
    while (parent) { if (parent === id) return true; parent = byId.get(parent)?.parentId; }
    return false;
  };
  const visible = nodes.filter((node) => !ignored.has(node.id) && ![...ignored].some((id) => ancestor(id, node)) && (projection.nodeById.has(node.id) || node.type === 'cluster' && nodes.some((child) => projection.nodeById.has(child.id) && ancestor(node.id, child))));
  for (const node of visible) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && (node.position.x < 24 || node.position.y < (parent.type === 'cluster' ? 60 : structureHeaderHeight(parent) + 4)
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

/** Four-way fitting compensates child coordinates and never pushes sibling components. */
export function fitAuthoredLayout(before: readonly CanvasNode[], proposed: readonly CanvasNode[], changedIds: readonly string[], stage: StageSnapshot, movedRoots: ReadonlySet<string> = new Set(), ignored: ReadonlySet<string> = new Set(), preserveFrames = false): { nodes: CanvasNode[]; conflict?: StageConflict } {
  const fitted = fitMovedContainers(proposed, changedIds, { moveNeighbours: false, ignored, preserveFrozen: true, preserveFrames, anchorFrame: true });
  for (const old of before) {
    const next = fitted.find((node) => node.id === old.id)!;
    if (next.width === old.width && next.height === old.height && next.position.x === old.position.x && next.position.y === old.position.y) continue;
    if (old.data.frozen) {
      let owner: CanvasNode | undefined = old;
      while (owner && !movedRoots.has(owner.id)) owner = before.find((node) => node.id === owner!.parentId);
      const oldOrigin = worldPosition(old, before), nextOrigin = worldPosition(next, fitted);
      const oldOwner = owner ? worldPosition(owner, before) : { x: 0, y: 0 };
      const nextOwner = owner ? worldPosition(fitted.find((node) => node.id === owner.id)!, fitted) : { x: 0, y: 0 };
      if (old.width !== next.width || old.height !== next.height || Math.abs(nextOrigin.x - oldOrigin.x - nextOwner.x + oldOwner.x) > 0.000001 || Math.abs(nextOrigin.y - oldOrigin.y - nextOwner.y + oldOwner.y) > 0.000001) return { nodes: before as CanvasNode[], conflict: { kind: 'frozen-violation', entityIds: [old.id], message: `冻结边界保持不变：${old.data.title}`, actions: ['unfreeze', 'cancel'] } };
    }
    if (next.type !== 'structure' && next.type !== 'cluster') continue;
    const ceiling = containerGrowthCeiling(!old.data.expanded && next.data.expanded && old.data.authored?.expandedSize ? { ...old, ...old.data.authored.expandedSize } : old);
    if (next.width! > Math.max(old.width!, ceiling.width) || next.height! > Math.max(old.height!, ceiling.height)) return { nodes: before as CanvasNode[], conflict: { kind: 'growth-ceiling', entityIds: [old.id], message: `容器达到扩容上限：${old.data.title}`, actions: ['cancel'] } };
  }
  const conflict = manualGeometryConflict(fitted, stage, ignored);
  if (conflict) return { nodes: before as CanvasNode[], conflict };
  if (layoutProtectionConflict(before, fitted, movedRoots)) return { nodes: before as CanvasNode[], conflict: { kind: 'no-space', entityIds: [...movedRoots], message: '容器调整会改变固定节点的锚点', actions: ['cancel'] } };
  return { nodes: fitted };
}

/** Rebuild fitted frames after edit intents and expansion have been merged; frozen geometry remains literal. */
export function deriveAuthoredLayout(input: readonly CanvasNode[], stage: StageSnapshot): { nodes: CanvasNode[]; conflict?: StageConflict } {
  const proposed = input.map((node) => {
    if (node.data.frozen) return node;
    const preference = preferredEditedSize(node);
    const natural = node.type === 'card' ? node.data.expanded ? detailCardSize(node.data.details?.length ?? 0) : CARD_SIZE : preference ?? (node.data.expanded ? node.data.authored?.expandedSize : node.data.authored?.collapsedSize) ?? { width: node.width!, height: node.height! };
    const { reflowOrigin: _reflow, expansionSizes: _sizes, ...data } = node.data;
    return { ...node, width: natural.width, height: natural.height, measured: { width: natural.width, height: natural.height }, style: { ...node.style, width: natural.width, height: natural.height }, data: { ...data, contentWidth: natural.width, contentHeight: natural.height } };
  });
  const projection = projectGraph(stage, new Set(input.filter((node) => node.data.expanded).map((node) => node.id)));
  const changed = input.filter((node) => projection.nodeById.has(node.id) || node.type === 'cluster').map((node) => node.id);
  return fitAuthoredLayout(input, proposed, changed, stage);
}

export function moveAuthoredNodes(before: readonly CanvasNode[], proposed: readonly CanvasNode[], movedIds: readonly string[], stage: StageSnapshot): CanvasNode[] {
  return moveAuthoredSelection(before, proposed, movedIds, stage).nodes;
}

export function moveAlignedAuthoredNodes(before: readonly CanvasNode[], proposed: readonly CanvasNode[], movedIds: readonly string[], stage: StageSnapshot, zoom: number, visible: ReadonlySet<string>): { nodes: CanvasNode[]; guides: AlignmentGuide[]; conflict?: StageConflict } {
  return moveAuthoredSelection(before, proposed, movedIds, stage, { zoom, visible });
}

function moveAuthoredSelection(before: readonly CanvasNode[], proposed: readonly CanvasNode[], movedIds: readonly string[], stage: StageSnapshot, alignment?: { zoom: number; visible: ReadonlySet<string> }): { nodes: CanvasNode[]; guides: AlignmentGuide[]; conflict?: StageConflict } {
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
    const fitted = fitAuthoredLayout(before, snapped, [...rootIds], stage, rootIds, new Set(), true);
    if (!fitted.conflict) return { nodes: fitted.nodes, guides: snap.guides };
  }
  const fitted = fitAuthoredLayout(before, next, [...rootIds], stage, rootIds, new Set(), true);
  if (!fitted.conflict) return { nodes: fitted.nodes, guides: [] };
  let low = 0, high = 1, accepted = before as CanvasNode[];
  for (let step = 0; step < 18; step++) {
    const fraction = (low + high) / 2;
    const trial = next.map((node) => rootIds.has(node.id) ? { ...node, position: { x: previous.get(node.id)!.position.x + delta.x * fraction, y: previous.get(node.id)!.position.y + delta.y * fraction } } : node);
    const result = fitAuthoredLayout(before, trial, [...rootIds], stage, rootIds, new Set(), true);
    if (result.conflict) high = fraction; else { low = fraction; accepted = result.nodes; }
  }
  return { nodes: accepted, guides: [], ...(accepted === before && fitted.conflict ? { conflict: fitted.conflict } : {}) };
}
