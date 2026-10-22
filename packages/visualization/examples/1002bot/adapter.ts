/**
 * Owner: `src/data/canonical-model.ts`.
 *
 * Converts the canonical graph source into validated, stage-complete snapshots.
 */

import type {
  GraphEdge,
  GraphNode,
  StageSnapshot,
  TrackSeries,
} from '../../src/core/schema/types.ts';
import { assertValidSnapshot } from '../../src/core/schema/validate.ts';
import { normalizeTrackSeries } from '../../src/core/schema/normalize.ts';
import { STAGE_NAMES, STAGES } from './stages.ts';
import { buildGraph as buildCanonicalGraph, setTrack as setCanonicalTrack, stages as canonicalStages } from './canonical-model.ts';

interface SourceEdge {
  from: string;
  to: string;
  label?: string;
  twoWay?: boolean;
}

interface SourceNode {
  id: string;
  title: string;
  desc?: string;
  details?: unknown;
  file?: string;
  children?: SourceNode[];
  edges?: SourceEdge[];
  intro?: string | number;
  planned?: boolean;
}

interface CanonicalSource {
  stages: Record<string, Array<Record<string, unknown>>>;
  buildGraph(stage: Record<string, unknown>): SourceNode;
  setTrack(track: string): void;
}

interface SourceGraph {
  root: SourceNode;
  edgeByOwner: Map<string, { edge: SourceEdge; owner: string }[]>;
}

interface ConvertedPath {
  key: string;
  path: string;
}

type SourceDetails = readonly unknown[];

const TRACKS = ['main', 'qq', 'tui'] as const;
function loadCanonicalSource(): CanonicalSource {
  return {
    stages: canonicalStages as CanonicalSource['stages'],
    buildGraph: buildCanonicalGraph as CanonicalSource['buildGraph'],
    setTrack: setCanonicalTrack,
  };
}

function readSourceGraph(sourceRoot: SourceNode): SourceGraph {
  const root: SourceNode = {
    ...sourceRoot,
    children: Array.from(sourceRoot.children ?? []),
    edges: Array.from(sourceRoot.edges ?? []),
  };
  const edgeByOwner = new Map<string, { edge: SourceEdge; owner: string }[]>();

  function walk(node: SourceNode, path: string): void {
    const children = Array.from(node.children ?? [], (child) => ({
      ...child,
      details: Array.from((Array.isArray(child.details) ? child.details : []) as SourceDetails),
      children: Array.from(child.children ?? []),
      edges: Array.from(child.edges ?? []),
    }));
    node.details = Array.from((Array.isArray(node.details) ? node.details : []) as SourceDetails);
    node.children = children;
    node.edges = Array.from(node.edges ?? []);
    edgeByOwner.set(
      path,
      node.edges.map((edge) => ({ edge, owner: path })),
    );
    for (const child of children) walk(child, `${path}/${child.id}`);
  }

  walk(root, 'system');
  return { root, edgeByOwner };
}

function stringDetails(details: unknown): string[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const values = details.filter((value): value is string => typeof value === 'string');
  return values.length ? values : undefined;
}

const FALLBACK_KEYS: Record<string, string> = {
  'system/runtime/execution/context': 'context-group',
  'system/runtime/execution/model': 'model-group',
  'system/runtime/execution/tools': 'tools-group',
  'system/runtime/execution/model/provider-request': 'provider-request-group',
};

function uniqueKey(source: SourceNode, path: string, used: Set<string>): string {
  const candidate = source.id === 'system'
    ? 'system'
    : FALLBACK_KEYS[path] ?? source.id;
  let key = candidate;
  let index = 2;
  while (used.has(key)) key = `${candidate}-${index++}`;
  return key;
}

function assignPaths(
  source: SourceNode,
  sourcePath: string,
  parentPath: string,
  used: Set<string>,
  pathBySourcePath: Map<string, ConvertedPath>,
): string {
  const key = uniqueKey(source, sourcePath, used);
  used.add(key);
  const nodePath = parentPath ? `${parentPath}/${key}` : key;
  pathBySourcePath.set(sourcePath, { key, path: nodePath });
  for (const child of source.children ?? []) {
    const childPath = `${sourcePath}/${child.id}`;
    assignPaths(child, childPath, nodePath, used, pathBySourcePath);
  }
  return key;
}

function convertNode(
  source: SourceNode,
  sourcePath: string,
  pathBySourcePath: ReadonlyMap<string, ConvertedPath>,
  planned: boolean,
): GraphNode {
  const converted = pathBySourcePath.get(sourcePath)!;
  const marker = planned || source.planned === true;
  const details = stringDetails(source.details);
  const node: GraphNode = {
    key: converted.key,
    title: source.title,
    ...(source.desc === undefined ? {} : { desc: source.desc }),
    ...(details === undefined ? {} : { details }),
    ...(source.file === undefined ? {} : { source: source.file }),
    ...(source.intro === undefined ? {} : { intro: String(source.intro) }),
    ...(marker ? { planned: true } : {}),
  };
  const children = Array.from(source.children ?? [], (child) =>
    convertNode(child, `${sourcePath}/${child.id}`, pathBySourcePath, marker)
  );
  if (children.length) node.children = children;
  return node;
}

function endpointPath(endpoint: string): string {
  const hash = endpoint.indexOf('#');
  return hash < 0 ? endpoint : endpoint.slice(0, hash);
}

function endpointSuffix(endpoint: string): string {
  const hash = endpoint.indexOf('#');
  return hash < 0 ? '' : endpoint.slice(hash);
}

function keyEndpoint(
  sourcePath: string,
  pathBySourcePath: ReadonlyMap<string, ConvertedPath>,
  owner: string,
): string {
  const path = endpointPath(sourcePath);
  const fullPath = owner === 'system' ? `system/${path}` : `${owner}/${path}`;
  const converted = pathBySourcePath.get(fullPath);
  if (converted === undefined) {
    throw new Error(
      `Unresolved source edge endpoint "${sourcePath}" in "${owner}" (${fullPath})`,
    );
  }
  return converted.path + endpointSuffix(sourcePath);
}

function convertEdge(
  edge: SourceEdge,
  pathBySourcePath: ReadonlyMap<string, ConvertedPath>,
  scope: string,
): GraphEdge {
  return {
    from: keyEndpoint(edge.from, pathBySourcePath, scope),
    to: keyEndpoint(edge.to, pathBySourcePath, scope),
    ...(edge.label === undefined ? {} : { label: edge.label }),
    ...(edge.twoWay === undefined ? {} : { twoWay: edge.twoWay }),
  };
}

function loadTrack(world: CanonicalSource, track: string): TrackSeries {
  world.setTrack(track);
  const stages = STAGES[track as keyof typeof STAGES];
  if (!stages) throw new Error(`Unknown source track "${track}"`);

  return normalizeTrackSeries({
    track,
    name: STAGE_NAMES[track as keyof typeof STAGE_NAMES],
    stages: stages.map((stage) => {
      const sourceStage = world.stages[track]?.find(({ id }) => id === stage.id);
      if (!sourceStage) throw new Error(`Missing source stage "${stage.id}"`);
      const graph = readSourceGraph(world.buildGraph(sourceStage));
      const pathBySourcePath = new Map<string, ConvertedPath>();
      assignPaths(graph.root, 'system', '', new Set(), pathBySourcePath);
      const root = convertNode(graph.root, 'system', pathBySourcePath, false);
      root.title = stage.title;
      const edges = [...graph.edgeByOwner.values()]
        .flat()
        .map(({ edge, owner }) => convertEdge(edge, pathBySourcePath, owner));
      const snapshot: StageSnapshot = {
        id: stage.id,
        label: stage.label,
        track,
        order: stage.n,
        title: stage.title,
        subtitle: stage.subtitle,
        date: stage.date,
        ...(stage.scope === undefined ? {} : { scope: stage.scope }),
        status: stage.status,
        ...(stage.changes === undefined ? {} : { changes: stage.changes }),
        ...(stage.verified === undefined ? {} : { verified: stage.verified }),
        doc: stage.doc,
        root,
        edges,
      };
      assertValidSnapshot(snapshot);
      return snapshot;
    }),
  });
}

export function loadBotStages(): { tracks: TrackSeries[] } {
  const world = loadCanonicalSource();
  return { tracks: TRACKS.map((track) => loadTrack(world, track)) };
}
