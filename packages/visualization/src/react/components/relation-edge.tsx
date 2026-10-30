import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { ChangeMark } from '../../core/schema/baseline.ts';
import { svgPathFromPoints, type Point } from '../../core/layout/geometry.ts';
import type { EdgeLabelPlacement } from '../model/labels.ts';

export interface LinkData extends Record<string, unknown> {
  active: boolean;
  relation: string;
  change: ChangeMark;
  points: Point[];
  label: EdgeLabelPlacement;
  onSelect(id: string): void;
}

export function Link(props: EdgeProps<Edge<LinkData>>) {
  const path = svgPathFromPoints(props.data!.points, 14);
  const { x, y, width, height } = props.data!.label;
  return <>
    <BaseEdge id={props.id} path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} {...(props.style ? { style: props.style } : {})} interactionWidth={24} />
    <EdgeLabelRenderer><div className={`link-label nodrag nopan ${props.data?.active ? 'active' : ''}`} data-change={props.data?.change?.kind} style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}>
      <button style={{ width, height }} aria-label={`选择链路：${String(props.label)}`} title={props.data?.change?.note} onClick={(event) => { event.stopPropagation(); props.data?.onSelect(props.id); }}>{props.label}</button>
    </div></EdgeLabelRenderer>
  </>;
}
