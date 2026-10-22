/**
 * Leaf card node: status pill, icon, title, description, meta row.
 * Visual classes come from themes/default.css (av-* prefix). Status text is
 * provided by CSS ::after via data-status-label, so the element stays empty.
 */

import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '../canvas/projection-to-flow.ts';
import { NodePorts } from './ports.tsx';

type CardNodeType = Node<FlowNodeData, 'card'>;

export function CardNode({ data, selected }: NodeProps<CardNodeType>) {
  const status = data.planned ? 'planned' : data.deltaKind ?? 'inherited';
  return (
    <div
      className={['av-card', `av-delta-${status}`, selected ? 'av-card--selected' : ''].join(' ')}
      data-status-label={status}
      data-expanded={data.expanded ? 'true' : 'false'}
      title={data.deltaNote ?? data.summary}
      role="button"
      tabIndex={0}
      aria-label={`${data.title}${data.summary ? `：${data.summary}` : ''}`}
      onClick={(event) => { event.stopPropagation(); data.onSelect?.(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (data.expandable) data.onToggle?.();
        else data.onSelect?.();
      }}
    >
      <NodePorts customPorts={data.ports} />
      <span className="av-card-status" aria-label={status} />
      <div className="av-card-body">
        <div className="av-card-icon" aria-hidden>
          {iconFor(data)}
        </div>
        <div className="av-card-copy">
          <div className="av-card-title">{data.title}</div>
          {data.summary && <div className="av-card-desc">{data.summary}</div>}
        </div>
        {data.expandable && (
          <button type="button" className="av-card-action nodrag" aria-expanded={data.expanded} aria-label={data.expanded ? '收起' : '展开'} onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}>
            <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}
      </div>
      {data.sourceRefs && data.sourceRefs.length > 0 && (
        <div className="av-card-meta">
          <span className="av-card-meta-item">{data.sourceRefs?.[0]}</span>
        </div>
      )}
    </div>
  );
}

function iconFor(data: FlowNodeData): string {
  const key = data.path.split('/').pop() ?? '';
  const table: Record<string, string> = {
    runtime: '⚙️',
    agent: '🧠',
    provider: '🔌',
    world: '🌐',
    session: '💾',
    console: '🖥️',
    heartbeat: '💓',
    memory: '🧩',
    store: '🗄️',
  };
  return table[key] ?? '▦';
}
