import type { StageSnapshot } from '../../../src/core/schema/types.ts';

export interface StagebarProps {
  trackName: string;
  stage: StageSnapshot;
  stageIndex: number;
  totalStages: number;
  onPrevStage: () => void;
  onNextStage: () => void;
}

export function Stagebar({
  trackName,
  stage,
  stageIndex,
  totalStages,
  onPrevStage,
  onNextStage,
}: StagebarProps) {
  return (
    <section className="av-stagebar" aria-label="当前阶段">
      <div>
        <div className="av-stage-kicker">{trackName} / 架构演进</div>
        <h1>{stage.title}</h1>
        {stage.subtitle && <p>{stage.subtitle}</p>}
      </div>
      <div className="av-stage-right">
        {stage.status && <span className="av-stage-status-chip">{stage.status}</span>}
        <nav className="av-stage-nav" aria-label="前后阶段">
          <button
            type="button"
            aria-label="上一阶段"
            disabled={stageIndex <= 0}
            onClick={onPrevStage}
          >
            ‹
          </button>
          <span>{stageIndex + 1} / {totalStages}</span>
          <button
            type="button"
            aria-label="下一阶段"
            disabled={stageIndex >= totalStages - 1}
            onClick={onNextStage}
          >
            ›
          </button>
        </nav>
      </div>
    </section>
  );
}
