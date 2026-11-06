/** Single-layer frozen subgraphs; members and their internal routes stay geometrically stable. */
import type { StageSnapshot } from '../../../core/schema/types.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from '../layout/node.ts';
import { groupSelection } from '../layout/grouping.ts';
import { layoutProtectionConflict } from '../layout/protection.ts';
import { toggleHierarchy } from '../layout/hierarchy.ts';
import { applyFrozenFrame } from '../layout/frozen-frame.ts';
import type { FrozenBoundaryPort, FrozenGroupSnapshot } from '../contracts/snapshot-types.ts';
import type { StageConflict } from '../contracts/stage-types.ts';

export interface FreezeInput {
  nodes: readonly CanvasNode[];
  rootIds: readonly string[];
  groupId: string;
  stage?: StageSnapshot;
  frozenGroups?: readonly FrozenGroupSnapshot[];
  preserveExpansion?: boolean;
}

export type FreezeResult =
  | { ok: true; nodes: CanvasNode[]; group: FrozenGroupSnapshot }
  | { ok: false; conflict: StageConflict };

const size = (node: CanvasNode) => ({ w: node.width ?? CARD_SIZE.width, h: node.height ?? CARD_SIZE.height });

function descendants(nodes: readonly CanvasNode[], rootId: string): string[] {
  const result = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && (node.parentId === rootId || result.has(node.parentId)) && !result.has(node.id)) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return [...result];
}

function center(node: CanvasNode, nodes: readonly CanvasNode[]): { x: number; y: number } {
  const origin = worldPosition(node, nodes), extent = size(node);
  return { x: origin.x + extent.w / 2, y: origin.y + extent.h / 2 };
}

function boundaryPorts(rootId: string, memberIds: readonly string[], nodes: readonly CanvasNode[], stage: StageSnapshot | undefined): FrozenBoundaryPort[] {
  if (!stage) return [];
  const inside = new Set([rootId, ...memberIds]);
  const ports: FrozenBoundaryPort[] = [];
  for (const edge of stage.graph.edges) {
    const sourceIn = inside.has(edge.source.nodeId), targetIn = inside.has(edge.target.nodeId);
    if (sourceIn === targetIn) continue;
    const internalId = sourceIn ? edge.source.nodeId : edge.target.nodeId;
    const externalId = sourceIn ? edge.target.nodeId : edge.source.nodeId;
    const internal = nodes.find((node) => node.id === internalId), external = nodes.find((node) => node.id === externalId);
    if (!internal || !external) continue;
    const a = center(internal, nodes), b = center(external, nodes);
    const side = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? 'right' : 'left') : (b.y >= a.y ? 'bottom' : 'top');
    const handle = side === 'right' ? 'return-out' : side === 'left' ? 'left-out' : side === 'top' ? 'top-out' : 'out';
    ports.push({ edgeId: edge.id, nodeId: internalId, side, handle });
  }
  return ports;
}

function overlapsExisting(groups: readonly FrozenGroupSnapshot[], ids: ReadonlySet<string>): FrozenGroupSnapshot | undefined {
  return groups.find((group) => [group.rootId, ...group.memberIds].some((id) => ids.has(id)));
}

/**
 * 冻结一个规范容器子树或多项选择。
 * 单根容器会先展开，使框包住整个子树；随后固定根节点并锁定所有后代，不再调整尺寸。
 */
export function freezeSelection(input: FreezeInput): FreezeResult {
  if (!input.rootIds.length) return { ok: false, conflict: { kind: 'frozen-violation', entityIds: [], message: '没有可冻结的节点', actions: ['cancel'] } };
  let working: CanvasNode[] = input.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } }));
  let rootId = input.rootIds[0]!;
  if (input.rootIds.length > 1) {
    const selected = new Set(input.rootIds);
    working = working.map((node) => ({ ...node, selected: selected.has(node.id) }));
    working = groupSelection(working, input.groupId);
    const grouped = working.find((node) => node.id === input.groupId);
    if (!grouped) return { ok: false, conflict: { kind: 'frozen-violation', entityIds: input.rootIds, message: '选中节点无法聚合为冻结组', actions: ['cancel'] } };
    rootId = input.groupId;
  }

  let root = working.find((node) => node.id === rootId);
  if (!root) return { ok: false, conflict: { kind: 'frozen-violation', entityIds: [rootId], message: '冻结根节点不存在', actions: ['cancel'] } };
  if (root.data.expandable && !root.data.expanded && input.stage && !input.preserveExpansion) {
    const modes = new Map(working.map((node) => [node.id, node.data.layoutMode]));
    const guarded = working.map((node) => ({ ...node, data: { ...node.data, layoutMode: node.data.layoutMode === 'locked' ? 'locked' as const : 'fixed' as const } }));
    const expanded = toggleHierarchy(guarded, rootId, input.stage);
    if (expanded === guarded) return { ok: false, conflict: { kind: 'frozen-violation', entityIds: [rootId], message: '冻结前无法展开目标容器而保持已有节点位置', actions: ['cancel'] } };
    working = expanded.map((node) => {
      const mode = modes.get(node.id);
      const { layoutMode: _mode, ...data } = node.data;
      return { ...node, data: { ...data, ...(mode ? { layoutMode: mode } : {}) } };
    });
    root = working.find((node) => node.id === rootId)!;
  }
  const memberIds = descendants(working, rootId);
  const allIds = new Set([rootId, ...memberIds]);
  const existing = overlapsExisting(input.frozenGroups ?? [], allIds);
  if (existing) return { ok: false, conflict: { kind: 'frozen-violation', entityIds: [rootId], containerId: existing.id, message: '冻结组不能重叠或嵌套', actions: ['unfreeze', 'cancel'] } };

  const origin = worldPosition(root, working), extent = size(root);
  const group: FrozenGroupSnapshot = {
    id: input.groupId,
    rootId,
    memberIds,
    worldBounds: { x: origin.x, y: origin.y, w: extent.w, h: extent.h },
    boundaryPorts: boundaryPorts(rootId, memberIds, working, input.stage),
    createdAt: new Date().toISOString(),
    previousModes: Object.fromEntries(working.filter((node) => allIds.has(node.id)).map((node) => [node.id, node.data.layoutMode ?? 'free'])),
  };
  working = working.map((node) => {
    if (node.id === rootId) return { ...node, data: { ...node.data, frozen: true, layoutMode: 'fixed' } };
    if (allIds.has(node.id)) return { ...node, data: { ...node.data, frozen: true, layoutMode: 'locked' } };
    return node;
  });
  return { ok: true, nodes: working, group };
}

/** 解冻冻结组；视觉容器保留到用户解散。 */
export function unfreezeGroup(nodes: readonly CanvasNode[], group: FrozenGroupSnapshot): CanvasNode[] {
  const ids = new Set([group.rootId, ...group.memberIds]);
  return nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    const { frozen: _frozen, ...data } = node.data;
    return { ...node, data: { ...data, layoutMode: group.previousModes?.[node.id] ?? 'free' } };
  });
}

/** 冻结账本提供展开框，容器切换保持受保护锚点。 */
export function toggleFrozenExpansion(nodes: readonly CanvasNode[], rootId: string, expanded: boolean, groups: readonly FrozenGroupSnapshot[] = []): CanvasNode[] {
  return applyFrozenFrame(nodes, rootId, expanded, frozenGroupFor(groups, rootId)?.frozenFrames?.[rootId]);
}

/** 让持久化账本与恢复后的节点对齐；成员缺失则丢弃整组。 */
export function restoreFrozenGroups(nodes: readonly CanvasNode[], groups: readonly FrozenGroupSnapshot[]): { nodes: CanvasNode[]; groups: FrozenGroupSnapshot[]; conflicts: StageConflict[] } {
  const ids = new Set(nodes.map((node) => node.id));
  const kept = [...groups];
  const conflicts: StageConflict[] = groups.flatMap((group) => {
    const missing = [group.rootId, ...group.memberIds].filter((id) => !ids.has(id));
    return missing.length ? [{ kind: 'merge-conflict' as const, entityIds: missing, containerId: group.id, message: '冻结组成员已不存在，请先解冻或处理来源变更', actions: ['unfreeze' as const, 'cancel' as const] }] : [];
  });
  const frozen = new Map<string, { root: boolean }>();
  for (const group of kept) {
    frozen.set(group.rootId, { root: true });
    for (const id of group.memberIds) frozen.set(id, { root: false });
  }
  const restored = nodes.map((node) => {
    const membership = frozen.get(node.id);
    if (!membership) {
      const { frozen: _frozen, ...data } = node.data;
      return { ...node, data };
    }
    const layoutMode = membership.root ? ('fixed' as const) : ('locked' as const);
    return { ...node, data: { ...node.data, frozen: true, layoutMode } };
  });
  return { nodes: restored, groups: kept, conflicts };
}

export function frozenGroupFor(groups: readonly FrozenGroupSnapshot[], id: string | undefined): FrozenGroupSnapshot | undefined {
  if (!id) return undefined;
  return groups.find((group) => group.rootId === id || group.memberIds.includes(id));
}
