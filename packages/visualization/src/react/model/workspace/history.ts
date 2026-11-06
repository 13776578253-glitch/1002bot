/** Per-view undo and redo of committed workspace content. */
import type { CanvasBaselineContent } from '../contracts/snapshot-types.ts';
import { sameCanvasIntent } from './content-intent.ts';

/** 每个已提交手势一条记录；选择和视口不进入历史。 */
export class ViewHistory {
  private past: CanvasBaselineContent[] = [];
  private future: CanvasBaselineContent[] = [];
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  record(before: CanvasBaselineContent, after: CanvasBaselineContent, basisChanged = false): boolean {
    if (!basisChanged && sameCanvasIntent(before, after)) return false;
    this.past.push(before);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current: CanvasBaselineContent): CanvasBaselineContent { this.future.push(current); return this.past.pop()!; }
  redo(current: CanvasBaselineContent): CanvasBaselineContent { this.past.push(current); return this.future.pop()!; }
}
