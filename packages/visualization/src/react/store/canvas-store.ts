/**
 * UI state for the canvas: expansion, selection, stage navigation.
 * Expansion state feeds the core projection; it lives outside React Flow.
 */

import { create } from 'zustand';
import type { Viewport } from '@xyflow/react';

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface CanvasState {
  /** Expanded aggregate paths for the current stage. */
  expanded: Set<string>;
  /** Currently selected node path, if any. */
  selected: string | undefined;
  /** Active stage index within the track. */
  stageIndex: number;
  /** Manual Flow positions, relative to the node's parent when nested. */
  positions: Map<string, CanvasPosition>;
  /** Last camera viewport, retained while the user changes stages. */
  viewport: Viewport | undefined;
  /** Whether the inspector panel is currently open. */
  inspectorOpen: boolean;
  toggle(path: string): void;
  expand(path: string): void;
  collapse(path: string): void;
  collapseAll(): void;
  expandOneLevel(candidates: string[]): void;
  collapseOneLevel(): void;
  select(path: string | undefined): void;
  setPosition(path: string, position: CanvasPosition): void;
  setViewport(viewport: Viewport): void;
  setStage(index: number): void;
  setInspectorOpen(open: boolean): void;
  resetLayout(): void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  expanded: new Set<string>(),
  selected: undefined,
  stageIndex: 0,
  positions: new Map(),
  viewport: undefined,
  inspectorOpen: true,
  toggle: (path) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expanded: next };
    }),
  expand: (path) =>
    set((s) => {
      if (s.expanded.has(path)) return s;
      const next = new Set(s.expanded);
      next.add(path);
      return { expanded: next };
    }),
  collapse: (path) =>
    set((s) => {
      const next = new Set(s.expanded);
      next.delete(path);
      // Collapse descendants as well so re-opening starts clean.
      for (const p of [...next]) if (p.startsWith(path + '/')) next.delete(p);
      return { selected: undefined, expanded: next };
    }),
  collapseAll: () => set({ expanded: new Set(), selected: undefined }),
  expandOneLevel: (candidates) =>
    set((s) => {
      const next = new Set(s.expanded);
      for (const p of candidates) next.add(p);
      return { expanded: next };
    }),
  collapseOneLevel: () =>
    set((s) => {
      if (s.expanded.size === 0) return s;
      let maxDepth = 0;
      for (const p of s.expanded) {
        const d = p.split('/').length;
        if (d > maxDepth) maxDepth = d;
      }
      const next = new Set<string>();
      for (const p of s.expanded) {
        if (p.split('/').length < maxDepth) next.add(p);
      }
      return { expanded: next };
    }),
  select: (path) => set({ selected: path, ...(path !== undefined ? { inspectorOpen: true } : {}) }),
  setPosition: (path, position) =>
    set((s) => {
      const next = new Map(s.positions);
      next.set(path, position);
      return { positions: next };
    }),
  setViewport: (viewport) => set({ viewport }),
  setStage: (index) => set((s) => ({ stageIndex: index, selected: undefined, expanded: s.expanded, positions: s.positions })),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  resetLayout: () => set({ positions: new Map() }),
}));
