import { useMemo } from 'react';
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal, type Edge } from '@xyflow/react';
import { assertValidBaselines } from '../core/schema/baseline.ts';
import type { VisualizationCanvasProps } from './types.ts';
import { Card, Structure, Cluster } from './components/nodes.tsx';
import { Link, type LinkData } from './components/relation-edge.tsx';
import { Icon } from './components/icon.tsx';
import { BaselinePicker } from './components/baseline-picker.tsx';
import { CanvasControls } from './components/canvas-controls.tsx';
import { SelectionTools } from './components/selection-tools.tsx';
import { normalizeMarqueeSelection, ungroup, type CanvasNode } from './model/grouping.ts';
import { useCanvasController } from './canvas/use-canvas-controller.ts';

const nodeTypes = { card: Card, cluster: Cluster, structure: Structure };
const edgeTypes = { link: Link };

function CanvasContent(props: VisualizationCanvasProps) {
  const { displayNodes, edges, visibleGuides, selectedGroup, roots, selectionLabel, setNodes, baselines, baselineId, theme, setTheme, boxMode, setBoxMode, grid, setGrid, zoom, setZoom, setSelectedEdge, setAlignment, onNodesChange, toggleNode, chooseEdge, selectBaseline, createGroup, zoomIn, zoomOut, fitView } = useCanvasController(props);
  return <main className="canvas-app" data-theme={theme} aria-label="架构画布">
    <ReactFlow<CanvasNode, Edge<LinkData>>
      nodes={displayNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={onNodesChange} nodesConnectable={false} deleteKeyCode={null}
      zoomOnDoubleClick={false}
      onNodeDoubleClick={(event, node) => {
        if (node.data.expandable && !(event.target as Element).closest('.nodrag') && (node.type === 'card' || (event.target as Element).closest('.structure-header'))) toggleNode(node.id);
      }}
      onNodeClick={() => setSelectedEdge(undefined)} onEdgeClick={(_, edge) => chooseEdge(edge.id)}
      onNodeDragStop={() => setAlignment([])}
      onSelectionEnd={() => setNodes((current) => normalizeMarqueeSelection(current))}
      onPaneClick={() => setSelectedEdge(undefined)}
      onMove={(_, viewport) => setZoom(Math.round(viewport.zoom * 100))}
      selectionMode={SelectionMode.Partial} selectionOnDrag={boxMode}
      panOnDrag={boxMode ? [1, 2] : [0, 1, 2]} selectionKeyCode="Shift" multiSelectionKeyCode={["Meta", "Control", "Shift"]}
      minZoom={0.2} maxZoom={2} fitView fitViewOptions={{ padding: 0.22, maxZoom: 1.15 }}
      elevateNodesOnSelect={false} elevateEdgesOnSelect={false} proOptions={{ hideAttribution: true }}
    >
      {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--grid)" className="canvas-grid" />}
      <ViewportPortal><svg className="alignment-guides" aria-hidden="true">{visibleGuides.map((guide, index) => <line key={index} x1={guide.axis === 'x' ? guide.value : guide.start} y1={guide.axis === 'y' ? guide.value : guide.start} x2={guide.axis === 'x' ? guide.value : guide.end} y2={guide.axis === 'y' ? guide.value : guide.end} strokeWidth={1 / Math.max(0.2, zoom / 100)} />)}</svg></ViewportPortal>
    </ReactFlow>
    <div className="top-actions"><BaselinePicker baselines={baselines} selected={baselineId} onSelect={selectBaseline} /><button className="icon-button theme-button" aria-label={`切换为${theme === 'dark' ? '浅' : '深'}色主题`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button></div>
    <SelectionTools label={selectionLabel} canGroup={roots.length > 1} onGroup={createGroup} {...(selectedGroup ? { onUngroup: () => setNodes((current) => ungroup(current, selectedGroup.id)) } : {})} />
    <CanvasControls zoom={zoom} boxMode={boxMode} grid={grid} onZoomOut={() => void zoomOut()} onZoomIn={() => void zoomIn()} onFit={() => void fitView({ padding: 0.22, maxZoom: 1.15 })} onToggleBox={() => setBoxMode(!boxMode)} onToggleGrid={() => setGrid(!grid)} />
  </main>;
}

/** Render one immutable baseline set. Advance graph.revision when replacing source data. */
export function VisualizationCanvas(props: VisualizationCanvasProps) {
  useMemo(() => {
    assertValidBaselines(props.baselines);
    if (props.initialBaselineId && !props.baselines.some((item) => item.id === props.initialBaselineId)) throw new Error(`Unknown initial baseline: ${props.initialBaselineId}`);
  }, [props.baselines, props.initialBaselineId]);
  const revision = JSON.stringify(props.baselines.map((item) => [item.id, item.stage.graph.revision ?? item.stage.id]));
  return <ReactFlowProvider key={revision}><CanvasContent {...props} /></ReactFlowProvider>;
}
