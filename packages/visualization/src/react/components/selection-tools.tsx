/** Selection toolbar for grouping multiple selected nodes and dissolving clusters. */
import { Icon } from './icon.tsx';
import type { LayoutMode } from '../model/grouping.ts';

export interface SelectionToolsProps {
  label: string;
  canGroup: boolean;
  onGroup(): void;
  onUngroup?: () => void;
  modes: ReadonlySet<string>;
  onMode(mode: LayoutMode): void;
}

/** 选中操作浮条；显示已选计数，并提供一键聚合分组与分组解散操作。 */
export function SelectionTools({ label, canGroup, onGroup, onUngroup, modes, onMode }: SelectionToolsProps) {
  return label && <div className="selection-tools" role="toolbar" aria-label="节点操作"><span>{label}</span>
    <div className="layout-modes" role="group" aria-label="布局约束">{([
      ['free', '自由', 'move'], ['fixed', '固定', 'pin'], ['locked', '锁定', 'lock'],
    ] as const).map(([mode, title, icon]) => <button key={mode} aria-label={title} title={title} aria-pressed={modes.size === 1 && modes.has(mode)} onClick={() => onMode(mode)}><Icon name={icon} /><span>{title}</span></button>)}</div>
    {canGroup && <button onClick={onGroup} title="Ctrl + G"><Icon name="group" />聚合</button>}{onUngroup && <button onClick={onUngroup}>解散</button>}</div>;
}
