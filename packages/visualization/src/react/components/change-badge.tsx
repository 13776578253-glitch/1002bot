/** Change badge owns added/replaced annotation rendering; baseline and inherited marks stay plain. */
import type { ChangeMark } from '../../core/schema/baseline.ts';
import { hasChangeAnnotation } from '../model/routing/change.ts';

/** 变化徽标；基线与沿用不显示，只有新增/替换通过 hasChangeAnnotation。 */
export function ChangeBadge({ change }: { change: ChangeMark | undefined }) {
  return change && hasChangeAnnotation(change) && <span className="change-badge" data-change={change.kind} title={change.note}>{change.label}</span>;
}
