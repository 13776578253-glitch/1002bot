import test from 'node:test';
import assert from 'node:assert/strict';
import type { VisualizationBaseline } from '../../src/core/schema/baseline.ts';
import type { CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';
import { migrateRestoredViews, VIEW_MODES } from '../../src/react/canvas/use-workspace-session.ts';
import { baselineForView } from '../../src/react/model/stages/view-projection.ts';
import type { CanvasBaselineContent, CanvasBaselineView, CanvasViewMode, CanvasWorkspaceView } from '../../src/react/model/contracts/snapshot-types.ts';

const root: CanonicalNode = { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] };
const card: CanonicalNode = { id: 'card', parentId: 'root', kind: 'component', label: 'Card', order: 0, ports: [] };
const stage: StageSnapshot = { id: 's', label: 'S', title: 'S', track: 'main', order: 0, graph: { rootId: 'root', revision: 'one', nodes: [root, card], edges: [] } };
const baseline: VisualizationBaseline = { id: 's', stage, nodeChanges: { card: { kind: 'baseline', label: '基线' } }, edgeChanges: {} };
const definitions = Object.fromEntries(VIEW_MODES.map((mode) => [mode, new Map([['s', baselineForView(baseline, mode)]])])) as Record<CanvasViewMode, Map<string, VisualizationBaseline>>;

const node = (width: number, height: number, data: Record<string, unknown> = {}) => ({
  id: 'card', type: 'card', position: { x: 24, y: 72 }, width, height, data: { title: 'Card', ...data },
});
const content = (width = 260, height = 92, data: Record<string, unknown> = {}): CanvasBaselineContent => ({
  nodes: [node(width, height, data)], edgeRoutes: [], frozenGroups: [],
});
const view = (draft: CanvasBaselineContent, extra: Partial<CanvasBaselineView> = {}): CanvasBaselineView => ({ revision: 'one', ...draft, ...extra });
const workspace = (saved: CanvasBaselineView, views?: Partial<Record<CanvasViewMode, Record<string, CanvasBaselineView>>>): CanvasWorkspaceView => ({
  version: 2, baselineId: 's', baselines: { s: structuredClone(saved) }, ...(views ? { views } : {}),
});

test('old card sizes migrate once at the storage recovery boundary', () => {
  const source = workspace(view(content()));
  const before = structuredClone(source);
  const migrated = migrateRestoredViews(source, definitions);
  const restored = migrated.views.structure.s!;
  assert.equal(restored.nodes[0]!.width, 240);
  assert.equal(restored.nodes[0]!.height, 80);
  assert.equal(restored.requiresConfirmation, undefined);
  assert.equal(migrated.issues.size, 0);
  assert.deepEqual(source, before);
});

test('migration is idempotent and current card sizes are not rewritten', () => {
  const first = migrateRestoredViews(workspace(view(content())), definitions);
  const second = migrateRestoredViews(workspace(first.views.structure.s!, { structure: first.views.structure }), definitions);
  assert.deepEqual(second.views, first.views);
  assert.equal(second.issues.size, 0);

  const current = migrateRestoredViews(workspace(view(content(240, 80, { sentinel: 'keep' }))), definitions);
  const currentView = current.views.structure.s!;
  assert.equal(currentView.nodes[0]!.width, 240);
  assert.equal((currentView.nodes[0]!.data as Record<string, unknown>).sentinel, 'keep');
  assert.equal(currentView.requiresConfirmation, undefined);
});

test('confirmed snapshots stay literal while a changed draft requires confirmation', () => {
  const confirmed = content();
  const source = workspace(view(content(), { confirmed, requiresConfirmation: false }));
  const migrated = migrateRestoredViews(source, definitions);
  const restored = migrated.views.structure.s!;
  assert.equal(restored.nodes[0]!.width, 240);
  assert.equal(restored.requiresConfirmation, true);
  assert.deepEqual(restored.confirmed, confirmed);
});

test('frozen old cards are left unchanged by migration', () => {
  const frozenContent = content(260, 92, { frozen: true, layoutMode: 'locked' });
  const source = workspace(view(frozenContent, { confirmed: frozenContent, requiresConfirmation: false }));
  const migrated = migrateRestoredViews(source, definitions);
  const restored = migrated.views.structure.s!;
  assert.equal(restored.nodes[0]!.width, 260);
  assert.equal(restored.nodes[0]!.height, 92);
  assert.equal(restored.requiresConfirmation, false);
  assert.equal(migrated.issues.size, 0);
});

test('recovery keeps an explicitly edited card size and its historical confirmation', () => {
  const authored = content(300, 100, { layoutEdits: { version: 1, sizes: { collapsed: { width: 300, height: 100, origin: 'user' } } } });
  const source = workspace(view(authored, { confirmed: authored, confirmedRevision: 'one' }));
  const migrated = migrateRestoredViews(source, definitions);
  const restored = migrated.views.structure.s!;
  assert.deepEqual(restored.nodes, authored.nodes);
  assert.deepEqual(restored.confirmed, authored);
  assert.equal(restored.confirmedRevision, 'one');
  assert.equal(migrated.issues.size, 0);
});

test('all three stored views are migrated together', () => {
  const old = view(content());
  const source = workspace(old, {
    overview: { s: structuredClone(old) },
    structure: { s: structuredClone(old) },
    full: { s: structuredClone(old) },
  });
  const migrated = migrateRestoredViews(source, definitions);
  for (const mode of VIEW_MODES) assert.equal(migrated.views[mode].s!.nodes[0]!.width, 240, mode);
});
