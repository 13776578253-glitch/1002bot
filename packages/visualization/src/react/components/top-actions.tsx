/** Project, snapshot and transfer entries share one compact canvas control strip. */
import { Icon } from './icon.tsx';
import { SnapshotMenu } from './snapshot-menu.tsx';

export function TopActions({ workspaceTitle, stageLabel, theme, onThemeChange }: {
  workspaceTitle: string;
  stageLabel: string;
  theme: 'dark' | 'light';
  onThemeChange(): void;
}) {
  return <div className="top-actions" role="toolbar" aria-label="项目与视图">
    <button className="icon-button top-action" aria-label="项目" title="项目" aria-disabled="true"><Icon name="folder" /></button>
    <SnapshotMenu workspaceTitle={workspaceTitle} stageLabel={stageLabel} />
    <span className="top-actions-divider" aria-hidden="true" />
    <button className="icon-button top-action" aria-label="导入" title="导入" aria-disabled="true"><Icon name="import" /></button>
    <button className="icon-button top-action" aria-label="导出" title="导出" aria-disabled="true"><Icon name="export" /></button>
    <span className="top-actions-divider" aria-hidden="true" />
    <button className="icon-button top-action" aria-label={`切换为${theme === 'dark' ? '浅' : '深'}色主题`} title={theme === 'dark' ? '浅色主题' : '深色主题'} onClick={onThemeChange}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
  </div>;
}
