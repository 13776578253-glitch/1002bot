/** Baseline change annotations and relation label composition. */
import type { ChangeMark } from '../../../core/schema/baseline.ts';

/** 仅 added 与 replaced 产生显著的视觉徽标与连线标注。 */
export function hasChangeAnnotation(change: ChangeMark | undefined): boolean {
  return change?.kind === 'added' || change?.kind === 'replaced';
}

/** 拼接关系连线展示文案；对 added 与 replaced 追加演进标注后缀。 */
export function relationLabel(label: string, change: ChangeMark): string {
  return hasChangeAnnotation(change) ? `${label} · ${change.label}` : label;
}
