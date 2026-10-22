/**
 * Shared geometry metrics for the layout provider and React node styles.
 *
 * The values in this module are the only default dimensions used by the
 * renderer contract. A theme can override the CSS variables, while a
 * measurement pass can supply actual node sizes back to the provider.
 */

import type { Point, Size } from './index.ts';

export interface LayoutMetrics {
  cardWidth: number;
  cardHeight: number;
  cardPadding: number;
  gapX: number;
  gapY: number;
  grid: number;
  aggregatePadding: number;
  aggregateHeaderHeight: number;
  aggregateDescriptionHeight: number;
  aggregateContentGap: number;
  routePadding: number;
  routeStub: number;
}

export const LAYOUT_METRICS: LayoutMetrics & { readonly aggregateContentTop: number } = {
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
  routePadding: 14,
  routeStub: 24,
  get aggregateContentTop() {
    return this.aggregateHeaderHeight + this.aggregateDescriptionHeight + this.aggregateContentGap;
  },
};

export interface NodeMeasurement {
  id: string;
  size: Size;
  /** Optional revision from the ResizeObserver measurement pass. */
  revision?: number;
}

export interface NodeMeasureInput {
  id: string;
  expanded: boolean;
  measured?: NodeMeasurement;
  minSize?: Size;
}

export function nodeSize(input: NodeMeasureInput, metrics: LayoutMetrics = LAYOUT_METRICS): Size {
  const fallback: Size = input.expanded
    ? { w: metrics.cardWidth, h: metrics.aggregateHeaderHeight + metrics.aggregateDescriptionHeight + metrics.aggregateContentGap + metrics.aggregatePadding * 2 }
    : { w: metrics.cardWidth, h: metrics.cardHeight };
  const measured = input.measured?.size;
  const min = input.minSize;
  return {
    w: Math.max(fallback.w, min?.w ?? 0, measured?.w ?? 0),
    h: Math.max(fallback.h, min?.h ?? 0, measured?.h ?? 0),
  };
}

export function snapToGrid(value: number, grid: number = LAYOUT_METRICS.grid): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapPoint(point: Point, grid: number = LAYOUT_METRICS.grid): Point {
  return { x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid) };
}

/** CSS custom properties consumed by the card and aggregate theme. */
export function cssVariables(metrics: LayoutMetrics = LAYOUT_METRICS): Record<string, string> {
  return {
    '--av-card-width': `${metrics.cardWidth}px`,
    '--av-card-height': `${metrics.cardHeight}px`,
    '--av-card-padding': `${metrics.cardPadding}px`,
    '--av-card-gap-x': `${metrics.gapX}px`,
    '--av-card-gap-y': `${metrics.gapY}px`,
    '--av-grid-size': `${metrics.grid}px`,
    '--av-aggregate-padding': `${metrics.aggregatePadding}px`,
    '--av-aggregate-header-height': `${metrics.aggregateHeaderHeight}px`,
    '--av-aggregate-description-height': `${metrics.aggregateDescriptionHeight}px`,
    '--av-aggregate-content-gap': `${metrics.aggregateContentGap}px`,
  };
}

export function aggregateSize(
  inner: Size,
  metrics: LayoutMetrics = LAYOUT_METRICS,
): Size {
  return {
    w: Math.max(metrics.cardWidth, inner.w + metrics.aggregatePadding * 2),
    h: Math.max(
      metrics.cardHeight,
      inner.h + metrics.aggregateHeaderHeight + metrics.aggregateDescriptionHeight + metrics.aggregateContentGap + metrics.aggregatePadding * 2,
    ),
  };
}
