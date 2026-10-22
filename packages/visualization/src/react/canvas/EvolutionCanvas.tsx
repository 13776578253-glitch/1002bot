/**
 * Main canvas: runs the core projection over the current stage snapshot,
 * applies the tidy layout, adapts the result to React Flow, and wires
 * expansion / selection interactions back into the store.
 */

import { useMemo, type CSSProperties } from 'react';
import { Controls, ReactFlow, Background, BackgroundVariant, type EdgeTypes, type NodeChange, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { EvolutionStep, StageSnapshot } from '../../core/schema/types.ts';
import { createCanvasModel } from '../../core/engine/index.ts';
import { LAYOUT_METRICS } from '../../core/layout/tidy.ts';
import { canvasModelToFlow } from './projection-to-flow.ts';
import { CardNode } from '../nodes/card.tsx';
import { AggregateNode } from '../nodes/aggregate.tsx';
import { OrthoEdge } from '../edges/ortho.tsx';
import { useCanvasStore } from '../store/canvas-store.ts';

const nodeTypes: NodeTypes = { card: CardNode, aggregate: AggregateNode };
const edgeTypes: EdgeTypes = { ortho: OrthoEdge };
const canvasStyle = {
  width: '100%',
  height: '100%',
  '--av-card-width': `${LAYOUT_METRICS.cardWidth}px`,
  '--av-card-padding': `${LAYOUT_METRICS.cardPadding}px`,
  '--av-aggregate-padding': `${LAYOUT_METRICS.aggregatePadding}px`,
  '--av-aggregate-header-height': `${LAYOUT_METRICS.aggregateHeaderHeight}px`,
  '--av-aggregate-description-height': `${LAYOUT_METRICS.aggregateDescriptionHeight}px`,
} as CSSProperties;

export interface EvolutionCanvasProps {
  stage: StageSnapshot;
  previous?: StageSnapshot | undefined;
  evolution?: EvolutionStep | undefined;
  showSummary?: boolean | undefined;
}

export function EvolutionCanvas({ stage, previous, evolution, showSummary = true }: EvolutionCanvasProps) {
  const expanded = useCanvasStore((s) => s.expanded);
  const positions = useCanvasStore((s) => s.positions);
  const selected = useCanvasStore((s) => s.selected);
  const viewport = useCanvasStore((s) => s.viewport);
  const inspectorOpen = useCanvasStore((s) => s.inspectorOpen);
  const toggle = useCanvasStore((s) => s.toggle);
  const select = useCanvasStore((s) => s.select);
  const setPosition = useCanvasStore((s) => s.setPosition);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const setInspectorOpen = useCanvasStore((s) => s.setInspectorOpen);

  const model = useMemo(() => {
    return createCanvasModel(stage, previous, expanded, evolution);
  }, [stage, previous, expanded, evolution]);
  const { nodes, edges } = useMemo(
    () => canvasModelToFlow(model, positions, selected, { toggle, select }),
    [model, positions, selected, toggle, select],
  );
  const selectedNode = model.nodes.find((node) => node.path === selected);
  const changedNodes = model.delta?.nodes.filter((node) => node.kind !== 'inherited').length ?? 0;
  const changedEdges = model.delta?.edges.filter((edge) => edge.kind !== 'inherited').length ?? 0;
  const handleNodesChange = (changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position !== undefined) {
        setPosition(change.id, change.position);
      }
      if (change.type === 'select' && change.selected) select(change.id);
    }
  };

  return (
    <div className="av-theme av-canvas-shell" style={canvasStyle}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.2}
        maxZoom={2}
        nodesConnectable={false}
        {...(viewport === undefined ? {} : { defaultViewport: viewport })}
        onInit={(instance) => { if (viewport === undefined) instance.fitView({ padding: 0.18 }); }}
        onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
        onNodesChange={handleNodesChange}
        onPaneClick={() => select(undefined)}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} position="bottom-right" />
        <Background variant={BackgroundVariant.Lines} gap={20} color="#e8ebee" bgColor="transparent" />
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            <marker id="av-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9" fill="none" stroke="#858c94" strokeWidth="1.6" />
            </marker>
          </defs>
        </svg>
      </ReactFlow>
      <aside className={['av-inspector', inspectorOpen ? 'av-inspector--open' : ''].join(' ')} aria-live="polite" hidden={!inspectorOpen}>
        {selectedNode ? (
          <>
            <div className="av-inspector-head">
              <div>
                <div className="av-inspector-kicker">{stage.label}</div>
                <h2>{selectedNode.title}</h2>
              </div>
              <button type="button" className="av-inspector-close" onClick={() => { select(undefined); setInspectorOpen(false); }} aria-label="关闭详情">×</button>
            </div>
            <div className="av-inspector-body">
              <code>{selectedNode.path}</code>
              {selectedNode.desc && <p>{selectedNode.desc}</p>}
              {selectedNode.delta && selectedNode.delta.kind !== 'inherited' && (
                <div className={`av-inspector-delta av-delta-${selectedNode.delta.kind}`}>
                  {selectedNode.delta.kind}{selectedNode.delta.note ? ` · ${selectedNode.delta.note}` : ''}
                </div>
              )}
              {selectedNode.details && selectedNode.details.length > 0 && (
                <ul>{selectedNode.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
              )}
              {selectedNode.source && <a href={selectedNode.source}>{selectedNode.source}</a>}
            </div>
          </>
        ) : (
          <>
            <div className="av-inspector-head">
              <div>
                <div className="av-inspector-kicker">{stage.label} · {stage.status ?? '阶段'}</div>
                <h2>{stage.title}</h2>
              </div>
              <button type="button" className="av-inspector-close" onClick={() => setInspectorOpen(false)} aria-label="关闭详情">×</button>
            </div>
            <div className="av-inspector-body av-stage-info">
              {stage.subtitle && <p>{stage.subtitle}</p>}
              {stage.changes && stage.changes.length > 0 && <ul>{stage.changes.map((change) => <li key={change}>{change}</li>)}</ul>}
              {stage.verified && <p>{stage.verified}</p>}
              {stage.doc && <a href={stage.doc}>{stage.label} 阶段依据</a>}
            </div>
          </>
        )}
      </aside>
      {showSummary && (
        <div className="av-canvas-summary" aria-live="polite">
          {model.nodes.length} 个可见节点 · {changedNodes} 个节点变化 · {changedEdges} 条关系变化
        </div>
      )}
    </div>
  );
}
