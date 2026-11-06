/** Build independent initial geometries for the three stage projections. */
import type { VisualizationBaseline } from '../../../core/schema/baseline.ts';
import type { CanonicalNode } from '../../../core/schema/types.ts';
import { CARD_SIZE, detailCardSize, structureHeaderHeight } from '../layout/node.ts';
import type { CanvasViewMode } from '../contracts/snapshot-types.ts';

type Frame = NonNullable<VisualizationBaseline['layout']>['nodes'][string];
type Size = { width: number; height: number };

/** 在保存草稿前播种新视图；已有视图拥有自己的几何。 */
export function baselineForView(baseline: VisualizationBaseline, mode: CanvasViewMode): VisualizationBaseline {
  const graph = baseline.stage.graph;
  const children = new Map<string, CanonicalNode[]>();
  for (const node of graph.nodes) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const frames: Record<string, Frame> = {};
  const visibleSizes = new Map<string, Size>();
  const original = baseline.layout?.nodes;
  const gap = 80;

  const arrange = (siblings: readonly CanonicalNode[], origin: { x: number; y: number }): Size => {
    const columns = [0, 0];
    const rows: number[] = [];
    for (const [index, node] of siblings.entries()) {
      const size = visibleSizes.get(node.id)!;
      const col = index % 2, row = Math.floor(index / 2);
      columns[col] = Math.max(columns[col]!, size.width);
      rows[row] = Math.max(rows[row] ?? 0, size.height);
    }
    let y = origin.y;
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < 2; col++) {
        const node = siblings[row * 2 + col];
        if (!node) continue;
        const frame = frames[node.id]!;
        frames[node.id] = { ...frame, position: { x: origin.x + (col ? columns[0]! + gap : 0), y } };
      }
      y += rows[row]! + gap;
    }
    return {
      width: columns[0]! + (siblings.length > 1 ? gap + columns[1]! : 0),
      height: rows.length ? y - origin.y - gap : 0,
    };
  };

  const build = (node: CanonicalNode): void => {
    const nested = children.get(node.id) ?? [];
    for (const child of nested) build(child);

    const authored = original?.[node.id];
    const collapsed = { ...CARD_SIZE };
    const hasDetails = !!node.details?.length;
    const expanded = mode === 'full' ? nested.length > 0 || hasDetails
      : mode === 'structure' && node.parentId === graph.rootId && nested.length > 0;
    const header = structureHeaderHeight({ data: { title: node.label, ...(node.details ? { details: node.details } : {}) } });
    const childBounds = arrange(nested, { x: 24, y: header + 24 });

    const expandedSize = nested.length
      ? {
          width: Math.max(collapsed.width, authored?.expandedSize?.width ?? 0, childBounds.width + 48),
          height: Math.max(collapsed.height, authored?.expandedSize?.height ?? 0, header + 24 + childBounds.height + 24),
        }
      : hasDetails
        ? { ...detailCardSize(node.details!.length) }
        : authored?.expandedSize;

    frames[node.id] = {
      position: { x: 0, y: 0 }, ...collapsed,
      ...(expandedSize ? { expandedSize: { ...expandedSize } } : {}),
      initiallyExpanded: expanded,
    };
    visibleSizes.set(node.id, expanded && expandedSize ? expandedSize : collapsed);
  };

  const roots = children.get(graph.rootId) ?? [];
  for (const node of roots) build(node);
  arrange(roots, { x: 0, y: 0 });

  if (mode === 'overview') {
    for (const node of graph.nodes) {
      if (node.id === graph.rootId) continue;
      const position = original?.[node.id]?.position ?? baseline.positions?.[node.id];
      if (position) frames[node.id] = { ...frames[node.id]!, position: { ...position } };
    }
  }

  return {
    ...baseline,
    positions: Object.fromEntries(Object.entries(frames).map(([id, frame]) => [id, { ...frame.position }])),
    layout: { kind: 'manual', nodes: frames, ...(mode === 'overview' ? { expansion: 'collapsed' } : mode === 'full' ? { expansion: 'expanded' } : {}) },
  };
}
