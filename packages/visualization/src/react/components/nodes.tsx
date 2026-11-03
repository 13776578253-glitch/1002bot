/** Memoized node renderers subscribe only to their own supplied view data. */
import type { NodeProps } from '@xyflow/react';
import { memo, useState, type CSSProperties } from 'react';
import { RESPONSIBILITY_CARD_SIZE, structureHeaderHeight, type CanvasNode } from '../model/grouping.ts';
import { ChangeBadge } from './change-badge.tsx';
import { Icon } from './icon.tsx';
import { Ports } from './ports.tsx';

function LayoutMark({ mode }: { mode: CanvasNode['data']['layoutMode'] }) {
  return mode && mode !== 'free' ? <span className="layout-mark" title={mode === 'fixed' ? '固定' : '锁定'} aria-label={mode === 'fixed' ? '固定' : '锁定'}><Icon name={mode === 'fixed' ? 'pin' : 'lock'} /></span> : null;
}

function Responsibilities({ details, title }: { details: readonly string[] | undefined; title: string }) {
  const [page, setPage] = useState(0);
  if (!details?.length) return null;
  const pages = Math.ceil(details.length / 4), current = Math.min(page, pages - 1);
  const items = details.slice(current * 4, current * 4 + 4);
  const compact = details.length <= 2;
  return <div className="responsibility-panel" data-layout={compact ? 'compact' : 'grid'} style={{ '--responsibility-card-width': `${RESPONSIBILITY_CARD_SIZE.width}px`, '--responsibility-card-height': `${RESPONSIBILITY_CARD_SIZE.height}px`, '--responsibility-card-gap': `${RESPONSIBILITY_CARD_SIZE.gap}px` } as CSSProperties}>
    <ul className="card-responsibilities" aria-label={`${title}内部职责`}>{Array.from({ length: compact ? 2 : 4 }, (_, index) => {
    const detail = items[index];
    if (detail === undefined) return <li key={index} className="responsibility-placeholder" aria-hidden="true" />;
    const separator = detail.search(/[：:]/);
    return <li key={index} title={detail}>{separator > 0
      ? <><span className="responsibility-title">{detail.slice(0, separator)}</span><span className="responsibility-summary">{detail.slice(separator + 1).trim()}</span></>
      : <span className="responsibility-text">{detail}</span>}</li>;
  })}</ul>
    <div className="responsibility-pagination nodrag nopan">{pages > 1 && <>
      <button aria-label={`${title}职责上一页`} disabled={current === 0} onClick={(event) => { event.stopPropagation(); setPage(current - 1); }}>上一页</button>
      <span aria-live="polite">{current + 1} / {pages}</span>
      <button aria-label={`${title}职责下一页`} disabled={current === pages - 1} onClick={(event) => { event.stopPropagation(); setPage(current + 1); }}>下一页</button>
    </>}</div>
  </div>;
}

export const Card = memo(function Card({ data, selected, width, height }: NodeProps<CanvasNode>) {
  return <div className={`flow-card ${selected ? 'is-selected' : ''} ${data.planned ? 'is-planned' : ''}`} data-change={data.change?.kind} data-layout-mode={data.layoutMode ?? 'free'} data-frozen={data.frozen ? 'true' : undefined}>
    <Ports width={width ?? 0} height={height ?? 0} />
    <div className="card-title"><span className="card-name">{data.title}</span><LayoutMark mode={data.layoutMode} /><ChangeBadge change={data.change} />{data.expanded && !data.childCount && !!data.details?.length && <span className="terminal-badge">末端</span>}{data.planned && <span className="planned-badge">规划</span>}{data.expandable && <button className="structure-toggle nodrag nopan" aria-label={`${data.expanded ? '收起' : '展开'}${data.title}`} aria-expanded={!!data.expanded} onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}>{!!data.childCount && <span>{data.childCount}</span>}<Icon name={data.expanded ? 'collapse' : 'expand'} /></button>}</div>
    <div className="card-summary" title={data.summary}>{data.summary}</div>
    {data.expanded && <Responsibilities details={data.details} title={data.title} />}
  </div>;
});

export const Structure = memo(function Structure({ data, selected, width, height }: NodeProps<CanvasNode>) {
  return <div className={`structure-frame ${selected ? 'is-selected' : ''}`} data-change={data.change?.kind} data-layout-mode={data.layoutMode ?? 'free'} data-frozen={data.frozen ? 'true' : undefined}>
    <Ports width={width ?? 0} height={height ?? 0} />
    <div className="structure-header" style={{ height: structureHeaderHeight({ data }) }}>
      <div className="structure-heading"><div className="card-title">{data.title}<LayoutMark mode={data.layoutMode} /><ChangeBadge change={data.change} /></div><div className="card-summary">{data.summary}</div><Responsibilities details={data.details} title={data.title} /></div>
      <button className="structure-toggle nodrag nopan" aria-label={`收起${data.title}`} aria-expanded={true} onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}><span>{data.childCount}</span><Icon name="collapse" /></button>
    </div>
  </div>;
});

export const Cluster = memo(function Cluster({ data, selected, width, height }: NodeProps<CanvasNode>) {
  return <div className={`cluster ${selected ? 'is-selected' : ''}`} data-layout-mode={data.layoutMode ?? 'free'} data-frozen={data.frozen ? 'true' : undefined}>
    <Ports width={width ?? 0} height={height ?? 0} />
    <div className="cluster-drag-handle">
      <span className="cluster-grip" aria-hidden="true" title="拖动分组"><Icon name="group" /></span>
      <input className="cluster-title nodrag nopan" aria-label="聚合分组标题" value={data.title} readOnly={data.layoutMode === 'locked'} title="修改分组标题" onChange={(event) => data.onRename?.(event.target.value)} onBlur={() => { if (data.layoutMode !== 'locked') { data.onRename?.(data.title.trim() || '聚合分组'); data.onRenameCommit?.(); } }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <LayoutMark mode={data.layoutMode} /><span>{data.childCount}</span>
    </div>
  </div>;
});
