/**
 * Canonical canvas computation. This is the only Core entry point that
 * combines graph indexing, projection, evolution, layout, and routing.
 * Renderers consume the returned model without recomputing graph semantics.
 */

import type { EdgeDelta, NodeDelta, StageDelta } from '../evolution/index.ts';
import { applyEvolutionEvents, diffSnapshots, edgeDeltaIdentity } from '../evolution/index.ts';
import { indexGraph, splitEndpoint, type IndexedGraph } from '../graph/index.ts';
import { createElkLayout } from '../layout/elk.ts';
import type { LayoutResult, PlacedNode, RoutedEdge } from '../layout/index.ts';
import { projectGraph, type Projection, type ProjectedEdge } from '../projection/index.ts';
import type { EvolutionStep, NodePath, StageSnapshot } from '../schema/types.ts';

export interface CanvasNodeModel {
  path: NodePath;
  key: string;
  parentPath?: NodePath;
  title: string;
  desc?: string;
  details?: string[];
  expanded: boolean;
  hasChildren: boolean;
  planned: boolean;
  source?: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
  delta?: NodeDelta;
}

export interface CanvasEdgeModel {
  id: string;
  from: string;
  to: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  folded: boolean;
  twoWay: boolean;
  route?: RoutedEdge;
  delta?: EdgeDelta;
}

export interface CanvasModel {
  stage: StageSnapshot;
  previous?: StageSnapshot;
  graph: IndexedGraph;
  projection: Projection;
  delta?: StageDelta;
  layout: LayoutResult;
  nodes: CanvasNodeModel[];
  edges: CanvasEdgeModel[];
}

function parentPath(path: NodePath): NodePath | undefined {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? undefined : path.slice(0, cut);
}

function endpointKey(endpoint: string, graph: IndexedGraph): { key: string; port?: string } {
  const { path, port } = splitEndpoint(endpoint);
  let cursor = path;
  while (cursor && !graph.byPath.has(cursor)) {
    const cut = cursor.lastIndexOf('/');
    if (cut < 0) break;
    cursor = cursor.slice(0, cut);
  }
  return {
    key: graph.byPath.get(cursor)?.key ?? cursor,
    ...(port === undefined ? {} : { port }),
  };
}

function projectedEdgeDelta(edge: ProjectedEdge, graph: IndexedGraph, delta: StageDelta | undefined): EdgeDelta | undefined {
  if (!delta) return undefined;
  const from = endpointKey(edge.edge.from, graph);
  const to = endpointKey(edge.edge.to, graph);
  const identity = edgeDeltaIdentity({
    from: from.key,
    to: to.key,
    ...(from.port === undefined ? {} : { fromPort: from.port }),
    ...(to.port === undefined ? {} : { toPort: to.port }),
    ...(edge.edge.label === undefined ? {} : { label: edge.edge.label }),
    twoWay: edge.edge.twoWay,
  });
  return delta.edges.find((candidate) => edgeDeltaIdentity(candidate) === identity);
}

function toCanvasNode(item: PlacedNode, graph: IndexedGraph, delta: StageDelta | undefined): CanvasNodeModel {
  const node = graph.byPath.get(item.path)!;
  const parent = parentPath(item.path);
  const nodeDelta = delta?.nodes.find((candidate) => candidate.path === item.path);
  return {
    path: item.path,
    key: node.key,
    ...(parent === undefined || parent === graph.snapshot.root.key ? {} : { parentPath: parent }),
    title: node.title,
    ...(node.desc === undefined ? {} : { desc: node.desc }),
    ...(node.details === undefined ? {} : { details: node.details }),
    expanded: item.expanded,
    hasChildren: (node.children?.length ?? 0) > 0,
    planned: node.planned === true,
    ...(node.source === undefined ? {} : { source: node.source }),
    position: item.at,
    size: item.size,
    ...(nodeDelta === undefined ? {} : { delta: nodeDelta }),
  };
}

export function createCanvasModel(
  stage: StageSnapshot,
  previous: StageSnapshot | undefined,
  expandedPaths: Iterable<NodePath>,
  evolutionStep?: EvolutionStep,
): CanvasModel {
  const graph = indexGraph(stage);
  const projection = projectGraph(stage, expandedPaths);
  const automaticDelta = previous === undefined ? undefined : diffSnapshots(previous, stage);
  const delta = automaticDelta === undefined
    ? undefined
    : applyEvolutionEvents(automaticDelta, evolutionStep);
  const layout = createElkLayout().layout(
    projection.nodes.map((node) => ({ path: node.path, expanded: node.expanded })),
    projection.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.edge.label === undefined ? {} : { label: edge.edge.label }),
    })),
  );
  const nodes = layout.nodes
    .map((node) => toCanvasNode(node, graph, delta))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const edges = projection.edges.map((projected, index) => {
    const from = splitEndpoint(projected.from);
    const to = splitEndpoint(projected.to);
    const route = layout.edges[index];
    const edgeDelta = projectedEdgeDelta(projected, graph, delta);
    return {
      id: `edge-${index}-${projected.from}-${projected.to}`,
      from: from.path,
      to: to.path,
      ...(from.port === undefined ? {} : { sourceHandle: from.port }),
      ...(to.port === undefined ? {} : { targetHandle: to.port }),
      ...(projected.edge.label === undefined ? {} : { label: projected.edge.label }),
      folded: projected.folded,
      twoWay: projected.edge.twoWay === true,
      ...(route === undefined ? {} : { route }),
      ...(edgeDelta === undefined ? {} : { delta: edgeDelta }),
    } satisfies CanvasEdgeModel;
  });
  return { stage, ...(previous === undefined ? {} : { previous }), graph, projection, ...(delta === undefined ? {} : { delta }), layout, nodes, edges };
}
