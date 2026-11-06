/** Label placement on immutable, already selected paths. */
import { rectIntersects, segmentBounds, type Point, type Rect } from '../../../core/layout/geometry.ts';
import type { Projection } from '../../../core/projection/index.ts';
import type { CanvasNode } from '../layout/node.ts';
import { measureLabel } from './labels.ts';
import { type EdgeLabelPlacement } from '../contracts/label-types.ts';
import type { LabelAttachment } from '../contracts/label-types.ts';
import type { CachedRoute } from '../routing/route-cache.ts';
import { createDiagramGeometry, type DiagramGeometry } from '../routing/routing.ts';
import { expandBounds, SpatialIndex } from '../layout/spatial-index.ts';

export interface LabelLayoutEdge {
  id: string;
  text: string;
  priority?: number;
  /** 当前投影连接的语义身份。 */
  identity?: string;
  /** 世界坐标下的人工或受保护标签位置。 */
  fixed?: EdgeLabelPlacement;
}

export interface LabelLayoutResult {
  text: string;
  fullText: string;
  placement?: EdgeLabelPlacement;
  attachment?: LabelAttachment;
  identity?: string;
  state: 'normal' | 'adjusted' | 'space-exhausted' | 'fixed';
}

export const LABEL_LAYOUT_POLICY_KEY = 'label-layout-v2-tight-projection';

export interface LabelLayoutStats {
  visible: number;
  hidden: number;
  candidateCount: number;
  generated: number;
  reusedCandidates: number;
  durationMs: number;
}

interface Segment { edgeId: string; from: Point; to: Point; length: number; start: number; ux: number; uy: number }
interface Candidate { placement: EdgeLabelPlacement; rect: Rect; base: number; crossings: number; adjusted: boolean; attachment: LabelAttachment; bucket?: string }
interface CandidateCache { signature: string; candidates: Candidate[] }
interface Prepared { edge: LabelLayoutEdge; text: string; candidates: Candidate[]; preferred?: Candidate; stable: boolean }
interface Occupied { id: string; rect: Rect; fixed: boolean }

const NODE_CLEARANCE = 8;
const BEND_CLEARANCE = 12;
const LABEL_CLEARANCE = 2;
const SIDE_GAP = 2;
export const SWITCH_IMPROVEMENT = 20;
const MAX_REATTACH_DISTANCE = 96;
const MAX_LABEL_WIDTH = 140;
const MAX_CANDIDATES = 32;
const EPSILON = 0.000001;

const rectOf = (label: EdgeLabelPlacement): Rect => ({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
const inside = (outer: Rect, inner: Rect) => inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON
  && inner.x + inner.w <= outer.x + outer.w + EPSILON && inner.y + inner.h <= outer.y + outer.h + EPSILON;
const labelIntersects = (a: Rect, b: Rect) => rectIntersects(expandBounds(a, LABEL_CLEARANCE), expandBounds(b, LABEL_CLEARANCE));

/** 完整语义保留在 fullText，供 tooltip 或详情面板使用。 */
export function shortenLabel(text: string): string {
  if (measureLabel(text).width <= MAX_LABEL_WIDTH) return text;
  let result = '';
  for (const character of Array.from(text)) {
    if (measureLabel(result + character + '…').width > MAX_LABEL_WIDTH) break;
    result += character;
  }
  return `${result.trimEnd()}…`;
}

function clearOfNodes(rect: Rect, geometry: DiagramGeometry): boolean {
  if (geometry.obstacleIndex.query(expandBounds(rect, NODE_CLEARANCE)).some((node) => rectIntersects(rect, expandBounds(node.bounds, NODE_CLEARANCE)))) return false;
  return geometry.frames.every((frame) => inside(expandBounds(frame, -NODE_CLEARANCE), rect)
    || !rectIntersects(expandBounds(frame, NODE_CLEARANCE), rect));
}

/** Liang-Barsky 裁剪同时处理轴对齐和斜线段。 */
function segmentCrossesBox(from: Point, to: Point, rect: Rect): boolean {
  let start = 0, end = 1;
  const dx = to.x - from.x, dy = to.y - from.y;
  for (const [p, q] of [[-dx, from.x - rect.x], [dx, rect.x + rect.w - from.x], [-dy, from.y - rect.y], [dy, rect.y + rect.h - from.y]] as const) {
    if (Math.abs(p) < EPSILON) { if (q <= 0) return false; continue; }
    const t = q / p;
    if (p < 0) start = Math.max(start, t); else end = Math.min(end, t);
    if (start >= end) return false;
  }
  return true;
}

function segmentsOf(edgeId: string, points: readonly Point[]): Segment[] {
  const output: Segment[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) continue;
    const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length;
    const previous = output.at(-1);
    // 同一直线段上的冗余点不算折点。
    if (previous && Math.abs(previous.ux * uy - previous.uy * ux) <= EPSILON && previous.ux * ux + previous.uy * uy > 0) {
      previous.to = to;
      previous.length += length;
    } else output.push({ edgeId, from, to, length, start: 0, ux, uy });
  }
  let start = 0;
  for (const segment of output) { segment.start = start; start += segment.length; }
  return output;
}

function crossesOtherPaths(rect: Rect, ownId: string, segmentIndex: SpatialIndex<Segment>): number {
  return segmentIndex.query(rect).filter((segment) => segment.edgeId !== ownId && segmentCrossesBox(segment.from, segment.to, rect)).length;
}

function pathBounds(segments: readonly Segment[], padding: number): Rect {
  const points = segments.flatMap(({ from, to }) => [from, to]);
  const minX = Math.min(...points.map((point) => point.x)), maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y)), maxY = Math.max(...points.map((point) => point.y));
  return expandBounds({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, padding);
}

function placementFor(anchor: Point, width: number, height: number): EdgeLabelPlacement {
  return { x: anchor.x, y: anchor.y, width, height };
}

const axisOf = (segment: Segment): LabelAttachment['axis'] => Math.abs(segment.uy) <= EPSILON ? 'horizontal'
  : Math.abs(segment.ux) <= EPSILON ? 'vertical' : 'diagonal';

function makeAttachment(segment: Segment, segments: readonly Segment[], along: number, offset: number): LabelAttachment {
  const total = segments.at(-1)!.start + segments.at(-1)!.length;
  return {
    from: { ...segment.from }, to: { ...segment.to },
    projected: { x: segment.from.x + segment.ux * along, y: segment.from.y + segment.uy * along },
    fraction: along / segment.length, axis: axisOf(segment), side: Math.abs(offset) <= EPSILON ? 'inline' : offset < 0 ? 'negative' : 'positive', offset,
    pathStart: { ...segments[0]!.from }, pathEnd: { ...segments.at(-1)!.to }, pathFraction: (segment.start + along) / total,
  };
}

function baseScore(segment: Segment, longest: number, along: number, offset: number, width: number, height: number): number {
  const halfAlong = (Math.abs(segment.ux) * width + Math.abs(segment.uy) * height) / 2;
  const low = halfAlong + BEND_CLEARANCE, high = segment.length - halfAlong - BEND_CLEARANCE;
  const mid = (low + high) / 2;
  const alongPenalty = high > low ? Math.abs(along - mid) / (high - low) * 12 : 0;
  return (axisOf(segment) === 'horizontal' ? 0 : 8) + (1 - segment.length / longest) * 7 + alongPenalty + (Math.abs(offset) > EPSILON ? 6 : 0);
}

function generateCandidates(edge: LabelLayoutEdge, segments: readonly Segment[], text: string, geometry: DiagramGeometry, pathIndex: SpatialIndex<Segment>): Candidate[] {
  const { width, height } = measureLabel(text);
  const longest = Math.max(...segments.map((segment) => segment.length));
  const candidates: Candidate[] = [], seen = new Set<string>();
  for (const [index, segment] of segments.entries()) {
    const alongHalf = (Math.abs(segment.ux) * width + Math.abs(segment.uy) * height) / 2;
    const acrossHalf = (Math.abs(segment.uy) * width + Math.abs(segment.ux) * height) / 2;
    const low = alongHalf + BEND_CLEARANCE, high = segment.length - alongHalf - BEND_CLEARANCE;
    if (low > high) continue;
    const positions = [(low + high) / 2, low, high];
    const offsets = [0, -acrossHalf - SIDE_GAP, acrossHalf + SIDE_GAP];
    for (const [positionIndex, along] of positions.entries()) for (const offset of offsets) {
      const anchor = { x: segment.from.x + segment.ux * along - segment.uy * offset, y: segment.from.y + segment.uy * along + segment.ux * offset };
      const key = `${anchor.x.toFixed(4)}:${anchor.y.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const placement = placementFor(anchor, width, height), rect = rectOf(placement);
      if (!clearOfNodes(rect, geometry)) continue;
      const base = baseScore(segment, longest, along, offset, width, height);
      candidates.push({ placement, rect, base, crossings: crossesOtherPaths(rect, edge.id, pathIndex), adjusted: Math.abs(offset) > EPSILON,
        attachment: makeAttachment(segment, segments, along, offset),
        bucket: `${index}:${positionIndex}:${Math.sign(offset)}` });
    }
  }
  // 先覆盖整条路径（含两端和两侧），再做数量限制。
  candidates.sort((a, b) => (a.crossings - b.crossings) || a.base - b.base || a.placement.x - b.placement.x || a.placement.y - b.placement.y);
  const diverse: Candidate[] = [], deferred: Candidate[] = [], buckets = new Set<string>();
  for (const candidate of candidates) {
    if (!buckets.has(candidate.bucket!)) { buckets.add(candidate.bucket!); diverse.push(candidate); }
    else deferred.push(candidate);
  }
  return [...diverse, ...deferred].slice(0, MAX_CANDIDATES);
}

function attachmentAtPlacement(point: Point, segments: readonly Segment[], width: number, height: number): LabelAttachment | undefined {
  let best: LabelAttachment | undefined, bestGap = Infinity;
  for (const segment of segments) {
    const halfAlong = (Math.abs(segment.ux) * width + Math.abs(segment.uy) * height) / 2;
    const low = halfAlong + BEND_CLEARANCE, high = segment.length - halfAlong - BEND_CLEARANCE;
    if (low > high) continue;
    const along = (point.x - segment.from.x) * segment.ux + (point.y - segment.from.y) * segment.uy;
    if (along < low - EPSILON || along > high + EPSILON) continue;
    const offset = (point.x - segment.from.x) * -segment.uy + (point.y - segment.from.y) * segment.ux;
    const across = Math.abs(offset);
    const halfAcross = (Math.abs(segment.uy) * width + Math.abs(segment.ux) * height) / 2;
    const gap = across <= EPSILON ? 0 : Math.abs(across - halfAcross);
    if ((across <= EPSILON || gap <= SIDE_GAP + EPSILON) && gap < bestGap) {
      best = makeAttachment(segment, segments, along, offset);
      bestGap = gap;
    }
  }
  return best;
}

function predictedPoint(old: LabelAttachment, segments: readonly Segment[]): Point {
  const start = segments[0]!.from, end = segments.at(-1)!.to;
  const fraction = Math.min(1, Math.max(0, old.pathFraction));
  return { x: old.projected.x + (start.x - old.pathStart.x) * (1 - fraction) + (end.x - old.pathEnd.x) * fraction,
    y: old.projected.y + (start.y - old.pathStart.y) * (1 - fraction) + (end.y - old.pathEnd.y) * fraction };
}

function similarDirection(old: LabelAttachment, segment: Pick<Segment, 'ux' | 'uy'>): boolean {
  const dx = old.to.x - old.from.x, dy = old.to.y - old.from.y, length = Math.hypot(dx, dy);
  return length > EPSILON && Math.abs(dx / length * segment.ux + dy / length * segment.uy) >= 1 - 0.0001;
}

/** 将旧附着映射到最近的相似线段，不使用旧的数组下标。 */
function projectAttachment(edgeId: string, previous: LabelLayoutResult, segments: readonly Segment[], text: string, geometry: DiagramGeometry, pathIndex: SpatialIndex<Segment>): Candidate | undefined {
  const old = previous.attachment;
  if (!old || !previous.placement) return undefined;
  const target = predictedPoint(old, segments), { width, height } = measureLabel(text);
  const longest = Math.max(...segments.map((segment) => segment.length));
  let best: Candidate | undefined, bestRank = Infinity;
  const oldDx = old.to.x - old.from.x, oldDy = old.to.y - old.from.y, oldLength = Math.hypot(oldDx, oldDy);
  const total = segments.at(-1)!.start + segments.at(-1)!.length;
  const startDelta = { x: segments[0]!.from.x - old.pathStart.x, y: segments[0]!.from.y - old.pathStart.y };
  const endDelta = { x: segments.at(-1)!.to.x - old.pathEnd.x, y: segments.at(-1)!.to.y - old.pathEnd.y };
  const uncertainTranslation = Math.min(12, Math.hypot(startDelta.x - endDelta.x, startDelta.y - endDelta.y) * 0.25);
  for (const segment of segments) {
    if (!similarDirection(old, segment)) continue;
    const halfAlong = (Math.abs(segment.ux) * width + Math.abs(segment.uy) * height) / 2;
    const low = halfAlong + BEND_CLEARANCE, high = segment.length - halfAlong - BEND_CLEARANCE;
    if (low > high) continue;
    const along = Math.max(low, Math.min(high, (target.x - segment.from.x) * segment.ux + (target.y - segment.from.y) * segment.uy));
    const projected = { x: segment.from.x + segment.ux * along, y: segment.from.y + segment.uy * along };
    const distance = Math.hypot(projected.x - target.x, projected.y - target.y);
    if (distance > MAX_REATTACH_DISTANCE) continue;
    const direction = (oldDx / oldLength * segment.ux + oldDy / oldLength * segment.uy) >= 0 ? 1 : -1;
    const from = direction > 0 ? segment.from : segment.to, to = direction > 0 ? segment.to : segment.from;
    const shiftX = target.x - old.projected.x, shiftY = target.y - old.projected.y;
    const endpointDistance = (shiftX: number, shiftY: number) => (Math.hypot(from.x - old.from.x - shiftX, from.y - old.from.y - shiftY)
      + Math.hypot(to.x - old.to.x - shiftX, to.y - old.to.y - shiftY)) / 2;
    const rank = Math.min(endpointDistance(0, 0), endpointDistance(shiftX, shiftY) + uncertainTranslation) + distance * 0.25
      + Math.abs((segment.start + along) / total - old.pathFraction) * 4;
    if (rank >= bestRank) continue;
    const oldHalfAcross = (Math.abs(oldDy / oldLength) * previous.placement.width + Math.abs(oldDx / oldLength) * previous.placement.height) / 2;
    const gap = Math.min(SIDE_GAP, Math.max(0, Math.abs(old.offset) - oldHalfAcross));
    const halfAcross = (Math.abs(segment.uy) * width + Math.abs(segment.ux) * height) / 2;
    const offset = old.side === 'inline' ? 0 : Math.sign(old.offset) * direction * (halfAcross + gap);
    const placement = placementFor({ x: projected.x - segment.uy * offset, y: projected.y + segment.ux * offset }, width, height);
    const rect = rectOf(placement);
    if (!clearOfNodes(rect, geometry)) continue;
    best = { placement, rect, base: baseScore(segment, longest, along, offset, width, height), crossings: crossesOtherPaths(rect, edgeId, pathIndex),
      adjusted: Math.abs(offset) > EPSILON, attachment: makeAttachment(segment, segments, along, offset) };
    bestRank = rank;
  }
  return best;
}

function validPrior(result: LabelLayoutResult | undefined, identity: string | undefined): result is LabelLayoutResult & { placement: EdgeLabelPlacement; attachment: LabelAttachment } {
  const attachment = result?.attachment, placement = result?.placement;
  if (!result || result.identity !== identity || !attachment || !placement || !attachment.from || !attachment.to || !attachment.projected
    || !attachment.pathStart || !attachment.pathEnd) return false;
  const values = [placement.x, placement.y, placement.width, placement.height, attachment.from.x, attachment.from.y, attachment.to.x, attachment.to.y,
    attachment.projected.x, attachment.projected.y, attachment.fraction, attachment.offset, attachment.pathStart.x, attachment.pathStart.y,
    attachment.pathEnd.x, attachment.pathEnd.y, attachment.pathFraction];
  if (!values.every(Number.isFinite) || placement.width <= 0 || placement.height <= 0 || attachment.fraction < 0 || attachment.fraction > 1
    || attachment.pathFraction < 0 || attachment.pathFraction > 1) return false;
  const dx = attachment.to.x - attachment.from.x, dy = attachment.to.y - attachment.from.y, length = Math.hypot(dx, dy);
  if (length <= EPSILON) return false;
  const ux = dx / length, uy = dy / length;
  const expected = { x: attachment.from.x + dx * attachment.fraction, y: attachment.from.y + dy * attachment.fraction };
  const halfAcross = (Math.abs(uy) * placement.width + Math.abs(ux) * placement.height) / 2;
  return Math.hypot(attachment.projected.x - expected.x, attachment.projected.y - expected.y) <= 0.001
    && Math.hypot(placement.x - (expected.x - uy * attachment.offset), placement.y - (expected.y + ux * attachment.offset)) <= 0.001
    && (Math.abs(attachment.offset) <= EPSILON || Math.abs(Math.abs(attachment.offset) - halfAcross) <= SIDE_GAP + EPSILON)
    && attachment.side === (Math.abs(attachment.offset) <= EPSILON ? 'inline' : attachment.offset < 0 ? 'negative' : 'positive')
    && attachment.axis === (Math.abs(uy) <= EPSILON ? 'horizontal' : Math.abs(ux) <= EPSILON ? 'vertical' : 'diagonal');
}

/** 新候选必须比旧附着至少高出切换阈值才采用。 */
export function shouldSwitchLabel(candidateScore: number, previousScore: number): boolean {
  return candidateScore + SWITCH_IMPROVEMENT <= previousScore;
}

/** 候选复用按局部路径和障碍几何做键，与选择和缩放无关。 */
export class LabelLayoutCache {
  private candidates = new Map<string, CandidateCache>();
  private previous = new Map<string, LabelLayoutResult>();
  private lastResults = new Map<string, LabelLayoutResult>();
  private lastSignature = '';
  private lastCandidateCount = 0;

  /** 创建隔离的渲染草稿；候选和结果缓存值不可变。 */
  fork(): LabelLayoutCache {
    const draft = new LabelLayoutCache();
    draft.adopt(this);
    return draft;
  }

  /** 发布一次已提交渲染，不共享可变 Map 容器。 */
  adopt(draft: LabelLayoutCache): void {
    this.candidates = new Map(draft.candidates);
    this.previous = new Map(draft.previous);
    this.lastResults = new Map(draft.lastResults);
    this.lastSignature = draft.lastSignature;
    this.lastCandidateCount = draft.lastCandidateCount;
  }

  update(nodes: readonly CanvasNode[], projection: Projection, edges: readonly LabelLayoutEdge[], routes: ReadonlyMap<string, CachedRoute>, seeds?: ReadonlyMap<string, LabelLayoutResult>): { labels: ReadonlyMap<string, LabelLayoutResult>; stats: LabelLayoutStats } {
    const started = performance.now();
    const geometry = createDiagramGeometry(nodes, projection);
    const ordered = [...edges].sort((a, b) => Number(!!b.fixed) - Number(!!a.fixed) || (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
    const signature = JSON.stringify([
      [...geometry.obstacles.values()].map(({ id, bounds }) => [id, bounds]), geometry.frames,
      ordered.map((edge) => {
        const route = routes.get(edge.id);
        return [edge.id, edge.identity, edge.text, edge.priority, edge.fixed, route?.feasible, route?.sourceHandle, route?.targetHandle, route?.points, seeds?.get(edge.id)];
      }),
    ]);
    if (signature === this.lastSignature) {
      const visible = [...this.lastResults.values()].filter((label) => label.placement).length;
      return { labels: this.lastResults, stats: { visible, hidden: this.lastResults.size - visible, candidateCount: this.lastCandidateCount,
        generated: 0, reusedCandidates: this.candidates.size, durationMs: performance.now() - started } };
    }
    const segments = new Map<string, Segment[]>(), pathIndex = new SpatialIndex<Segment>();
    for (const edge of edges) {
      const route = routes.get(edge.id);
      if (!route || route.feasible === false) continue;
      const paths = segmentsOf(edge.id, route.points);
      segments.set(edge.id, paths);
      paths.forEach((segment, index) => pathIndex.set(`${edge.id}:${index}`, segmentBounds(segment.from, segment.to), segment));
    }
    const labels = new Map<string, LabelLayoutResult>();
    const previousById = new Map<string, LabelLayoutResult>();
    const occupied: Occupied[] = [];
    const prepared: Prepared[] = [];
    let generated = 0, reusedCandidates = 0, candidateCount = 0;
    for (const edge of ordered) {
      const route = routes.get(edge.id), paths = segments.get(edge.id), text = shortenLabel(edge.text);
      const identity = edge.identity !== undefined ? { identity: edge.identity } : {};
      const last = this.previous.get(edge.id), seed = seeds?.get(edge.id);
      const previous = validPrior(last, edge.identity) ? last : validPrior(seed, edge.identity) ? seed : undefined;
      if (previous) previousById.set(edge.id, previous);
      const hidden = (): LabelLayoutResult => ({ text, fullText: edge.text, state: 'space-exhausted', ...identity });
      if (!route || route.feasible === false || !paths?.length || !text.trim()) { labels.set(edge.id, hidden()); continue; }
      if (edge.fixed) {
        const rect = rectOf(edge.fixed);
        const legal = [edge.fixed.x, edge.fixed.y, edge.fixed.width, edge.fixed.height].every(Number.isFinite)
          && edge.fixed.width > 0 && edge.fixed.height > 0;
        const attachment = legal ? attachmentAtPlacement(edge.fixed, paths, edge.fixed.width, edge.fixed.height) : undefined;
        if (!attachment || !clearOfNodes(rect, geometry) || occupied.some((other) => labelIntersects(other.rect, rect))) labels.set(edge.id, hidden());
        else { occupied.push({ id: edge.id, rect, fixed: true }); labels.set(edge.id, { text, fullText: edge.text, placement: { ...edge.fixed }, attachment, state: 'fixed', ...identity }); }
        continue;
      }
      const envelope = pathBounds(paths, MAX_LABEL_WIDTH / 2 + SIDE_GAP + NODE_CLEARANCE + 24);
      const obstacles = geometry.obstacleIndex.query(envelope).map((item) => [item.id, item.bounds]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const frames = geometry.frames.filter((frame) => rectIntersects(envelope, frame));
      const peers = pathIndex.query(envelope).filter((segment) => segment.edgeId !== edge.id).map(({ edgeId, from, to }) => [edgeId, from, to]);
      const localSignature = JSON.stringify([edge.identity, text, route.points, obstacles, frames, peers]);
      const cached = this.candidates.get(edge.id);
      let candidates: Candidate[];
      if (cached?.signature === localSignature) { candidates = cached.candidates; reusedCandidates++; }
      else {
        candidates = generateCandidates(edge, paths, text, geometry, pathIndex);
        this.candidates.set(edge.id, { signature: localSignature, candidates }); generated++;
      }
      const preferred = previous ? projectAttachment(edge.id, previous, paths, text, geometry, pathIndex) : undefined;
      if (previous) {
        const old = previous.attachment!, predicted = predictedPoint(old, paths);
        candidates = candidates.filter((candidate) => {
          const attachment = candidate.attachment, dx = attachment.to.x - attachment.from.x, dy = attachment.to.y - attachment.from.y, length = Math.hypot(dx, dy);
          return length > EPSILON && similarDirection(old, { ux: dx / length, uy: dy / length })
            && Math.hypot(attachment.projected.x - predicted.x, attachment.projected.y - predicted.y) <= MAX_REATTACH_DISTANCE;
        });
        if (preferred) candidates = [preferred, ...candidates];
      }
      prepared.push({ edge, text, candidates, ...(preferred ? { preferred } : {}), stable: !!preferred });
      candidateCount += candidates.length;
    }
    // 受限选项先结算；相同情况按规范/展示 ID 稳定排序。
    prepared.sort((a, b) => Number(b.stable) - Number(a.stable) || (b.edge.priority ?? 0) - (a.edge.priority ?? 0) || a.candidates.length - b.candidates.length || a.edge.id.localeCompare(b.edge.id));
    const selected = new Map<string, { prepared: Prepared; candidate: Candidate }>();
    const expectedPlacements = new Map(prepared.flatMap((item) => item.preferred ? [[item.edge.id, item.preferred.placement] as const] : []));
    const scoreFor = (edgeId: string, candidate: Candidate): number => {
      const previous = expectedPlacements.get(edgeId) ?? previousById.get(edgeId)?.placement;
      const movement = previous ? Math.hypot(candidate.placement.x - previous.x, candidate.placement.y - previous.y) * 0.2 : 0;
      return candidate.crossings * 400 + candidate.base + movement;
    };
    for (const item of prepared) {
      const { edge, text, candidates } = item;
      let best: Candidate | undefined, bestScore = Infinity;
      for (const candidate of candidates) {
        if (occupied.some((other) => labelIntersects(candidate.rect, other.rect))) continue;
        const score = scoreFor(edge.id, candidate);
        if (score < bestScore) { best = candidate; bestScore = score; }
      }
      if (item.preferred && !occupied.some((other) => labelIntersects(item.preferred!.rect, other.rect))) {
        const preferredScore = scoreFor(edge.id, item.preferred);
        if (!best || !shouldSwitchLabel(bestScore, preferredScore)) { best = item.preferred; bestScore = preferredScore; }
      }
      // 有界的单标签重分配可以为受限边释放位置。
      if (!best) {
        let alternative: { displacedId: string; next: Candidate; incoming: Candidate; score: number } | undefined;
        for (const candidate of candidates) {
          const blockers = occupied.filter((other) => labelIntersects(candidate.rect, other.rect));
          if (blockers.length !== 1 || blockers[0]!.fixed) continue;
          const displaced = selected.get(blockers[0]!.id);
          if (!displaced) continue;
          if (displaced.prepared.stable && (edge.priority ?? 0) <= (displaced.prepared.edge.priority ?? 0)) continue;
          for (const replacement of displaced.prepared.candidates) {
            if (labelIntersects(candidate.rect, replacement.rect) || occupied.some((other) => other.id !== blockers[0]!.id && labelIntersects(other.rect, replacement.rect))) continue;
            const score = scoreFor(edge.id, candidate) + scoreFor(blockers[0]!.id, replacement);
            if (!alternative || score < alternative.score) alternative = { displacedId: blockers[0]!.id, next: replacement, incoming: candidate, score };
          }
        }
        if (alternative) {
          const displaced = selected.get(alternative.displacedId)!;
          const position = occupied.findIndex((other) => other.id === alternative!.displacedId);
          occupied[position] = { id: alternative.displacedId, rect: alternative.next.rect, fixed: false };
          selected.set(alternative.displacedId, { prepared: displaced.prepared, candidate: alternative.next });
          labels.set(alternative.displacedId, { text: displaced.prepared.text, fullText: displaced.prepared.edge.text,
            placement: { ...alternative.next.placement }, attachment: alternative.next.attachment,
            ...(displaced.prepared.edge.identity !== undefined ? { identity: displaced.prepared.edge.identity } : {}), state: alternative.next.adjusted ? 'adjusted' : 'normal' });
          best = alternative.incoming;
        }
      }
      if (best) {
        occupied.push({ id: edge.id, rect: best.rect, fixed: false });
        selected.set(edge.id, { prepared: item, candidate: best });
        labels.set(edge.id, { text, fullText: edge.text, placement: { ...best.placement }, attachment: best.attachment,
          ...(edge.identity !== undefined ? { identity: edge.identity } : {}), state: best.adjusted ? 'adjusted' : 'normal' });
      } else labels.set(edge.id, { text, fullText: edge.text, ...(edge.identity !== undefined ? { identity: edge.identity } : {}), state: 'space-exhausted' });
    }
    const ids = new Set(edges.map((edge) => edge.id));
    for (const id of this.candidates.keys()) if (!ids.has(id)) this.candidates.delete(id);
    // 暂时隐藏时保留最后合法位置，空间恢复后避免跳动。
    for (const [id, result] of labels) {
      const old = this.lastResults.get(id), a = result.placement, b = old?.placement;
      if (old && old.text === result.text && old.fullText === result.fullText && old.state === result.state && old.identity === result.identity
        && JSON.stringify(old.attachment) === JSON.stringify(result.attachment)
        && ((!a && !b) || (a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height))) labels.set(id, old);
    }
    this.lastResults = labels;
    this.lastSignature = signature;
    this.lastCandidateCount = candidateCount;
    const nextPrevious = new Map<string, LabelLayoutResult>();
    for (const [id, result] of labels) nextPrevious.set(id, result.placement ? result : previousById.get(id) ?? result);
    this.previous = nextPrevious;
    const visible = [...labels.values()].filter((label) => label.placement).length;
    return { labels, stats: { visible, hidden: labels.size - visible, candidateCount, generated, reusedCandidates, durationMs: performance.now() - started } };
  }
}
