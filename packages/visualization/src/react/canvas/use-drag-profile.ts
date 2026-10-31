/** Gesture-local timing used by browser acceptance; measurements never enter saved views. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RouteCacheStats } from '../model/route-cache.ts';

const percentile = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]! : 0;
export function useDragProfile(stats: RouteCacheStats) {
  const currentStats = useRef(stats); currentStats.current = stats;
  const [result, setResult] = useState({ frames: 0, frameP95: 0, geometryP95: 0, constraintP95: 0, routeUpdates: 0, maxRouted: 0, totalEdges: 0 });
  const active = useRef<{ frame?: number; previousTime?: number; previousStats: RouteCacheStats; frames: number[]; geometry: number[]; constraints: number[]; routed: number[] } | undefined>(undefined);
  const sample = () => {
    const gesture = active.current;
    if (gesture && gesture.previousStats !== currentStats.current) {
      gesture.previousStats = currentStats.current;
      gesture.geometry.push(currentStats.current.durationMs);
      gesture.routed.push(currentStats.current.routedEdges);
    }
  };
  const start = useCallback(() => {
    if (active.current) return;
    active.current = { previousStats: currentStats.current, frames: [], geometry: [], constraints: [], routed: [] };
    const tick = (time: number) => {
      const gesture = active.current;
      if (!gesture) return;
      if (gesture.previousTime !== undefined) gesture.frames.push(time - gesture.previousTime);
      gesture.previousTime = time;
      sample();
      gesture.frame = requestAnimationFrame(tick);
    };
    active.current.frame = requestAnimationFrame(tick);
  }, []);
  const stop = useCallback(() => {
    const gesture = active.current;
    if (!gesture) return;
    sample();
    if (gesture.frame !== undefined) cancelAnimationFrame(gesture.frame);
    active.current = undefined;
    setResult({ frames: gesture.frames.length, frameP95: percentile(gesture.frames), geometryP95: percentile(gesture.geometry), constraintP95: percentile(gesture.constraints), routeUpdates: gesture.routed.length, maxRouted: Math.max(0, ...gesture.routed), totalEdges: currentStats.current.totalEdges });
  }, []);
  useEffect(() => () => { if (active.current?.frame !== undefined) cancelAnimationFrame(active.current.frame); }, []);
  const recordConstraint = useCallback((duration: number) => { active.current?.constraints.push(duration); }, []);
  return { result, start, stop, recordConstraint };
}
