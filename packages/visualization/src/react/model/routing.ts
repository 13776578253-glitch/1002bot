import type { Projection } from '../../core/projection/index.ts';
import {
  midpointOfPoints, obstacleFromRect, portAnchor, routeOrthogonal, simplifyPoints,
  type Point, type PortSide, type Rect,
} from '../../core/layout/geometry.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from './grouping.ts';
import { edgeHandles, nodeIsVisible } from './hierarchy.ts';

export function routeDiagramEdge(nodes: readonly CanvasNode[], projection: Projection, sourceId: string, targetId: string) {
  const rect = (node: CanvasNode): Rect => ({ ...worldPosition(node, nodes), w: node.width ?? CARD_SIZE.width, h: node.height ?? CARD_SIZE.height });
  const source = nodes.find((node) => node.id === sourceId)!, target = nodes.find((node) => node.id === targetId)!;
  const handles = edgeHandles(nodes, sourceId, targetId);
  const sourceSides: Record<string, PortSide> = { out: 'bottom', 'top-out': 'top', 'return-out': 'right', 'left-out': 'left' };
  const targetSides: Record<string, PortSide> = { in: 'top', 'bottom-in': 'bottom', return: 'right', 'left-in': 'left' };
  const sourceSide = sourceSides[handles.sourceHandle]!, targetSide = targetSides[handles.targetHandle]!;
  const start = portAnchor(rect(source), sourceSide), end = portAnchor(rect(target), targetSide);
  const obstacles = nodes.filter((node) => nodeIsVisible(node, nodes, projection)).map((node) => {
    const bounds = rect(node);
    return obstacleFromRect(node.type === 'card' ? bounds : { ...bounds, h: node.type === 'structure' ? 68 : 54 }, node.id === sourceId || node.id === targetId ? 0 : node.type === 'card' ? 10 : 0);
  });
  const extend = (point: Point, side: PortSide): Point => {
    let stub = point;
    for (let distance = 28; distance >= 4; distance -= 4) {
      stub = {
        x: point.x + (side === 'right' ? distance : side === 'left' ? -distance : 0),
        y: point.y + (side === 'bottom' ? distance : side === 'top' ? -distance : 0),
      };
      if (!obstacles.some((obstacle) => stub.x > obstacle.left && stub.x < obstacle.right && stub.y > obstacle.top && stub.y < obstacle.bottom)) break;
    }
    return stub;
  };
  const startStub = extend(start, sourceSide), endStub = extend(end, targetSide);
  const middle = routeOrthogonal(
    { ...startStub, w: 0, h: 0 }, { ...endStub, w: 0, h: 0 }, obstacles,
    { offset: 0, padding: 10 },
  );
  const points = simplifyPoints([start, ...middle, end]);
  return { ...handles, points, label: midpointOfPoints(points) };
}
