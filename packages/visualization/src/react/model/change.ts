import type { ChangeMark } from '../../core/schema/baseline.ts';

export function hasChangeAnnotation(change: ChangeMark | undefined): boolean {
  return change?.kind === 'added' || change?.kind === 'replaced';
}

export function relationLabel(label: string, change: ChangeMark): string {
  return hasChangeAnnotation(change) ? `${label} · ${change.label}` : label;
}
