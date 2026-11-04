/** Draft/confirmed comparison; display route snapshots are derived and never make a draft dirty. */
import type { CanvasBaselineContent, CanvasBaselineView, EdgeRouteSnapshot } from './workspace.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
}

export function comparableCanvasIntent(content: CanvasBaselineContent): unknown {
  const { nodes, edgeRoutes, frozenGroups, overlay, labelPins } = content;
  const path = ({ label: _label, ...route }: EdgeRouteSnapshot) => route;
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      layoutMode: node.data.layoutMode ?? 'free',
      expanded: !!node.data.expanded,
      frozen: !!node.data.frozen,
    },
  }));
  const normalizedPins = (labelPins ?? []).map(({ memberFingerprints: _fingerprints, ...pin }) => ({ ...pin, memberIds: [...pin.memberIds].sort() })).sort((a, b) => JSON.stringify([a.id, a.source, a.target, a.memberIds]).localeCompare(JSON.stringify([b.id, b.source, b.target, b.memberIds])));
  return canonical({ nodes: normalizedNodes, edgeRoutes: edgeRoutes.map(path), frozenGroups: frozenGroups.map((group) => ({
    ...group, ...(group.previousRoutes ? { previousRoutes: group.previousRoutes.map(path) } : {}),
  })), labelPins: normalizedPins, ...(overlay ? { overlay } : {}) });
}

export function draftMatchesConfirmed(view: CanvasBaselineView): boolean {
  return !!view.confirmed && JSON.stringify(comparableCanvasIntent(view)) === JSON.stringify(comparableCanvasIntent(view.confirmed));
}

export function confirmationIsCurrent(view: CanvasBaselineView, sourceRevision: string): boolean {
  if (!view.confirmed || view.requiresConfirmation) return false;
  return (view.confirmedRevision ?? view.revision) === sourceRevision && draftMatchesConfirmed(view);
}
