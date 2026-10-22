import { useMemo, type CSSProperties } from 'react';
import { Background, BackgroundVariant, Controls, ReactFlow, type EdgeTypes, type NodeChange, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { EvolutionStep, StageSnapshot } from '../../core/schema/types.ts';
import { cssVariables, LAYOUT_METRICS } from '../../core/layout/index.ts';
import { canvasSceneToFlow } from './projection-to-flow.ts';
import { useCanvasScene } from './use-canvas-scene.ts';
import { CardNode } from '../nodes/card.tsx';
import { AggregateNode } from '../nodes/aggregate.tsx';
import { OrthoEdge } from '../edges/ortho.tsx';
import { Inspector } from '../panels/Inspector.tsx';
import { DeltaPanel } from '../panels/DeltaPanel.tsx';
import { useCanvasStore } from '../store/canvas-store.ts';

const nodeTypes: NodeTypes = { card: CardNode, aggregate: AggregateNode };
const edgeTypes: EdgeTypes = { ortho: OrthoEdge };

export interface EvolutionCanvasProps {
  stage: StageSnapshot;
  previous?: StageSnapshot | undefined;
  evolution?: EvolutionStep | undefined;
  showSummary?: boolean | undefined;
}

export function EvolutionCanvas({ stage, previous, evolution, showSummary = true }: EvolutionCanvasProps) {
  const scene = useCanvasScene(stage, previous, evolution);
  const positions = useCanvasStore((state) => state.positions);
  const selected = useCanvasStore((state) => state.selected);
  const viewport = useCanvasStore((state) => state.viewport);
  const toggle = useCanvasStore((state) => state.toggle);
  const select = useCanvasStore((state) => state.select);
  const setPosition = useCanvasStore((state) => state.setPosition);
  const setViewport = useCanvasStore((state) => state.setViewport);
  const style = useMemo(() => ({ width: '100%', height: '100%', ...cssVariables(LAYOUT_METRICS) } as CSSProperties), []);

  if (!scene) {
    return <div className="av-theme av-canvas-shell av-canvas-loading" style={style} aria-live="polite">正在整理画布…</div>;
  }

  const flow = canvasSceneToFlow(scene, positions, selected, { toggle, select });
  const handleNodesChange = (changes: NodeChange[]) => {
    for (const change of changes) {
      if (!('id' in change)) continue;
      const id = change.id.startsWith('node:') ? change.id.slice(5) : change.id;
      if (change.type === 'position' && change.position) setPosition(id, change.position);
      if (change.type === 'select' && change.selected) select(id);
    }
  };
  const changedNodes = scene.delta?.nodes.filter((item) => item.kind !== 'inherited').length ?? 0;
  const changedEdges = scene.delta?.edges.filter((item) => item.kind !== 'inherited').length ?? 0;

  return (
    <div className="av-theme av-canvas-shell" style={style}>
      <DeltaPanel scene={scene} />
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#d8ddd9" bgColor="transparent" />
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            <marker id="av-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9" fill="none" stroke="#9ca5a0" strokeWidth="1.6" />
            </marker>
          </defs>
        </svg>
      </ReactFlow>
      <Inspector scene={scene} />
      {showSummary && <div className="av-canvas-summary" aria-live="polite">{scene.nodes.length} 个可见节点 · {changedNodes} 个节点变化 · {changedEdges} 条关系变化</div>}
    </div>
  );
}
