/** Global label occupancy: resolve cross-group label collisions with bounded reselection. */
import { rectIntersects, type Rect } from '../../core/layout/geometry.ts';
import type { LabelCandidate } from './label-candidates.ts';

export interface CoordinatedLabelRoute {
  edgeId: string;
  candidates: readonly LabelCandidate[];
  required: boolean;
}

interface State {
  placements: Map<string, LabelCandidate | undefined>;
  rects: Rect[];
  hidden: number;
  score: number;
}

/**
 * Select one non-overlapping candidate for each route. Fixed labels are inserted
 * first. If no candidate fits, a required label becomes hidden; optional labels
 * simply have no placement. The beam is bounded so this stays a local UI pass.
 */
export function coordinateLabels(routes: readonly CoordinatedLabelRoute[], fixed: readonly Rect[] = [], beamWidth = 24): Map<string, LabelCandidate | undefined> {
  const ordered = [...routes].sort((a, b) =>
    Number(b.required) - Number(a.required)
    || a.candidates.length - b.candidates.length
    || a.edgeId.localeCompare(b.edgeId));
  let beam: State[] = [{ placements: new Map(), rects: [...fixed], hidden: 0, score: 0 }];
  for (const route of ordered) {
    const next: State[] = [];
    for (const state of beam) {
      for (const candidate of route.candidates) {
        if (state.rects.some((rect) => rectIntersects(rect, candidate.rect))) continue;
        const placements = new Map(state.placements);
        placements.set(route.edgeId, candidate);
        next.push({ placements, rects: [...state.rects, candidate.rect], hidden: state.hidden, score: state.score + candidate.score });
      }
      const placements = new Map(state.placements);
      placements.set(route.edgeId, undefined);
      next.push({ placements, rects: state.rects, hidden: state.hidden + (route.required ? 1 : 0), score: state.score + (route.required ? 40 : 0) });
    }
    next.sort((a, b) => a.hidden - b.hidden || a.score - b.score);
    beam = next.slice(0, Math.max(1, beamWidth));
  }
  const best = beam[0];
  return best ? new Map(best.placements) : new Map();
}
