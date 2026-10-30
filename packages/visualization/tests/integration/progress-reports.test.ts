import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { adaptProgressReports, type ReportDataset } from '../../src/adapters/progress-reports/index.ts';
import { assertValidBaselines, projectGraph } from '../../src/index.ts';

const repository = new URL('../../../../', import.meta.url);
const dataset: ReportDataset = JSON.parse(await readFile(new URL('../../datasets/progress-reports/architecture.json', import.meta.url), 'utf8'));
const baselines = adaptProgressReports(dataset);
const baseline = (id: string) => baselines.find((item) => item.id === id)!;
const nodeIds = (id: string) => new Set(baseline(id).stage.graph.nodes.map((node) => node.id));

test('every published progress report maps to a complete valid baseline with source references', async () => {
  assertValidBaselines(baselines);
  const reports = (await readdir(new URL('docs/进度汇报/', repository))).filter((name) => /-M\d+\.\d+进度与架构图\.md$/.test(name)).sort();
  assert.deepEqual(dataset.stages.map((stage) => stage.source.split('/').at(-1)).sort(), reports);
  for (const item of baselines) {
    await access(new URL(item.stage.doc!, repository));
    assert.deepEqual(Object.keys(item.nodeChanges).sort(), item.stage.graph.nodes.filter((node) => node.parentId !== null).map((node) => node.id).sort());
    assert.deepEqual(Object.keys(item.edgeChanges).sort(), item.stage.graph.edges.map((edge) => edge.id).sort());
    for (const node of item.stage.graph.nodes) {
      assert.ok(node.sourceRefs!.length, `${item.id}/${node.id}`);
      const [document, heading] = node.sourceRefs![0]!.split('#');
      const report = await readFile(new URL(document!, repository), 'utf8');
      assert.ok(report.includes(`## ${heading}`), `${node.id}: ${document}#${heading}`);
    }
  }
});

test('early milestones retain their historical execution paths and State remains a key-value capability', () => {
  const first = nodeIds('M1.0'), second = nodeIds('M2.0'), unified = nodeIds('M3.0');
  assert.ok(first.has('event-loop') && first.has('test-agent'));
  assert.ok(!first.has('input-queue') && !first.has('heartbeat'));
  assert.ok(second.has('event-loop') && second.has('input-queue') && second.has('conversation-agent'));
  assert.equal(baseline('M2.0').nodeChanges['conversation-agent']!.kind, 'replaced');
  assert.ok(!unified.has('input-run') && !unified.has('event-loop'));
  assert.ok(unified.has('trigger-run') && unified.has('trigger-channel') && unified.has('heartbeat'));
  assert.equal(baseline('M3.0').nodeChanges['trigger-run']!.kind, 'replaced');
  assert.equal(baseline('M3.0').stage.graph.edges.find((edge) => edge.id === 'trigger-save')!.label, '执行过程事实');
  assert.equal(baseline('M3.0').stage.graph.edges.find((edge) => edge.id === 'channel-save')!.label, '接收与唯一终态事实');
  assert.equal(baseline('M1.0').stage.graph.nodes.find((node) => node.id === 'state')!.summary, '仅装配实例内键值能力');
});

test('M4 runtime projections and the QQ extension keep their ownership boundaries', () => {
  const fourth = baseline('M4.0');
  for (const id of ['delivery-state', 'preflight', 'session-audit', 'history-window']) {
    assert.equal(fourth.stage.graph.nodes.find((node) => node.id === id)!.parentId, 'runtime');
  }
  assert.ok(!nodeIds('M4.0').has('qq-world'));
  const qq = baseline('M4.1');
  assert.equal(qq.stage.graph.nodes.find((node) => node.id === 'qq-world')!.parentId, 'world');
  assert.equal(qq.stage.graph.nodes.find((node) => node.id === 'snowluma')!.parentId, dataset.rootId);
  const projection = projectGraph(qq.stage, new Set(['world', 'qq-world', 'runtime']));
  assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'pump-sink')!.source.nodeId, 'qq-pump');
  assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'pump-sink')!.target.nodeId, 'world-sink');
  assert.equal(qq.stage.graph.edges.find((edge) => edge.id === 'delivery-saved-pump')!.target.nodeId, 'qq-pump');
  assert.equal(qq.stage.graph.edges.find((edge) => edge.id === 'pump-journal-saved')!.source.nodeId, 'qq-pump');
});

test('QQ Chat adds an independent memory assembly while retaining Core tasks and disk storage', () => {
  const chat = baseline('M5.1');
  for (const id of ['task-coordinator', 'task-projection', 'task-tools', 'jsonl', 'qq-journal', 'memory-session', 'qq-memory-journal', 'qq-chat']) assert.ok(nodeIds('M5.1').has(id), id);
  assert.match(chat.stage.graph.nodes.find((node) => node.id === 'qq-chat')!.summary!, /任务工具.*心跳默认关闭/);
  assert.equal(chat.nodeChanges['task-tools']!.kind, 'inherited');
  assert.equal(chat.nodeChanges['tool-name-codec']!.kind, 'replaced');
  assert.ok(!nodeIds('M5.1').has('tool-wire-wrapper'));
  assert.equal(chat.stage.graph.edges.find((edge) => edge.id === 'chat-session')!.target.nodeId, 'memory-session');
  assert.equal(chat.stage.graph.edges.find((edge) => edge.id === 'chat-current-context')!.source.nodeId, 'trigger-run');
});

test('M6 keeps late operation evidence out of ordinary history until an explicit query', () => {
  const latest = baseline('M6.0');
  assert.equal(latest.nodeChanges.operations!.kind, 'added');
  assert.equal(latest.stage.graph.nodes.find((node) => node.id === 'response-control')!.parentId, 'trigger-channel');
  assert.ok(nodeIds('M6.0').has('guarded'));
  assert.equal(latest.stage.graph.edges.find((edge) => edge.id === 'detached-append')!.source.nodeId, 'operation-detached');
  assert.match(latest.stage.graph.edges.find((edge) => edge.id === 'registry-qq')!.label!, /未启用响应/);
  assert.equal(latest.stage.graph.edges.find((edge) => edge.id === 'operations-world')!.target.nodeId, 'response-world');
  const outgoing = latest.stage.graph.edges.filter((edge) => edge.source.nodeId === 'operation-facts');
  assert.deepEqual(outgoing, []);
  assert.equal(latest.stage.graph.edges.find((edge) => edge.id === 'evidence-read')!.source.nodeId, 'operation-evidence');
  assert.equal(latest.stage.graph.edges.find((edge) => edge.id === 'evidence-context')!.target.nodeId, 'context-selection');
  assert.match(latest.stage.status!, /真实环境验收待做/);
});
