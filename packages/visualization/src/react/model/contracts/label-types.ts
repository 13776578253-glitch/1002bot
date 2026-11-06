/** Label geometry and path attachment shared by layout and saved view data. */
import type { Point } from '../../../core/layout/geometry.ts';

export interface EdgeLabelPlacement extends Point {
  width: number;
  height: number;
}

/** 几何附着关系，不依赖折线段的数组下标。 */
export interface LabelAttachment {
  from: Point;
  to: Point;
  projected: Point;
  fraction: number;
  axis: 'horizontal' | 'vertical' | 'diagonal';
  side: 'inline' | 'negative' | 'positive';
  offset: number;
  pathStart: Point;
  pathEnd: Point;
  pathFraction: number;
}
