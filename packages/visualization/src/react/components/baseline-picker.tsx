import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import { Icon } from './icon.tsx';

export interface BaselinePickerProps {
  baselines: readonly VisualizationBaseline[];
  selected: string;
  onSelect(id: string): void;
}

export function BaselinePicker({ baselines, selected, onSelect }: BaselinePickerProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeOption = useRef<HTMLInputElement>(null);
  const id = useId();
  const panelId = `${id}-baseline-panel`, headingId = `${id}-baseline-heading`;
  const currentIndex = baselines.findIndex((baseline) => baseline.id === selected);
  const current = baselines[currentIndex]!;
  const previous = baselines[currentIndex - 1];
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    activeOption.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [open, close]);
  return <>
    <button ref={trigger} className="baseline-button" aria-label="基线" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}><Icon name="layers" /></button>
    {open && <aside id={panelId} className="baseline-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">基线</h2>
      <fieldset className="baseline-options"><legend className="sr-only">选择基线</legend>
        {baselines.map((option) => <label className="baseline-option" key={option.id}>
          <span className="baseline-copy"><span className="baseline-name">{option.stage.label}<span>{option.stage.title}</span></span><span className="baseline-summary">{option.stage.subtitle}</span></span>
          <input className="sr-only" ref={selected === option.id ? activeOption : undefined} type="radio" name={`${id}-baseline`} value={option.id} aria-label={`${option.stage.label} ${option.stage.title}`} checked={selected === option.id} onChange={() => onSelect(option.id)} />
        </label>)}
      </fieldset>
      <div className="baseline-current" aria-live="polite">当前 {current.stage.label}{previous ? ` · 相对 ${previous.stage.label}` : ' · 初始基线'}</div>
    </aside>}
  </>;
}
