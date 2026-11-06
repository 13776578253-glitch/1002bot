/** Confirmation uses editable intent and the revision of the historical snapshot. */
import type { CanvasBaselineView } from '../contracts/snapshot-types.ts';
import { sameCanvasIntent } from './content-intent.ts';

export function draftMatchesConfirmed(view: CanvasBaselineView): boolean {
  return !!view.confirmed && sameCanvasIntent(view, view.confirmed);
}

export function confirmationIsCurrent(view: CanvasBaselineView, sourceRevision: string): boolean {
  if (!view.confirmed || view.requiresConfirmation) return false;
  return (view.confirmedRevision ?? view.revision) === sourceRevision && draftMatchesConfirmed(view);
}
