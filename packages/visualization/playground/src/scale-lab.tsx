import { useMemo } from 'react';
import { VisualizationCanvas } from '../../src/react/index.ts';
import { scaleBaseline } from './scale-baseline.ts';

export function ScaleLab() {
  const params = new URLSearchParams(location.search);
  const edges = Math.max(10, Math.min(200, Number(params.get('edges') ?? 200)));
  const crossed = params.get('crossed') === '1';
  const baseline = useMemo(() => scaleBaseline(edges, crossed), [edges, crossed]);
  return <div className="scale-lab" data-lab="scale" data-edges={edges} data-crossed={crossed ? '1' : '0'} style={{ width: '100vw', height: '100vh' }}>
    <VisualizationCanvas baselines={[baseline]} initialBaselineId={baseline.id} />
  </div>;
}
