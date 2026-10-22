/**
 * Regression coverage for expanded aggregate frames across every adapted
 * stage on the main, QQ, and TUI tracks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBotStages } from '../examples/1002bot/adapter.ts';
import { projectionToFlow } from '../src/react/canvas/projection-to-flow.ts';
import { indexGraph } from '../src/core/graph/index.ts';
import { createTidyLayout, LAYOUT_METRICS } from '../src/core/layout/tidy.ts';
import { projectGraph } from '../src/core/projection/index.ts';

test('every expanded aggregate places children below its title and description', () => {
  const stages = loadBotStages().tracks.flatMap((track) => track.stages);
  let pairs = 0;

  for (const stage of stages) {
    const graph = indexGraph(stage);
    for (const [path, node] of graph.byPath) {
      if (!node.children?.length) continue;
      if (path === graph.snapshot.root.key) continue;

      const visibleAncestors: string[] = [];
      let parent = graph.parentOf.get(path);
      while (parent !== undefined) {
        visibleAncestors.push(parent);
        parent = graph.parentOf.get(parent);
      }

      const projection = projectGraph(stage, [...visibleAncestors, path]);
      const layout = createTidyLayout().layout(
        projection.nodes.map((visible) => ({
          path: visible.path,
          expanded: visible.expanded,
        })),
        projection.edges.map((edge) => ({ from: edge.from, to: edge.to })),
      );
      const placed = new Map(layout.nodes.map((item) => [item.path, item]));
      const aggregate = placed.get(path);
      assert.ok(aggregate?.expanded, `${stage.id}: ${path} did not expand`);
      const flow = projectionToFlow(projection, layout, undefined, {
        title: (item) => graph.byPath.get(item)?.title ?? item,
        desc: (item) => graph.byPath.get(item)?.desc,
        hasChildren: (item) => !!graph.byPath.get(item)?.children?.length,
        planned: (item) => !!graph.byPath.get(item)?.planned,
        source: (item) => graph.byPath.get(item)?.source,
      });
      const flowNode = new Map(flow.nodes.map((item) => [item.id, item]));
      const aggregateFlow = flowNode.get(path)!;
      const aggregateFlowHeight = aggregateFlow.style?.height;
      assert.equal(typeof aggregateFlowHeight, 'number');

      for (const childPath of graph.childrenOf.get(path) ?? []) {
        const child = placed.get(childPath);
        assert.ok(child, `${stage.id}: ${childPath} was not laid out`);
        const childFlow = flowNode.get(childPath)!;
        assert.ok(childFlow.parentId === path);
        const relativePosition = childFlow.parentId === path
          ? childFlow.position
          : { x: child.at.x - aggregate.at.x, y: child.at.y - aggregate.at.y };
        assert.ok(
          relativePosition.y >= LAYOUT_METRICS.aggregateContentTop,
          `${stage.id}: ${childPath} starts inside the aggregate header`,
        );
        assert.ok(
          relativePosition.x >= LAYOUT_METRICS.aggregatePadding - LAYOUT_METRICS.grid / 2,
          `${stage.id}: ${childPath} starts inside the aggregate side padding`,
        );
        assert.ok(
          relativePosition.y + child.size.h <=
            Number(aggregateFlowHeight) - LAYOUT_METRICS.aggregatePadding,
          `${stage.id}: ${childPath} extends past aggregate ${path}: child y=${relativePosition.y} h=${child.size.h}, frame h=${aggregateFlowHeight}`,
        );
        pairs += 1;
      }
    }
  }

  assert.ok(pairs > 0);
});
