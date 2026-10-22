/**
 * Orthogonal edge with rounded corners and a centered label capsule.
 * Uses React Flow's smooth-step path; the label capsule is rendered via
 * EdgeLabelRenderer and styled by .av-edge-label.
 */

import type { EdgeProps, Edge } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import type { FlowEdgeData } from '../canvas/projection-to-flow.ts';
import { svgPathFromPoints, midpointOfPoints } from '../../core/layout/geometry.ts';

type OrthoEdgeType = Edge<FlowEdgeData, 'ortho'>;

export function OrthoEdge(props: EdgeProps<OrthoEdgeType>) {
  let path: string;
  let labelX: number;
  let labelY: number;

  const rawPoints = props.data?.points;
  if (rawPoints && rawPoints.length >= 2) {
    // Snap endpoints to actual React Flow handle positions
    const adjustedPoints = [
      { x: props.sourceX, y: props.sourceY },
      ...rawPoints.slice(1, -1),
      { x: props.targetX, y: props.targetY },
    ];
    path = svgPathFromPoints(adjustedPoints, 10);
    const mid = midpointOfPoints(adjustedPoints);
    labelX = mid.x;
    labelY = mid.y;
  } else {
    const [smoothPath, sLabelX, sLabelY] = getSmoothStepPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      targetX: props.targetX,
      targetY: props.targetY,
      borderRadius: 12,
    });
    path = smoothPath;
    labelX = sLabelX;
    labelY = sLabelY;
  }

  const kind = props.data?.deltaKind;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd="url(#av-arrow)"
        {...(props.data?.twoWay ? { markerStart: 'url(#av-arrow)' } : {})}
      />
      {props.data?.label && (
        <EdgeLabelRenderer>
          <div
            className={['av-edge-label', kind ? `av-edge-label--${kind}` : ''].join(' ')}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            {props.data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
