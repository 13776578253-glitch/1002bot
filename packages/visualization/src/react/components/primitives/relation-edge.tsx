/** Relation edge owns orthogonal path rendering and the attached label capsule; route geometry and placement are supplied. */
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { ChangeMark } from '../../../core/schema/baseline.ts';
import { svgPathFromPoints, type Point } from '../../../core/layout/geometry.ts';
import type { EdgeLabelPlacement } from '../../model/labels.ts';
import { memo } from 'react';

/** 连线渲染数据；points 是已选路径，label 是最终放置结果，路由策略不在组件内。 */
export interface LinkData extends Record<string, unknown> {
  active: boolean;
  muted?: boolean;
  relation: string;
  change: ChangeMark;
  points: Point[];
  label: EdgeLabelPlacement;
  labelText?: string;
  labelFallback?: EdgeLabelPlacement | undefined;
  labelState?: 'normal' | 'adjusted' | 'space-exhausted' | undefined;
  onSelect(id: string): void;
  counts?: { title: string; added: number; replaced: number };
}

/** 连线渲染；标签隐藏时仍保留整条路径的完整文本与键盘入口。 */
export const Link = memo(function Link(props: EdgeProps<Edge<LinkData>>) {
  if (props.data!.points.length < 2) return null;
  const data = props.data!;
  const label = data.label;
  const { x, y, width, height } = label;
  // 空间耗尽或尺寸为空时不渲染标签，路径本身仍保留完整文本。
  const hidden = data.labelState === 'space-exhausted' || width <= 0 || height <= 0;
  // 圆角只在最终 SVG 输出阶段应用，不改变路由点列。
  const path = svgPathFromPoints(data.points, 14);
  return <>
    <g className="link-path" tabIndex={0} role="button" aria-label={`查看连接：${String(props.label ?? '')}`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); data.onSelect(props.id); } }} data-label-hidden={hidden ? 'true' : undefined}>
      <title>{String(props.label ?? '')}</title>
      <BaseEdge id={props.id} path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} {...(props.markerStart ? { markerStart: props.markerStart } : {})} {...(props.style ? { style: props.style } : {})} interactionWidth={24} />
    </g>
    {!hidden && <EdgeLabelRenderer><div className={`link-label nodrag nopan ${data.active ? 'active' : ''} ${data.muted ? 'is-muted' : ''}`} data-edge-id={props.id} data-change={data.change?.kind} data-label-state={data.labelState} style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}>
      <button style={{ width, height }} aria-label={`选择链路：${String(props.label)}`} title={[String(props.label ?? ''), data.change?.note].filter(Boolean).join('\n')} onClick={(event) => { event.stopPropagation(); data.onSelect(props.id); }}>{data.labelText ?? props.label}</button>
    </div></EdgeLabelRenderer>}
  </>;
});
