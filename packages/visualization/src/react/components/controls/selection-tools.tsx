/** Selection tools own layout-mode, grouping and freeze actions for the current selection. */
import { Icon } from '../icon.tsx';
import type { LayoutMode } from '../../model/grouping.ts';

export interface SelectionToolsProps {
  label: string;
  canGroup: boolean;
  onGroup(): void;
  onUngroup?: () => void;
  canFreeze?: boolean;
  canUnfreeze?: boolean;
  onFreeze?(): void;
  onUnfreeze?(): void;
  modes: ReadonlySet<string>;
  onMode(mode: LayoutMode): void;
}

/** 选中操作浮条；布局约束、聚合/解散与冻结/解冻只作用于当前选择。 */
export function SelectionTools({ label, canGroup, onGroup, onUngroup, canFreeze, canUnfreeze, onFreeze, onUnfreeze, modes, onMode }: SelectionToolsProps) {
  // 混合约束不点亮任何模式；只有选择内模式一致时才显示按下态。
  return label && <div className="selection-tools" role="toolbar" aria-label="节点操作"><span>{label}</span>
    <div className="layout-modes" role="group" aria-label="布局约束">{([
      ['free', '自由', 'move'], ['fixed', '固定', 'pin'], ['locked', '锁定', 'lock'],
    ] as const).map(([mode, title, icon]) => <button key={mode} aria-label={title} title={title} aria-pressed={modes.size === 1 && modes.has(mode)} onClick={() => onMode(mode)}><Icon name={icon} /><span>{title}</span></button>)}</div>
    {canGroup && <button onClick={onGroup} title="Ctrl + G"><Icon name="group" />聚合</button>}{onUngroup && <button onClick={onUngroup}>解散</button>}
    {canFreeze && onFreeze && <button onClick={onFreeze} title="冻结选中子图"><Icon name="lock" />冻结</button>}
    {canUnfreeze && onUnfreeze && <button onClick={onUnfreeze} title="解冻选中冻结组"><Icon name="move" />解冻</button>}
  </div>;
}
