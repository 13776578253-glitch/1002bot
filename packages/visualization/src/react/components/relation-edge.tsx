/** Custom orthogonal edge renderer with obstacle-avoiding label capsule. */
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { ChangeMark } from '../../core/schema/baseline.ts';
import { svgPathFromPoints, type Point } from '../../core/layout/geometry.ts';
import { labelIsVisible, type EdgeLabelPlacement } from '../model/labels.ts';
import { memo, useEffect, useRef, useState } from 'react';

export interface LinkData extends Record<string, unknown> {
  active: boolean;
  relation: string;
  change: ChangeMark;
  points: Point[];
  label: EdgeLabelPlacement;
  labelFallback?: EdgeLabelPlacement | undefined;
  labelState?: 'normal' | 'adjusted' | 'space-exhausted' | undefined;
  onSelect(id: string): void;
  counts?: { title: string; added: number; replaced: number };
}

/** 正交避障连线组件；渲染圆角平滑路径并在指定无重叠坐标处渲染胶囊标签。 */
export const Link = memo(function Link(props: EdgeProps<Edge<LinkData>>) {
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current); }, []);
  const reveal = () => {
    if (hideTimer.current !== undefined) { window.clearTimeout(hideTimer.current); hideTimer.current = undefined; }
    setHovered(true);
  };
  const scheduleHide = () => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { hideTimer.current = undefined; setHovered(false); }, 140);
  };
  if (props.data!.points.length < 2) return null;
  const data = props.data!;
  const label = data.label.width > 0 ? data.label : data.labelFallback ?? data.label;
  const { x, y, width, height } = label;
  const hidden = !labelIsVisible(data.labelState);
  const show = labelIsVisible(data.labelState, hovered);
  const path = svgPathFromPoints(data.points, 14);
  return <>
    <g onMouseEnter={reveal} onMouseLeave={scheduleHide} data-label-hidden={hidden ? 'true' : undefined}>
      {hidden && <title>{String(props.label ?? '')}</title>}
      <BaseEdge id={props.id} path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} {...(props.markerStart ? { markerStart: props.markerStart } : {})} {...(props.style ? { style: props.style } : {})} interactionWidth={24} />
    </g>
    {show && <EdgeLabelRenderer><div className={`link-label nodrag nopan ${data.active ? 'active' : ''}`} data-change={data.change?.kind} data-label-state={hidden ? 'revealed' : data.labelState} onMouseEnter={reveal} onMouseLeave={scheduleHide} style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}>
      <button style={{ width, height }} aria-label={`选择链路：${String(props.label)}`} title={data.change?.note} onClick={(event) => { event.stopPropagation(); data.onSelect(props.id); }}>{data.counts ? <><span>{data.counts.title}</span>{data.counts.added > 0 && <span className="edge-added">新增 {data.counts.added}</span>}{data.counts.replaced > 0 && <span className="edge-replaced">替换 {data.counts.replaced}</span>}</> : props.label}</button>
    </div></EdgeLabelRenderer>}
  </>;
});
