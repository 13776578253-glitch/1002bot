import type { VisualizationBaseline } from '../core/schema/baseline.ts';

export interface VisualizationCanvasProps {
  baselines: readonly VisualizationBaseline[];
  initialBaselineId?: string;
  initialTheme?: 'dark' | 'light';
}
