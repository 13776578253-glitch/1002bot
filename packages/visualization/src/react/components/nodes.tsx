import { useNodes, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../model/grouping.ts';
import { ChangeBadge } from './change-badge.tsx';
import { Icon } from './icon.tsx';
import { Ports } from './ports.tsx';

export function Card({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`flow-card ${selected ? 'is-selected' : ''} ${data.planned ? 'is-planned' : ''}`} data-change={data.change?.kind}>
    <Ports />
    <div className="card-title"><span className="card-name">{data.title}</span><ChangeBadge change={data.change} />{data.planned && <span className="planned-badge">规划</span>}{data.expandable && <button className="structure-toggle nodrag nopan" aria-label={`展开${data.title}`} aria-expanded={false} onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}><span>{data.childCount}</span><Icon name="expand" /></button>}</div>
    <div className="card-summary" title={data.summary}>{data.summary}</div>
  </div>;
}

export function Structure({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`structure-frame ${selected ? 'is-selected' : ''}`} data-change={data.change?.kind}>
    <Ports />
    <div className="structure-header">
      <div className="structure-heading"><div className="card-title">{data.title}<ChangeBadge change={data.change} /></div><div className="card-summary">{data.summary}</div></div>
      <button className="structure-toggle nodrag nopan" aria-label={`收起${data.title}`} aria-expanded={true} onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}><span>{data.childCount}</span><Icon name="collapse" /></button>
    </div>
  </div>;
}

export function Cluster({ id, data, selected }: NodeProps<CanvasNode>) {
  const children = useNodes<CanvasNode>().filter((node) => node.parentId === id);
  return <div className={`cluster ${selected ? 'is-selected' : ''}`}>
    <div className="cluster-drag-handle">
      <span className="cluster-grip" aria-hidden="true" title="拖动分组"><Icon name="group" /></span>
      <input className="cluster-title nodrag nopan" aria-label="聚合分组标题" value={data.title} title="修改分组标题" onChange={(event) => data.onRename?.(event.target.value)} onBlur={() => data.onRename?.(data.title.trim() || '聚合分组')} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <span>{children.length}</span>
    </div>
  </div>;
}
