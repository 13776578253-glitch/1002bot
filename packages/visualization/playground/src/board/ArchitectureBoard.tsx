import { useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import type { StageSnapshot, TrackSeries } from '../../../src/core/schema/types.ts';
import { createCanvasModel } from '../../../src/core/engine/index.ts';
import { EvolutionCanvas } from '../../../src/react/canvas/EvolutionCanvas.tsx';
import { useCanvasStore } from '../../../src/react/store/canvas-store.ts';

import { Sidebar } from './Sidebar.tsx';
import { Stagebar } from './Stagebar.tsx';
import { Toolbar } from './Toolbar.tsx';
import { DeltaBar } from './DeltaBar.tsx';

export interface ArchitectureBoardProps {
  tracks: TrackSeries[];
  defaultTrackIndex?: number;
  gitCheckoutMeta?: {
    main?: string;
    tui?: string;
  };
  brandTitle?: string;
  brandSubtitle?: string;
  metaVersion?: string;
}

export function ArchitectureBoard({
  tracks,
  defaultTrackIndex = 0,
  gitCheckoutMeta = { main: '44d4eab', tui: '7ac2fec' },
  brandTitle = '项目架构',
  brandSubtitle = '/ 自由画布',
  metaVersion = '交互看板',
}: ArchitectureBoardProps) {
  const [trackIdx, setTrackIdx] = useState(defaultTrackIndex);
  const stageIndex = useCanvasStore((s) => s.stageIndex);
  const expanded = useCanvasStore((s) => s.expanded);
  const selected = useCanvasStore((s) => s.selected);
  const inspectorOpen = useCanvasStore((s) => s.inspectorOpen);
  const setStage = useCanvasStore((s) => s.setStage);
  const select = useCanvasStore((s) => s.select);
  const expandOneLevel = useCanvasStore((s) => s.expandOneLevel);
  const collapseOneLevel = useCanvasStore((s) => s.collapseOneLevel);
  const collapseAll = useCanvasStore((s) => s.collapseAll);
  const resetLayout = useCanvasStore((s) => s.resetLayout);
  const setInspectorOpen = useCanvasStore((s) => s.setInspectorOpen);

  const currentTrack = tracks[trackIdx] ?? tracks[0]!;
  const stage: StageSnapshot = currentTrack.stages[stageIndex] ?? currentTrack.stages[0]!;
  const previous = stageIndex > 0 ? currentTrack.stages[stageIndex - 1] : undefined;
  const evolution = stageIndex > 0 ? currentTrack.events?.find((step) => step.stage === stage.id) : undefined;

  const model = useMemo(() => {
    return createCanvasModel(stage, previous, expanded, evolution);
  }, [stage, previous, expanded, evolution]);

  const selectedNode = model.nodes.find((node) => node.path === selected);
  const changedNodes = model.delta?.nodes.filter((node) => node.kind !== 'inherited').length ?? 0;
  const changedEdges = model.delta?.edges.filter((edge) => edge.kind !== 'inherited').length ?? 0;

  const expandableCandidates = useMemo(() => {
    return model.nodes.filter((n) => n.hasChildren && !n.expanded).map((n) => n.path);
  }, [model.nodes]);

  const handlePrevStage = () => {
    if (stageIndex > 0) setStage(stageIndex - 1);
  };

  const handleNextStage = () => {
    if (stageIndex < currentTrack.stages.length - 1) setStage(stageIndex + 1);
  };

  const handleToggleStageInfo = () => {
    if (!inspectorOpen) {
      select(undefined);
      setInspectorOpen(true);
    } else if (selected === undefined) {
      setInspectorOpen(false);
    } else {
      select(undefined);
    }
  };

  const handleShowDeltaDetails = () => {
    select(undefined);
    setInspectorOpen(true);
  };

  const deltaText = stageIndex === 0
    ? `基线版本 · ${model.nodes.length} 个初始节点`
    : `${changedNodes} 个节点变化 · ${changedEdges} 条关系变化`;

  return (
    <div className="av-theme" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <header className="av-topbar">
        <div className="av-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="3" width="7" height="6" rx="1" />
            <rect x="15" y="15" width="7" height="6" rx="1" />
            <rect x="2" y="15" width="7" height="6" rx="1" />
            <path d="M5 9v6M9 6h9v9" />
          </svg>
          <span>{brandTitle}</span>
          <span style={{ fontWeight: 400, color: '#94a399', fontSize: 12 }}>{brandSubtitle}</span>
        </div>
        <div className="av-top-meta">
          <span>{stage.date ? `${stage.date} 基线` : '架构基线'}</span>
          <span className="av-prototype-badge">{metaVersion}</span>
        </div>
      </header>

      {/* Shell: Sidebar + Workspace */}
      <div className="av-shell">
        <Sidebar
          tracks={tracks}
          activeTrackIndex={trackIdx}
          activeStageIndex={stageIndex}
          onSelectTrack={(idx) => {
            setTrackIdx(idx);
            setStage(0);
          }}
          onSelectStage={(idx) => setStage(idx)}
          gitCheckoutMeta={gitCheckoutMeta}
        />

        <main className="av-workspace">
          <Stagebar
            trackName={currentTrack.name}
            stage={stage}
            stageIndex={stageIndex}
            totalStages={currentTrack.stages.length}
            onPrevStage={handlePrevStage}
            onNextStage={handleNextStage}
          />

          <Toolbar
            selectedTitle={selectedNode ? selectedNode.title : undefined}
            visibleNodeCount={model.nodes.length}
            canExpandOneLevel={expandableCandidates.length > 0}
            hasExpandedNodes={expanded.size > 0}
            onExpandOneLevel={() => expandOneLevel(expandableCandidates)}
            onCollapseOneLevel={collapseOneLevel}
            onCollapseAll={collapseAll}
            onResetLayout={resetLayout}
            onToggleStageInfo={handleToggleStageInfo}
          />

          <DeltaBar
            summaryText={deltaText}
            showDetailsButton={stageIndex > 0}
            onShowDetails={handleShowDeltaDetails}
          />

          <div className="av-canvas-viewport">
            <ReactFlowProvider>
              <EvolutionCanvas
                stage={stage}
                previous={previous}
                evolution={evolution}
                showSummary={false}
              />
            </ReactFlowProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
