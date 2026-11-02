import { adaptProject } from '../../src/adapters/project/index.ts';
import { baselineNodes, hierarchyProjection } from '../../src/react/model/hierarchy.ts';
import { aggregateProjectedEdges } from '../../src/react/model/display-edges.ts';
import { DiagramRouteCache } from '../../src/react/model/route-cache.ts';
import { routeSnapshotForEdge } from '../../src/react/model/edge-routes.ts';
import { freezeSelection } from '../../src/react/model/frozen.ts';
import { captureFrozenSubgraph } from '../../src/react/model/blackbox-routes.ts';
import { captureDisplayRoutes } from '../../src/react/model/display-route-snapshots.ts';
import { captureContent, type CanvasBaselineContent } from '../../src/react/model/workspace.ts';
import type { CanvasNode } from '../../src/react/model/grouping.ts';
import type { Projection } from '../../src/core/projection/index.ts';
import type { DisplayEdge } from '../../src/react/model/display-edges.ts';
import { p4Project } from './project-p4.ts';

export const p4Baselines = adaptProject(p4Project);

export interface P4Content {
  baseline: (typeof p4Baselines)[number];
  nodes: CanvasNode[];
  projection: Projection;
  edges: DisplayEdge[];
  routes: Map<string, import('../../src/react/model/route-cache.ts').CachedRoute>;
  content: CanvasBaselineContent;
  pinnedId: string;
  lockedId: string;
  frozenId: string;
}

export function buildP4Content(index = 0): P4Content {
  const baseline = p4Baselines[index]!;
  const baseNodes = baselineNodes(baseline);
  const persist = baseline.stage.graph.edges.find((edge) => edge.id === 'persist-view');
  if (!persist) throw new Error('P4 fixture relations missing');
  const baseProjection = hierarchyProjection(baseNodes, baseline.stage);
  const baseEdges = aggregateProjectedEdges(baseProjection, baseline.edgeChanges);
  const baseRoutes = new DiagramRouteCache().update(baseNodes, baseProjection, baseEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })));
  const pinnedEdge = baseEdges.find((edge) => edge.id === 'invoke-view')!;
  const lockedEdge = baseEdges.find((edge) => edge.id === 'persist-view')!;
  const pinned = routeSnapshotForEdge(pinnedEdge, baseRoutes.get(pinnedEdge.id)!, 'pinned', baseNodes, []);
  const locked = routeSnapshotForEdge(lockedEdge, baseRoutes.get(lockedEdge.id)!, 'locked', baseNodes, []);
  if (!pinned || !locked) throw new Error('P4 fixture could not capture pinned/locked routes');

  const frozen = freezeSelection({ nodes: baseNodes, rootIds: ['inner-view'], groupId: 'freeze:inner', stage: baseline.stage });
  if (!frozen.ok) throw new Error(`P4 fixture could not freeze: ${frozen.conflict.message}`);
  const projection = hierarchyProjection(frozen.nodes, baseline.stage);
  const edges = aggregateProjectedEdges(projection, baseline.edgeChanges);
  const routes = new DiagramRouteCache().update(frozen.nodes, projection, edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })));
  const captured = captureFrozenSubgraph({
    nodes: frozen.nodes, stage: baseline.stage, group: frozen.group, groups: [frozen.group],
    displayEdges: edges, displayRoutes: routes, storedRoutes: [],
  });
  if (!captured.ok) throw new Error(`P4 fixture could not capture frozen routes: ${captured.conflicts[0]?.message}`);
  const displayRoutes = captureDisplayRoutes(frozen.nodes, projection, edges, routes);
  const content = captureContent(frozen.nodes, [...captured.routes, pinned, locked], [frozen.group], undefined, displayRoutes);
  return {
    baseline, nodes: frozen.nodes, projection, edges, routes, content,
    pinnedId: pinned.canonicalEdgeId, lockedId: locked.canonicalEdgeId, frozenId: frozen.group.id,
  };
}
