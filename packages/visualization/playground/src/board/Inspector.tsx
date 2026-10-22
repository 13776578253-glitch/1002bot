import type { StageSnapshot } from '../../../src/core/schema/types.ts';
import type { CanvasNodeModel } from '../../../src/core/engine/index.ts';

export interface InspectorProps {
  isOpen: boolean;
  stage: StageSnapshot;
  selectedNode?: CanvasNodeModel | undefined;
  onClose: () => void;
}

export function Inspector({
  isOpen,
  stage,
  selectedNode,
  onClose,
}: InspectorProps) {
  if (!isOpen) return null;

  return (
    <aside className="av-inspector av-inspector--open" aria-live="polite">
      {selectedNode ? (
        <>
          <div className="av-inspector-head">
            <div>
              <div className="av-inspector-kicker">{stage.label}</div>
              <h2>{selectedNode.title}</h2>
            </div>
            <button
              type="button"
              className="av-inspector-close"
              onClick={onClose}
              aria-label="关闭详情"
            >
              ×
            </button>
          </div>
          <div className="av-inspector-body">
            <code>{selectedNode.path}</code>
            {selectedNode.desc && <p>{selectedNode.desc}</p>}
            {selectedNode.delta && selectedNode.delta.kind !== 'inherited' && (
              <div className={`av-inspector-delta av-delta-${selectedNode.delta.kind}`}>
                {selectedNode.delta.kind}
                {selectedNode.delta.note ? ` · ${selectedNode.delta.note}` : ''}
              </div>
            )}
            {selectedNode.details && selectedNode.details.length > 0 && (
              <ul>
                {selectedNode.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
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
            <button
              type="button"
              className="av-inspector-close"
              onClick={onClose}
              aria-label="关闭详情"
            >
              ×
            </button>
          </div>
          <div className="av-inspector-body av-stage-info">
            {stage.subtitle && <p>{stage.subtitle}</p>}
            {stage.changes && stage.changes.length > 0 && (
              <ul>
                {stage.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            )}
            {stage.verified && <p>{stage.verified}</p>}
            {stage.doc && <a href={stage.doc}>{stage.label} 阶段依据</a>}
          </div>
        </>
      )}
    </aside>
  );
}
