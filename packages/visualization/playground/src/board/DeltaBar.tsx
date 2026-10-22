export interface DeltaBarProps {
  summaryText: string;
  showDetailsButton: boolean;
  onShowDetails: () => void;
}

export function DeltaBar({
  summaryText,
  showDetailsButton,
  onShowDetails,
}: DeltaBarProps) {
  return (
    <div className="av-deltabar">
      <div className="av-delta-summary">
        <span>{summaryText}</span>
        {showDetailsButton && (
          <button
            type="button"
            className="av-delta-summary-btn"
            onClick={onShowDetails}
          >
            增量明细 ↗
          </button>
        )}
      </div>
      <div className="av-delta-legend" aria-label="增量图例">
        <span className="av-delta-legend-item added">新增 / 新关系</span>
        <span className="av-delta-legend-item changed">修改 / 改线</span>
        <span className="av-delta-legend-item inherited">沿用</span>
      </div>
    </div>
  );
}
