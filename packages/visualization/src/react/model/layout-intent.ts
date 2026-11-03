/** User geometry is expressed in the parent's stable content coordinates, independently of fitted frames. */
import type { CanvasNodeView } from './workspace.ts';
import type { CanvasNode } from './grouping.ts';

export interface LayoutPositionEdit {
  x: number;
  y: number;
  parentId?: string;
  origin: 'user' | 'legacy';
}
export interface LayoutSizeEdit {
  width: number;
  height: number;
  origin: 'user' | 'legacy';
}
export interface NodeLayoutEdits {
  version: 1;
  position?: LayoutPositionEdit;
  sizes?: { collapsed?: LayoutSizeEdit; expanded?: LayoutSizeEdit };
}

type Frame = Pick<CanvasNodeView, 'id' | 'parentId' | 'position'> & { width?: number | undefined; height?: number | undefined; type?: string | undefined; data: Pick<CanvasNodeView['data'], 'fitOffset' | 'contentWidth' | 'contentHeight' | 'expanded' | 'layoutEdits'> };

export function contentPosition(node: Frame, nodes: readonly Frame[]): { x: number; y: number } {
  const parent = nodes.find((item) => item.id === node.parentId);
  return { x: node.position.x + (parent?.data.fitOffset?.x ?? 0) - (node.data.fitOffset?.x ?? 0), y: node.position.y + (parent?.data.fitOffset?.y ?? 0) - (node.data.fitOffset?.y ?? 0) };
}

/** Legacy preferences retain unknown edits without claiming their geometry was manually authored. */
export function legacyLayoutEdits(node: Frame, nodes: readonly Frame[]): NodeLayoutEdits {
  const size = { width: node.width!, height: node.height!, origin: 'legacy' as const };
  return { version: 1, position: { ...contentPosition(node, nodes), ...(node.parentId ? { parentId: node.parentId } : {}), origin: 'legacy' }, sizes: { [node.data.expanded || node.type === 'cluster' ? 'expanded' : 'collapsed']: size } };
}

export function recordPositionEdits(before: readonly CanvasNode[], after: readonly CanvasNode[], movedIds: readonly string[]): CanvasNode[] {
  const moving = new Set(movedIds);
  return after.map((node) => {
    const old = before.find((item) => item.id === node.id);
    if (!old || !moving.has(node.id)) return node;
    let owner = node.parentId;
    while (owner) { if (moving.has(owner)) return node; owner = after.find((item) => item.id === owner)?.parentId; }
    const a = contentPosition(old, before), b = contentPosition(node, after);
    if (a.x === b.x && a.y === b.y && old.parentId === node.parentId) return node;
    return { ...node, data: { ...node.data, layoutEdits: { ...(node.data.layoutEdits ?? legacyLayoutEdits(old, before)), position: { ...b, ...(node.parentId ? { parentId: node.parentId } : {}), origin: 'user' } } } };
  });
}

export function recordSizeEdits(before: readonly CanvasNode[], after: readonly CanvasNode[], resizedIds: readonly string[]): CanvasNode[] {
  const resizing = new Set(resizedIds);
  return after.map((node) => {
    const old = before.find((item) => item.id === node.id);
    if (!old || !resizing.has(node.id) || old.width === node.width && old.height === node.height) return node;
    if (old.data.layoutMode === 'locked' || old.data.frozen) return old;
    const edits = node.data.layoutEdits ?? legacyLayoutEdits(old, before);
    return { ...node, data: { ...node.data, ...(node.data.expanded || node.type === 'cluster' ? { contentWidth: node.width!, contentHeight: node.height! } : {}), layoutEdits: { ...edits, sizes: { ...edits.sizes, [node.data.expanded || node.type === 'cluster' ? 'expanded' : 'collapsed']: { width: node.width!, height: node.height!, origin: 'user' } } } } };
  });
}

export function preferredEditedSize(node: Pick<CanvasNode, 'data' | 'type'>): LayoutSizeEdit | undefined {
  return node.data.layoutEdits?.sizes?.[node.data.expanded || node.type === 'cluster' ? 'expanded' : 'collapsed'];
}
