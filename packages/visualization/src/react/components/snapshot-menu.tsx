/** Snapshot popover presentation; saved snapshot actions are supplied in a later integration. */
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon.tsx';

export function SnapshotMenu({ workspaceTitle, stageLabel }: { workspaceTitle: string; stageLabel: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [open]);
  return <>
    <button ref={trigger} className="icon-button top-action" aria-label="快照" title="快照" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Icon name="history" /></button>
    {open && <aside ref={panel} id={id} className="snapshot-panel" aria-labelledby={`${id}-title`} tabIndex={-1}>
      <div className="snapshot-header"><h2 id={`${id}-title`}>快照</h2><button className="icon-button" aria-label="保存快照" title="保存快照" aria-disabled="true"><Icon name="save" /></button></div>
      <div className="snapshot-workspace">
        <div className="snapshot-workspace-meta"><span>当前工作区</span><span className="snapshot-stage">{stageLabel}</span></div>
        <div className="snapshot-workspace-title"><span>{workspaceTitle}</span><Icon name="check" /></div>
      </div>
    </aside>}
  </>;
}
