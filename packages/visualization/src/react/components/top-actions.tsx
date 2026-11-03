/** Project actions and independent stage-view selection. */
import { Icon } from './icon.tsx';
import { SnapshotMenu } from './snapshot-menu.tsx';
import type { CanvasViewMode } from '../model/workspace.ts';

const modes = ['overview', 'structure', 'full'] as const;
const names = { overview: 'Overview View', structure: 'Structure View', full: 'Full View' };
export function TopActions({ workspaceTitle, stageLabel, stageId, stages, description, theme, onThemeChange, onSelectStage, viewMode, onSelectView, confirmationStatus, confirmedAt }: {
  workspaceTitle: string;
  stageLabel: string;
  description?: string;
  stageId: string;
  stages: readonly { id: string; label: string }[];
  theme: 'dark' | 'light';
  viewMode: CanvasViewMode;
  confirmationStatus: readonly { mode: CanvasViewMode; confirmed: boolean; current: boolean }[];
  confirmedAt?: string | undefined;
  onThemeChange(): void;
  onSelectStage(id: string): void;
  onSelectView(mode: CanvasViewMode): void;
}) {
  return <>
    <div className="view-selector" role="group" aria-label="阶段视图">
      <span className="view-stage-label">{stageLabel}</span>
      {modes.map((mode) => {
        const status = confirmationStatus.find((item) => item.mode === mode)!;
        return <button key={mode} aria-pressed={mode === viewMode} onClick={() => onSelectView(mode)} title={`${names[mode]} · ${status.current ? '已确认' : status.confirmed ? '需重新确认' : '草稿'}`}>
          {names[mode]}<span className={`view-confirmation ${status.current ? 'is-confirmed' : ''}`} aria-label={status.current ? '已确认' : '待确认'} />
        </button>;
      })}
    </div>
    <div className="top-actions" role="toolbar" aria-label="项目与视图">
      <button className="icon-button top-action" aria-label="项目" title="项目" aria-disabled="true"><Icon name="folder" /></button>
      <SnapshotMenu workspaceTitle={workspaceTitle} stageLabel={stageLabel} stageId={stageId} stages={stages} onSelectStage={onSelectStage} viewLabel={names[viewMode]} confirmedAt={confirmedAt} {...(description ? { description } : {})} />
      <span className="top-actions-divider" aria-hidden="true" />
      <button className="icon-button top-action" aria-label="导入" title="导入" aria-disabled="true"><Icon name="import" /></button>
      <button className="icon-button top-action" aria-label="导出" title="导出" aria-disabled="true"><Icon name="export" /></button>
      <span className="top-actions-divider" aria-hidden="true" />
      <button className="icon-button top-action" aria-label={`切换为${theme === 'dark' ? '浅' : '深'}色主题`} title={theme === 'dark' ? '浅色主题' : '深色主题'} onClick={onThemeChange}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
    </div>
  </>;
}
