/** Selection toolbar for grouping multiple selected nodes and dissolving clusters. */
import { Icon } from './icon.tsx';

export interface SelectionToolsProps {
  label: string;
  canGroup: boolean;
  onGroup(): void;
  onUngroup?: () => void;
}

/** 选中操作浮条；显示已选计数，并提供一键聚合分组与分组解散操作。 */
export function SelectionTools({ label, canGroup, onGroup, onUngroup }: SelectionToolsProps) {
  return label && <div className="selection-tools" role="toolbar" aria-label="聚合操作"><span>{label}</span>{canGroup && <button onClick={onGroup} title="Ctrl + G"><Icon name="group" />聚合</button>}{onUngroup && <button onClick={onUngroup}>解散</button>}</div>;
}
