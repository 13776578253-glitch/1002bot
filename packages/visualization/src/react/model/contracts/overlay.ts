/** Historical graph overlay data preserved when loading and saving snapshots. */
import type { CanonicalEdge, CanonicalEndpoint, CanonicalNode } from '../../../core/schema/types.ts';

export interface EdgeOverride {
  id: string;
  source?: CanonicalEndpoint;
  target?: CanonicalEndpoint;
  label?: string;
  relation?: CanonicalEdge['relation'];
  direction?: CanonicalEdge['direction'];
  note?: string;
}

export interface UserGraphOverlay {
  version: 1;
  addedNodes: CanonicalNode[];
  addedEdges: CanonicalEdge[];
  hiddenSourceNodeIds: string[];
  hiddenSourceEdgeIds: string[];
  edgeOverrides: EdgeOverride[];
}
