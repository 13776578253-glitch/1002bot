/** Public React Flow surface for the architecture evolution canvas. */

export { EvolutionCanvas } from './canvas/EvolutionCanvas.tsx';
export type { EvolutionCanvasProps } from './canvas/EvolutionCanvas.tsx';
export { useCanvasScene } from './canvas/use-canvas-scene.ts';
export { canvasSceneToFlow, sceneToFlow, portHandleId } from './canvas/projection-to-flow.ts';
export type { FlowEdgeData, FlowNodeData, FlowPortData } from './canvas/projection-to-flow.ts';
export { CardNode } from './nodes/card.tsx';
export { AggregateNode } from './nodes/aggregate.tsx';
export { NodePorts, type NodePortsProps } from './nodes/ports.tsx';
export { OrthoEdge } from './edges/ortho.tsx';
export { Inspector } from './panels/Inspector.tsx';
export { DeltaPanel } from './panels/DeltaPanel.tsx';
export { useCanvasStore } from './store/canvas-store.ts';
export type { CanvasPosition, CanvasState } from './store/canvas-store.ts';
