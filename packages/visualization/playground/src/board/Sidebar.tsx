import type { TrackSeries } from '../../../src/core/schema/types.ts';

export interface SidebarProps {
  tracks: TrackSeries[];
  activeTrackIndex: number;
  activeStageIndex: number;
  onSelectTrack: (index: number) => void;
  onSelectStage: (index: number) => void;
  gitCheckoutMeta?: {
    main?: string;
    tui?: string;
  };
}

export function Sidebar({
  tracks,
  activeTrackIndex,
  activeStageIndex,
  onSelectTrack,
  onSelectStage,
  gitCheckoutMeta = { main: '44d4eab', tui: '7ac2fec' },
}: SidebarProps) {
  const currentTrack = tracks[activeTrackIndex] ?? tracks[0]!;

  return (
    <aside className="av-sidebar" aria-label="阶段导航">
      <div>
        <p className="av-section-label">开发路线</p>
        <div className="av-tracks-nav" role="group" aria-label="选择开发路线">
          {tracks.map((t, idx) => (
            <button
              key={t.track}
              type="button"
              className="av-track-btn"
              aria-pressed={activeTrackIndex === idx}
              onClick={() => onSelectTrack(idx)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="av-section-label">基线演进</p>
        <nav className="av-stage-list" aria-label="选择阶段">
          {currentTrack.stages.map((s, idx) => {
            const isActive = activeStageIndex === idx;
            return (
              <button
                key={s.id}
                type="button"
                className="av-stage-btn"
                aria-current={isActive ? 'step' : undefined}
                onClick={() => onSelectStage(idx)}
              >
                <span className="av-stage-no">{idx + 1}</span>
                <div className="av-stage-btn-content">
                  <strong>{s.label} · {s.title}</strong>
                  {s.subtitle && <span>{s.subtitle}</span>}
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="av-sidebar-bottom">
        <b>当前检出</b>
        <br />
        main / QQ <span className="av-mono">{gitCheckoutMeta.main}</span>
        <br />
        TUI <span className="av-mono">{gitCheckoutMeta.tui}</span>
        <br />
        <br />
        图中的聚合范围可以继续展开。
        <br />
        节点位置由你调整。
      </div>
    </aside>
  );
}
