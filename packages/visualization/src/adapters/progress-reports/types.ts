/** Legacy report catalog and cumulative stage declarations; no IO or UI dependencies. */
import type { CanonicalEdge, CanonicalNode } from '../../core/schema/types.ts';

export interface ReportNode extends Omit<CanonicalNode, 'ports'> {
  /** 世界坐标；缺省时不提供初始位置。 */
  position?: { x: number; y: number };
}

export interface ReportLink {
  id: string;
  source: string;
  target: string;
  relation: CanonicalEdge['relation'];
  label: string;
  order: number;
  /** 缺省为 'directed'。 */
  direction?: CanonicalEdge['direction'];
}

export interface ReportReplacement {
  id: string;
  previousId: string;
  /** 替换说明；只进入变更标记，不参与匹配。 */
  note: string;
}

export interface ReportStage {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  /** 格式为 YYYY-MM-DD。 */
  date: string;
  /** 相对仓库根目录的文档路径。 */
  source: string;
  /** 自由文本说明，不参与身份判断。 */
  status: string;
  /** 目录键；记录按自身稳定 ID 写入，已存在则覆盖元数据。 */
  nodes: readonly string[];
  /** 目录键；记录按自身稳定 ID 写入，已存在则覆盖元数据。 */
  links: readonly string[];
  removeNodes?: readonly string[];
  removeLinks?: readonly string[];
  /** 替换溯源；与 removeNodes/removeLinks 独立生效。 */
  replacements?: {
    nodes?: readonly ReportReplacement[];
    links?: readonly ReportReplacement[];
  };
}

export interface ReportDataset {
  rootId: string;
  /** 源数据版本；拼接为每个阶段的 graph.revision。 */
  revision: string;
  /** 全局节点目录；阶段通过键引用。 */
  nodes: Readonly<Record<string, ReportNode>>;
  /** 全局连线目录；阶段通过键引用。 */
  links: Readonly<Record<string, ReportLink>>;
  /** 数组顺序即演进顺序。 */
  stages: readonly ReportStage[];
}
