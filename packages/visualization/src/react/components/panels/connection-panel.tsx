/** Connection panel owns relation inspection, route/label controls and endpoint navigation for one display edge. */
import { memo, useId, useMemo } from 'react';
import type { StageSnapshot } from '../../../core/schema/types.ts';
import { relationNames, type DisplayEdge } from '../../model/routing/display-edges.ts';
import type { EdgeRouteState } from '../../model/contracts/snapshot-types.ts';
import { ChangeBadge } from '../change-badge.tsx';
import { Icon } from '../icon.tsx';

/** 单条展示边详情；路径状态与标签位置独立，聚合边不提供路径状态。 */
export interface ConnectionPanelProps {
  edge: DisplayEdge;
  stage: StageSnapshot;
  onClose(): void;
  onLocate(edgeId: string): void;
  message?: string;
  routeState?: EdgeRouteState;
  onRouteState?(state: EdgeRouteState): void;
  labelState?: { pinned: boolean; visible: boolean };
  onLabelPinChange?(pinned: boolean): void;
}

const routeNames: Record<EdgeRouteState, string> = { auto: '自动', pinned: '固定', locked: '锁定' };

/** 连接详情面板；成员端点按根到自身的路径显示，定位动作交给画布。 */
export const ConnectionPanel = memo(function ConnectionPanel({ edge, stage, onClose, onLocate, message, routeState, onRouteState, labelState, onLabelPinChange }: ConnectionPanelProps) {
  const heading = useId();
  // 预计算每个规范节点的根到自身标签路径，成员端点直接查表。
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
    {labelState && onLabelPinChange && <div className="label-controls">
      <span className="label-status">{!labelState.visible ? '标签已隐藏' : labelState.pinned ? '标签位置已固定' : '标签自动放置'}</span>
      <div className="route-state" role="group" aria-label="标签位置">
        <button aria-pressed={labelState.pinned} disabled={labelState.pinned || !labelState.visible} onClick={() => onLabelPinChange(true)}>固定标签位置</button>
        <button disabled={!labelState.pinned} onClick={() => onLabelPinChange(false)}>恢复标签自动位置</button>
      </div>
    </div>}
    {onRouteState && !edge.aggregated && <div className="route-state" role="group" aria-label="路径状态">
      {(['auto', 'pinned', 'locked'] as const).map((state) => <button key={state} aria-pressed={(routeState ?? 'auto') === state} title={`路径状态：${routeNames[state]}`} onClick={() => onRouteState(state)}>{routeNames[state]}</button>)}
    </div>}
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
