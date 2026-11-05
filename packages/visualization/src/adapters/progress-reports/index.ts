/** Adapts legacy report-stage catalogs into canvas baselines; source loading belongs to the caller, with no IO or UI dependencies. */
import type { ChangeMark, VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { CanonicalEdge, CanonicalNode } from '../../core/schema/types.ts';
import type { ReportDataset, ReportLink, ReportNode, ReportReplacement } from './types.ts';

export type { ReportDataset, ReportLink, ReportNode, ReportReplacement, ReportStage } from './types.ts';

/** 首阶段记基线；后续按是否已存在区分沿用/新增，显式替换覆盖为 replaced。 */
function changeMarks(
  ids: readonly string[],
  previous: ReadonlySet<string>,
  first: boolean,
  replacements: readonly ReportReplacement[],
): Record<string, ChangeMark> {
  const marks: Record<string, ChangeMark> = Object.fromEntries(ids.map((id) => [id,
    first ? { kind: 'baseline', label: '基线' } : previous.has(id) ? { kind: 'inherited', label: '沿用' } : { kind: 'added', label: '新增' },
  ]));
  for (const replacement of replacements) {
    marks[replacement.id] = { kind: 'replaced', label: '替换', note: replacement.note, previousId: replacement.previousId };
  }
  return marks;
}

export function adaptProgressReports(dataset: ReportDataset): VisualizationBaseline[] {
  const nodes = new Map<string, ReportNode>();
  const links = new Map<string, ReportLink>();
  return dataset.stages.map((stage, order) => {
    const previousNodes = new Set(nodes.keys());
    const previousLinks = new Set(links.keys());
    // 阶段按数组顺序累积：先删除，再按目录键 upsert。
    for (const id of stage.removeNodes ?? []) nodes.delete(id);
    for (const id of stage.removeLinks ?? []) links.delete(id);
    for (const key of stage.nodes) {
      const node = dataset.nodes[key]!;
      nodes.set(node.id, node);
    }
    for (const key of stage.links) {
      const link = dataset.links[key]!;
      links.set(link.id, link);
    }

    // 图节点剥离 position，端口固定为空；初始坐标单独放进 baseline.positions。
    const graphNodes: CanonicalNode[] = [...nodes.values()].map(({ position, ...node }) => ({ ...node, ports: [] }));
    const graphEdges: CanonicalEdge[] = [...links.values()].map((link) => ({
      id: link.id,
      source: { nodeId: link.source }, target: { nodeId: link.target },
      relation: link.relation, direction: link.direction ?? 'directed', label: link.label, order: link.order,
    }));
    return {
      id: stage.id,
      ...(order > 0 ? { previousStageId: dataset.stages[order - 1]!.id } : {}),
      stage: {
        id: stage.id, label: stage.label, title: stage.title, subtitle: stage.subtitle,
        date: stage.date, doc: stage.source, status: stage.status, track: 'main', order,
        graph: { rootId: dataset.rootId, revision: `${dataset.revision}:${stage.id}`, nodes: graphNodes, edges: graphEdges },
      },
      positions: Object.fromEntries([...nodes.values()].flatMap((node) => node.position ? [[node.id, { ...node.position }]] : [])),
      nodeChanges: changeMarks(graphNodes.filter((node) => node.id !== dataset.rootId).map((node) => node.id), previousNodes, order === 0, stage.replacements?.nodes ?? []),
      edgeChanges: changeMarks(graphEdges.map((link) => link.id), previousLinks, order === 0, stage.replacements?.links ?? []),
    };
  });
}
