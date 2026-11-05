/** Snapshot menu owns the trigger and portal lifetime for the snapshot dialog. */
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icon.tsx';
import { SnapshotDialog, type SnapshotDialogProps } from './snapshot-dialog.tsx';

/** 快照入口；对话框挂到画布宿主，关闭后焦点回到触发按钮。 */
export function SnapshotMenu(props: Omit<SnapshotDialogProps, 'onClose'>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // 关闭后把焦点还给入口按钮。
  const close = useCallback(() => { setOpen(false); trigger.current!.focus(); }, []);
  const select = useCallback((id: string) => {
    // 当前阶段不触发导航；切换后关闭弹窗。
    if (id === props.stageId) return;
    props.onSelectStage(id);
    close();
  }, [close, props.onSelectStage, props.stageId]);
  // 弹窗挂在画布作用域内，避免影响宿主文档。
  return <>
    <button ref={trigger} className="icon-button top-action" aria-label="快照" title="快照" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="history" /></button>
    {open && createPortal(<SnapshotDialog {...props} onClose={close} onSelectStage={select} />, trigger.current!.closest('.canvas-app')!)}
  </>;
}
