/** Interactive architecture canvas with isolated source data and restorable working views. */
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal, type Edge } from '@xyflow/react';
import { assertValidBaselines } from '../core/schema/baseline.ts';
import type { VisualizationCanvasProps } from './types.ts';
import type { CanvasWorkspaceView } from './model/workspace.ts';
import { Card, Structure, Cluster } from './components/nodes.tsx';
import { Link, type LinkData } from './components/relation-edge.tsx';
import { Icon } from './components/icon.tsx';
import { TopActions } from './components/top-actions.tsx';
import { CanvasControls } from './components/canvas-controls.tsx';
import { SelectionTools } from './components/selection-tools.tsx';
import { ConnectionPanel } from './components/connection-panel.tsx';
import { TransitionPanel } from './components/transition-panel.tsx';
import { normalizeMarqueeSelection, type CanvasNode } from './model/grouping.ts';
import { useCanvasController } from './canvas/use-canvas-controller.ts';
import { baselineNodes, VIEW_MODES } from './canvas/use-workspace-session.ts';
import { baselineForView } from './model/view-projection.ts';
import { normalizeWorkspaceView } from './persistence/local-storage.ts';
import { restoreNodeViews } from './model/workspace.ts';
import { restoreFrozenGroups } from './model/frozen.ts';
import { rebaseSavedView } from './model/stage-navigation.ts';
import { loadWorkspace } from './persistence/storage-session.ts';

const nodeTypes = { card: Card, cluster: Cluster, structure: Structure };
const edgeTypes = { link: Link };
const fitOptions = { padding: 0.22, maxZoom: 1.15 };
const flowOptions = { hideAttribution: true };
const multiSelectionKeys = ['Meta', 'Control', 'Shift'];
const panButtons = [0, 1, 2], boxPanButtons = [1, 2];

function CanvasContent({ restored, ...props }: VisualizationCanvasProps & { restored?: CanvasWorkspaceView }) {
  const canvas = useCanvasController(props, restored);
  const { displayNodes, edges, visibleGuides, selectedGroup, roots, selectionLabel, setNodes, baseline, theme, setTheme, boxMode, setBoxMode, grid, setGrid, zoom, setZoom, setSelectedEdge, onNodesChange, toggleNode, chooseEdge, selectBaseline, createGroup, zoomIn, zoomOut, fitView } = canvas;
  const onDoubleClick = useCallback((event: MouseEvent, node: CanvasNode) => {
    if (canvas.preview || canvas.viewMode !== 'structure') return;
    if (node.data.expandable && !(event.target as Element).closest('.nodrag') && (node.type === 'card' || (event.target as Element).closest('.structure-header'))) toggleNode(node.id);
  }, [canvas.preview, canvas.viewMode, toggleNode]);
  const clearEdge = useCallback(() => setSelectedEdge(undefined), [setSelectedEdge]);
  const onEdgeClick = useCallback((_event: MouseEvent, edge: Edge<LinkData>) => chooseEdge(edge.id), [chooseEdge]);
  const onSelectionEnd = useCallback(() => { if (!canvas.preview) setNodes((current) => normalizeMarqueeSelection(current)); }, [canvas.preview, setNodes]);
  const onMove = useCallback((_event: unknown, viewport: { zoom: number }) => setZoom(Math.round(viewport.zoom * 100)), [setZoom]);
  const onMoveEnd = useCallback((_event: unknown, viewport: { x: number; y: number; zoom: number }) => { if (!canvas.preview) canvas.saveViewport(viewport); }, [canvas.preview, canvas.saveViewport]);
  return <main className="canvas-app" data-theme={theme} data-view-mode={canvas.viewMode} data-stage-id={baseline.id} aria-label="架构画布" data-transition={JSON.stringify(canvas.transition)} data-route-count={canvas.routeStats.routedEdges} data-route-total={canvas.routeStats.totalEdges} data-route-ms={canvas.routeStats.durationMs.toFixed(3)} data-route-geometry-ms={canvas.routeStats.geometryMs.toFixed(3)} data-route-routing-ms={canvas.routeStats.routingMs.toFixed(3)} data-route-label-ms={canvas.routeStats.labelMs.toFixed(3)} data-route-group-ms={canvas.routeStats.groupMs.toFixed(3)} data-routing-engine={canvas.routingEngine} data-routing-fallback={canvas.routingStatus.fallback?.reason ?? ''} data-routing-cache={canvas.routingStatus.cache ? `${canvas.routingStatus.cache.mode}:${canvas.routingStatus.cache.reusedGroups}/${canvas.routingStatus.cache.groups}` : ''} data-drag-profile={JSON.stringify(canvas.dragProfile)}>
    <ReactFlow<CanvasNode, Edge<LinkData>>
      nodes={displayNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={onNodesChange} nodesConnectable={false} deleteKeyCode={null}
      nodesDraggable={!canvas.preview} elementsSelectable={!canvas.preview}
      zoomOnDoubleClick={false}
      onNodeDoubleClick={onDoubleClick}
      onNodeClick={clearEdge} onEdgeClick={onEdgeClick}
      onNodeDragStart={canvas.beginDrag} onNodeDragStop={canvas.finishDrag}
      onSelectionDragStart={canvas.beginDrag} onSelectionDragStop={canvas.finishDrag}
      onSelectionEnd={onSelectionEnd}
      onPaneClick={clearEdge}
      onMove={onMove}
      onMoveEnd={onMoveEnd}
      {...(canvas.initialViewport ? { defaultViewport: canvas.initialViewport } : {})}
      selectionMode={SelectionMode.Partial} selectionOnDrag={boxMode && !canvas.preview}
      panOnDrag={boxMode && !canvas.preview ? boxPanButtons : panButtons} selectionKeyCode="Shift" multiSelectionKeyCode={multiSelectionKeys}
      minZoom={0.2} maxZoom={2} fitView={!canvas.initialViewport} fitViewOptions={fitOptions}
      elevateNodesOnSelect={false} elevateEdgesOnSelect={false} proOptions={flowOptions}
    >
      {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--grid)" className="canvas-grid" />}
      <ViewportPortal><svg className="alignment-guides" aria-hidden="true">{visibleGuides.map((guide, index) => <line key={index} x1={guide.axis === 'x' ? guide.value : guide.start} y1={guide.axis === 'y' ? guide.value : guide.start} x2={guide.axis === 'x' ? guide.value : guide.end} y2={guide.axis === 'y' ? guide.value : guide.end} strokeWidth={1 / Math.max(0.2, zoom / 100)} />)}</svg></ViewportPortal>
    </ReactFlow>
    <TopActions workspaceTitle={baseline.stage.title} stageLabel={baseline.stage.label} stageId={baseline.id} stages={props.baselines.map((item) => ({ id: item.id, label: item.stage.label }))} onSelectStage={selectBaseline} viewMode={canvas.viewMode} onSelectView={canvas.selectView} confirmationStatus={canvas.confirmationStatus} confirmedAt={canvas.confirmedAt} {...(baseline.stage.subtitle ? { description: baseline.stage.subtitle } : {})} theme={theme} onThemeChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
    <SelectionTools label={selectionLabel} modes={canvas.selectedModes} onMode={canvas.setLayoutMode} canGroup={roots.length > 1 && !roots.some((node) => node.data.layoutMode === 'locked')} onGroup={createGroup} canFreeze={roots.length > 0} canUnfreeze={roots.some((node) => node.data.frozen) || !!selectedGroup?.data.frozen} onFreeze={canvas.freezeSubgraph} onUnfreeze={canvas.unfreezeSelected} {...(selectedGroup && selectedGroup.data.layoutMode !== 'locked' && !canvas.nodes.some((node) => node.parentId === selectedGroup.id && node.data.layoutMode === 'locked') ? { onUngroup: () => canvas.dissolveGroup(selectedGroup.id) } : {})} />
    <CanvasControls zoom={zoom} boxMode={boxMode} grid={grid} onZoomOut={() => void zoomOut()} onZoomIn={() => void zoomIn()} onFit={() => void fitView({ padding: 0.22, maxZoom: 1.15 })} onToggleBox={() => setBoxMode(!boxMode)} onToggleGrid={() => setGrid(!grid)} onFreeze={canvas.freezeLayout} onConfirm={canvas.confirmStage} onUndo={canvas.undo} onRedo={canvas.redo} canUndo={canvas.canUndo} canRedo={canvas.canRedo} />
    {canvas.connectionEdge && <ConnectionPanel edge={canvas.connectionEdge} stage={baseline.stage} onClose={canvas.closeConnections} onLocate={canvas.locateConnection} {...(canvas.message ? { message: canvas.message } : {})} {...(canvas.selectedRouteState ? { routeState: canvas.selectedRouteState } : {})} onRouteState={canvas.setEdgeRouteState} />}
    {canvas.preview && <TransitionPanel target={canvas.preview.baseline} conflicts={canvas.preview.conflicts} onCancel={canvas.cancelPreview} {...(canvas.preview.reset?{onAdopt:canvas.adoptPreview}:{})} />}
    {!canvas.saveError && !canvas.message && canvas.blockedRoutes.length > 0 && <div className="canvas-notice" role="status" data-tone="error"><span className="notice-symbol" aria-hidden="true"><Icon name="warning" /></span><span className="notice-message">{canvas.blockedRoutes.length} 条连线无可行路径，请调整节点位置或解锁路径。</span></div>}
    {!canvas.saveError && canvas.blockedRoutes.length === 0 && canvas.routingStatus.fallback && !canvas.routingStatus.fallback.silent && (!canvas.message || canvas.connectionEdge) && <div className="canvas-notice" role="status" data-tone={canvas.routingStatus.fallback.reason === 'incomplete' || canvas.routingStatus.fallback.reason === 'error' ? 'error' : 'info'} data-routing-fallback={canvas.routingStatus.fallback.reason}><span className="notice-symbol" aria-hidden="true"><Icon name={canvas.routingStatus.fallback.reason === 'incomplete' || canvas.routingStatus.fallback.reason === 'error' ? 'warning' : 'info'} /></span><span className="notice-message">{canvas.routingStatus.fallback.message}</span></div>}
    {(canvas.saveError || canvas.message && !canvas.connectionEdge) && <div className="canvas-notice" role="status" data-tone={canvas.saveError ? 'error' : 'info'}><span className="notice-symbol" aria-hidden="true"><Icon name={canvas.saveError ? 'warning' : 'info'} /></span><span className="notice-message">{canvas.saveError || canvas.message}</span>{canvas.saveError ? <button onClick={canvas.retrySave}>重试保存</button> : <button aria-label="关闭提示" onClick={canvas.clearMessage}><Icon name="close" /></button>}</div>}
  </main>;
}

function WorkspaceLoader(props: VisualizationCanvasProps) {
  const [state, setState] = useState<{ ready: boolean; restored?: CanvasWorkspaceView; error?: string }>({ ready: !props.persistence });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!props.persistence) return;
    let active = true;
    setState({ ready: false });
    loadWorkspace(props.persistence!.storage, props.persistence!.key).then((loaded) => {
      const view = loaded ? normalizeWorkspaceView(loaded) : undefined;
      if (view) for (const mode of VIEW_MODES) for (const original of props.baselines) {
        const baseline = baselineForView(original, mode);
        let saved = view.views?.[mode]?.[baseline.id];
        if (saved && saved.revision !== (baseline.stage.graph.revision ?? baseline.stage.id)) {
          saved = rebaseSavedView(baseline, saved);
          view.views![mode]![baseline.id]=saved;
        }
        if (saved) {
          const reconciled = restoreFrozenGroups(restoreNodeViews(baseline, baselineNodes(baseline), saved.nodes), saved.frozenGroups);
          if (reconciled.conflicts.length) throw new Error(reconciled.conflicts.map((item) => item.message).join('；'));
        }
      }
      if (view) view.baselines = view.views![view.viewMode!]!;
      if (active) setState({ ready: true, ...(view ? { restored: view } : {}) });
    }).catch((error: unknown) => { if (active) setState({ ready: false, error: `恢复失败：${error instanceof Error ? error.message : String(error)}` }); });
    return () => { active = false; };
  }, [props.persistence?.key, props.persistence?.storage, attempt]);
  if (!state.ready) return <main className="canvas-app workspace-loading" role="status"><span>{state.error ?? '正在恢复视图…'}</span>{state.error && <button onClick={() => retry((value) => value + 1)}>重试恢复</button>}</main>;
  return <CanvasContent {...props} {...(state.restored ? { restored: state.restored } : {})} />;
}

export function VisualizationCanvas(props: VisualizationCanvasProps) {
  useMemo(() => {
    assertValidBaselines(props.baselines);
    if (props.initialBaselineId && !props.baselines.some((item) => item.id === props.initialBaselineId)) throw new Error(`Unknown initial baseline: ${props.initialBaselineId}`);
  }, [props.baselines, props.initialBaselineId]);
  const revision = JSON.stringify(props.baselines.map((item) => [item.id, item.stage.graph.revision ?? item.stage.id]));
  return <ReactFlowProvider key={`${revision}:${props.persistence?.key ?? ''}`}><WorkspaceLoader {...props} /></ReactFlowProvider>;
}
