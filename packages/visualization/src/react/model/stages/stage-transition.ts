/** Atomic stage transition: inherit confirmed layout, place differences, then commit or fail. */
import type { VisualizationBaseline } from '../../../core/schema/baseline.ts';
import { CARD_SIZE, structureHeaderHeight, worldPosition, type CanvasNode } from '../layout/node.ts';
import { baselineNodes } from '../layout/hierarchy.ts';
import { hierarchyProjection } from '../layout/visibility.ts';
import { restoreFrozenGroups } from '../freeze/frozen.ts';
import { rebaseFrozenGrowth } from '../freeze/frozen-growth.ts';
import { worldRoutePoints, endpointFingerprint } from '../routing/edge-routes.ts';
import { validateFrozenConnections } from '../freeze/blackbox-routes.ts';
import { segmentCrossesRect } from '../routing/routing.ts';
import { resolveRoutes } from '../routing/resolve-routes.ts';
import { DiagramRouteCache } from '../routing/route-cache.ts';
import { aggregateProjectedEdges } from '../routing/display-edges.ts';
import { placeAddedNodes } from '../layout/placement.ts';
import type { StageConflict } from '../contracts/stage-types.ts';
import { captureContent, restoreNodeViews } from '../workspace/workspace.ts';
import { type CanvasBaselineContent, type CanvasNodeView, type EdgeRouteSnapshot, type FrozenGroupSnapshot, type StageTransitionRecord } from '../contracts/snapshot-types.ts';
import type { UserGraphOverlay } from '../contracts/overlay.ts';
import { captureDisplayRoutes } from '../routing/display-route-snapshots.ts';
import type { DisplayRouteSnapshot } from '../contracts/snapshot-types.ts';
import type { EdgeLabelPin } from '../contracts/snapshot-types.ts';
import { retainLabelPins } from '../labels/label-pins.ts';

export interface StageViewState {
  nodes: CanvasNode[];
  edgeRoutes: EdgeRouteSnapshot[];
  frozenGroups: FrozenGroupSnapshot[];
  overlay?: UserGraphOverlay;
  displayRoutes?: DisplayRouteSnapshot[];
  labelPins?: EdgeLabelPin[];
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
        : { x: origin.x, y: origin.y, w: node.width ?? CARD_SIZE.width, h: node.type === 'structure' ? structureHeaderHeight(node) : 54 };
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
 * 从已确认的来源布局构建目标阶段布局。
 * 不修改输入；失败时仍返回候选布局，调用方可以只读预览而不提交。
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
  for(const route of origin.edgeRoutes)if((route.state==='locked'||route.frozenBoundaries?.length)&&!target.stage.graph.edges.some(edge=>edge.id===route.canonicalEdgeId))frozenConflicts.push({kind:'merge-conflict',entityIds:[route.canonicalEdgeId],message:'来源删除了冻结或锁定连接，请先解冻或解除锁定',actions:['unfreeze','cancel']});
  for (const group of origin.frozenGroups) {
    const changed = [group.rootId, ...group.memberIds].filter((id) => sourceParents.has(id) && (!targetIds.has(id) || (!input.targetSaved && sourceParents.get(id) !== targetParents.get(id))));
    if (changed.length) frozenConflicts.push({ kind: 'merge-conflict', entityIds: changed, containerId: group.rootId, message: '冻结子图成员被删除或更改归属，请先解冻', actions: ['unfreeze', 'cancel'] });
  }
  const sourceViews = input.targetSaved ? input.targetSaved.nodes : input.sourceContent.nodes;
  const mapped = mapReplacementViews(target, sourceViews);
  const targetNodes = baselineNodes(target);
  const targetById = new Map(targetNodes.map((node) => [node.id, node]));
  const sourceBaseline = new Map(baselineNodes(input.source).map((node) => [node.id, node]));
  const sourceExpansionChanged = mapped.views.some((view) => {
    const baseline = sourceBaseline.get(view.id);
    return !!baseline && (!!baseline.data.expanded !== !!view.data.expanded || baseline.type !== view.type);
  });
  const sourceAuto = (view: CanvasNodeView): boolean => {
    if (view.data.layoutEdits?.position) return false;
    const baseline = sourceBaseline.get(view.id);
    if (!baseline || baseline.parentId !== view.parentId) return false;
    return sourceExpansionChanged
      || Math.abs(baseline.position.x - view.position.x) < 0.001 && Math.abs(baseline.position.y - view.position.y) < 0.001;
  };
  const restoredBase = restoreNodeViews(target, targetNodes, mapped.views).map((node) => {
    if (input.targetSaved || node.data.frozen || (node.data.layoutMode !== undefined && node.data.layoutMode !== 'free')) return node;
    const source = mapped.views.find((view) => view.id === node.id);
    const targetNode = targetById.get(node.id);
    const position = target.positions?.[node.id];
    if (!source || !targetNode || !position || targetNode.parentId !== source.parentId) return node;
    if (source.data.frozen || (source.data.layoutMode !== undefined && source.data.layoutMode !== 'free') || !sourceAuto(source)) return node;
    return { ...node, position: { ...position } };
  });
  const baseRoutes = inheritRoutes(input.targetSaved ?? input.sourceContent, target);
  const reconciled = restoreFrozenGroups(restoredBase, structuredClone(origin.frozenGroups));
  const baseFrozen = reconciled.groups;
  const pins = retainLabelPins(origin.labelPins ?? [], target.stage, mapped.views, input.targetSaved ? undefined : input.source.stage);
  const base = captureContent(reconciled.nodes, baseRoutes, baseFrozen, undefined, undefined, pins);

  const inherited = new Set(mapped.views.map((view) => view.id));
  for (const id of mapped.mappedIds) {
    const view = mapped.views.find((item) => item.id === id)!;
    const node = target.stage.graph.nodes.find((item) => item.id === id)!;
    const parent = node.parentId === target.stage.graph.rootId ? undefined : node.parentId;
    if (view.parentId !== parent) inherited.delete(id);
  }
  const addedNodeIds = target.stage.graph.nodes
    .filter((node) => node.id !== target.stage.graph.rootId && !inherited.has(node.id))
    .filter((node) => {
      const mark = target.nodeChanges[node.id];
      return mark?.kind === 'added' || mark?.kind === 'replaced';
    })
    .map((node) => node.id);

  let working = reconciled.nodes;
  const conflicts: StageConflict[] = [...frozenConflicts, ...reconciled.conflicts];
  for (const route of baseRoutes) {
    const edge = target.stage.graph.edges.find((item) => item.id === route.canonicalEdgeId)!;
    if ((route.state === 'locked'||route.frozenBoundaries?.length) && endpointFingerprint(edge) !== route.endpointFingerprint) conflicts.push({ kind: 'locked-route', entityIds: [route.canonicalEdgeId], message: '来源更改了锁定路径的端点或端口，请先解除路径锁定', actions: ['unfreeze', 'cancel'] });
  }
  const projection = hierarchyProjection(working, target.stage);
  const placement = placeAddedNodes({
    nodes: working,
    stage: target.stage,
    projection,
    addedNodeIds,
    ...(target.layout?.kind === 'manual' ? { preserveExpansion: true } : {}),
    ...(target.positions ? { preferredPositions: target.positions } : {}),
    frozenFrames: new Map(baseFrozen.flatMap((group) => Object.entries(group.frozenFrames ?? {}))),
    protectedRoutes: baseRoutes,
    displayPaths: (origin.displayRoutes ?? []).filter((route) => route.memberIds.every((id) => target.stage.graph.edges.some((edge) => edge.id === id))),
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
  conflicts.push(...validateFrozenConnections(reconciled.nodes,working,target.stage,activeRoutes,activeFrozen));
  let displayRoutes: DisplayRouteSnapshot[] = [];
  let routeMetrics={reusedPaths:0,routedEdges:0,totalEdges:0};
  if (!conflicts.length) {
    const visibleEdges = aggregateProjectedEdges(finalProjection, target.edgeChanges);
    const policy = target.stage.presentation?.portPolicy;
    const cache = new DiagramRouteCache();
    const { routes, reserved, failures, reusedPaths } = resolveRoutes({
      nodes: working, projection: finalProjection, edges: visibleEdges, policy, stored: activeRoutes, displaySnapshots: origin.displayRoutes, frozen: activeFrozen,
    }, cache);
    for (const [id, message] of failures) conflicts.push({ kind: 'locked-route', entityIds: [id], message, actions: ['unfreeze', 'cancel'] });
    routeMetrics = { reusedPaths, routedEdges: cache.lastStats.routedEdges, totalEdges: visibleEdges.length };
    if (!conflicts.length) displayRoutes = captureDisplayRoutes(working, finalProjection, visibleEdges, routes, reserved, policy);
  }
  const state: StageViewState = { nodes: working, edgeRoutes: activeRoutes, frozenGroups: activeFrozen, displayRoutes, ...(pins.length ? { labelPins: pins } : {}) };
  if (conflicts.length) return { ok: false, base, candidate: state, conflicts };

  const content = captureContent(working, activeRoutes, activeFrozen, undefined, displayRoutes, pins);
  const record: StageTransitionRecord = {
    fromStageId: input.source.id,
    toStageId: target.id,
    sourceRevision: revisionOf(input.source),
    targetRevision: revisionOf(target),
    startedAt,
    durationMs: performance.now() - started,
    placements: placement.placements,
    expanded: placement.expanded,
    metrics:{inheritedNodes:working.filter(node=>inherited.has(node.id)).length,addedNodes:addedNodeIds.length,...routeMetrics},
  };
  return { ok: true, base, content, state, record };
}
