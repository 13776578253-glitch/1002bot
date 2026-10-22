/**
 * Default tidy layout: ranks sibling nodes by edge depth, places ranks
 * left-to-right, and snaps to a grid. Aggregates wrap their children with
 * padding. Deterministic and dependency-free; ELK.js can replace it later.
 */

import type { LayoutEngine, LayoutResult, PlacedNode, RoutedEdge, Size } from './index.ts';
import type { NodePath } from '../schema/types.ts';

/**
 * Geometry shared by the layout engine, React Flow node dimensions, and
 * theme CSS. Aggregate children start below both header bands.
 */
export const LAYOUT_METRICS = {
  cardWidth: 278,
  cardHeight: 124,
  cardPadding: 14,
  gapX: 110,
  gapY: 40,
  grid: 20,
  aggregatePadding: 24,
  aggregateHeaderHeight: 52,
  aggregateDescriptionHeight: 36,
  aggregateContentGap: 12,
  get aggregateContentTop(): number {
    return (
      this.aggregateHeaderHeight +
      this.aggregateDescriptionHeight +
      this.aggregateContentGap
    );
  },
} as const;

const contentSpan = (height: number): number =>
  Math.ceil(height / LAYOUT_METRICS.grid) * LAYOUT_METRICS.grid;

const snap = (v: number): number => Math.round(v / LAYOUT_METRICS.grid) * LAYOUT_METRICS.grid;

interface VisibleInput {
  path: NodePath;
  expanded: boolean;
}

export function createTidyLayout(): LayoutEngine {
  return {
    layout(visible: VisibleInput[], edges: { from: NodePath; to: NodePath; label?: string }[]): LayoutResult {
      const stripPort = (p: NodePath): NodePath => p.split('#')[0] ?? p;
      const visibleSet = new Set(visible.map((v) => v.path));
      const expanded = new Set(visible.filter((v) => v.expanded).map((v) => v.path));

      const childrenOf = new Map<NodePath, NodePath[]>();
      const parentOf = new Map<NodePath, NodePath>();
      for (const p of visibleSet) {
        const cut = p.lastIndexOf('/');
        if (cut < 0) continue;
        const parent = p.slice(0, cut);
        if (!visibleSet.has(parent)) continue;
        parentOf.set(p, parent);
        const list = childrenOf.get(parent) ?? [];
        list.push(p);
        childrenOf.set(parent, list);
      }

      const localEdges = edges
        .map((e) => ({ from: stripPort(e.from), to: stripPort(e.to) }))
        .filter((e) => visibleSet.has(e.from) && visibleSet.has(e.to));

      const rank = new Map<NodePath, number>();
      const rankGroup = (siblings: NodePath[]): void => {
        const inSet = new Set(siblings);
        const indeg = new Map<NodePath, number>(siblings.map((s) => [s, 0]));
        for (const e of localEdges) {
          if (inSet.has(e.from) && inSet.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
        }
        const queue = siblings.filter((s) => (indeg.get(s) ?? 0) === 0);
        for (const s of queue) rank.set(s, Math.max(rank.get(s) ?? 0, 0));
        for (let i = 0; i < queue.length; i++) {
          const cur = queue[i]!;
          for (const e of localEdges) {
            if (e.from !== cur || !inSet.has(e.to)) continue;
            rank.set(e.to, Math.max(rank.get(e.to) ?? 0, (rank.get(cur) ?? 0) + 1));
            const d = (indeg.get(e.to) ?? 1) - 1;
            indeg.set(e.to, d);
            if (d === 0) queue.push(e.to);
          }
        }
      };

      const topLevel = [...visibleSet].filter((p) => !parentOf.has(p));
      rankGroup(topLevel);
      for (const [parent, kids] of childrenOf) if (expanded.has(parent)) rankGroup(kids);

      const placed = new Map<NodePath, PlacedNode>();
      const placeGroup = (
        siblings: NodePath[],
        originX: number,
        originY: number,
        constrainWidth?: number,
      ): { w: number; h: number } => {
        const byRank = new Map<number, NodePath[]>();
        for (const s of siblings) {
          const r = rank.get(s) ?? 0;
          const list = byRank.get(r) ?? [];
          list.push(s);
          byRank.set(r, list);
        }
        let x = originX;
        let maxH = 0;
        for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
          const column = byRank.get(r)!;
          let y = originY;
          let colW = 0;
          for (const path of column) {
            const isOpen = expanded.has(path);
            let size: Size = {
              w: LAYOUT_METRICS.cardWidth,
              h: LAYOUT_METRICS.cardHeight,
            };
            if (isOpen) {
              const kids = childrenOf.get(path) ?? [];
              const childOriginX = x + LAYOUT_METRICS.aggregatePadding;
              const childOriginY = y + LAYOUT_METRICS.aggregateContentTop;
              const inner = placeGroup(
                kids,
                childOriginX,
                childOriginY,
                constrainWidth,
              );
              const frame = {
                w: Math.max(
                  LAYOUT_METRICS.cardWidth,
                  inner.w + LAYOUT_METRICS.aggregatePadding * 2,
                ),
                h:
                  contentSpan(inner.h) +
                  LAYOUT_METRICS.aggregateContentTop +
                  LAYOUT_METRICS.aggregatePadding * 2,
              };
              size = constrainWidth
                ? {
                    w: Math.max(frame.w, constrainWidth),
                    h: frame.h,
                  }
                : frame;
            }
            placed.set(path, { path, at: { x: snap(x), y: snap(y) }, size, expanded: isOpen });
            y += size.h + LAYOUT_METRICS.gapY;
            colW = Math.max(colW, size.w);
          }
          maxH = Math.max(maxH, y - originY - LAYOUT_METRICS.gapY);
          x += colW + LAYOUT_METRICS.gapX;
        }
        const groupSize = {
          w: x - originX - LAYOUT_METRICS.gapX,
          h: Math.max(maxH, LAYOUT_METRICS.cardHeight),
        };
        return groupSize;
      };
      placeGroup(topLevel, 0, 0);

      const nodes = [...placed.values()];
      const routedEdges: RoutedEdge[] = [];
      for (const edge of edges) {
        const fromPath = stripPort(edge.from);
        const toPath = stripPort(edge.to);
        const from = placed.get(fromPath);
        const to = placed.get(toPath);
        if (!from || !to) continue;
        const start = {
          x: from.at.x + from.size.w,
          y: from.at.y + from.size.h / 2,
        };
        const end = {
          x: to.at.x,
          y: to.at.y + to.size.h / 2,
        };
        const middleX = snap((start.x + end.x) / 2);
        routedEdges.push({
          from: edge.from,
          to: edge.to,
          points: [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end],
          ...(edge.label === undefined ? {} : { label: edge.label }),
        });
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.at.x);
        minY = Math.min(minY, n.at.y);
        maxX = Math.max(maxX, n.at.x + n.size.w);
        maxY = Math.max(maxY, n.at.y + n.size.h);
      }
      return {
        nodes,
        edges: routedEdges,
        bounds: nodes.length
          ? {
              x: minX - LAYOUT_METRICS.aggregatePadding,
              y: minY - LAYOUT_METRICS.aggregatePadding,
              w: maxX - minX + LAYOUT_METRICS.aggregatePadding * 2,
              h: maxY - minY + LAYOUT_METRICS.aggregatePadding * 2,
            }
          : { x: 0, y: 0, w: 0, h: 0 },
      };
    },
  };
}
