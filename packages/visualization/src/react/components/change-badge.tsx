import type { ChangeMark } from '../../core/schema/baseline.ts';
import { hasChangeAnnotation } from '../model/change.ts';

export function ChangeBadge({ change }: { change: ChangeMark | undefined }) {
  return change && hasChangeAnnotation(change) && <span className="change-badge" data-change={change.kind} title={change.note}>{change.label}</span>;
}
