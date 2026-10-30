/** Baseline change indicator badge for added and replaced entities. */
import type { ChangeMark } from '../../core/schema/baseline.ts';
import { hasChangeAnnotation } from '../model/change.ts';

/** 架构演进变化徽标；仅对新增与替换实体展示变更说明。 */
export function ChangeBadge({ change }: { change: ChangeMark | undefined }) {
  return change && hasChangeAnnotation(change) && <span className="change-badge" data-change={change.kind} title={change.note}>{change.label}</span>;
}
