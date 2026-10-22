import { create } from 'zustand';
import type { Viewport } from '@xyflow/react';

export interface CanvasPosition { x: number; y: number; }
export interface CanvasState {
  trackId: string;
  stageId: string;
  stageIndex: number;
  expanded: Set<string>;
  expandedByStage: Map<string, Set<string>>;
  selected: string | undefined;
  positions: Map<string, CanvasPosition>;
  positionsByTrack: Map<string, Map<string, CanvasPosition>>;
  viewport: Viewport | undefined;
  viewportByTrack: Map<string, Viewport>;
  inspectorOpen: boolean;
  setContext(trackId: string, stageId: string, index: number): void;
  toggle(id: string): void;
  expand(id: string): void;
  collapse(id: string): void;
  collapseAll(): void;
  expandOneLevel(ids: string[]): void;
  collapseOneLevel(): void;
  select(id: string | undefined): void;
  setPosition(id: string, position: CanvasPosition): void;
  setViewport(viewport: Viewport): void;
  setStage(index: number): void;
  setInspectorOpen(open: boolean): void;
  resetLayout(): void;
}

const copySet = (value: Set<string>): Set<string> => new Set(value);
const copyMap = (value: Map<string, CanvasPosition>): Map<string, CanvasPosition> => new Map(value);

export const useCanvasStore = create<CanvasState>((set) => ({
  trackId: 'main',
  stageId: '',
  stageIndex: 0,
  expanded: new Set(),
  expandedByStage: new Map(),
  selected: undefined,
  positions: new Map(),
  positionsByTrack: new Map(),
  viewport: undefined,
  viewportByTrack: new Map(),
  inspectorOpen: true,
  setContext: (trackId, stageId, index) => set((state) => {
    const expanded = copySet(state.expandedByStage.get(stageId) ?? new Set());
    const positions = copyMap(state.positionsByTrack.get(trackId) ?? new Map());
    const viewport = state.viewportByTrack.get(trackId);
    return { trackId, stageId, stageIndex: index, expanded, positions, ...(viewport ? { viewport } : { viewport: undefined }), selected: undefined };
  }),
  toggle: (id) => set((state) => {
    const next = copySet(state.expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    const expandedByStage = new Map(state.expandedByStage);
    expandedByStage.set(state.stageId, next);
    return { expanded: next, expandedByStage: expandedByStage };
  }),
  expand: (id) => set((state) => {
    const next = copySet(state.expanded);
    next.add(id);
    const expandedByStage = new Map(state.expandedByStage);
    expandedByStage.set(state.stageId, next);
    return { expanded: next, expandedByStage };
  }),
  collapse: (id) => set((state) => {
    const next = copySet(state.expanded);
    next.delete(id);
    const expandedByStage = new Map(state.expandedByStage);
    expandedByStage.set(state.stageId, next);
    return { expanded: next, expandedByStage, selected: state.selected === id ? undefined : state.selected };
  }),
  collapseAll: () => set((state) => {
    const expandedByStage = new Map(state.expandedByStage);
    expandedByStage.set(state.stageId, new Set());
    return { expanded: new Set(), expandedByStage, selected: undefined };
  }),
  expandOneLevel: (ids) => set((state) => {
    const next = copySet(state.expanded);
    for (const id of ids) next.add(id);
    const expandedByStage = new Map(state.expandedByStage);
    expandedByStage.set(state.stageId, next);
    return { expanded: next, expandedByStage };
  }),
  collapseOneLevel: () => set((state) => {
    const next = new Set<string>();
    const expandedByStage = new Map(state.expandedByStage);
    expandedByStage.set(state.stageId, next);
    return { expanded: next, expandedByStage };
  }),
  select: (id) => set({ selected: id, ...(id ? { inspectorOpen: true } : {}) }),
  setPosition: (id, position) => set((state) => {
    const positions = copyMap(state.positions);
    positions.set(id, position);
    const positionsByTrack = new Map(state.positionsByTrack);
    positionsByTrack.set(state.trackId, positions);
    return { positions, positionsByTrack };
  }),
  setViewport: (viewport) => set((state) => {
    const viewportByTrack = new Map(state.viewportByTrack);
    viewportByTrack.set(state.trackId, viewport);
    return { viewport, viewportByTrack };
  }),
  setStage: (index) => set({ stageIndex: index, selected: undefined }),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  resetLayout: () => set((state) => {
    const positionsByTrack = new Map(state.positionsByTrack);
    positionsByTrack.set(state.trackId, new Map());
    return { positions: new Map(), positionsByTrack };
  }),
}));
