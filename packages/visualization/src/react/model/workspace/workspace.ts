/** Captures and restores working views against their canonical baseline. */
import type { VisualizationBaseline } from '../../../core/schema/baseline.ts';
import type { CanvasNode } from '../layout/node.ts';
import { CARD_SIZE, detailCardSize } from '../layout/node.ts';
import type { UserGraphOverlay } from '../contracts/overlay.ts';
import { legacyLayoutEdits } from '../layout/layout-intent.ts';

import type { CanvasBaselineContent, CanvasNodeView, DisplayRouteSnapshot, EdgeLabelPin, EdgeRouteSnapshot, FrozenGroupSnapshot } from '../contracts/snapshot-types.ts';

export function captureNodeViews(nodes: readonly CanvasNode[]): CanvasNodeView[] {
  return nodes.map((node) => {
    const { expanded, contentWidth, contentHeight, fitOffset, reflowOrigin, expansionSizes, groupOrigins, frozen } = node.data;
    return structuredClone({
      id: node.id, type: node.type!, ...(node.parentId ? { parentId: node.parentId } : {}),
      position: node.position, width: node.width!, height: node.height!,
      data: {
        ...(node.type === 'cluster' || node.data.titleOverride !== undefined ? { title: node.data.titleOverride ?? node.data.title } : {}),
        ...(expanded !== undefined ? { expanded } : {}),
        ...(contentWidth !== undefined ? { contentWidth } : {}), ...(contentHeight !== undefined ? { contentHeight } : {}),
        ...(fitOffset ? { fitOffset } : {}), ...(reflowOrigin ? { reflowOrigin } : {}),
        ...(expansionSizes ? { expansionSizes } : {}), ...(groupOrigins ? { groupOrigins } : {}),
        ...(frozen ? { frozen } : {}),
        layoutMode: node.data.layoutMode ?? 'free',
        ...(node.data.layoutEdits ? { layoutEdits: node.data.layoutEdits } : {}),
      },
    });
  });
}

export function captureContent(
  nodes: readonly CanvasNode[],
  edgeRoutes: readonly EdgeRouteSnapshot[] = [],
  frozenGroups: readonly FrozenGroupSnapshot[] = [],
  overlay?: UserGraphOverlay,
  displayRoutes?: readonly DisplayRouteSnapshot[],
  labelPins?: readonly EdgeLabelPin[],
): CanvasBaselineContent {
  return {
    nodes: captureNodeViews(nodes),
    edgeRoutes: structuredClone([...edgeRoutes]),
    frozenGroups: structuredClone([...frozenGroups]),
    ...(overlay ? { overlay: structuredClone(overlay) } : {}),
    ...(displayRoutes ? { displayRoutes: structuredClone([...displayRoutes]) } : {}),
    ...(labelPins?.length ? { labelPins: structuredClone([...labelPins]) } : {}),
  };
}

export function cloneContent(content: CanvasBaselineContent): CanvasBaselineContent {
  return structuredClone(content);
}

export function emptyContent(nodes: CanvasNodeView[] = []): CanvasBaselineContent {
  return { nodes, edgeRoutes: [], frozenGroups: [] };
}

export function restoreNodeViews(baseline: VisualizationBaseline, fresh: readonly CanvasNode[], saved: readonly CanvasNodeView[], standardizeCards = true): CanvasNode[] {
  const canonical = new Map(fresh.map((node) => [node.id, node]));
  const previous = new Map(saved.map((node) => [node.id, node]));
  const retained = new Set([...canonical.keys(), ...saved.filter((node) => node.type === 'cluster').map((node) => node.id)]);
  let removed = true;
  while (removed) {
    removed = false;
    for (const node of saved) {
      if (node.type !== 'cluster' || !retained.has(node.id)) continue;
      if (!saved.some((child) => child.parentId === node.id && retained.has(child.id))) { retained.delete(node.id); removed = true; }
    }
  }
  const world = (node: CanvasNodeView): { x: number; y: number } => {
    const parent = node.parentId ? previous.get(node.parentId) : undefined;
    const origin = parent ? world(parent) : { x: 0, y: 0 };
    return { x: origin.x + node.position.x, y: origin.y + node.position.y };
  };
  const freshWorld = (node: CanvasNode): { x: number; y: number } => {
    const parent = node.parentId ? canonical.get(node.parentId) : undefined;
    const origin = parent ? freshWorld(parent) : { x: 0, y: 0 };
    return { x: origin.x + node.position.x, y: origin.y + node.position.y };
  };
  const result = saved.filter((node) => retained.has(node.id)).map((view): CanvasNode => {
    const source = canonical.get(view.id);
    const manualParent = view.parentId && retained.has(view.parentId) && previous.get(view.parentId)?.type === 'cluster';
    const parentId = manualParent ? view.parentId : source ? source.parentId : view.parentId && retained.has(view.parentId) ? view.parentId : undefined;
    const position = parentId === view.parentId ? view.position : (() => {
      const point = world(view), parent = parentId ? previous.get(parentId) : undefined, freshParent = parentId ? canonical.get(parentId) : undefined;
      const origin = parent ? world(parent) : freshParent ? freshWorld(freshParent) : { x: 0, y: 0 };
      return { x: point.x - origin.x, y: point.y - origin.y };
    })();
    const expanded = !!source?.data.expandable && (baseline.layout?.expansion === 'expanded' || baseline.layout?.expansion !== 'collapsed' && !!view.data.expanded);
    const cluster = view.type === 'cluster';
    const structure = expanded && (source?.data.childCount ?? 0) > 0;
    const shapeChanged = !cluster && (expanded !== !!view.data.expanded || expanded && (view.type === 'structure') !== structure);
    const size = source && (shapeChanged || !source.data.expandable && view.type === 'structure') ? { width: source.width!, height: source.height! } : { width: view.width, height: view.height };
    const preferredSize = view.data.layoutEdits?.sizes?.[expanded ? 'expanded' : 'collapsed'];
    if (standardizeCards && !cluster && !structure && !view.data.frozen && view.data.layoutMode !== 'locked' && preferredSize?.origin !== 'user') Object.assign(size, expanded ? detailCardSize(source?.data.details?.length ?? 0) : CARD_SIZE);
    return {
      ...(source ? (({ parentId: _parent, extent: _extent, dragHandle: _handle, ...node }) => node)(source) : { id: view.id, data: { title: view.data.title! } }),
      type: cluster ? 'cluster' : structure ? 'structure' : 'card',
      position: { ...position }, ...size,
      measured: { ...size }, style: { ...size },
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      ...(cluster ? { dragHandle: '.cluster-drag-handle' } : structure ? { dragHandle: '.structure-header' } : {}),
      selected: false,
      data: { ...source?.data, ...view.data, layoutEdits: view.data.layoutEdits ?? legacyLayoutEdits(view, saved), ...(shapeChanged && source ? { contentWidth: source.width!, contentHeight: source.height! } : {}), expanded, title: view.data.title ?? source!.data.title, ...(!cluster && view.data.title !== undefined ? { titleOverride: view.data.title } : {}), ...(source ? { change: baseline.nodeChanges[source.id]! } : {}) },
    };
  });
  const restoredIds = new Set(result.map((node) => node.id));
  result.push(...fresh.filter((node) => !restoredIds.has(node.id)));
  const byId = new Map(result.map((node) => [node.id, node])), ordered: CanvasNode[] = [], visited = new Set<string>(), visiting = new Set<string>();
  const append = (node: CanvasNode): void => {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) throw new Error('保存的分组与当前架构形成循环，请修正分组后重试');
    visiting.add(node.id);
    if (node.parentId) append(byId.get(node.parentId)!);
    visiting.delete(node.id); visited.add(node.id); ordered.push(node);
  };
  result.forEach(append);
  return ordered;
}
