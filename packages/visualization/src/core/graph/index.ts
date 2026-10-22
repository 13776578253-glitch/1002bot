/** Canonical graph validation, indexing and incremental patch entry points. */

export {
  applyGraphPatch,
  assertValidGraph,
  edgesTouching,
  indexGraph,
  splitEndpoint,
  validateGraph,
} from './validate.ts';
export type { IndexedGraph } from './validate.ts';
