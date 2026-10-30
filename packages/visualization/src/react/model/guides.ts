import type { Rect } from '../../core/layout/geometry.ts';
import type { AlignmentGuide } from './constraints.ts';

export function clipAlignmentGuides(guides: readonly AlignmentGuide[], blockers: readonly Rect[], padding = 8): AlignmentGuide[] {
  return guides.flatMap((guide) => {
    const intervals = blockers.flatMap((blocker) => {
      const crossStart = (guide.axis === 'x' ? blocker.x : blocker.y) - padding;
      const crossEnd = (guide.axis === 'x' ? blocker.x + blocker.w : blocker.y + blocker.h) + padding;
      if (guide.value < crossStart || guide.value > crossEnd) return [];
      const start = Math.max(guide.start, (guide.axis === 'x' ? blocker.y : blocker.x) - padding);
      const end = Math.min(guide.end, (guide.axis === 'x' ? blocker.y + blocker.h : blocker.x + blocker.w) + padding);
      return end > start ? [{ start, end }] : [];
    }).sort((a, b) => a.start - b.start);
    const segments: AlignmentGuide[] = [];
    let cursor = guide.start;
    for (const interval of intervals) {
      if (interval.start - cursor > 2) segments.push({ ...guide, start: cursor, end: interval.start });
      cursor = Math.max(cursor, interval.end);
    }
    if (guide.end - cursor > 2) segments.push({ ...guide, start: cursor });
    return segments;
  });
}
