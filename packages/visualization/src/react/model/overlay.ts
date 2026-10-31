/** User-owned graph overlay contract; canonical source entities remain unchanged. */
import type { CanonicalEdge, CanonicalEndpoint, CanonicalNode } from '../../core/schema/types.ts';

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

export function emptyOverlay(): UserGraphOverlay {
  return { version: 1, addedNodes: [], addedEdges: [], hiddenSourceNodeIds: [], hiddenSourceEdgeIds: [], edgeOverrides: [] };
}
