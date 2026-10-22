import type { StageSnapshot, TrackSeries } from './types.ts';
import { assertValidTrackSeries } from './validate.ts';

/**
 * Canonicalize a track at the data boundary. The returned stages are ordered
 * by their declared order, while event steps remain keyed by destination id.
 */
export function normalizeTrackSeries(series: TrackSeries): TrackSeries {
  assertValidTrackSeries(series);
  const stages = [...series.stages].sort((a, b) => a.order - b.order);
  const byStage = new Map((series.events ?? []).map((step) => [step.stage, step]));
  const events = stages.slice(1)
    .map((stage) => byStage.get(stage.id))
    .filter((step): step is NonNullable<typeof step> => step !== undefined);
  const normalized: TrackSeries = {
    ...series,
    stages,
    ...(series.events === undefined ? {} : { events }),
  };
  assertValidTrackSeries(normalized);
  return normalized;
}

export function normalizeTracks(tracks: TrackSeries[]): TrackSeries[] {
  return tracks.map(normalizeTrackSeries);
}

export function stageAt(series: TrackSeries, index: number): StageSnapshot | undefined {
  return series.stages[index];
}
