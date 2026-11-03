/** Draft/confirmed comparison; display route snapshots are derived and never make a draft dirty. */
import type { CanvasBaselineContent, CanvasBaselineView } from './workspace.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
}

function comparable(content: CanvasBaselineContent): unknown {
  const { nodes, edgeRoutes, frozenGroups, overlay } = content;
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      layoutMode: node.data.layoutMode ?? 'free',
      expanded: !!node.data.expanded,
      frozen: !!node.data.frozen,
    },
  }));
  return canonical({ nodes: normalizedNodes, edgeRoutes, frozenGroups, ...(overlay ? { overlay } : {}) });
}

export function draftMatchesConfirmed(view: CanvasBaselineView): boolean {
  return !!view.confirmed && JSON.stringify(comparable(view)) === JSON.stringify(comparable(view.confirmed));
}

export function confirmationIsCurrent(view: CanvasBaselineView, sourceRevision: string): boolean {
  if (!view.confirmed || view.requiresConfirmation) return false;
  return (view.confirmedRevision ?? view.revision) === sourceRevision && draftMatchesConfirmed(view);
}
