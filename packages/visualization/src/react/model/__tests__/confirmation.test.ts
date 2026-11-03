import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationIsCurrent, draftMatchesConfirmed } from '../confirmation.ts';
import type { CanvasBaselineContent, CanvasBaselineView } from '../workspace.ts';

const content = (): CanvasBaselineContent => ({
  nodes: [{
    id: 'node', type: 'card', position: { x: 10, y: 20 }, width: 462, height: 96,
    data: { title: 'Node', layoutMode: 'free' },
  }],
  edgeRoutes: [{
    canonicalEdgeId: 'edge', state: 'pinned',
    source: { nodeId: 'node' }, target: { nodeId: 'node' },
    space: { kind: 'world' }, endpointFingerprint: 'node:node',
    points: [{ x: 10, y: 20 }, { x: 30, y: 20 }],
  }],
  frozenGroups: [],
});

const view = (): CanvasBaselineView => {
  const draft = content();
  return { revision: 'rev-1', ...draft, confirmed: content(), confirmedRevision: 'rev-1' };
};

test('draft matches confirmed when content is unchanged', () => {
  assert.equal(draftMatchesConfirmed(view()), true);
  assert.equal(confirmationIsCurrent(view(), 'rev-1'), true);
  const legacy = view();
  delete legacy.confirmed!.nodes[0]!.data.layoutMode;
  assert.equal(draftMatchesConfirmed(legacy), true);
});

test('node position, size and grouping changes invalidate confirmation', () => {
  const moved = view(); moved.nodes[0]!.position.x = 30;
  assert.equal(draftMatchesConfirmed(moved), false);

  const resized = view(); resized.nodes[0]!.width = 500;
  assert.equal(draftMatchesConfirmed(resized), false);

  const grouped = view(); grouped.nodes[0]!.parentId = 'group';
  assert.equal(draftMatchesConfirmed(grouped), false);
});

test('path and frozen-group changes invalidate confirmation', () => {
  const routed = view(); routed.edgeRoutes[0]!.state = 'locked';
  assert.equal(draftMatchesConfirmed(routed), false);

  const frozen = view();
  frozen.frozenGroups = [{
    id: 'frozen', rootId: 'node', memberIds: [], worldBounds: { x: 0, y: 0, w: 462, h: 96 },
    boundaryPorts: [], createdAt: '2026-11-03T00:00:00Z',
  }];
  assert.equal(draftMatchesConfirmed(frozen), false);
});

test('derived display routes and explicit review state do not masquerade as current confirmation', () => {
  const rerendered = view(); rerendered.displayRoutes = [];
  assert.equal(draftMatchesConfirmed(rerendered), true);

  const review = view(); review.requiresConfirmation = true;
  assert.equal(confirmationIsCurrent(review, 'rev-1'), false);

  const stale = view(); stale.confirmedRevision = 'rev-0';
  assert.equal(confirmationIsCurrent(stale, 'rev-1'), false);
});
