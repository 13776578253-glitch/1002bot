import { useEffect, useRef, useState } from 'react';
import type { EvolutionStep, StageSnapshot } from '../../core/schema/types.ts';
import { createCanvasScene, type CanvasScene } from '../../core/engine/scene.ts';
import { useCanvasStore } from '../store/canvas-store.ts';

export function useCanvasScene(stage: StageSnapshot, previous?: StageSnapshot, evolution?: EvolutionStep): CanvasScene | undefined {
  const expanded = useCanvasStore((state) => state.expanded);
  const positions = useCanvasStore((state) => state.positions);
  const requestRef = useRef(0);
  const [scene, setScene] = useState<CanvasScene>();
  useEffect(() => {
    const request = ++requestRef.current;
    let active = true;
    void createCanvasScene({
      stage,
      ...(previous === undefined ? {} : { previous }),
      ...(evolution === undefined ? {} : { evolution }),
      expanded,
      constraints: { pinned: positions, keepWithinParent: true },
      sceneVersion: request,
    }).then((next) => {
      if (active && request === requestRef.current) setScene(next);
    }).catch(() => {
      if (active && request === requestRef.current) setScene(undefined);
    });
    return () => { active = false; };
  }, [stage, previous, evolution, expanded, positions]);
  return scene;
}
