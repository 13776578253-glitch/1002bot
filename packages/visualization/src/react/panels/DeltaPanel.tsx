import type { CanvasScene } from '../../core/engine/scene.ts';
import { useCanvasStore } from '../store/canvas-store.ts';

export function DeltaPanel({ scene }: { scene: CanvasScene }) {
  const select = useCanvasStore((state) => state.select);
  const changedNodes = scene.delta?.nodes.filter((item) => item.kind !== 'inherited').length ?? 0;
  const changedEdges = scene.delta?.edges.filter((item) => item.kind !== 'inherited').length ?? 0;
  return (
    <div className="av-deltabar av-canvas-delta" aria-live="polite">
      <div className="av-delta-summary">
        <span>{scene.stage.order === 1 ? '基线版本' : changedNodes + ' 个节点变化 · ' + changedEdges + ' 条关系变化'}</span>
        {scene.delta && <button type="button" className="av-delta-summary-btn" onClick={() => select(undefined)}>查看明细</button>}
      </div>
      <div className="av-delta-legend" aria-label="增量图例">
        <span className="av-delta-legend-item added">新增</span>
        <span className="av-delta-legend-item changed">修改</span>
        <span className="av-delta-legend-item inherited">沿用</span>
      </div>
    </div>
  );
}
