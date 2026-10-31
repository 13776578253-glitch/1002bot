/** Memoized node renderers subscribe only to their own supplied view data. */
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { CanvasNode } from '../model/grouping.ts';
import { ChangeBadge } from './change-badge.tsx';
import { Icon } from './icon.tsx';
import { Ports } from './ports.tsx';

function LayoutMark({ mode }: { mode: CanvasNode['data']['layoutMode'] }) {
  return mode && mode !== 'free' ? <span className="layout-mark" title={mode === 'fixed' ? '固定' : '锁定'} aria-label={mode === 'fixed' ? '固定' : '锁定'}><Icon name={mode === 'fixed' ? 'pin' : 'lock'} /></span> : null;
}

export const Card = memo(function Card({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`flow-card ${selected ? 'is-selected' : ''} ${data.planned ? 'is-planned' : ''}`} data-change={data.change?.kind} data-layout-mode={data.layoutMode ?? 'free'} data-frozen={data.frozen ? 'true' : undefined}>
    <Ports />
    <div className="card-title"><span className="card-name">{data.title}</span><LayoutMark mode={data.layoutMode} /><ChangeBadge change={data.change} />{data.planned && <span className="planned-badge">规划</span>}{data.expandable && <button className="structure-toggle nodrag nopan" aria-label={`展开${data.title}`} aria-expanded={false} onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}><span>{data.childCount}</span><Icon name="expand" /></button>}</div>
    <div className="card-summary" title={data.summary}>{data.summary}</div>
  </div>;
});

export const Structure = memo(function Structure({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`structure-frame ${selected ? 'is-selected' : ''}`} data-change={data.change?.kind} data-layout-mode={data.layoutMode ?? 'free'} data-frozen={data.frozen ? 'true' : undefined}>
    <Ports />
    <div className="structure-header">
      <div className="structure-heading"><div className="card-title">{data.title}<LayoutMark mode={data.layoutMode} /><ChangeBadge change={data.change} /></div><div className="card-summary">{data.summary}</div></div>
      <button className="structure-toggle nodrag nopan" aria-label={`收起${data.title}`} aria-expanded={true} onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}><span>{data.childCount}</span><Icon name="collapse" /></button>
    </div>
  </div>;
});

export const Cluster = memo(function Cluster({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`cluster ${selected ? 'is-selected' : ''}`} data-layout-mode={data.layoutMode ?? 'free'} data-frozen={data.frozen ? 'true' : undefined}>
    <div className="cluster-drag-handle">
      <span className="cluster-grip" aria-hidden="true" title="拖动分组"><Icon name="group" /></span>
      <input className="cluster-title nodrag nopan" aria-label="聚合分组标题" value={data.title} readOnly={data.layoutMode === 'locked'} title="修改分组标题" onChange={(event) => data.onRename?.(event.target.value)} onBlur={() => { if (data.layoutMode !== 'locked') { data.onRename?.(data.title.trim() || '聚合分组'); data.onRenameCommit?.(); } }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <LayoutMark mode={data.layoutMode} /><span>{data.childCount}</span>
    </div>
  </div>;
});
