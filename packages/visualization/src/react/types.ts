/** React canvas component options and input contracts. */
import type { VisualizationBaseline } from '../core/schema/baseline.ts';

export interface VisualizationCanvasProps {
  /** 架构演进基线快照数组；至少包含一项，按数组顺序渲染。 */
  baselines: readonly VisualizationBaseline[];
  /** 初始选择的基线 ID；未指定时默认选中最后一项。 */
  initialBaselineId?: string;
  /** 初始主题外观；未指定时默认从本地存储读取或回退至深色主题。 */
  initialTheme?: 'dark' | 'light';
}
