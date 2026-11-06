/** Geometry fingerprint for matching a committed frame to its workspace nodes. */
import type { CanvasNode } from './node.ts';

export function sceneGeometryKey(nodes: readonly (Pick<CanvasNode, 'id' | 'parentId' | 'type' | 'position' | 'width' | 'height'> & { data: { expanded?: boolean } })[]): string {
  return JSON.stringify(nodes.map((node) => [node.id, node.parentId, node.type, node.position.x, node.position.y, node.width, node.height, !!node.data.expanded]));
}
