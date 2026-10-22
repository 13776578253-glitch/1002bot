/**
 * 1002bot business adapter.
 *
 * This module is the only place that parses the source tree used by the
 * example. Core receives flat CanonicalGraph snapshots and never reads these
 * source objects directly.
 */

import type { CanonicalEdge, CanonicalNode, CanonicalPort, StageSnapshot, TrackSeries } from '../../src/core/schema/types.ts';
import { assertValidSnapshot } from '../../src/core/schema/validate.ts';
import { assertValidGraph } from '../../src/core/graph/validate.ts';
import { normalizeTrackSeries } from '../../src/core/schema/normalize.ts';
import { STAGE_NAMES, STAGES } from './stages.ts';
import { buildGraph as buildCanonicalGraph, setTrack as setCanonicalTrack, stages as canonicalStages } from './canonical-model.ts';

interface SourcePort { id: string; label?: string; direction?: CanonicalPort['direction']; side?: CanonicalPort['side']; order?: number; role?: string; }
interface SourceEdge { from: string; to: string; label?: string; twoWay?: boolean; relation?: CanonicalEdge['relation']; }
interface SourceNode {
  id: string;
  title: string;
  desc?: string;
  details?: unknown;
  file?: string;
  children?: SourceNode[];
  edges?: SourceEdge[];
  ports?: SourcePort[];
  intro?: string | number;
  planned?: boolean;
}
interface SourceStage { id: string; label: string; n: number; title: string; subtitle?: string; date?: string; scope?: string; status?: string; changes?: string[]; verified?: string; doc?: string; }
const TRACKS = ['main', 'qq', 'tui'] as const;

function sourceDetails(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === 'string');
  return values.length ? values : undefined;
}

function sourcePorts(value: SourcePort[] | undefined): CanonicalPort[] {
  return (value ?? []).map((port, order) => ({
    id: port.id,
    ...(port.label === undefined ? {} : { label: port.label }),
    direction: port.direction ?? 'bidirectional',
    side: port.side ?? 'auto',
    order: port.order ?? order,
    ...(port.role === undefined ? {} : { role: port.role }),
  }));
}

function relationFor(edge: SourceEdge): CanonicalEdge['relation'] {
  if (edge.relation) return edge.relation;
  const value = (edge.label ?? '').toLowerCase();
  if (value.includes('存') || value.includes('save') || value.includes('record')) return 'storage';
  if (value.includes('工具') || value.includes('tool') || value.includes('调用') || value.includes('call')) return 'call';
  if (value.includes('事件') || value.includes('event') || value.includes('tick')) return 'event';
  return 'control';
}

function idFor(source: SourceNode, used: Set<string>): string {
  const candidate = source.id || 'node';
  let result = candidate;
  let suffix = 2;
  while (used.has(result)) result = candidate + '-' + suffix++;
  used.add(result);
  return result;
}

function endpointPath(value: string, ownerPath: string): string {
  const hash = value.indexOf('#');
  const raw = hash < 0 ? value : value.slice(0, hash);
  const suffix = hash < 0 ? '' : value.slice(hash);
  const path = raw.startsWith('system') ? raw : ownerPath + '/' + raw;
  return path + suffix;
}

function convertStage(sourceStage: SourceStage, track: string): StageSnapshot {
  setCanonicalTrack(track);
  const root = buildCanonicalGraph(sourceStage);
  const sourceByPath = new Map<string, SourceNode>();
  const parentByPath = new Map<string, string | null>();
  const idByPath = new Map<string, string>();
  const used = new Set<string>();

  const walk = (node: SourceNode, path: string, parentPath: string | null): void => {
    sourceByPath.set(path, node);
    parentByPath.set(path, parentPath);
    idByPath.set(path, idFor(node, used));
    for (const child of node.children ?? []) walk(child, path + '/' + child.id, path);
  };
  walk(root, 'system', null);

  const nodes: CanonicalNode[] = [];
  for (const [path, source] of sourceByPath) {
    const parentPath = parentByPath.get(path) ?? null;
    const nodeId = idByPath.get(path)!;
    const details = sourceDetails(source.details);
    const node: CanonicalNode = {
      id: nodeId,
      parentId: parentPath === null ? null : idByPath.get(parentPath!) ?? null,
      kind: parentPath === null ? 'root' : source.planned ? 'planned' : (source.children?.length ? 'group' : 'component'),
      label: source.title,
      ...(source.desc === undefined ? {} : { summary: source.desc }),
      ...(details === undefined ? {} : { details }),
      ports: sourcePorts(source.ports),
      ...(source.file === undefined ? {} : { sourceRefs: [source.file] }),
      ...(source.intro === undefined ? {} : { introducedAt: String(source.intro) }),
      ...(source.planned ? { planned: true } : {}),
      order: path.split('/').length * 1000,
    };
    nodes.push(node);
  }

  const edges: CanonicalEdge[] = [];
  let edgeOrder = 0;
  for (const [ownerPath, owner] of sourceByPath) {
    for (const [localIndex, edge] of (owner.edges ?? []).entries()) {
      const sourcePath = endpointPath(edge.from, ownerPath);
      const targetPath = endpointPath(edge.to, ownerPath);
      const sourceHash = sourcePath.indexOf('#');
      const targetHash = targetPath.indexOf('#');
      const sourceNodeId = idByPath.get(sourceHash < 0 ? sourcePath : sourcePath.slice(0, sourceHash));
      const targetNodeId = idByPath.get(targetHash < 0 ? targetPath : targetPath.slice(0, targetHash));
      if (!sourceNodeId || !targetNodeId) {
        throw new Error('Unresolved source edge endpoint in ' + track + '/' + sourceStage.id + ': ' + sourcePath + ' -> ' + targetPath);
      }
      edges.push({
        id: sourceStage.id + ':edge:' + edgeOrder + ':' + ownerPath + ':' + localIndex,
        source: { nodeId: sourceNodeId, ...(sourceHash < 0 ? {} : { portId: sourcePath.slice(sourceHash + 1) }) },
        target: { nodeId: targetNodeId, ...(targetHash < 0 ? {} : { portId: targetPath.slice(targetHash + 1) }) },
        relation: relationFor(edge),
        direction: edge.twoWay ? 'bidirectional' : 'directed',
        ...(edge.label === undefined ? {} : { label: edge.label }),
        order: edgeOrder++,
      });
    }
  }

  const graph = { rootId: idByPath.get('system')!, nodes, edges, revision: track + ':' + sourceStage.id };
  assertValidGraph(graph);
  const snapshot: StageSnapshot = {
    id: sourceStage.id,
    label: sourceStage.label,
    track,
    order: sourceStage.n,
    title: sourceStage.title,
    ...(sourceStage.subtitle === undefined ? {} : { subtitle: sourceStage.subtitle }),
    ...(sourceStage.date === undefined ? {} : { date: sourceStage.date }),
    ...(sourceStage.scope === undefined ? {} : { scope: sourceStage.scope }),
    ...(sourceStage.status === undefined ? {} : { status: sourceStage.status }),
    ...(sourceStage.changes === undefined ? {} : { changes: sourceStage.changes }),
    ...(sourceStage.verified === undefined ? {} : { verified: sourceStage.verified }),
    ...(sourceStage.doc === undefined ? {} : { doc: sourceStage.doc }),
    graph,
  };
  assertValidSnapshot(snapshot);
  return snapshot;
}

export function loadBotStages(): { tracks: TrackSeries[] } {
  return {
    tracks: TRACKS.map((track) => {
      setCanonicalTrack(track);
      const stages = STAGES[track as keyof typeof STAGES] as SourceStage[];
      return normalizeTrackSeries({
        track,
        name: STAGE_NAMES[track as keyof typeof STAGE_NAMES],
        stages: stages.map((stage) => {
          const sourceStage = (canonicalStages[track] as SourceStage[]).find((candidate) => candidate.id === stage.id);
          if (!sourceStage) throw new Error('Missing source stage "' + stage.id + '"');
          return convertStage(sourceStage, track);
        }),
      });
    }),
  };
}
