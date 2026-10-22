import type { CanonicalPort, GraphNodeId } from '../schema/types.ts';
import type { LayoutEngine, LayoutInput, LayoutNodeInput, LayoutProvider, LayoutResult, NodeLayout, Size } from './index.ts';
import { aggregateSize, LAYOUT_METRICS, nodeSize, snapPoint } from './metrics.ts';
import { portAnchor, type Point, type Rect } from './geometry.ts';

function childrenMap(input: LayoutInput): Map<GraphNodeId | undefined, LayoutNodeInput[]> {
  const map = new Map<GraphNodeId | undefined, LayoutNodeInput[]>();
  for (const node of input.nodes) {
    const list = map.get(node.parentId) ?? [];
    list.push(node);
    map.set(node.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return map;
}

function ranks(ids: readonly LayoutNodeInput[], edges: LayoutInput['edges']): Map<GraphNodeId, number> {
  const idsSet = new Set(ids.map((node) => node.id));
  const incoming = new Map(ids.map((node) => [node.id, 0]));
  const outgoing = new Map<GraphNodeId, GraphNodeId[]>();
  for (const edge of edges) {
    if (!idsSet.has(edge.source.nodeId) || !idsSet.has(edge.target.nodeId) || edge.source.nodeId === edge.target.nodeId) continue;
    incoming.set(edge.target.nodeId, (incoming.get(edge.target.nodeId) ?? 0) + 1);
    const list = outgoing.get(edge.source.nodeId) ?? [];
    list.push(edge.target.nodeId);
    outgoing.set(edge.source.nodeId, list);
  }
  const queue = ids.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  const rank = new Map<GraphNodeId, number>(ids.map((node) => [node.id, 0]));
  const queued = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const target of outgoing.get(current) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(current) ?? 0) + 1));
      const nextIncoming = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, nextIncoming);
      if (nextIncoming === 0 && !queued.has(target)) {
        queued.add(target);
        queue.push(target);
      }
    }
  }
  return rank;
}

function portFraction(port: CanonicalPort, ports: readonly CanonicalPort[]): number {
  const ordered = [...ports].filter((candidate) => candidate.side === port.side || candidate.side === 'auto');
  const index = Math.max(0, ordered.findIndex((candidate) => candidate.id === port.id));
  return (index + 1) / (ordered.length + 1);
}

function anchors(node: LayoutNodeInput, rect: Rect): Map<string, Point> {
  const result = new Map<string, Point>();
  for (const port of node.ports) {
    const side = port.side === 'auto' ? 'right' : port.side;
    const anchor = portAnchor(rect, side, portFraction(port, node.ports));
    result.set(port.id, anchor);
    result.set(`port:${port.id}:in`, anchor);
    result.set(`port:${port.id}:out`, anchor);
  }
  result.set('left', portAnchor(rect, 'left'));
  result.set('right', portAnchor(rect, 'right'));
  result.set('top', portAnchor(rect, 'top'));
  result.set('bottom', portAnchor(rect, 'bottom'));
  return result;
}

export function createLayeredLayout(): LayoutProvider {
  const engine: LayoutEngine = {
    layout(input): LayoutResult {
      const byParent = childrenMap(input);
      const sizeCache = new Map<GraphNodeId, Size>();
      const rankCache = new Map<string, Map<GraphNodeId, number>>();
      const placed = new Map<GraphNodeId, NodeLayout>();

      const measureGroup = (ids: readonly LayoutNodeInput[], parentKey: string): Size => {
        const rank = ranks(ids, input.edges);
        rankCache.set(parentKey, rank);
        const columns = new Map<number, LayoutNodeInput[]>();
        for (const node of ids) {
          const key = rank.get(node.id) ?? 0;
          const list = columns.get(key) ?? [];
          list.push(node);
          columns.set(key, list);
        }
        let width = 0;
        let height = 0;
        for (const key of [...columns.keys()].sort((a, b) => a - b)) {
          const members = columns.get(key)!;
          let columnHeight = 0;
          let columnWidth = 0;
          for (const node of members) {
            const measureInput = {
              id: node.id,
              expanded: node.expanded,
              ...(node.measuredSize ? { measured: { id: node.id, size: node.measuredSize } } : {}),
              ...(node.minSize ? { minSize: node.minSize } : {}),
            };
            let size = nodeSize(measureInput);
            if (node.expanded) {
              size = aggregateSize(measureGroup(byParent.get(node.id) ?? [], node.id));
            }
            sizeCache.set(node.id, size);
            columnHeight += size.h + (columnHeight === 0 ? 0 : LAYOUT_METRICS.gapY);
            columnWidth = Math.max(columnWidth, size.w);
          }
          width += columnWidth + (width === 0 ? 0 : LAYOUT_METRICS.gapX);
          height = Math.max(height, columnHeight);
        }
        return { w: Math.max(width, LAYOUT_METRICS.cardWidth), h: Math.max(height, LAYOUT_METRICS.cardHeight) };
      };

      const placeGroup = (ids: readonly LayoutNodeInput[], origin: Point, parentId?: GraphNodeId): void => {
        const rank = rankCache.get(parentId ?? '__root__') ?? ranks(ids, input.edges);
        const columns = new Map<number, LayoutNodeInput[]>();
        for (const node of ids) {
          const key = rank.get(node.id) ?? 0;
          const list = columns.get(key) ?? [];
          list.push(node);
          columns.set(key, list);
        }
        let x = origin.x;
        for (const key of [...columns.keys()].sort((a, b) => a - b)) {
          const members = columns.get(key)!;
          let y = origin.y;
          let columnWidth = 0;
          for (const node of members) {
            const size = sizeCache.get(node.id) ?? nodeSize({ id: node.id, expanded: node.expanded });
            const at = snapPoint({ x, y });
            const rect: Rect = { x: at.x, y: at.y, w: size.w, h: size.h };
            const contentRect = node.expanded
              ? { x: rect.x + LAYOUT_METRICS.aggregatePadding, y: rect.y + LAYOUT_METRICS.aggregateContentTop, w: Math.max(0, rect.w - LAYOUT_METRICS.aggregatePadding * 2), h: Math.max(0, rect.h - LAYOUT_METRICS.aggregateContentTop - LAYOUT_METRICS.aggregatePadding) }
              : undefined;
            const headerRect = node.expanded
              ? { x: rect.x, y: rect.y, w: rect.w, h: LAYOUT_METRICS.aggregateHeaderHeight + LAYOUT_METRICS.aggregateDescriptionHeight }
              : undefined;
            placed.set(node.id, {
              id: node.id,
              ...(parentId === undefined ? {} : { parentId }),
              worldRect: rect,
              ...(contentRect ? { contentRect } : {}),
              ...(headerRect ? { headerRect } : {}),
              anchors: anchors(node, rect),
              expanded: node.expanded,
            });
            if (node.expanded) placeGroup(byParent.get(node.id) ?? [], contentRect ? { x: contentRect.x, y: contentRect.y } : at, node.id);
            y += size.h + LAYOUT_METRICS.gapY;
            columnWidth = Math.max(columnWidth, size.w);
          }
          x += columnWidth + LAYOUT_METRICS.gapX;
        }
      };

      const roots = byParent.get(undefined) ?? [];
      measureGroup(roots, '__root__');
      placeGroup(roots, { x: 0, y: 0 });

      const nodes = [...placed.values()];
      let bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
      for (const node of nodes) {
        if (bounds.w === 0 && bounds.h === 0) bounds = { ...node.worldRect };
        else {
          const left = Math.min(bounds.x, node.worldRect.x);
          const top = Math.min(bounds.y, node.worldRect.y);
          const right = Math.max(bounds.x + bounds.w, node.worldRect.x + node.worldRect.w);
          const bottom = Math.max(bounds.y + bounds.h, node.worldRect.y + node.worldRect.h);
          bounds = { x: left, y: top, w: right - left, h: bottom - top };
        }
      }
      return { nodes, edges: [], bounds };
    },
  };
  return { ...engine, layoutAsync: async (input) => engine.layout(input) };
}

export const createElkLayout = createLayeredLayout;
