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
  onFreeze(): void;
  onConfirm(): void;
  onUndo(): void;
  onRedo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

/** 底部浮动控制栏；提供缩放级别显示、视口自适应、框选切换与网格底纹开关。 */
export function CanvasControls({ zoom, boxMode, grid, onZoomOut, onZoomIn, onFit, onToggleBox, onToggleGrid, onFreeze, onConfirm, onUndo, onRedo, canUndo, canRedo }: CanvasControlsProps) {
  return <div className="canvas-controls" role="toolbar" aria-label="画布操作">
    <button className="icon-button" aria-label="缩小" onClick={onZoomOut}><Icon name="minus" /></button>
    <span className="zoom-value">{zoom}%</span>
    <button className="icon-button" aria-label="放大" onClick={onZoomIn}><Icon name="plus" /></button>
    <span className="divider" />
    <button className="icon-button" aria-label="适应画布" onClick={onFit}><Icon name="fit" /></button>
    <button className="icon-button" aria-label="框选节点" aria-pressed={boxMode} title="框选节点 · Shift + 拖动" onClick={onToggleBox}><Icon name="select" /></button>
    <button className="icon-button" aria-label="显示网格" aria-pressed={grid} onClick={onToggleGrid}><Icon name="grid" /></button>
    <span className="divider" />
    <button className="icon-button" aria-label="固定当前可见节点" title="固定当前可见节点的位置" onClick={onFreeze}><Icon name="pin" /></button>
    <button className="icon-button" aria-label="确认当前阶段布局" title="确认当前阶段布局，作为后续阶段基础" onClick={onConfirm}><Icon name="check" /></button>
    <button className="icon-button" aria-label="撤销" title="撤销 · Ctrl + Z" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
    <button className="icon-button" aria-label="重做" title="重做 · Ctrl + Shift + Z" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>
  </div>;
}
