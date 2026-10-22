/**
 * Aggregate container node: light frame whose children render inside via
 * React Flow's parentId subflow. Header carries title, count and status.
 */

import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '../canvas/projection-to-flow.ts';
import { NodePorts } from './ports.tsx';

type AggregateNodeType = Node<FlowNodeData, 'aggregate'>;

export function AggregateNode({ data, selected }: NodeProps<AggregateNodeType>) {
  const status = data.planned ? 'planned' : data.deltaKind ?? 'inherited';
  return (
    <div
      className={['av-aggregate', `av-delta-${status}`, selected ? 'av-aggregate--selected' : ''].join(' ')}
      data-status-label={status}
      role="button"
      tabIndex={0}
      aria-label={`${data.title}${data.summary ? `：${data.summary}` : ''}`}
      aria-expanded="true"
      onClick={(event) => { event.stopPropagation(); data.onSelect?.(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        data.onToggle?.();
      }}
    >
      <NodePorts customPorts={data.ports} />
      <div className="av-aggregate-header">
        <span className="av-aggregate-icon" aria-hidden>▦</span>
        <span className="av-aggregate-title">{data.title}</span>
        <span className="av-card-status" aria-label={status} />
        <button type="button" className="av-aggregate-action av-card-action nodrag" aria-expanded="true" aria-label="收起" onClick={(event) => { event.stopPropagation(); data.onToggle?.(); }}>
          <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {data.summary && <div className="av-aggregate-desc">{data.summary}</div>}
    </div>
  );
}
