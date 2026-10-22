import type { LayoutConstraints, LayoutProvider, LayoutInput, LayoutResult } from './index.ts';
import { rectContains } from './geometry.ts';

export function applyPinnedConstraints(result: LayoutResult, constraints: LayoutConstraints | undefined): LayoutResult {
  const pinned = constraints?.pinned;
  if (!pinned || pinned.size === 0) return result;
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  const nodes = result.nodes.map((node) => {
    const point = pinned.get(node.id);
    if (!point) return node;
    const dx = point.x - node.worldRect.x;
    const dy = point.y - node.worldRect.y;
    const rect = { ...node.worldRect, x: point.x, y: point.y };
    if (constraints.keepWithinParent && node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent?.contentRect && !rectContains(parent.contentRect, rect)) {
        rect.x = Math.max(parent.contentRect.x, Math.min(rect.x, parent.contentRect.x + parent.contentRect.w - rect.w));
        rect.y = Math.max(parent.contentRect.y, Math.min(rect.y, parent.contentRect.y + parent.contentRect.h - rect.h));
      }
    }
    const move = (value: { x: number; y: number }) => ({ x: value.x + (rect.x - node.worldRect.x), y: value.y + (rect.y - node.worldRect.y) });
    return {
      ...node,
      worldRect: rect,
      ...(node.contentRect ? { contentRect: { ...node.contentRect, x: node.contentRect.x + dx, y: node.contentRect.y + dy } } : {}),
      ...(node.headerRect ? { headerRect: { ...node.headerRect, x: node.headerRect.x + dx, y: node.headerRect.y + dy } } : {}),
      anchors: new Map([...node.anchors].map(([key, value]) => [key, move(value)])),
    };
  });
  return { ...result, nodes };
}

export function createPinnedLayout(provider: LayoutProvider, constraints?: LayoutConstraints): LayoutProvider {
  const decorate = (result: LayoutResult) => applyPinnedConstraints(result, constraints);
  const withoutConstraints = (input: LayoutInput): LayoutInput => ({
    nodes: input.nodes,
    edges: input.edges,
    ...(input.previous === undefined ? {} : { previous: input.previous }),
  });
  return {
    layout(input: LayoutInput) { return decorate(provider.layout(withoutConstraints(input))); },
    async layoutAsync(input: LayoutInput) { return decorate(await provider.layoutAsync(withoutConstraints(input))); },
  };
}
