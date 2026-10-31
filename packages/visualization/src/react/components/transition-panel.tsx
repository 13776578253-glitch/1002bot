/** Read-only candidate preview and structured transition conflicts. */
import { memo, useId } from 'react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { StageConflict } from '../model/stage-types.ts';
import { Icon } from './icon.tsx';

export interface TransitionPanelProps {
  target: VisualizationBaseline;
  conflicts: readonly StageConflict[];
  onCancel(): void;
  onAdopt?(): void;
}

export const TransitionPanel = memo(function TransitionPanel({ target, conflicts, onCancel, onAdopt }: TransitionPanelProps) {
  const heading = useId();
  return <aside className="connection-panel transition-panel" aria-labelledby={heading}>
    <div className="connection-panel-header"><h2 id={heading}>阶段布局冲突</h2><button className="icon-button" aria-label="取消候选预览" onClick={onCancel}><Icon name="close" /></button></div>
    <div className="connection-panel-summary">{target.stage.label} · {target.stage.title}</div>
    <p className="connection-message" role="status">只读候选预览，未写入阶段快照。</p>
    {onAdopt && <button className="connection-locate" onClick={onAdopt}>从父阶段重新继承</button>}
    <ol className="connection-list">{conflicts.map((conflict, index) => <li className="connection-item" key={`${conflict.kind}:${index}`}>
      <div className="connection-name"><span>{conflict.kind}</span></div>
      <div className="connection-endpoints"><span>{conflict.message}</span></div>
      <div className="connection-endpoints"><span>{conflict.entityIds.join(' / ') || conflict.containerId || '布局约束'}</span></div>
      <button className="connection-locate" aria-label="取消候选预览" onClick={onCancel}><Icon name="close" />取消预览</button>
    </li>)}</ol>
  </aside>;
});
