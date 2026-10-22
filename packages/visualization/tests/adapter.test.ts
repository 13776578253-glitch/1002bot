/**
 * Owner: `src/adapters/bot-1002.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBotStages } from '../examples/1002bot/adapter.ts';
import { diffSnapshots } from '../src/core/evolution/index.ts';
import type { GraphNode } from '../src/core/schema/types.ts';
import { assertValidSnapshot } from '../src/core/schema/validate.ts';
import { STAGES } from '../examples/1002bot/stages.ts';

function findNode(root: GraphNode, key: string): GraphNode | undefined {
  if (root.key === key) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, key);
    if (found) return found;
  }
  return undefined;
}

function hasAddedNode(delta: ReturnType<typeof diffSnapshots>): boolean {
  return delta.nodes.some((node) => node.kind === 'added');
}

test('adapts all canonical stages into valid snapshots', () => {
  const { tracks } = loadBotStages();
  const snapshots = tracks.flatMap((track) => track.stages);
  assert.equal(snapshots.length, 12);
  assert.deepEqual(
    tracks.map(({ track, stages }) => [track, stages.length]),
    [
      ['main', STAGES.main.length],
      ['qq', STAGES.qq.length],
      ['tui', STAGES.tui.length],
    ],
  );
  for (const snapshot of snapshots) assertValidSnapshot(snapshot);
});

test('converts node metadata and resolves nested edge paths', () => {
  const snapshots = loadBotStages().tracks.flatMap((track) => track.stages);
  const m6 = snapshots.find(({ id }) => id === 'm6')!;
  const system = m6.root;
  assert.equal(system.key, 'system');
  assert.equal(system.title, STAGES.main[5]!.title);
  assert.ok(system.children?.some(({ key }) => key === 'runtime'));

  const execution = findNode(system, 'execution')!;
  assert.equal(execution.source, 'src/runtime/trigger-run.ts');
  assert.ok(execution.details?.length);
  assert.ok(m6.edges?.some(({ from, to }) =>
    from === 'system/runtime/execution/model-group/agent-request' &&
    to === 'system/collaborators/agent/context'
  ));
});

test('main-track diffs are populated and introduce nodes from M2', () => {
  const { tracks } = loadBotStages();
  const stages = tracks.find(({ track }) => track === 'main')!.stages;
  for (let i = 1; i < stages.length; i++) {
    const delta = diffSnapshots(stages[i - 1], stages[i]!);
    assert.ok(
      delta.nodes.some(({ kind }) => kind !== 'inherited') || delta.edges.some(({ kind }) => kind !== 'inherited'),
      `empty delta from ${stages[i - 1]!.id} to ${stages[i]!.id}`,
    );
    assert.ok(hasAddedNode(delta), `${stages[i]!.id} has no added nodes`);
  }
});

test('marks the M6 memory design as planned', () => {
  const snapshots = loadBotStages().tracks.flatMap((track) => track.stages);
  const m6 = snapshots.find(({ id }) => id === 'm6')!;
  assert.equal(findNode(m6.root, 'memory-design')?.planned, true);
});
