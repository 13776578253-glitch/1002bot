import test from 'node:test';
import assert from 'node:assert/strict';
import { fitMovedContainers } from '../spacing.ts';
import type { CanvasNode } from '../node.ts';

test('moving within retained content bounds preserves the parent and untouched sibling objects', () => {
  const parent: CanvasNode = { id: 'parent', type: 'structure', position: { x: 0, y: 0 }, width: 600, height: 178, data: { title: 'Parent', expanded: true, contentWidth: 600, contentHeight: 178 } };
  const first: CanvasNode = { id: 'first', parentId: 'parent', type: 'card', position: { x: 24, y: 72 }, width: 240, height: 82, data: { title: 'First' } };
  const second: CanvasNode = { ...first, id: 'second', position: { x: 336, y: 72 }, data: { title: 'Second' } };
  const moved = { ...first, position: { x: 25, y: 72 } };
  const result = fitMovedContainers([parent, moved, second], ['first']);
  assert.equal(result[0], parent);
  assert.equal(result[1], moved);
  assert.equal(result[2], second);
});
