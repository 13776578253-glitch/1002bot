/**
 * Hierarchical Layered (ELK-style) Layout Engine.
 *
 * Provides deterministic hierarchical coordinate calculation for nested
 * aggregates and computes collision-free orthogonal edge routes using the
 * obstacle-avoiding geometry router.
 */

import type { NodePath } from '../schema/types.ts';
import type { LayoutEngine, LayoutResult, PlacedNode, RoutedEdge, Size } from './index.ts';
import { LAYOUT_METRICS } from './tidy.ts';
import { routeOrthogonal, type Obstacle, type Rect } from './geometry.ts';

interface VisibleInput {
  path: NodePath;
  expanded: boolean;
}

const snap = (v: number): number => Math.round(v / LAYOUT_METRICS.grid) * LAYOUT_METRICS.grid;

const contentSpan = (height: number): number =>
  Math.ceil(height / LAYOUT_METRICS.grid) * LAYOUT_METRICS.grid;

export function createElkLayout(): LayoutEngine {
  return {
    layout(
      visible: VisibleInput[],
      edges: { from: NodePath; to: NodePath; label?: string }[],
    ): LayoutResult {
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
          if (inSet.has(e.from) && inSet.has(e.to)) {
            indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
          }
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
      for (const [parent, kids] of childrenOf) {
        if (expanded.has(parent)) rankGroup(kids);
      }

      const placed = new Map<NodePath, PlacedNode>();

      const placeGroup = (
        siblings: NodePath[],
        originX: number,
        originY: number,
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
              const inner = placeGroup(kids, childOriginX, childOriginY);

              size = {
                w: Math.max(LAYOUT_METRICS.cardWidth, inner.w + LAYOUT_METRICS.aggregatePadding * 2),
                h: contentSpan(inner.h) + LAYOUT_METRICS.aggregateContentTop + LAYOUT_METRICS.aggregatePadding * 2,
              };
            }

            placed.set(path, {
              path,
              at: { x: snap(x), y: snap(y) },
              size,
              expanded: isOpen,
            });

            y += size.h + LAYOUT_METRICS.gapY;
            colW = Math.max(colW, size.w);
          }

          maxH = Math.max(maxH, y - originY - LAYOUT_METRICS.gapY);
          x += colW + LAYOUT_METRICS.gapX;
        }

        return {
          w: Math.max(x - originX - LAYOUT_METRICS.gapX, LAYOUT_METRICS.cardWidth),
          h: Math.max(maxH, LAYOUT_METRICS.cardHeight),
        };
      };

      placeGroup(topLevel, 0, 0);

      const nodes = [...placed.values()];

      // Compute obstacles for edge routing
      const obstacles: Obstacle[] = [];
      for (const n of nodes) {
        if (!n.expanded) {
          obstacles.push({
            left: n.at.x - 8,
            right: n.at.x + n.size.w + 8,
            top: n.at.y - 8,
            bottom: n.at.y + n.size.h + 8,
          });
        } else {
          // For expanded containers, protect header region
          obstacles.push({
            left: n.at.x - 4,
            right: n.at.x + n.size.w + 4,
            top: n.at.y - 4,
            bottom: n.at.y + LAYOUT_METRICS.aggregateHeaderHeight + 8,
          });
        }
      }

      // Compute orthogonal collision-free paths for all edges
      const routedEdges: RoutedEdge[] = [];
      for (const edge of edges) {
        const fromPath = stripPort(edge.from);
        const toPath = stripPort(edge.to);
        const fromNode = placed.get(fromPath);
        const toNode = placed.get(toPath);
        if (!fromNode || !toNode) continue;

        const fromRect: Rect = {
          x: fromNode.at.x,
          y: fromNode.at.y,
          w: fromNode.size.w,
          h: fromNode.expanded ? LAYOUT_METRICS.aggregateHeaderHeight : fromNode.size.h,
        };

        const toRect: Rect = {
          x: toNode.at.x,
          y: toNode.at.y,
          w: toNode.size.w,
          h: toNode.expanded ? LAYOUT_METRICS.aggregateHeaderHeight : toNode.size.h,
        };

        // Filter out endpoints themselves from obstacles
        const filteredObstacles = obstacles.filter((obs) => {
          const isFrom = obs.left <= fromRect.x + fromRect.w && obs.right >= fromRect.x && obs.top <= fromRect.y + fromRect.h && obs.bottom >= fromRect.y;
          const isTo = obs.left <= toRect.x + toRect.w && obs.right >= toRect.x && obs.top <= toRect.y + toRect.h && obs.bottom >= toRect.y;
          return !isFrom && !isTo;
        });

        const points = routeOrthogonal(fromRect, toRect, filteredObstacles);

        routedEdges.push({
          from: edge.from,
          to: edge.to,
          points,
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
