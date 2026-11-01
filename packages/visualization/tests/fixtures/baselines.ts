/** Sample architecture baselines for visualization tests. */
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';
import type { ChangeKind, ChangeMark, VisualizationBaseline } from '../../src/core/schema/baseline.ts';

const component = (id: string, parentId: string | null, label: string, summary: string, order: number): CanonicalNode => ({
  id, parentId, label, summary, kind: parentId === null ? 'root' : 'component', ports: [], order,
});
const edge = (id: string, source: string, target: string, label: string, order: number, relation: CanonicalEdge['relation'] = 'data'): CanonicalEdge => ({
  id, source: { nodeId: source }, target: { nodeId: target }, label, relation, order, direction: 'directed',
});
const commonNodes: CanonicalNode[] = [
  component('system', null, '架构系统', '', 0),
  component('entry', 'system', '入口适配', '接收外部消息并统一格式', 1),
  component('session', 'system', '会话管理', '维护会话状态与上下文', 2),
  component('scheduler', 'system', '任务调度', '排队并派发执行任务', 3),
  component('tools', 'system', '工具执行', '运行外部工具并收集结果', 4),
  component('bus', 'system', '事件总线', '在组件间广播事件', 6),
  component('session-receive', 'session', '消息接收', '归一消息并识别会话', 0),
  component('session-context', 'session', '上下文管理', '读取历史并组装上下文', 1),
  component('session-dispatch', 'session', '调度出口', '携带上下文提交任务', 2),
  component('context-history', 'session-context', '历史读取', '按会话获取最近消息', 0),
  component('context-compose', 'session-context', '上下文组装', '整理消息与摘要', 1),
  component('compose-trim', 'context-compose', '消息裁剪', '按上下文容量保留消息', 0),
  component('compose-summary', 'context-compose', '摘要合并', '合并摘要与当前输入', 1),
];
const commonEdges: CanonicalEdge[] = [
  edge('e-entry-session', 'entry', 'session-receive', '接入', 0, 'call'),
  edge('e-session-scheduler', 'session-dispatch', 'scheduler', '派发', 1, 'control'),
  edge('e-scheduler-tools', 'scheduler', 'tools', '执行', 2, 'call'),
  edge('e-scheduler-bus', 'scheduler', 'bus', '发布', 4, 'event'),
  edge('e-bus-session', 'bus', 'compose-summary', '回报', 5, 'event'),
  edge('session-message', 'session-receive', 'context-history', '消息', 6),
  edge('context-input', 'context-history', 'compose-trim', '历史', 7),
  edge('context-summary', 'compose-trim', 'compose-summary', '整理', 8),
  edge('session-ready', 'compose-summary', 'session-dispatch', '上下文', 9),
];
export const samplePositions = {
  entry: { x: 290, y: 0 }, session: { x: 290, y: 150 }, scheduler: { x: 290, y: 300 },
  tools: { x: 120, y: 470 }, bus: { x: 620, y: 470 }, memory: { x: 120, y: 640 },
  'memory-durable': { x: 120, y: 640 }, audit: { x: 620, y: 640 },
  'session-receive': { x: 24, y: 72 }, 'session-context': { x: 336, y: 72 }, 'session-dispatch': { x: 648, y: 72 },
  'context-history': { x: 24, y: 72 }, 'context-compose': { x: 336, y: 72 },
  'compose-trim': { x: 24, y: 72 }, 'compose-summary': { x: 24, y: 218 },
};
const first: StageSnapshot = {
  id: 'M1', label: 'M1', title: '最小闭环', subtitle: '入口到记忆的单线链路', track: 'main', order: 1,
  graph: {
    rootId: 'system', revision: 'M1',
    nodes: [...commonNodes.slice(0, 5), { ...component('memory', 'system', '会话记忆', '随会话保留执行结果', 5), kind: 'store' }, ...commonNodes.slice(5)],
    edges: [...commonEdges.slice(0, 3), edge('e-tools-memory', 'tools', 'memory', '写入', 3, 'storage'), ...commonEdges.slice(3)],
  },
};
const second: StageSnapshot = {
  id: 'M2', label: 'M2', title: '审计留痕', subtitle: '执行记录进入独立存储', track: 'main', order: 2,
  graph: {
    rootId: 'system', revision: 'M2',
    nodes: [...first.graph.nodes.map((node): CanonicalNode => node.id === 'memory' ? { ...node, id: 'memory-durable', label: '持久记忆', summary: '跨会话保存记忆与事件' } : node), { ...component('audit', 'system', '审计日志', '记录关键操作的审计痕迹', 7), kind: 'store' }],
    edges: [...first.graph.edges.map((item): CanonicalEdge => item.id === 'e-tools-memory' ? { ...item, id: 'e-tools-durable', target: { nodeId: 'memory-durable' } } : item), edge('e-tools-audit', 'tools', 'audit', '留痕', 10, 'storage')],
  },
};
const mark = (kind: ChangeKind, note?: string): ChangeMark => ({ kind, label: { baseline: '基线', added: '新增', inherited: '沿用', replaced: '替换' }[kind], ...(note ? { note } : {}) });
const positionsFor = (stage: StageSnapshot) => Object.fromEntries(stage.graph.nodes.filter((node) => node.id !== stage.graph.rootId).map((node) => [node.id, samplePositions[node.id as keyof typeof samplePositions]]));

export const sampleBaselines: readonly VisualizationBaseline[] = [
  {
    id: 'M1', stage: first, positions: positionsFor(first),
    nodeChanges: Object.fromEntries(first.graph.nodes.filter((node) => node.parentId !== null).map((node) => [node.id, mark('baseline')])),
    edgeChanges: Object.fromEntries(first.graph.edges.map((item) => [item.id, mark('baseline')])),
  },
  {
    id: 'M2', stage: second, positions: positionsFor(second),
    nodeChanges: Object.fromEntries(second.graph.nodes.filter((node) => node.parentId !== null).map((node) => [node.id, node.id === 'memory-durable' ? mark('replaced', '持久记忆替换 M1 的会话记忆') : mark(node.id === 'audit' ? 'added' : 'inherited')])),
    edgeChanges: Object.fromEntries(second.graph.edges.map((item) => [item.id, item.id === 'e-tools-durable' ? mark('replaced', '工具执行改写持久记忆，替换 M1 的会话记忆写入') : mark(item.id === 'e-tools-audit' ? 'added' : 'inherited')])),
  },
];
