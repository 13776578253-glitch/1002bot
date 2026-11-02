/** Custom orthogonal edge renderer with obstacle-avoiding label capsule. */
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { ChangeMark } from '../../core/schema/baseline.ts';
import { svgPathFromPoints, type Point } from '../../core/layout/geometry.ts';
import type { EdgeLabelPlacement } from '../model/labels.ts';
import { memo } from 'react';

export interface LinkData extends Record<string, unknown> {
  active: boolean;
  relation: string;
  change: ChangeMark;
  points: Point[];
  label: EdgeLabelPlacement;
  labelState?: 'normal' | 'adjusted' | 'space-exhausted' | undefined;
  onSelect(id: string): void;
  counts?: { title: string; added: number; replaced: number };
}

/** 正交避障连线组件；渲染圆角平滑路径并在指定无重叠坐标处渲染胶囊标签。 */
export const Link = memo(function Link(props: EdgeProps<Edge<LinkData>>) {
  if (props.data!.points.length < 2) return null;
  const path = svgPathFromPoints(props.data!.points, 14);
  const { x, y, width, height } = props.data!.label;
  const hidden = props.data!.labelState === 'space-exhausted';
  return <>
    <BaseEdge id={props.id} path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} {...(props.markerStart ? { markerStart: props.markerStart } : {})} {...(props.style ? { style: props.style } : {})} interactionWidth={24} />
    {!hidden && <EdgeLabelRenderer><div className={`link-label nodrag nopan ${props.data?.active ? 'active' : ''}`} data-change={props.data?.change?.kind} data-label-state={props.data?.labelState} style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}>
      <button style={{ width, height }} aria-label={`选择链路：${String(props.label)}`} title={props.data?.change?.note} onClick={(event) => { event.stopPropagation(); props.data?.onSelect(props.id); }}>{props.data!.counts ? <><span>{props.data!.counts.title}</span>{props.data!.counts.added > 0 && <span className="edge-added">新增 {props.data!.counts.added}</span>}{props.data!.counts.replaced > 0 && <span className="edge-replaced">替换 {props.data!.counts.replaced}</span>}</> : props.label}</button>
    </div></EdgeLabelRenderer>}
  </>;
});
