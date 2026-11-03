/** Presentational snapshot detail; tab and note state stay local to this dialog. */
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon.tsx';

export interface SnapshotDialogProps {
  workspaceTitle: string;
  stageLabel: string;
  description?: string;
  stages: readonly { id: string; label: string }[];
  stageId: string;
  viewLabel: string;
  confirmedAt?: string | undefined;
  confirmedCurrent?: boolean | undefined;
  onSelectStage(id: string): void;
  onClose(): void;
}

const tabs = ['详情', '活动记录', '备注'] as const;

export function SnapshotDialog({ workspaceTitle, stageLabel, stageId, stages, description, viewLabel, confirmedAt, confirmedCurrent, onSelectStage, onClose }: SnapshotDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const tabButtons = useRef<HTMLButtonElement[]>([]);
  const [tab, setTab] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => {
    closeButton.current!.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, [tabindex="0"]')).filter((element) => element.tabIndex >= 0);
      const first = controls[0]!, last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [onClose]);
  return <div className="snapshot-layer" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="snapshot-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} ref={dialog}>
      <button className="icon-button snapshot-close" aria-label="关闭快照" title="关闭" ref={closeButton} onClick={onClose}><Icon name="close" /></button>
      <div className="snapshot-main">
        <header className="snapshot-title-block"><span className="snapshot-eyebrow">快照 / 当前工作区</span><h2 id={`${id}-title`}>{workspaceTitle}</h2>{description && <p>{description}</p>}</header>
        <div className="snapshot-context"><div className="snapshot-context-heading"><Icon name="layers" /><span>关联工作区</span><span className="snapshot-badge">{stageLabel}</span></div><div className="snapshot-context-body"><span className="snapshot-context-dot" /><span>{workspaceTitle}</span></div></div>
        <div className="snapshot-tabs" role="tablist" aria-label="快照内容">{tabs.map((label, index) => <button key={label} ref={(element) => { tabButtons.current[index] = element!; }} role="tab" id={`${id}-tab-${index}`} aria-selected={tab === index} aria-controls={`${id}-panel-${index}`} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
          if (next === undefined) return;
          event.preventDefault(); event.stopPropagation(); setTab(next); tabButtons.current[next]!.focus();
        }}>{label}</button>)}</div>
        {tabs.map((label, index) => <section key={label} className="snapshot-tab-content" role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} tabIndex={tab === index ? 0 : -1} hidden={tab !== index}>
          {index === 1 && <div className="snapshot-activity-empty"><Icon name="history" /><p>暂无可显示的活动</p></div>}
          {index === 2 && <label className="snapshot-note"><span>快照备注</span><textarea placeholder="记录这次快照的说明…" value={note} onChange={(event) => setNote(event.target.value)} /></label>}
        </section>)}
      </div>
      <aside className="snapshot-sidebar" aria-label="快照属性">
        <div className="snapshot-properties"><h3>快照属性</h3><dl>
          <div><dt>状态</dt><dd><span className="snapshot-status"><span />{confirmedAt ? confirmedCurrent ? '已确认' : '有未确认修改' : '草稿'}</span></dd></div>
          <div><dt>视图</dt><dd>{viewLabel}</dd></div>
          <div><dt><label htmlFor={`${id}-stage`}>所属阶段</label></dt><dd><div className="snapshot-stage"><select id={`${id}-stage`} value={stageId} onChange={(event) => { const next = event.target.value; if (next !== stageId) onSelectStage(next); }}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select><Icon name="down" /></div></dd></div>
          <div><dt>标签</dt><dd className="snapshot-unset">—</dd></div>
          <div><dt>确认时间</dt><dd>{confirmedAt ? new Date(confirmedAt).toLocaleString() : '—'}</dd></div>
        </dl></div>
        <div className="snapshot-management"><h3>Revert or delete</h3><button className="snapshot-delete" aria-disabled="true">Delete</button></div>
      </aside>
      <div className="snapshot-rail" aria-label="快照导航"><div><button className="icon-button" aria-label="上一个快照" title="上一个快照" disabled><Icon name="up" /></button><button className="icon-button" aria-label="下一个快照" title="下一个快照" disabled><Icon name="down" /></button></div></div>
    </div>
  </div>;
}
