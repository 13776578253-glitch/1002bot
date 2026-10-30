import { Icon } from './icon.tsx';

export interface SelectionToolsProps {
  label: string;
  canGroup: boolean;
  onGroup(): void;
  onUngroup?: () => void;
}

export function SelectionTools({ label, canGroup, onGroup, onUngroup }: SelectionToolsProps) {
  return label && <div className="selection-tools" role="toolbar" aria-label="聚合操作"><span>{label}</span>{canGroup && <button onClick={onGroup} title="Ctrl + G"><Icon name="group" />聚合</button>}{onUngroup && <button onClick={onUngroup}>解散</button>}</div>;
}
