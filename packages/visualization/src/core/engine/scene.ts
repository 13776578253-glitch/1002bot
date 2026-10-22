/**
 * The only Core scene assembly entry.
 *
 * Canonical Graph → Projection → Boundary Resolution → Layered Layout +
 * Pinning → Edge Routing → CanvasScene.
 */

import type { CanonicalPort, EvolutionStep, GraphNodeId, StageSnapshot } from '../schema/types.ts';
import { indexGraph, type IndexedGraph } from '../graph/index.ts';
import { applyEvolutionEvents, diffSnapshots, type EdgeDelta, type NodeDelta, type StageDelta } from '../evolution/index.ts';
import { projectGraph, type Projection, type ProjectedEdge } from '../projection/index.ts';
import { createElkLayout, createPinnedLayout, type LayoutConstraints, type LayoutInput, type LayoutProvider, type LayoutResult, type Point } from '../layout/index.ts';
import { routeVisibleEdges, type RoutedPath } from '../layout/router.ts';
import { obstacleFromRect, type PortSide } from '../layout/geometry.ts';

export interface SceneInput {
  stage: StageSnapshot;
  previous?: StageSnapshot;
  evolution?: EvolutionStep;
  expanded: Iterable<GraphNodeId>;
  constraints?: LayoutConstraints;
  measurements?: ReadonlyMap<GraphNodeId, { w: number; h: number }>;
  sceneVersion?: number;
  metricsRevision?: number;
  layoutProvider?: LayoutProvider;
}

export interface SceneNode {
  id: GraphNodeId;
  parentId?: GraphNodeId;
  path: string;
  kind: string;
  label: string;
  summary?: string;
  details?: readonly string[];
  sourceRefs?: readonly string[];
  ports: readonly CanonicalPort[];
  expanded: boolean;
  expandable: boolean;
  planned: boolean;
  worldRect: LayoutResult['nodes'][number]['worldRect'];
  contentRect?: LayoutResult['nodes'][number]['contentRect'];
  headerRect?: LayoutResult['nodes'][number]['headerRect'];
  anchors: ReadonlyMap<string, Point>;
  delta?: NodeDelta | undefined;
}

export interface SceneEdge {
  id: string;
  canonicalEdgeId: string;
  source: ProjectedEdge['source'];
  target: ProjectedEdge['target'];
  label?: string;
  relation: ProjectedEdge['relation'];
  direction: ProjectedEdge['direction'];
  folded: boolean;
  route?: RoutedPath | undefined;
  delta?: EdgeDelta | undefined;
}

export interface CanvasScene {
  sceneVersion: number;
  metricsRevision: number;
  graphRevision: string;
  stageId: string;
  stage: StageSnapshot;
  previous?: StageSnapshot;
  graph: IndexedGraph;
  projection: Projection;
  delta?: StageDelta;
  layout: LayoutResult;
  nodes: readonly SceneNode[];
  edges: readonly SceneEdge[];
}

function syntheticPort(id: string, direction: 'in' | 'out'): CanonicalPort {
  return { id, direction, side: 'auto', order: 0, role: 'boundary' };
}

function scenePorts(node: SceneNode | undefined, projected: Projection): CanonicalPort[] {
  if (!node) return [];
  const ports = [...node.ports];
  for (const edge of projected.edges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (endpoint.nodeId !== node.id || !endpoint.boundary || endpoint.portId === undefined) continue;
      if (!ports.some((port) => port.id === endpoint.portId)) {
        ports.push(syntheticPort(endpoint.portId, endpoint === edge.source ? 'out' : 'in'));
      }
    }
  }
  return ports;
}

function endpointSide(graph: IndexedGraph, nodeId: string, portId: string | undefined): PortSide {
  if (!portId) return 'auto';
  return graph.byId.get(nodeId)?.ports.find((port) => port.id === portId)?.side ?? 'auto';
}

function buildLayoutInput(
  graph: IndexedGraph,
  projection: Projection,
  measurements: SceneInput['measurements'],
): LayoutInput {
  const nodes = projection.nodes.map((visible) => {
    const node = graph.byId.get(visible.canonicalId)!;
    const ports = scenePorts({
      id: node.id,
      path: graph.pathById.get(node.id) ?? node.id,
      kind: node.kind,
      label: node.label,
      ports: node.ports,
      expanded: visible.expanded,
      expandable: visible.expandable,
      planned: node.planned === true,
      worldRect: { x: 0, y: 0, w: 0, h: 0 },
      anchors: new Map(),
    }, projection);
    const base = {
      id: visible.id,
      ...(visible.parentId === undefined ? {} : { parentId: visible.parentId }),
      kind: node.kind,
      expanded: visible.expanded,
      order: node.order,
      ports,
      ...(nodeSizeHint(node.kind)),
    };
    const measuredSize = measurements?.get(visible.id);
    return measuredSize === undefined ? base : { ...base, measuredSize };
  });
  const edges = projection.edges.map((edge) => ({
    id: edge.id,
    source: {
      nodeId: edge.source.nodeId,
      ...(edge.source.portId === undefined ? {} : { portId: edge.source.portId, side: endpointSide(graph, edge.source.canonicalNodeId, edge.source.canonicalPortId) }),
    },
    target: {
      nodeId: edge.target.nodeId,
      ...(edge.target.portId === undefined ? {} : { portId: edge.target.portId, side: endpointSide(graph, edge.target.canonicalNodeId, edge.target.canonicalPortId) }),
    },
    ...(edge.label === undefined ? {} : { label: edge.label }),
  }));
  return { nodes, edges };
}

function nodeSizeHint(kind: string): { minSize: { w: number; h: number } } {
  return kind === 'group' || kind === 'root'
    ? { minSize: { w: 278, h: 124 } }
    : { minSize: { w: 278, h: 124 } };
}

function routeSceneEdges(
  graph: IndexedGraph,
  projection: Projection,
  layout: LayoutResult,
): Map<string, RoutedPath> {
  const byNode = new Map(layout.nodes.map((node) => [node.id, node]));
  const obstacles = layout.nodes.map((node) => obstacleFromRect(node.worldRect, 12));
  const requests = projection.edges.flatMap((edge) => {
    const source = byNode.get(edge.source.nodeId);
    const target = byNode.get(edge.target.nodeId);
    if (!source || !target) return [];
    return [{
      id: edge.id,
      source: {
        rect: source.worldRect,
        side: endpointSide(graph, edge.source.canonicalNodeId, edge.source.canonicalPortId),
        fraction: 0.5,
      },
      target: {
        rect: target.worldRect,
        side: endpointSide(graph, edge.target.canonicalNodeId, edge.target.canonicalPortId),
        fraction: 0.5,
      },
      obstacles,
      ...(edge.label === undefined ? {} : { label: edge.label }),
    }];
  });
  return new Map(routeVisibleEdges(requests).map((route) => [route.id, route]));
}

function sceneFromLayout(input: SceneInput, graph: IndexedGraph, projection: Projection, delta: StageDelta | undefined, layout: LayoutResult): CanvasScene {
  const deltaNodes = new Map((delta?.nodes ?? []).map((item) => [item.id, item]));
  const deltaEdges = new Map((delta?.edges ?? []).map((item) => [item.id, item]));
  const routes = routeSceneEdges(graph, projection, layout);
  const nodes = projection.nodes.flatMap((visible) => {
    const node = graph.byId.get(visible.canonicalId);
    const placed = layout.nodes.find((item) => item.id === visible.id);
    if (!node || !placed) return [];
    return [{
      id: visible.id,
      ...(visible.parentId === undefined ? {} : { parentId: visible.parentId }),
      path: graph.pathById.get(node.id) ?? node.id,
      kind: node.kind,
      label: node.label,
      ...(node.summary === undefined ? {} : { summary: node.summary }),
      ...(node.details === undefined ? {} : { details: node.details }),
      ...(node.sourceRefs === undefined ? {} : { sourceRefs: node.sourceRefs }),
      ports: scenePorts({
        id: node.id, path: graph.pathById.get(node.id) ?? node.id, kind: node.kind, label: node.label,
        ports: node.ports, expanded: visible.expanded, expandable: visible.expandable, planned: node.planned === true,
        worldRect: placed.worldRect, anchors: placed.anchors,
      }, projection),
      expanded: visible.expanded,
      expandable: visible.expandable,
      planned: node.planned === true,
      worldRect: placed.worldRect,
      ...(placed.contentRect ? { contentRect: placed.contentRect } : {}),
      ...(placed.headerRect ? { headerRect: placed.headerRect } : {}),
      anchors: placed.anchors,
      ...(deltaNodes.get(node.id) ? { delta: deltaNodes.get(node.id) } : {}),
    } satisfies SceneNode];
  });
  const edges = projection.edges.map((edge) => ({
    id: edge.id,
    canonicalEdgeId: edge.canonicalEdgeId,
    source: edge.source,
    target: edge.target,
    ...(edge.label === undefined ? {} : { label: edge.label }),
    relation: edge.relation,
    direction: edge.direction,
    folded: edge.folded,
    ...(routes.get(edge.id) ? { route: routes.get(edge.id) } : {}),
    ...(deltaEdges.get(edge.canonicalEdgeId) ? { delta: deltaEdges.get(edge.canonicalEdgeId) } : {}),
  } satisfies SceneEdge));
  return {
    sceneVersion: input.sceneVersion ?? 0,
    metricsRevision: input.metricsRevision ?? 0,
    graphRevision: input.stage.graph.revision ?? input.stage.id,
    stageId: input.stage.id,
    stage: input.stage,
    ...(input.previous === undefined ? {} : { previous: input.previous }),
    graph,
    projection,
    ...(delta === undefined ? {} : { delta }),
    layout: { ...layout, edges: [...routes.values()].map((route) => ({ id: route.id, points: route.points, sourceAnchor: route.sourceAnchor, targetAnchor: route.targetAnchor, labelPoint: route.labelPoint, ...(route.label === undefined ? {} : { label: route.label }) })) },
    nodes,
    edges,
  };
}

export function createCanvasSceneSync(input: SceneInput): CanvasScene {
  const graph = indexGraph(input.stage);
  const projection = projectGraph(input.stage, input.expanded);
  const automatic = input.previous === undefined ? undefined : diffSnapshots(input.previous, input.stage);
  const delta = automatic === undefined ? undefined : applyEvolutionEvents(automatic, input.evolution);
  const provider = input.layoutProvider ?? createPinnedLayout(createElkLayout(), input.constraints);
  const layout = provider.layout(buildLayoutInput(graph, projection, input.measurements));
  return sceneFromLayout(input, graph, projection, delta, layout);
}

export async function createCanvasScene(input: SceneInput): Promise<CanvasScene> {
  const graph = indexGraph(input.stage);
  const projection = projectGraph(input.stage, input.expanded);
  const automatic = input.previous === undefined ? undefined : diffSnapshots(input.previous, input.stage);
  const delta = automatic === undefined ? undefined : applyEvolutionEvents(automatic, input.evolution);
  const provider = input.layoutProvider ?? createPinnedLayout(createElkLayout(), input.constraints);
  const layout = await provider.layoutAsync(buildLayoutInput(graph, projection, input.measurements));
  return sceneFromLayout(input, graph, projection, delta, layout);
}
