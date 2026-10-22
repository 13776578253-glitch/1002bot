import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import type { StageSnapshot, TrackSeries } from '../../../src/core/schema/types.ts';
import { EvolutionCanvas } from '../../../src/react/canvas/EvolutionCanvas.tsx';
import { useCanvasStore } from '../../../src/react/store/canvas-store.ts';

import { Sidebar } from './Sidebar.tsx';
import { Stagebar } from './Stagebar.tsx';
import { Toolbar } from './Toolbar.tsx';

export interface ArchitectureBoardProps {
  tracks: TrackSeries[];
  defaultTrackIndex?: number;
  gitCheckoutMeta?: { main?: string; tui?: string; };
  brandTitle?: string;
  brandSubtitle?: string;
  metaVersion?: string;
}

export function ArchitectureBoard({
  tracks,
  defaultTrackIndex = 0,
  gitCheckoutMeta = { main: '44d4eab', tui: '7ac2fec' },
  brandTitle = '项目架构',
  brandSubtitle = '/ 结构画布',
  metaVersion = '交互看板',
}: ArchitectureBoardProps) {
  const [trackIdx, setTrackIdx] = useState(defaultTrackIndex);
  const stageIndex = useCanvasStore((state) => state.stageIndex);
  const selected = useCanvasStore((state) => state.selected);
  const setContext = useCanvasStore((state) => state.setContext);
  const expandOneLevel = useCanvasStore((state) => state.expandOneLevel);
  const collapseOneLevel = useCanvasStore((state) => state.collapseOneLevel);
  const collapseAll = useCanvasStore((state) => state.collapseAll);
  const resetLayout = useCanvasStore((state) => state.resetLayout);
  const setStage = useCanvasStore((state) => state.setStage);
  const inspectorOpen = useCanvasStore((state) => state.inspectorOpen);
  const setInspectorOpen = useCanvasStore((state) => state.setInspectorOpen);
  const select = useCanvasStore((state) => state.select);
  const expanded = useCanvasStore((state) => state.expanded);

  const currentTrack = tracks[trackIdx] ?? tracks[0]!;
  const stage: StageSnapshot = currentTrack.stages[stageIndex] ?? currentTrack.stages[0]!;
  const previous = stageIndex > 0 ? currentTrack.stages[stageIndex - 1] : undefined;
  const evolution = stageIndex > 0 ? currentTrack.events?.find((step) => step.stage === stage.id) : undefined;

  useEffect(() => {
    setContext(currentTrack.track, stage.id, stageIndex);
  }, [currentTrack.track, stage.id, stageIndex, setContext]);

  const childIds = useMemo(() => {
    const parents = new Set(stage.graph.nodes.map((node) => node.parentId).filter((id): id is string => id !== null));
    return stage.graph.nodes.filter((node) => parents.has(node.id)).map((node) => node.id);
  }, [stage]);
  const expandableCandidates = childIds.filter((id) => !expanded.has(id));
  const selectedTitle = stage.graph.nodes.find((node) => node.id === selected)?.label;

  const toggleStageInfo = () => {
    if (!inspectorOpen) {
      select(undefined);
      setInspectorOpen(true);
    } else if (selected === undefined) {
      setInspectorOpen(false);
    } else {
      select(undefined);
    }
  };

  return (
    <div className="av-theme" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="av-topbar">
        <div className="av-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="7" height="6" rx="1" /><rect x="15" y="15" width="7" height="6" rx="1" /><rect x="2" y="15" width="7" height="6" rx="1" /><path d="M5 9v6M9 6h9v9" /></svg>
          <span>{brandTitle}</span>
          <span style={{ fontWeight: 400, color: '#94a399', fontSize: 12 }}>{brandSubtitle}</span>
        </div>
        <div className="av-top-meta"><span>{stage.date ? stage.date + ' 基线' : '架构基线'}</span><span className="av-prototype-badge">{metaVersion}</span></div>
      </header>

      <div className="av-shell">
        <Sidebar
          tracks={tracks}
          activeTrackIndex={trackIdx}
          activeStageIndex={stageIndex}
          onSelectTrack={(index) => { setTrackIdx(index); setStage(0); }}
          onSelectStage={(index) => setStage(index)}
          gitCheckoutMeta={gitCheckoutMeta}
        />
        <main className="av-workspace">
          <Stagebar
            trackName={currentTrack.name}
            stage={stage}
            stageIndex={stageIndex}
            totalStages={currentTrack.stages.length}
            onPrevStage={() => { if (stageIndex > 0) setStage(stageIndex - 1); }}
            onNextStage={() => { if (stageIndex < currentTrack.stages.length - 1) setStage(stageIndex + 1); }}
          />
          <Toolbar
            selectedTitle={selectedTitle}
            canExpandOneLevel={expandableCandidates.length > 0}
            hasExpandedNodes={expanded.size > 0}
            onExpandOneLevel={() => expandOneLevel(expandableCandidates)}
            onCollapseOneLevel={collapseOneLevel}
            onCollapseAll={collapseAll}
            onResetLayout={resetLayout}
            onToggleStageInfo={toggleStageInfo}
          />
          <div className="av-canvas-viewport">
            <ReactFlowProvider>
              <EvolutionCanvas stage={stage} previous={previous} evolution={evolution} />
            </ReactFlowProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
