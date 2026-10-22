/** Public React Flow surface for the architecture evolution canvas. */

export { EvolutionCanvas } from './canvas/EvolutionCanvas.tsx';
export type { EvolutionCanvasProps } from './canvas/EvolutionCanvas.tsx';
export { projectionToFlow, canvasModelToFlow } from './canvas/projection-to-flow.ts';
export type { FlowNodeData, FlowEdgeData } from './canvas/projection-to-flow.ts';
export { CardNode } from './nodes/card.tsx';
export { AggregateNode } from './nodes/aggregate.tsx';
export { NodePorts, type NodePortsProps } from './nodes/ports.tsx';
export { OrthoEdge } from './edges/ortho.tsx';
export { useCanvasStore } from './store/canvas-store.ts';
export type { CanvasPosition, CanvasState } from './store/canvas-store.ts';
