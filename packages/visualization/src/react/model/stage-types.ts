/** Structured transition failures shared by placement, routing and the controller. */

export type StageConflictKind =
  | 'no-space'
  | 'frozen-violation'
  | 'locked-route'
  | 'growth-ceiling'
  | 'invalid-source'
  | 'merge-conflict';

export type StageConflictAction = 'unfreeze' | 'expand' | 'move-free-nodes' | 'cancel' | 'retry';

export interface StageConflict {
  kind: StageConflictKind;
  entityIds: readonly string[];
  containerId?: string;
  message: string;
  actions: StageConflictAction[];
}
