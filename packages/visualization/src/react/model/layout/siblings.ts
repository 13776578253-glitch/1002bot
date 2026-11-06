/** Sibling collision separation and restoration within a shared parent. */
import { isLayoutProtected, MIN_EDGE_GAP, nodeSize, type CanvasNode } from './node.ts';

const SIBLING_GAP = 24;
const GEOMETRY_EPSILON = 0.000001;

const siblingGap = (a: CanvasNode, b: CanvasNode) => a.type === 'card' && b.type === 'card' ? MIN_EDGE_GAP : SIBLING_GAP;

export function siblingsOverlap(a: CanvasNode, b: CanvasNode): boolean {
  const first = nodeSize(a), second = nodeSize(b);
  const gap = siblingGap(a, b);
  return a.position.x < b.position.x + second.width + gap - GEOMETRY_EPSILON
    && a.position.x + first.width + gap > b.position.x + GEOMETRY_EPSILON
    && a.position.y < b.position.y + second.height + gap - GEOMETRY_EPSILON
    && a.position.y + first.height + gap > b.position.y + GEOMETRY_EPSILON;
}

/** 兄弟节点避让；当节点扩张或插入时，将发生重叠的同级节点沿 X/Y 正向或负向推开。 */
export function separateSiblings(input: readonly CanvasNode[], fixedId: string, remember = false): CanvasNode[] {
  let nodes = [...input];
  const parentId = nodes.find((node) => node.id === fixedId)!.parentId;
  const settled = new Set([fixedId, ...nodes.filter((node) => node.parentId === parentId && isLayoutProtected(node)).map((node) => node.id)]), pending = [fixedId];
  while (pending.length) {
    const anchorId = pending.shift()!;
    const anchor = nodes.find((node) => node.id === anchorId)!;
    for (const sibling of nodes.filter((node) => node.parentId === parentId && !settled.has(node.id))) {
      if (!siblingsOverlap(anchor, sibling)) continue;
      const blockers = nodes.filter((node) => settled.has(node.id));
      const clearAlong = (axis: 'x' | 'y', direction: 1 | -1) => {
        let candidate = sibling;
        let collisions = blockers.filter((node) => siblingsOverlap(candidate, node));
        while (collisions.length) {
          const size = axis === 'x' ? nodeSize(candidate).width : nodeSize(candidate).height;
          const position = direction > 0
            ? Math.max(...collisions.map((node) => node.position[axis] + (axis === 'x' ? nodeSize(node).width : nodeSize(node).height) + siblingGap(node, candidate)))
            : Math.min(...collisions.map((node) => node.position[axis] - size - siblingGap(node, candidate)));
          candidate = { ...candidate, position: { ...candidate.position, [axis]: position } };
          collisions = blockers.filter((node) => siblingsOverlap(candidate, node));
        }
        return candidate;
      };
      const choices = [clearAlong('x', 1), clearAlong('y', 1)];
      if (!parentId) choices.push(clearAlong('x', -1), clearAlong('y', -1));
      const distance = (node: CanvasNode) => Math.abs(node.position.x - sibling.position.x) + Math.abs(node.position.y - sibling.position.y);
      const target = choices.sort((a, b) => distance(a) - distance(b))[0]!;
      nodes = nodes.map((node) => node.id === sibling.id ? { ...target, ...(remember ? { data: { ...target.data, reflowOrigin: target.data.reflowOrigin ?? { ...sibling.position } } } : {}) } : node);
      settled.add(sibling.id);
      pending.push(sibling.id);
    }
  }
  return nodes;
}

/** 当扩张节点收缩或移除时，将曾发生避让的兄弟节点尝试恢复至其 reflowOrigin 记录的位置。 */
export function restoreSiblings(input: readonly CanvasNode[], parentId: string | undefined, excluded: ReadonlySet<string>): CanvasNode[] {
  let nodes = [...input], restored = true;
  while (restored) {
    restored = false;
    for (const node of nodes) {
      if (node.parentId !== parentId || !node.data.reflowOrigin || excluded.has(node.id) || isLayoutProtected(node)) continue;
      const candidate = { ...node, position: node.data.reflowOrigin };
      if (nodes.some((other) => other.id !== node.id && other.parentId === parentId && siblingsOverlap(candidate, other))) continue;
      const { reflowOrigin: _origin, ...data } = candidate.data;
      nodes = nodes.map((item) => item.id === node.id ? { ...candidate, data } : item);
      restored = true;
    }
  }
  return nodes;
}
