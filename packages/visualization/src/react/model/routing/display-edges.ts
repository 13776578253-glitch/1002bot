/** Display-only aggregation retains every canonical relation and its change mark. */
import type { ChangeMark } from '../../../core/schema/baseline.ts';
import type { CanonicalEdge } from '../../../core/schema/types.ts';
import type { ProjectedEdge, Projection } from '../../../core/projection/index.ts';
import { relationLabel } from './change.ts';

export interface DisplayEdge {
  id: string;
  source: string;
  target: string;
  direction: CanonicalEdge['direction'];
  relation: CanonicalEdge['relation'];
  members: ProjectedEdge[];
  memberChanges: Readonly<Record<string, ChangeMark>>;
  change: ChangeMark;
  text: string;
  aggregated: boolean;
  added: number;
  replaced: number;
}

export const relationNames: Record<CanonicalEdge['relation'], string> = {
  data: '数据关系', control: '控制关系', call: '调用', event: '事件关系', storage: '存储关系', ownership: '所有权', implementation: '实现', lifecycle: '生命周期', unknown: '关系',
};

function visibleEndpoints(edge: ProjectedEdge): [string, string] {
  const source = edge.source.nodeId, target = edge.target.nodeId;
  return edge.direction === 'bidirectional' && source > target ? [target, source] : [source, target];
}

/** 只有包含折叠端点的桶才聚合；已展开的平行关系保留各自身份。 */
export function aggregateProjectedEdges(projection: Projection, changes: Readonly<Record<string, ChangeMark>>): DisplayEdge[] {
  const buckets = new Map<string, ProjectedEdge[]>();
  for (const edge of [...projection.edges].sort((a, b) => a.edge.order - b.edge.order || a.canonicalEdgeId.localeCompare(b.canonicalEdgeId))) {
    const [source, target] = visibleEndpoints(edge);
    const key = JSON.stringify([source, target, edge.direction, edge.relation, edge.edge.semantics ?? 'interaction']);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(edge);
    else buckets.set(key, [edge]);
  }
  const display = (members: ProjectedEdge[], key: string, aggregated: boolean): DisplayEdge => {
    const first = members[0]!;
    const [source, target] = visibleEndpoints(first);
    const memberChanges = Object.fromEntries(members.map((member) => [member.canonicalEdgeId, changes[member.canonicalEdgeId]!]));
    const marks = Object.values(memberChanges);
    const added = marks.filter((mark) => mark.kind === 'added').length;
    const replaced = marks.filter((mark) => mark.kind === 'replaced').length;
    const change: ChangeMark = !aggregated ? changes[first.canonicalEdgeId]!
      : added === members.length ? { kind: 'added', label: '新增' }
      : replaced === members.length ? { kind: 'replaced', label: '替换' }
      : { kind: 'inherited', label: '沿用' };
    const text = aggregated
      ? `${members.length} 条${relationNames[first.relation]}${added ? ` · 新增 ${added}` : ''}${replaced ? ` · 替换 ${replaced}` : ''}`
      : relationLabel(first.label ?? '', change);
    return { id: aggregated ? `aggregate:${encodeURIComponent(key)}` : first.canonicalEdgeId,
      source, target, direction: first.direction, relation: first.relation, members, memberChanges, change, text, aggregated, added, replaced };
  };
  return [...buckets].flatMap(([key, members]) => members.length > 1 && members.some((member) => member.folded)
    ? [display(members, key, true)] : members.map((member) => display([member], key, false)));
}
