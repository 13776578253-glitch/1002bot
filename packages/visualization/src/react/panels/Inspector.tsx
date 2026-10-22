import type { CanvasScene } from '../../core/engine/scene.ts';
import { useCanvasStore } from '../store/canvas-store.ts';

export function Inspector({ scene }: { scene: CanvasScene }) {
  const selected = useCanvasStore((state) => state.selected);
  const open = useCanvasStore((state) => state.inspectorOpen);
  const select = useCanvasStore((state) => state.select);
  const setOpen = useCanvasStore((state) => state.setInspectorOpen);
  const node = selected ? scene.nodes.find((item) => item.id === selected) : undefined;
  return (
    <aside className={['av-inspector', open ? 'av-inspector--open' : ''].join(' ')} aria-live="polite" hidden={!open}>
      <div className="av-inspector-head">
        <div><div className="av-inspector-kicker">{scene.stage.label} · {scene.stage.status ?? '阶段'}</div><h2>{node?.label ?? scene.stage.title}</h2></div>
        <button type="button" className="av-inspector-close" onClick={() => { select(undefined); setOpen(false); }} aria-label="关闭详情">×</button>
      </div>
      <div className="av-inspector-body">
        {node ? (
          <>
            <code>{node.path}</code>
            {node.summary && <p>{node.summary}</p>}
            {node.delta && node.delta.kind !== 'inherited' && <div className={'av-inspector-delta av-delta-' + node.delta.kind}>{node.delta.kind}{node.delta.note ? ' · ' + node.delta.note : ''}</div>}
            {node.details && node.details.length > 0 && <ul>{node.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
            {node.sourceRefs?.map((source) => <a href={source} key={source}>{source}</a>)}
          </>
        ) : (
          <>
            {scene.stage.subtitle && <p>{scene.stage.subtitle}</p>}
            {scene.stage.changes && scene.stage.changes.length > 0 && <ul>{scene.stage.changes.map((change) => <li key={change}>{change}</li>)}</ul>}
            {scene.stage.verified && <p>{scene.stage.verified}</p>}
            {scene.stage.doc && <a href={scene.stage.doc}>{scene.stage.label} 阶段依据</a>}
          </>
        )}
      </div>
    </aside>
  );
}
