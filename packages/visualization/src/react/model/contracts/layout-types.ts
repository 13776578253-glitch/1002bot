/** Editable canvas geometry and layout protection contracts. */

export type LayoutMode = 'free' | 'fixed' | 'locked';

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
