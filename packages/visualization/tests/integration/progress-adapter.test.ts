import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptProgressReports, type ReportDataset, type ReportStage } from '../../src/adapters/progress-reports/index.ts';
import { assertValidBaselines, projectGraph } from '../../src/index.ts';

function reportStage(id: string, nodes: string[], links: string[], extra: Partial<ReportStage> = {}): ReportStage {
  return { id, label: id, title: id, subtitle: 'Architecture', date: '2026-01-01', source: `reports/${id}.md#structure`, status: 'implemented', nodes, links, ...extra };
}

function dataset(): ReportDataset {
  return {
    rootId: 'catalog/root', revision: 'edition-7',
    nodes: {
      root: { id: 'catalog/root', parentId: null, kind: 'root', label: 'Architecture', order: 0 },
      container: { id: 'engine/A', parentId: 'catalog/root', kind: 'group', label: 'Engine', order: 0, position: { x: 30, y: 40 } },
      nested: { id: 'engine/A/execute', parentId: 'engine/A', kind: 'component', label: 'Execute', order: 0, sourceRefs: ['reports/initial.md#execution'], position: { x: 24, y: 72 } },
      archive: { id: 'archive/old', parentId: 'catalog/root', kind: 'store', label: 'Archive', order: 1 },
      durable: { id: 'archive/new', parentId: 'catalog/root', kind: 'store', label: 'Durable archive', order: 1 },
      engineUpdated: { id: 'engine/A', parentId: 'catalog/root', kind: 'group', label: 'Unified engine', order: 0, position: { x: 70, y: 80 } },
      relocated: { id: 'engine/A/execute', parentId: 'catalog/root', kind: 'component', label: 'Execute', order: 2, position: { x: 400, y: 40 } },
    },
    links: {
      writeOld: { id: 'link/write-old', source: 'engine/A/execute', target: 'archive/old', relation: 'storage', label: 'write', order: 0 },
      writeNew: { id: 'link/write-new', source: 'engine/A/execute', target: 'archive/new', relation: 'storage', label: 'commit', order: 0, direction: 'bidirectional' },
    },
    stages: [
      reportStage('alpha', ['root', 'nested', 'archive', 'container'], ['writeOld']),
      reportStage('beta', ['durable', 'engineUpdated'], ['writeNew'], {
        removeNodes: ['archive/old'], removeLinks: ['link/write-old'],
        replacements: { nodes: [{ id: 'archive/new', previousId: 'archive/old', note: 'Durable archive replaces the old store' }], links: [{ id: 'link/write-new', previousId: 'link/write-old', note: 'Writes now commit to the durable archive' }] },
      }),
      reportStage('gamma', ['relocated'], []),
    ],
  };
}

test('report stages inherit stable identities, apply explicit removals and retain replacement provenance', () => {
  const source = dataset();
  const serialized = JSON.stringify(source);
  const [first, second, third] = adaptProgressReports(source);
  assertValidBaselines([first!, second!, third!]);
  assert.equal(JSON.stringify(source), serialized);
  assert.deepEqual(first!.nodeChanges['engine/A'], { kind: 'baseline', label: '基线' });
  assert.deepEqual(second!.nodeChanges['engine/A'], { kind: 'inherited', label: '沿用' });
  assert.deepEqual(second!.nodeChanges['archive/new'], { kind: 'replaced', label: '替换', note: 'Durable archive replaces the old store' });
  assert.equal(second!.edgeChanges['link/write-new']?.kind, 'replaced');
  assert.equal(third!.edgeChanges['link/write-new']?.kind, 'inherited');
  assert.ok(!second!.stage.graph.nodes.some((node) => node.id === 'archive/old'));
  assert.ok(!third!.stage.graph.edges.some((edge) => edge.id === 'link/write-old'));
  assert.equal(first!.stage.graph.nodes.find((node) => node.id === 'engine/A')?.label, 'Engine');
  assert.equal(second!.stage.graph.nodes.find((node) => node.id === 'engine/A')?.label, 'Unified engine');
  assert.equal(first!.stage.graph.nodes.find((node) => node.id === 'engine/A/execute')?.parentId, 'engine/A');
  assert.equal(third!.stage.graph.nodes.find((node) => node.id === 'engine/A/execute')?.parentId, 'catalog/root');
  assert.deepEqual(first!.positions?.['engine/A'], { x: 30, y: 40 });
  assert.deepEqual(second!.positions?.['engine/A'], { x: 70, y: 80 });
  assert.equal(second!.stage.graph.revision, 'edition-7:beta');
  assert.equal(second!.stage.doc, 'reports/beta.md#structure');
  assert.equal(second!.stage.graph.edges[0]?.direction, 'bidirectional');
});

test('new report entities are added and replacement provenance does not implicitly remove earlier entities', () => {
  const source = dataset();
  const stages = [source.stages[0]!, reportStage('delta', ['durable'], ['writeNew'], {
    replacements: { nodes: [{ id: 'archive/new', previousId: 'archive/old', note: 'Replaces responsibility' }] },
  })];
  const [first, second] = adaptProgressReports({ ...source, stages });
  assertValidBaselines([first!, second!]);
  assert.equal(second!.edgeChanges['link/write-new']?.kind, 'added');
  assert.ok(second!.stage.graph.nodes.some((node) => node.id === 'archive/old'));
  assert.equal(second!.edgeChanges['link/write-old']?.kind, 'inherited');
});

test('adapted cross-layer flows retain canonical endpoints through folding and expansion', () => {
  const [first] = adaptProgressReports(dataset());
  const folded = projectGraph(first!.stage, []);
  assert.equal(folded.edges[0]?.source.nodeId, 'engine/A');
  assert.equal(folded.edges[0]?.source.canonicalNodeId, 'engine/A/execute');
  const expanded = projectGraph(first!.stage, ['engine/A']);
  assert.equal(expanded.edges[0]?.source.nodeId, 'engine/A/execute');
  assert.equal(expanded.edges[0]?.target.nodeId, 'archive/old');
  assert.deepEqual(first!.stage.graph.nodes.find((node) => node.id === 'engine/A/execute')?.sourceRefs, ['reports/initial.md#execution']);
});
