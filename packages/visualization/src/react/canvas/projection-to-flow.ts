/**
 * Adapt a core Projection to React Flow nodes and edges.
 * Layout positions come from a LayoutEngine; this adapter only maps shapes.
 */

import type { Edge, Node } from '@xyflow/react';
import type { Projection, ProjectedEdge, VisibleNode } from '../../core/projection/index.ts';
import type { LayoutResult, PlacedNode, RoutedEdge } from '../../core/layout/index.ts';
import type { StageDelta } from '../../core/evolution/index.ts';
import type { CanvasModel } from '../../core/engine/index.ts';

export interface FlowNodeData extends Record<string, unknown> {
  path: string;
  key?: string | undefined;
  title: string;
  desc?: string | undefined;
  details?: string[] | undefined;
  expanded: boolean;
  hasChildren: boolean;
  deltaKind?: string | undefined;
  deltaNote?: string | undefined;
  planned?: boolean | undefined;
  source?: string | undefined;
  onToggle?: (() => void) | undefined;
  onSelect?: (() => void) | undefined;
}

export interface FlowEdgeData extends Record<string, unknown> {
  label?: string | undefined;
  folded: boolean;
  deltaKind?: string | undefined;
  twoWay?: boolean | undefined;
  points?: { x: number; y: number }[] | undefined;
}

export function projectionToFlow(
  projection: Projection,
  layout: LayoutResult,
  delta: StageDelta | undefined,
  lookup: { title(path: string): string; desc(path: string): string | undefined; hasChildren(path: string): boolean; planned(path: string): boolean; source(path: string): string | undefined; key?(path: string): string },
): { nodes: Node<FlowNodeData>[]; edges: Edge<FlowEdgeData>[] } {
  const placed = new Map(layout.nodes.map((n) => [n.path, n]));
  const nodeDelta = new Map((delta?.nodes ?? []).map((d) => [d.path, d]));
  const edgeDelta = new Map(
    (delta?.edges ?? [])
      .filter((e) => e.kind !== 'inherited')
      .map((e) => [`${e.from}>${e.to}`, e]),
  );

  // React Flow subflow: children use parentId + position relative to parent.
  const parentOf = new Map<string, string>();
  for (const vn of projection.nodes) {
    const cut = vn.path.lastIndexOf('/');
    if (cut < 0) continue;
    const parent = vn.path.slice(0, cut);
    if (placed.has(parent)) parentOf.set(vn.path, parent);
  }
  const nodes: Node<FlowNodeData>[] = projection.nodes.map((vn) => {
    const parent = parentOf.get(vn.path);
    const node = flowNode(vn, placed.get(vn.path), nodeDelta.get(vn.path), lookup);
    if (parent) {
      const parentPlaced = placed.get(parent);
      node.parentId = parent;
      node.extent = 'parent';
      node.position = {
        x: node.position.x - (parentPlaced?.at.x ?? 0),
        y: node.position.y - (parentPlaced?.at.y ?? 0),
      };
    }
    return node;
  });
  const edges: Edge<FlowEdgeData>[] = projection.edges.map((pe, i) => flowEdge(pe, i, layout.edges[i], edgeDelta, lookup));
  return { nodes, edges };
}

/** Adapt the canonical Core model without recomputing graph semantics. */
export function canvasModelToFlow(
  model: CanvasModel,
  positions?: ReadonlyMap<string, { x: number; y: number }>,
  selected?: string,
  interactions?: { toggle(path: string): void; select(path: string): void },
): { nodes: Node<FlowNodeData>[]; edges: Edge<FlowEdgeData>[] } {
  const nodes: Node<FlowNodeData>[] = model.nodes.map((item) => {
    const savedPosition = positions?.get(item.path);
    const node: Node<FlowNodeData> = {
      id: item.path,
      type: item.expanded ? 'aggregate' : 'card',
      position: savedPosition ?? item.position,
      selected: selected === item.path,
      style: { width: item.size.w, height: item.size.h },
      data: {
        path: item.path,
        key: item.key,
        title: item.title,
        ...(item.desc === undefined ? {} : { desc: item.desc }),
        ...(item.details === undefined ? {} : { details: item.details }),
        expanded: item.expanded,
        hasChildren: item.hasChildren,
        ...(item.delta?.kind === undefined ? {} : { deltaKind: item.delta.kind }),
        ...(item.delta?.note === undefined ? {} : { deltaNote: item.delta.note }),
        planned: item.planned,
        ...(item.source === undefined ? {} : { source: item.source }),
        ...(interactions === undefined ? {} : {
          onToggle: () => interactions.toggle(item.path),
          onSelect: () => interactions.select(item.path),
        }),
      },
    };
    if (item.parentPath !== undefined) {
      const parent = model.nodes.find((candidate) => candidate.path === item.parentPath);
      node.parentId = item.parentPath;
      node.extent = 'parent';
      if (savedPosition === undefined) {
        node.position = {
          x: item.position.x - (parent?.position.x ?? 0),
          y: item.position.y - (parent?.position.y ?? 0),
        };
      }
    }
    return node;
  });
  const edges: Edge<FlowEdgeData>[] = model.edges.map((item) => {
    const fromNode = model.nodes.find((n) => n.path === item.from);
    const toNode = model.nodes.find((n) => n.path === item.to);
    const isTargetOnRight = (toNode?.position.x ?? 0) >= (fromNode?.position.x ?? 0);

    const sourceHandle = item.sourceHandle ?? (isTargetOnRight ? 'right' : 'left');
    const targetHandle = item.targetHandle ?? (isTargetOnRight ? 'left' : 'right');

    return {
      id: item.id,
      source: item.from,
      target: item.to,
      sourceHandle,
      targetHandle,
      type: 'ortho',
      ...(item.delta?.kind === undefined ? {} : { className: `av-edge-${item.delta.kind}` }),
      data: {
        ...(item.label === undefined ? {} : { label: item.label }),
        folded: item.folded,
        deltaKind: item.delta?.kind,
        twoWay: item.twoWay,
        ...(item.route?.points ? { points: item.route.points } : {}),
      },
    };
  });
  return { nodes, edges };
}

function flowNode(
  vn: VisibleNode,
  placed: PlacedNode | undefined,
  delta: { kind: string; note?: string | undefined } | undefined,
  lookup: { title(path: string): string; desc(path: string): string | undefined; hasChildren(path: string): boolean; planned(path: string): boolean; source(path: string): string | undefined; key?(path: string): string },
): Node<FlowNodeData> {
  const key = vn.path.split('/').pop() ?? vn.path;
  return {
    id: vn.path,
    type: vn.expanded ? 'aggregate' : 'card',
    position: { x: placed?.at.x ?? 0, y: placed?.at.y ?? 0 },
    ...(placed
      ? {
          style: {
            width: placed.size.w,
            height: placed.size.h,
          },
        }
      : {}),
    data: {
      path: vn.path,
      title: lookup.title(vn.path) || key,
      desc: lookup.desc(vn.path),
      expanded: vn.expanded,
      hasChildren: lookup.hasChildren(vn.path),
      deltaKind: delta?.kind,
      deltaNote: delta?.note ?? undefined,
      planned: lookup.planned(vn.path),
      source: lookup.source(vn.path),
    },
  };
}

function flowEdge(
  pe: ProjectedEdge,
  index: number,
  routed: RoutedEdge | undefined,
  edgeDelta: Map<string, { kind: string }>,
  lookup: { title(path: string): string; key?(path: string): string },
): Edge<FlowEdgeData> {
  const fromEndpoint = pe.from.split('#');
  const toEndpoint = pe.to.split('#');
  const fromPath = fromEndpoint[0] ?? pe.from;
  const toPath = toEndpoint[0] ?? pe.to;
  const fromKey = lookup.key?.(fromPath) ?? fromPath.split('/').pop() ?? fromPath;
  const toKey = lookup.key?.(toPath) ?? toPath.split('/').pop() ?? toPath;
  const deltaKind = edgeDelta.get(`${fromKey}>${toKey}`)?.kind;
  return {
    id: `e${index}-${pe.from}-${pe.to}`,
    source: fromPath,
    target: toPath,
    ...(fromEndpoint[1] === undefined ? {} : { sourceHandle: fromEndpoint[1] }),
    ...(toEndpoint[1] === undefined ? {} : { targetHandle: toEndpoint[1] }),
    type: 'ortho',
    ...(deltaKind === undefined ? {} : { className: `av-edge-${deltaKind}` }),
    data: {
      label: pe.edge.label,
      folded: pe.folded,
      deltaKind,
      twoWay: pe.edge.twoWay,
    },
  };
}
