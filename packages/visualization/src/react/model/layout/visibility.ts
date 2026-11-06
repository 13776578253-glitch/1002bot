/** Graph projection and node visibility derived from expanded canvas nodes. */
import { projectGraph, type Projection } from '../../../core/projection/index.ts';
import type { StageSnapshot } from '../../../core/schema/types.ts';
import type { CanvasNode } from './node.ts';

/** 基于当前画布节点的展开标记计算逻辑图投影。 */
export function hierarchyProjection(nodes: readonly CanvasNode[], stage: StageSnapshot): Projection {
  return projectGraph(stage, new Set(nodes.filter((node) => node.data.expanded).map((node) => node.id)));
}

/** 判断节点在当前投影下是否可见；聚合分组在其内含任一可见节点时显示。 */
export function nodeIsVisible(node: CanvasNode, nodes: readonly CanvasNode[], projection: Projection): boolean {
  if (node.type !== 'cluster') return projection.nodeById.has(node.id);
  let parent = nodes.find((item) => item.id === node.parentId);
  while (parent) {
    if (parent.data.expandable && !parent.data.expanded) return false;
    parent = nodes.find((item) => item.id === parent?.parentId);
  }
  return nodes.some((item) => {
    if (!projection.nodeById.has(item.id)) return false;
    let owner = item.parentId;
    while (owner) { if (owner === node.id) return true; owner = nodes.find((ancestor) => ancestor.id === owner)?.parentId; }
    return false;
  });
}
