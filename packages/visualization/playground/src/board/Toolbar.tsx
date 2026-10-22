export interface ToolbarProps {
  selectedTitle?: string | undefined;
  visibleNodeCount: number;
  canExpandOneLevel: boolean;
  hasExpandedNodes: boolean;
  onExpandOneLevel: () => void;
  onCollapseOneLevel: () => void;
  onCollapseAll: () => void;
  onResetLayout: () => void;
  onToggleStageInfo: () => void;
}

export function Toolbar({
  selectedTitle,
  visibleNodeCount,
  canExpandOneLevel,
  hasExpandedNodes,
  onExpandOneLevel,
  onCollapseOneLevel,
  onCollapseAll,
  onResetLayout,
  onToggleStageInfo,
}: ToolbarProps) {
  return (
    <div className="av-toolbar">
      <div className="av-toolbar-group">
        <span className="av-selection-name">
          {selectedTitle ?? '系统总览'}
        </span>
        <i className="av-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="av-tool-btn primary"
          disabled={!canExpandOneLevel}
          onClick={onExpandOneLevel}
        >
          展开一层
        </button>
        <button
          type="button"
          className="av-tool-btn"
          disabled={!hasExpandedNodes}
          onClick={onCollapseOneLevel}
        >
          收起一层
        </button>
        <button
          type="button"
          className="av-tool-btn"
          disabled={!hasExpandedNodes && selectedTitle === undefined}
          onClick={onCollapseAll}
        >
          回到总览
        </button>
      </div>
      <div className="av-toolbar-group">
        <span className="av-visible-count">{visibleNodeCount} 个可见节点</span>
        <button type="button" className="av-tool-btn" onClick={onResetLayout}>
          自动整理
        </button>
        <button type="button" className="av-tool-btn" onClick={onToggleStageInfo}>
          阶段说明
        </button>
      </div>
    </div>
  );
}
