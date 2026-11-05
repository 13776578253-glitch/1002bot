/** Canvas controls own zoom, fit, marquee, grid, freeze, confirm and history actions; all state stays in the controller. */
import { Icon } from '../icon.tsx';

/** 控制栏输入；所有动作与可用状态都由控制器提供。 */
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

/** 底部控制栏；缩放、自适应、框选、网格、固定、确认与撤销/重做都只通过回调交给控制器。 */
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
    <button className="icon-button" aria-label="固定当前可见节点" title="固定当前可见节点（与子图冻结不同）" onClick={onFreeze}><Icon name="pin" /></button>
    <button className="icon-button" aria-label="确认当前阶段布局" title="确认当前阶段布局，作为后续阶段基础" onClick={onConfirm}><Icon name="check" /></button>
    <button className="icon-button" aria-label="撤销" title="撤销 · Ctrl + Z" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
    <button className="icon-button" aria-label="重做" title="重做 · Ctrl + Shift + Z" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>
  </div>;
}
