/** Atomic stage transition: inherit confirmed layout, place differences, then commit or fail. */
import { diffStages } from '../../core/graph/diff.ts';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from './grouping.ts';
import { baselineNodes, hierarchyProjection } from './hierarchy.ts';
import { restoreFrozenGroups } from './frozen.ts';
import { rebaseFrozenGrowth } from './frozen-growth.ts';
import { worldRoutePoints, endpointFingerprint } from './edge-routes.ts';
import { createDiagramGeometry, pathIsClear, segmentCrossesRect } from './routing.ts';
import { DiagramRouteCache } from './route-cache.ts';
import { aggregateProjectedEdges } from './display-edges.ts';
import { placeAddedNodes } from './placement.ts';
import type { StageConflict } from './stage-types.ts';
import {
  captureContent,
  restoreNodeViews,
  type CanvasBaselineContent,
  type CanvasNodeView,
  type EdgeRouteSnapshot,
  type FrozenGroupSnapshot,
  type StageTransitionRecord,
} from './workspace.ts';
import type { UserGraphOverlay } from './overlay.ts';
import { captureDisplayRoutes, retainedDisplayRoutes } from './display-route-snapshots.ts';
import type { DisplayRouteSnapshot } from './workspace.ts';

export interface StageViewState {
  nodes: CanvasNode[];
  edgeRoutes: EdgeRouteSnapshot[];
  frozenGroups: FrozenGroupSnapshot[];
  overlay?: UserGraphOverlay;
  displayRoutes?: DisplayRouteSnapshot[];
}

export interface StageTransitionInput {
  source: VisualizationBaseline;
  target: VisualizationBaseline;
  sourceContent: CanvasBaselineContent;
  targetSaved?: CanvasBaselineContent;
  targetSavedRevision?: string;
}

export interface StageTransitionSuccess {
  ok: true;
  base: CanvasBaselineContent;
  content: CanvasBaselineContent;
  state: StageViewState;
  record: StageTransitionRecord;
}

export interface StageTransitionFailure {
  ok: false;
  base: CanvasBaselineContent;
  candidate: StageViewState;
  conflicts: StageConflict[];
}

export type StageTransitionResult = StageTransitionSuccess | StageTransitionFailure;

const revisionOf = (baseline: VisualizationBaseline): string => baseline.stage.graph.revision ?? baseline.stage.id;

function mapReplacementViews(target: VisualizationBaseline, views: readonly CanvasNodeView[]): { views: CanvasNodeView[]; mappedIds: Set<string> } {
  const byId = new Map(views.map((view) => [view.id, view]));
  const mapped = [...views];
  const mappedIds = new Set<string>();
  for (const node of target.stage.graph.nodes) {
    if (node.id === target.stage.graph.rootId || byId.has(node.id)) continue;
    const mark = target.nodeChanges[node.id];
    if (mark?.kind !== 'replaced' || !mark.previousId) continue;
    const previous = byId.get(mark.previousId);
    if (!previous) continue;
    mapped.push({ ...structuredClone(previous), id: node.id });
    mappedIds.add(node.id);
  }
  return { views: mapped, mappedIds };
}

function inheritRoutes(content: CanvasBaselineContent, target: VisualizationBaseline): EdgeRouteSnapshot[] {
  const nodeIds = new Set(target.stage.graph.nodes.map((node) => node.id));
  const edgeIds = new Set(target.stage.graph.edges.map((edge) => edge.id));
  return content.edgeRoutes
    .filter((route) => edgeIds.has(route.canonicalEdgeId) && nodeIds.has(route.source.nodeId) && nodeIds.has(route.target.nodeId))
    .map((route) => structuredClone(route));
}

function ancestry(nodes: readonly CanvasNode[], id: string): string[] {
  const chain: string[] = [];
  let parent = nodes.find((node) => node.id === id)?.parentId;
  while (parent) {
    chain.unshift(parent);
    parent = nodes.find((node) => node.id === parent)?.parentId;
  }
  return chain;
}

function routeConflicts(nodes: readonly CanvasNode[], visible: ReadonlySet<string>, routes: readonly EdgeRouteSnapshot[]): StageConflict[] {
  const conflicts: StageConflict[] = [];
  for (const route of routes) {
    if (route.state !== 'locked') continue;
    const points = worldRoutePoints(route, nodes);
    if (!points) {
      conflicts.push({ kind: 'locked-route', entityIds: [route.canonicalEdgeId], message: '锁定路径的坐标空间已不存在', actions: ['unfreeze', 'cancel'] });
      continue;
    }
    const ancestors = new Set([...ancestry(nodes, route.source.nodeId), ...ancestry(nodes, route.target.nodeId)]);
    for (const node of nodes) {
      if (!visible.has(node.id) || node.id === route.source.nodeId || node.id === route.target.nodeId || ancestors.has(node.id)) continue;
      const origin = worldPosition(node, nodes);
      const rect = node.type === 'card'
        ? { x: origin.x, y: origin.y, w: node.width ?? CARD_SIZE.width, h: node.height ?? CARD_SIZE.height }
        : { x: origin.x, y: origin.y, w: node.width ?? CARD_SIZE.width, h: node.type === 'structure' ? 68 : 54 };
      for (let index = 1; index < points.length; index += 1) {
        if (segmentCrossesRect(points[index - 1]!, points[index]!, rect)) {
          conflicts.push({ kind: 'locked-route', entityIds: [route.canonicalEdgeId, node.id], message: '锁定路径与新布局节点相交', actions: ['move-free-nodes', 'unfreeze', 'cancel'] });
          break;
        }
      }
    }
  }
  return conflicts;
}

function protectedConflicts(before: readonly CanvasNode[], after: readonly CanvasNode[], groups: readonly FrozenGroupSnapshot[], inherited: ReadonlySet<string>): StageConflict[] {
  for (const oldNode of before) {
    if (!inherited.has(oldNode.id)) continue;
    const nextNode = after.find((node) => node.id === oldNode.id);
    if (!nextNode) continue;
    const oldWorld = worldPosition(oldNode, before), nextWorld = worldPosition(nextNode, after);
    if (oldNode.data.expandable) {
      oldWorld.x -= oldNode.data.fitOffset?.x ?? 0; oldWorld.y -= oldNode.data.fitOffset?.y ?? 0;
      nextWorld.x -= nextNode.data.fitOffset?.x ?? 0; nextWorld.y -= nextNode.data.fitOffset?.y ?? 0;
    }
    if (Math.abs(oldWorld.x - nextWorld.x) > 0.001 || Math.abs(oldWorld.y - nextWorld.y) > 0.001) {
      return [{ kind: 'merge-conflict', entityIds: [oldNode.id], message: '增量布局改变了已确认节点的位置', actions: ['move-free-nodes', 'cancel'] }];
    }
  }
  for (const group of groups) {
    for (const id of [group.rootId, ...group.memberIds]) {
      const oldNode = before.find((node) => node.id === id), nextNode = after.find((node) => node.id === id);
      if (!oldNode || !nextNode) continue;
      const oldWorld = worldPosition(oldNode, before), nextWorld = worldPosition(nextNode, after);
      if (oldNode.data.expandable) {
        oldWorld.x -= oldNode.data.fitOffset?.x ?? 0; oldWorld.y -= oldNode.data.fitOffset?.y ?? 0;
        nextWorld.x -= nextNode.data.fitOffset?.x ?? 0; nextWorld.y -= nextNode.data.fitOffset?.y ?? 0;
      }
      if (Math.abs(oldWorld.x - nextWorld.x) > 0.001 || Math.abs(oldWorld.y - nextWorld.y) > 0.001) {
        return [{ kind: 'frozen-violation', entityIds: [id], containerId: group.id, message: '阶段切换改变了冻结子图的内部位置', actions: ['unfreeze', 'cancel'] }];
      }
    }
  }
  return [];
}

/**
 * Build the target stage layout from the confirmed source layout.
 *
 * The function never mutates its inputs. A failure still returns the candidate
 * layout so the caller can render a read-only preview without committing it.
 */
export function planStageTransition(input: StageTransitionInput): StageTransitionResult {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const target = input.target;
  const origin = input.targetSaved ?? input.sourceContent;
  const targetIds = new Set(target.stage.graph.nodes.map((node) => node.id));
  const sourceParents = new Map(input.source.stage.graph.nodes.map((node) => [node.id, node.parentId]));
  const targetParents = new Map(target.stage.graph.nodes.map((node) => [node.id, node.parentId]));
  const frozenConflicts: StageConflict[] = [];
  for (const group of origin.frozenGroups) {
    const changed = [group.rootId, ...group.memberIds].filter((id) => sourceParents.has(id) && (!targetIds.has(id) || (!input.targetSaved && sourceParents.get(id) !== targetParents.get(id))));
    if (changed.length) frozenConflicts.push({ kind: 'merge-conflict', entityIds: changed, containerId: group.rootId, message: '冻结子图成员被删除或更改归属，请先解冻', actions: ['unfreeze', 'cancel'] });
  }
  const sourceViews = input.targetSaved ? input.targetSaved.nodes : input.sourceContent.nodes;
  const mapped = mapReplacementViews(target, sourceViews);
  const restoredBase = restoreNodeViews(target, baselineNodes(target), mapped.views);
  const baseRoutes = inheritRoutes(input.targetSaved ?? input.sourceContent, target);
  const reconciled = restoreFrozenGroups(restoredBase, structuredClone(origin.frozenGroups));
  const baseFrozen = reconciled.groups;
  const base = captureContent(reconciled.nodes, baseRoutes, baseFrozen);

  const inherited = new Set(mapped.views.map((view) => view.id));
  for (const id of mapped.mappedIds) {
    const view = mapped.views.find((item) => item.id === id)!;
    const node = target.stage.graph.nodes.find((item) => item.id === id)!;
    const parent = node.parentId === target.stage.graph.rootId ? undefined : node.parentId;
    if (view.parentId !== parent) inherited.delete(id);
  }
  const diff = input.targetSaved
    ? undefined
    : diffStages(input.source.stage, target.stage, { nodeChanges: target.nodeChanges, edgeChanges: target.edgeChanges });
  const diffAdded = new Set(diff?.nodes.added ?? []);
  const diffReplaced = new Set((diff?.nodes.replaced ?? []).map((pair) => pair.to));
  const addedNodeIds = target.stage.graph.nodes
    .filter((node) => node.id !== target.stage.graph.rootId && !inherited.has(node.id))
    .filter((node) => !diff || diffAdded.has(node.id) || diffReplaced.has(node.id))
    .map((node) => node.id);

  let working = reconciled.nodes;
  const conflicts: StageConflict[] = [...frozenConflicts, ...reconciled.conflicts];
  for (const route of baseRoutes) {
    const edge = target.stage.graph.edges.find((item) => item.id === route.canonicalEdgeId)!;
    if (route.state === 'locked' && endpointFingerprint(edge) !== route.endpointFingerprint) conflicts.push({ kind: 'locked-route', entityIds: [route.canonicalEdgeId], message: '来源更改了锁定路径的端点或端口，请先解除路径锁定', actions: ['unfreeze', 'cancel'] });
  }
  const projection = hierarchyProjection(working, target.stage);
  const placement = placeAddedNodes({
    nodes: working,
    stage: target.stage,
    projection,
    addedNodeIds,
    ...(target.positions ? { preferredPositions: target.positions } : {}),
    frozenGroups: baseFrozen,
    routes: baseRoutes,
    reservedPaths: (origin.displayRoutes ?? []).filter((route) => route.memberIds.every((id) => target.stage.graph.edges.some((edge) => edge.id === id))),
  });
  working = placement.nodes;
  conflicts.push(...placement.conflicts);


  const eligibleFrozen = baseFrozen.filter((group) => [group.rootId, ...group.memberIds].every((id) => reconciled.nodes.some((node) => node.id === id) && working.some((node) => node.id === id)));
  const grown = rebaseFrozenGrowth(reconciled.nodes, working, baseRoutes, eligibleFrozen);
  const activeRoutes = grown.routes;
  const activeFrozen = baseFrozen.map((group) => grown.groups.find((item) => item.id === group.id) ?? group);
  const protectedIssues = protectedConflicts(reconciled.nodes, working, baseFrozen, inherited);
  conflicts.push(...protectedIssues);
  const finalProjection = hierarchyProjection(working, target.stage);
  conflicts.push(...routeConflicts(working, new Set(finalProjection.nodes.map((node) => node.id)), activeRoutes));
  let displayRoutes: DisplayRouteSnapshot[] = [];
  if (!conflicts.length) {
    const visibleEdges = aggregateProjectedEdges(finalProjection, target.edgeChanges);
    const reserved = activeRoutes.flatMap((route) => {
      if (route.state !== 'locked') return [];
      const points = worldRoutePoints(route, working);
      return points ? [{ edgeId: route.canonicalEdgeId, points }] : [];
    });
    const inputs = visibleEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text }));
    const retained = retainedDisplayRoutes(working, finalProjection, visibleEdges, origin.displayRoutes, reserved);
    const routes = new DiagramRouteCache().update(working, finalProjection, inputs, reserved, retained);
    const geometry = createDiagramGeometry(working, finalProjection, reserved);
    for (const edge of inputs) {
      const route = routes.get(edge.id);
      if (!route || !pathIsClear(route.points, geometry, edge.source, edge.target, edge.id)) {
        conflicts.push({ kind: 'locked-route', entityIds: [edge.id], message: '连接无法避开当前节点或锁定路径', actions: ['unfreeze', 'cancel'] });
      }
    }
    displayRoutes = captureDisplayRoutes(working, finalProjection, visibleEdges, routes);
  }
  const state: StageViewState = { nodes: working, edgeRoutes: activeRoutes, frozenGroups: activeFrozen, displayRoutes };
  if (conflicts.length) return { ok: false, base, candidate: state, conflicts };

  const content = captureContent(working, activeRoutes, activeFrozen, undefined, displayRoutes);
  const record: StageTransitionRecord = {
    fromStageId: input.source.id,
    toStageId: target.id,
    sourceRevision: revisionOf(input.source),
    targetRevision: revisionOf(target),
    startedAt,
    durationMs: performance.now() - started,
    placements: placement.placements,
    expanded: placement.expanded,
  };
  return { ok: true, base, content, state, record };
}
