/** Load and save contract for canvas workspace adapters. */
import type { CanvasWorkspaceView } from '../model/contracts/snapshot-types.ts';

export interface CanvasViewStorage {
  load(key: string): CanvasWorkspaceView | undefined | Promise<CanvasWorkspaceView | undefined>;
  save(key: string, view: CanvasWorkspaceView): void | Promise<void>;
}
