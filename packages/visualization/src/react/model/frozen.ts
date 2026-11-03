/** Single-layer frozen subgraphs; members and their internal routes stay geometrically stable. */
import type { StageSnapshot } from '../../core/schema/types.ts';
import { CARD_SIZE, groupSelection, layoutProtectionConflict, worldPosition, type CanvasNode } from './grouping.ts';
import { toggleHierarchy } from './hierarchy.ts';
import type { FrozenBoundaryPort, FrozenGroupSnapshot } from './workspace.ts';
import type { StageConflict } from './stage-types.ts';

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
 * Freeze a canonical container subtree or a multi-selection.
 *
 * A single collapsible root is expanded first so its frame encloses the subtree;
 * freezing then fixes the root and locks every descendant without resizing.
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

/** Thaw a frozen group; the visual container remains until the user dissolves it. */
export function unfreezeGroup(nodes: readonly CanvasNode[], group: FrozenGroupSnapshot): CanvasNode[] {
  const ids = new Set([group.rootId, ...group.memberIds]);
  return nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    const { frozen: _frozen, ...data } = node.data;
    return { ...node, data: { ...data, layoutMode: group.previousModes?.[node.id] ?? 'free' } };
  });
}

/** Read-only expansion keeps the container frame and all descendant geometry unchanged. */
export function toggleFrozenExpansion(nodes: readonly CanvasNode[], rootId: string, expanded: boolean, groups: readonly FrozenGroupSnapshot[] = []): CanvasNode[] {
  const next = nodes.map((node) => {
    if (node.id !== rootId || node.type === 'cluster' || !node.data.expandable) return node;
    const { dragHandle: _handle, ...base } = node;
    const frame = groups.find((group) => group.rootId === rootId || group.memberIds.includes(rootId))?.frozenFrames?.[rootId];
    const nextSize = frame ? (expanded ? frame : CARD_SIZE) : { width: node.width!, height: node.height! };
    return {
      ...base,
      type: expanded ? 'structure' : 'card',
      ...nextSize, measured: { ...nextSize }, style: { ...node.style, ...nextSize },
      ...(expanded ? { dragHandle: '.structure-header' } : {}),
      data: { ...node.data, expanded },
    };
  });
  return layoutProtectionConflict(nodes, next) ? nodes as CanvasNode[] : next;
}

/** Reconcile persisted ledgers with restored nodes; missing members drop the whole group. */
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
