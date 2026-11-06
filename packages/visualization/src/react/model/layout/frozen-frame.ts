/** Frozen frame expansion applies resolved dimensions while preserving protected anchors. */
import { CARD_SIZE, type CanvasNode } from './node.ts';
import { layoutProtectionConflict } from './protection.ts';

/** 只读展开保持容器框和所有后代几何不变。 */
export function applyFrozenFrame(nodes: readonly CanvasNode[], rootId: string, expanded: boolean, frame?: { width: number; height: number }): CanvasNode[] {
  const next = nodes.map((node) => {
    if (node.id !== rootId || node.type === 'cluster' || !node.data.expandable) return node;
    const { dragHandle: _handle, ...base } = node;
    const nextSize = frame ? (expanded ? frame : CARD_SIZE) : { width: node.width!, height: node.height! };
    return {
      ...base,
      type: expanded ? 'structure' : 'card',
      ...nextSize, measured: { ...nextSize }, style: { ...node.style, ...nextSize },
      ...(expanded ? { dragHandle: '.structure-header' } : {}),
      data: { ...node.data, expanded },
    };
  });
  return layoutProtectionConflict(nodes, next) ? nodes as CanvasNode[] : next;
}
