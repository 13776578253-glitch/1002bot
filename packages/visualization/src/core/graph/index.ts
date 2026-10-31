/** Canonical graph validation, indexing and incremental patch entry points. */

export {
  applyGraphPatch,
  assertValidGraph,
  edgesTouching,
  indexGraph,
  validateGraph,
} from './validate.ts';
export type { IndexedGraph } from './validate.ts';
export { diffStages } from './diff.ts';
export type { StageDiff } from './diff.ts';
