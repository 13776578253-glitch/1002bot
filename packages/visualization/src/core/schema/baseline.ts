/** Baseline presentation contracts and boundary validation. */
import type { StageSnapshot } from './types.ts';
import { assertValidSnapshot } from './validate.ts';

/** 基线实体演进类型；added/replaced 显示变更徽标与强调色，baseline/inherited 保持常规展示。 */
export type ChangeKind = 'baseline' | 'added' | 'inherited' | 'replaced';

export interface ChangeMark {
  kind: ChangeKind;
  label: string;
  note?: string;
  /** 替换标记对应的上一实体 ID；增量布局据此继承旧位置。 */
  previousId?: string;
}

/** 完整架构版本基线合同；包含阶段快照、显示变更标记及可选的初始位置映射。 */
export interface VisualizationBaseline {
  id: string;
  stage: StageSnapshot;
  /** 上一阶段 ID；缺省时按基线数组顺序取前一项。 */
  previousStageId?: string;
  /** 节点初始坐标；根节点为画布绝对坐标，子节点为直接父节点局部坐标。缺省时自动使用网格布局。 */
  positions?: Readonly<Record<string, { x: number; y: number }>>;
  nodeChanges: Readonly<Record<string, ChangeMark>>;
  edgeChanges: Readonly<Record<string, ChangeMark>>;
}

/**
 * 数据源边界校验。
 * 断言基线非空、ID 唯一、快照结构完备、全量非根节点及连线具备合法变更标记且坐标数值有限。
 */
export function assertValidBaselines(baselines: readonly VisualizationBaseline[]): void {
  if (!baselines.length) throw new Error('At least one visualization baseline is required');
  const ids = new Set<string>();
  const kinds = new Set<ChangeKind>(['baseline', 'added', 'inherited', 'replaced']);
  for (const baseline of baselines) {
    if (!baseline.id.trim() || ids.has(baseline.id)) throw new Error(`Duplicate or empty baseline id: ${baseline.id}`);
    ids.add(baseline.id);
    assertValidSnapshot(baseline.stage);
    const graph = baseline.stage.graph;
    for (const [entities, changes] of [
      [graph.nodes.filter((node) => node.id !== graph.rootId), baseline.nodeChanges],
      [graph.edges, baseline.edgeChanges],
    ] as const) {
      for (const entity of entities) {
        const change = changes[entity.id];
        if (!change || !kinds.has(change.kind) || !change.label.trim()) throw new Error(`Missing or invalid change mark: ${baseline.id}/${entity.id}`);
      }
    }
    for (const [id, position] of Object.entries(baseline.positions ?? {})) {
      if (!graph.nodes.some((node) => node.id === id) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error(`Invalid initial position: ${baseline.id}/${id}`);
    }
  }
}
