/** Transition panel owns the read-only candidate summary and structured conflict list; it writes no workspace state. */
import { memo, useId } from 'react';
import type { VisualizationBaseline } from '../../../core/schema/baseline.ts';
import type { StageConflict } from '../../model/stage-types.ts';
import { Icon } from '../icon.tsx';

/** 阶段切换失败时的只读候选；冲突列表与可选重继承动作都不写入工作区。 */
export interface TransitionPanelProps {
  target: VisualizationBaseline;
  conflicts: readonly StageConflict[];
  onCancel(): void;
  onAdopt?(): void;
}

/** 冲突面板按 kind 与序号展示；只有提供 onAdopt 时才显示重继承入口。 */
export const TransitionPanel = memo(function TransitionPanel({ target, conflicts, onCancel, onAdopt }: TransitionPanelProps) {
  const heading = useId();
  // 冲突项没有稳定 ID，使用 kind + 序号作 key；实体为空时回退到容器或通用标签。
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
