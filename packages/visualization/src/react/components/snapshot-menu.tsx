/** Snapshot entry opens an isolated detail interface inside its canvas host. */
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon.tsx';
import { SnapshotDialog, type SnapshotDialogProps } from './snapshot-dialog.tsx';

export function SnapshotMenu(props: Omit<SnapshotDialogProps, 'onClose'>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); trigger.current!.focus(); }, []);
  return <>
    <button ref={trigger} className="icon-button top-action" aria-label="快照" title="快照" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="history" /></button>
    {open && createPortal(<SnapshotDialog {...props} onClose={close} />, trigger.current!.closest('.canvas-app')!)}
  </>;
}
