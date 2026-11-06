/** Canvas node representation and primitive dimensions and coordinates used by layout. */
import type { Node } from '@xyflow/react';
import type { ChangeMark } from '../../../core/schema/baseline.ts';
import type { LayoutMode, NodeLayoutEdits } from '../contracts/layout-types.ts';

/** 画布交互节点类型；承载展示、四向扩容边界与聚合分组账本。 */
export type CanvasNode = Node<{
  title: string;
  titleOverride?: string;
  summary?: string;
  details?: readonly string[];
  change?: ChangeMark;
  planned?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  childCount?: number;
  layoutMode?: LayoutMode;
  layoutEdits?: NodeLayoutEdits;
  frozen?: boolean;
  authored?: { collapsedSize: { width: number; height: number }; expandedSize?: { width: number; height: number } };
  onToggle?: () => void;
  onRename?: (title: string) => void;
  onRenameCommit?: () => void;
  contentWidth?: number;
  contentHeight?: number;
  fitOffset?: { x: number; y: number };
  reflowOrigin?: { x: number; y: number };
  expansionSizes?: Record<string, { width: number; height: number }>;
  groupOrigins?: Record<string, string | null>;
}>;

export const RESPONSIBILITY_CARD_SIZE = { width: 210, height: 80, gap: 8 };
export const RESPONSIBILITY_NODE_WIDTH = RESPONSIBILITY_CARD_SIZE.width * 2 + RESPONSIBILITY_CARD_SIZE.gap + 34;
export const CARD_SIZE = { width: 240, height: 80 };
export const DETAIL_CARD_SIZE = { width: RESPONSIBILITY_NODE_WIDTH, height: 280 };
export const COMPACT_DETAIL_CARD_SIZE = { width: RESPONSIBILITY_NODE_WIDTH, height: 192 };
export const detailCardSize = (count: number) => count <= 2 ? COMPACT_DETAIL_CARD_SIZE : DETAIL_CARD_SIZE;
export const responsibilityHeight = (count: number): number => count ? count <= 2 ? 116 : 204 : 0;
export const structureHeaderHeight = (node: Pick<CanvasNode, 'data'>): number => 68 + responsibilityHeight(node.data.details?.length ?? 0);
export const MIN_EDGE_GAP = 64;
export const isLayoutProtected = (node: CanvasNode): boolean => node.data.layoutMode === 'fixed' || node.data.layoutMode === 'locked';

export const nodeSize = (node: CanvasNode) => ({ width: node.width ?? node.measured?.width ?? CARD_SIZE.width, height: node.height ?? node.measured?.height ?? CARD_SIZE.height });
/** 将节点的局部坐标递归转换为画布全局绝对坐标。 */
export function worldPosition(node: CanvasNode, nodes: readonly CanvasNode[]): { x: number; y: number } {
  const parent = nodes.find((item) => item.id === node.parentId);
  const origin = parent ? worldPosition(parent, nodes) : { x: 0, y: 0 };
  return { x: origin.x + node.position.x, y: origin.y + node.position.y };
}
