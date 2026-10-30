/** Canvas toolbar controls: zoom, fit view, marquee mode and background grid. */
import { Icon } from './icon.tsx';

export interface CanvasControlsProps {
  zoom: number;
  boxMode: boolean;
  grid: boolean;
  onZoomOut(): void;
  onZoomIn(): void;
  onFit(): void;
  onToggleBox(): void;
  onToggleGrid(): void;
}

/** 底部浮动控制栏；提供缩放级别显示、视口自适应、框选切换与网格底纹开关。 */
export function CanvasControls({ zoom, boxMode, grid, onZoomOut, onZoomIn, onFit, onToggleBox, onToggleGrid }: CanvasControlsProps) {
  return <div className="canvas-controls" role="toolbar" aria-label="画布操作">
    <button className="icon-button" aria-label="缩小" onClick={onZoomOut}><Icon name="minus" /></button>
    <span className="zoom-value">{zoom}%</span>
    <button className="icon-button" aria-label="放大" onClick={onZoomIn}><Icon name="plus" /></button>
    <span className="divider" />
    <button className="icon-button" aria-label="适应画布" onClick={onFit}><Icon name="fit" /></button>
    <button className="icon-button" aria-label="框选节点" aria-pressed={boxMode} title="框选节点 · Shift + 拖动" onClick={onToggleBox}><Icon name="select" /></button>
    <button className="icon-button" aria-label="显示网格" aria-pressed={grid} onClick={onToggleGrid}><Icon name="grid" /></button>
  </div>;
}
