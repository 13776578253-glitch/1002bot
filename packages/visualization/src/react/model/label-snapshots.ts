/** Final labeling caches are tied to their source geometry and semantic connection. */
import type { Projection } from '../../core/projection/index.ts';
import type { PortPolicy } from '../../core/layout/port-policy.ts';
import type { CanvasNode } from './grouping.ts';
import type { DisplayEdge } from './display-edges.ts';
import type { CachedRoute } from './route-cache.ts';
import type { ReservedRoute } from './routing.ts';
import type { DisplayRouteSnapshot } from './workspace.ts';
import { labelPinKey, pinLabelForEdge } from './label-pins.ts';
import { captureDisplayRoutes } from './display-route-snapshots.ts';
import { LABEL_LAYOUT_POLICY_KEY, type LabelLayoutResult } from './label-layout.ts';

export function sceneGeometryKey(nodes: readonly (Pick<CanvasNode, 'id' | 'parentId' | 'type' | 'position' | 'width' | 'height'> & { data: { expanded?: boolean } })[]): string {
  return JSON.stringify(nodes.map((node) => [node.id, node.parentId, node.type, node.position.x, node.position.y, node.width, node.height, !!node.data.expanded]));
}

export function labelIdentity(edge: DisplayEdge): string {
  const connection = pinLabelForEdge(edge, { x: 0, y: 0, width: 0, height: 0 });
  return JSON.stringify([labelPinKey(connection), connection.memberFingerprints]);
}

const routeKey = (route: Pick<DisplayRouteSnapshot, 'sourceHandle' | 'targetHandle' | 'points'>) => JSON.stringify([route.sourceHandle, route.targetHandle, route.points]);

export function labelSeeds(snapshots: readonly DisplayRouteSnapshot[], edges: readonly DisplayEdge[]): ReadonlyMap<string, LabelLayoutResult> {
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  const seeds = new Map<string, LabelLayoutResult>();
  for (const snapshot of snapshots) {
    const edge = byId.get(snapshot.id);
    if (!edge || snapshot.labelPolicyKey !== LABEL_LAYOUT_POLICY_KEY || snapshot.labelRouteKey !== routeKey(snapshot)
      || snapshot.labelIdentity !== labelIdentity(edge) || !snapshot.labelAttachment || snapshot.label.width <= 0 || snapshot.label.height <= 0) continue;
    seeds.set(edge.id, { text: edge.text, fullText: edge.text, state: snapshot.labelAttachment.side === 'inline' ? 'normal' : 'adjusted',
      placement: { ...snapshot.label }, attachment: structuredClone(snapshot.labelAttachment), identity: snapshot.labelIdentity });
  }
  return seeds;
}

export function captureLabelledRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], routes: ReadonlyMap<string, CachedRoute>, labels: ReadonlyMap<string, LabelLayoutResult>, reserved: readonly ReservedRoute[], policy?: PortPolicy): DisplayRouteSnapshot[] {
  const identities = new Map(edges.map((edge) => [edge.id, labelIdentity(edge)]));
  return captureDisplayRoutes(nodes, projection, edges, routes, reserved, policy).map((snapshot) => {
    const result = labels.get(snapshot.id);
    return { ...snapshot, label: result?.placement ? { ...result.placement } : { x: 0, y: 0, width: 0, height: 0 },
      ...(result?.placement && result.attachment && result.state !== 'fixed' ? {
        labelPolicyKey: LABEL_LAYOUT_POLICY_KEY, labelIdentity: identities.get(snapshot.id)!, labelRouteKey: routeKey(snapshot), labelAttachment: structuredClone(result.attachment),
      } : {}) };
  });
}
