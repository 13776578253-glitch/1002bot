/** Original relation inspection and canonical endpoint navigation for a selected display edge. */
import { memo, useId, useMemo } from 'react';
import type { StageSnapshot } from '../../core/schema/types.ts';
import { relationNames, type DisplayEdge } from '../model/display-edges.ts';
import { ChangeBadge } from './change-badge.tsx';
import { Icon } from './icon.tsx';

export interface ConnectionPanelProps {
  edge: DisplayEdge;
  stage: StageSnapshot;
  onClose(): void;
  onLocate(edgeId: string): void;
  message?: string;
}

export const ConnectionPanel = memo(function ConnectionPanel({ edge, stage, onClose, onLocate, message }: ConnectionPanelProps) {
  const heading = useId();
  const paths = useMemo(() => {
    const nodes = new Map(stage.graph.nodes.map((node) => [node.id, node]));
    return new Map(stage.graph.nodes.map((node) => {
      const labels: string[] = [];
      let cursor = node;
      while (cursor.id !== stage.graph.rootId) {
        labels.unshift(cursor.label);
        cursor = nodes.get(cursor.parentId!)!;
      }
      return [node.id, labels.join(' / ')];
    }));
  }, [stage]);
  return <aside className="connection-panel" aria-labelledby={heading}>
    <div className="connection-panel-header"><h2 id={heading}>原始连接</h2><button className="icon-button" aria-label="关闭连接列表" onClick={onClose}><Icon name="close" /></button></div>
    <div className="connection-panel-summary">{edge.text}</div>
    {message && <p className="connection-message" role="status">{message}</p>}
    <ol className="connection-list">{edge.members.map((member) => {
      const label = member.label ?? relationNames[member.relation];
      return <li className="connection-item" key={member.canonicalEdgeId}>
        <div className="connection-name"><span>{label}</span><ChangeBadge change={edge.memberChanges[member.canonicalEdgeId]} /></div>
        <div className="connection-endpoints"><span>{paths.get(member.source.canonicalNodeId)}</span><span aria-label={member.direction === 'bidirectional' ? '双向' : '指向'}>{member.direction === 'bidirectional' ? '↔' : '→'}</span><span>{paths.get(member.target.canonicalNodeId)}</span></div>
        <button className="connection-locate" aria-label={`定位连接：${label}`} onClick={() => onLocate(member.canonicalEdgeId)}><Icon name="fit" />定位端点</button>
      </li>;
    })}</ol>
  </aside>;
});
