/**
 * 2D Geometry and Orthogonal Obstacle-Avoiding Router.
 *
 * Produces clean 90-degree bend paths that route around nodes and aggregate
 * frames without cutting across cards.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Obstacle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type PortSide = 'top' | 'right' | 'bottom' | 'left' | 'auto';

/** 画布世界坐标转为直接父节点局部相对坐标。 */
export function toLocalPoint(point: Point, parentOrigin: Point): Point {
  return { x: point.x - parentOrigin.x, y: point.y - parentOrigin.y };
}

/** 直接父节点局部相对坐标转为画布世界坐标。 */
export function toWorldPoint(point: Point, parentOrigin: Point): Point {
  return { x: point.x + parentOrigin.x, y: point.y + parentOrigin.y };
}

export function rectFromPointSize(at: Point, size: { w: number; h: number }): Rect {
  return { x: at.x, y: at.y, w: size.w, h: size.h };
}

export function insetRect(rect: Rect, inset: number): Rect {
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    w: Math.max(0, rect.w - inset * 2),
    h: Math.max(0, rect.h - inset * 2),
  };
}

export function rectContains(outer: Rect, inner: Rect, tolerance = 0): boolean {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.w <= outer.x + outer.w + tolerance
    && inner.y + inner.h <= outer.y + outer.h + tolerance;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 按节点包围盒与连接侧计算吸附锚点；fraction 为沿该侧的比例位置（默认 0.5 居中）。 */
export function portAnchor(rect: Rect, side: PortSide, fraction = 0.5): Point {
  const t = Math.max(0, Math.min(1, fraction));
  switch (side) {
    case 'top': return { x: rect.x + rect.w * t, y: rect.y };
    case 'bottom': return { x: rect.x + rect.w * t, y: rect.y + rect.h };
    case 'left': return { x: rect.x, y: rect.y + rect.h * t };
    case 'right': return { x: rect.x + rect.w, y: rect.y + rect.h * t };
    case 'auto': {
      return { x: rect.x + rect.w, y: rect.y + rect.h * t };
    }
  }
}

/** 从矩形生成带有缓冲区 padding 的避障障碍物盒。 */
export function obstacleFromRect(rect: Rect, padding = 0): Obstacle {
  return {
    left: rect.x - padding,
    right: rect.x + rect.w + padding,
    top: rect.y - padding,
    bottom: rect.y + rect.h + padding,
  };
}

/** 合并共线水平或垂直线段，消除同向中间冗余折点。 */
export function simplifyPoints(points: readonly Point[]): Point[] {
  if (points.length <= 2) return [...points];
  const simple: Point[] = [];
  for (const point of points) {
    while (simple.length > 1) {
      const a = simple[simple.length - 2]!;
      const b = simple[simple.length - 1]!;
      const isCollinearX = a.x === b.x && b.x === point.x;
      const isCollinearY = a.y === b.y && b.y === point.y;
      if (isCollinearX || isCollinearY) {
        simple.pop();
      } else {
        break;
      }
    }
    simple.push(point);
  }
  return simple;
}

/** 将折线点集转为带平滑圆角的 SVG 路径字符串；拐角使用二次贝塞尔曲线 Q 过渡。 */
export function svgPathFromPoints(points: readonly Point[], radius: number = 8): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  if (points.length === 2 || radius <= 0) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;

    const len1 = Math.hypot(d1x, d1y);
    const len2 = Math.hypot(d2x, d2y);
    const r = Math.min(radius, len1 / 2, len2 / 2);

    if (r < 1) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const startX = curr.x - (d1x / len1) * r;
    const startY = curr.y - (d1y / len1) * r;
    const endX = curr.x + (d2x / len2) * r;
    const endY = curr.y + (d2y / len2) * r;

    d += ` L ${startX} ${startY} Q ${curr.x} ${curr.y} ${endX} ${endY}`;
  }

  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** 计算沿折线实际物理长度 50% 处的几何中点，用于连线标签吸附。 */
export function midpointOfPoints(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0]! };

  let totalLen = 0;
  const lens: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    lens.push(segLen);
    totalLen += segLen;
  }

  const half = totalLen / 2;
  let accumulated = 0;
  for (let i = 0; i < lens.length; i++) {
    const segLen = lens[i]!;
    if (accumulated + segLen >= half) {
      const remain = half - accumulated;
      const t = segLen > 0 ? remain / segLen : 0;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
      };
    }
    accumulated += segLen;
  }

  return { ...points[Math.floor(points.length / 2)]! };
}

/**
 * 计算两矩形间的正交避障折线路径。
 * 1. 优先尝试无障碍直接直角连接；
 * 2. 存在障碍时，基于障碍轮廓生成网格线并执行带有拐弯惩罚的 A* 寻路；
 * 3. 寻路失败时回退至顶部绕行路径。
 */
export function routeOrthogonal(
  fromRect: Rect,
  toRect: Rect,
  obstacles: readonly Obstacle[],
  options: { offset?: number; padding?: number } = {},
): Point[] {
  const pad = options.padding ?? 14;
  const isRight = toRect.x + toRect.w / 2 >= fromRect.x + fromRect.w / 2;

  const start: Point = isRight
    ? { x: fromRect.x + fromRect.w, y: fromRect.y + fromRect.h / 2 }
    : { x: fromRect.x, y: fromRect.y + fromRect.h / 2 };

  const goal: Point = isRight
    ? { x: toRect.x, y: toRect.y + toRect.h / 2 }
    : { x: toRect.x + toRect.w, y: toRect.y + toRect.h / 2 };

  const stubDistance = options.offset ?? 24;
  const startStub: Point = {
    x: start.x + (isRight ? stubDistance : -stubDistance),
    y: start.y,
  };
  const goalStub: Point = {
    x: goal.x + (isRight ? -stubDistance : stubDistance),
    y: goal.y,
  };

  // 检测直连候选线段是否避开所有障碍物
  if (isRight && startStub.x < goalStub.x) {
    const midX = Math.round((startStub.x + goalStub.x) / 2);
    const candidate = [
      start,
      { x: midX, y: start.y },
      { x: midX, y: goal.y },
      goal,
    ];

    const collides = obstacles.some((obs) => {
      const minX1 = Math.min(start.x, midX);
      const maxX1 = Math.max(start.x, midX);
      if (start.y > obs.top && start.y < obs.bottom && maxX1 > obs.left && minX1 < obs.right) {
        return true;
      }
      const minY2 = Math.min(start.y, goal.y);
      const maxY2 = Math.max(start.y, goal.y);
      if (midX > obs.left && midX < obs.right && maxY2 > obs.top && minY2 < obs.bottom) {
        return true;
      }
      const minX3 = Math.min(midX, goal.x);
      const maxX3 = Math.max(midX, goal.x);
      if (goal.y > obs.top && goal.y < obs.bottom && maxX3 > obs.left && minX3 < obs.right) {
        return true;
      }
      return false;
    });

    if (!collides) {
      return simplifyPoints(candidate);
    }
  }

  // 提取端点与障碍物轮廓构建搜索网格坐标集合
  const xs = new Set<number>([start.x, startStub.x, goal.x, goalStub.x]);
  const ys = new Set<number>([start.y, startStub.y, goal.y, goalStub.y]);

  for (const obs of obstacles) {
    xs.add(obs.left - pad);
    xs.add(obs.right + pad);
    ys.add(obs.top - pad);
    ys.add(obs.bottom + pad);
  }

  const sortedX = [...xs].sort((a, b) => a - b);
  const sortedY = [...ys].sort((a, b) => a - b);
  const nx = sortedX.length;
  const ny = sortedY.length;

  const sx = sortedX.indexOf(startStub.x);
  const sy = sortedY.indexOf(startStub.y);
  const gx = sortedX.indexOf(goalStub.x);
  const gy = sortedY.indexOf(goalStub.y);

  if (sx < 0 || sy < 0 || gx < 0 || gy < 0) {
    return simplifyPoints([
      start,
      startStub,
      { x: startStub.x, y: goalStub.y },
      goalStub,
      goal,
    ]);
  }

  function isBlocked(ix: number, iy: number, jx: number, jy: number): boolean {
    const x1 = Math.min(sortedX[ix]!, sortedX[jx]!);
    const x2 = Math.max(sortedX[ix]!, sortedX[jx]!);
    const y1 = Math.min(sortedY[iy]!, sortedY[jy]!);
    const y2 = Math.max(sortedY[iy]!, sortedY[jy]!);

    for (const obs of obstacles) {
      if (ix === jx) {
        if (x1 > obs.left && x1 < obs.right && y2 > obs.top && y1 < obs.bottom) {
          return true;
        }
      } else {
        if (y1 > obs.top && y1 < obs.bottom && x2 > obs.left && x1 < obs.right) {
          return true;
        }
      }
    }
    return false;
  }

  interface SearchNode {
    id: number;
    ix: number;
    iy: number;
    dir: number;
    g: number;
    f: number;
  }

  const heap: SearchNode[] = [];
  function push(item: SearchNode) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.f <= heap[i]!.f) break;
      const tmp = heap[p]!;
      heap[p] = heap[i]!;
      heap[i] = tmp;
      i = p;
    }
  }

  function pop(): SearchNode | undefined {
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let next = i * 2 + 1;
        if (next + 1 < heap.length && heap[next + 1]!.f < heap[next]!.f) next++;
        if (heap[i]!.f <= heap[next]!.f) break;
        const tmp = heap[i]!;
        heap[i] = heap[next]!;
        heap[next] = tmp;
        i = next;
      }
    }
    return top;
  }

  const costs = new Map<number, number>();
  const parents = new Map<number, number>();
  const startId = (sy * nx + sx) * 3 + 2;

  costs.set(startId, 0);
  push({
    id: startId,
    ix: sx,
    iy: sy,
    dir: 2,
    g: 0,
    f: Math.abs(startStub.x - goalStub.x) + Math.abs(startStub.y - goalStub.y),
  });

  let finishId: number | undefined;
  while (heap.length > 0) {
    const cur = pop()!;
    if (cur.g > (costs.get(cur.id) ?? Infinity)) continue;
    if (cur.ix === gx && cur.iy === gy) {
      finishId = cur.id;
      break;
    }

    const dirs = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 1],
      [0, -1, 1],
    ] as const;

    for (const [dx, dy, dir] of dirs) {
      const nix = cur.ix + dx;
      const niy = cur.iy + dy;
      if (nix < 0 || niy < 0 || nix >= nx || niy >= ny) continue;
      if (isBlocked(cur.ix, cur.iy, nix, niy)) continue;

      const dist = Math.abs(sortedX[nix]! - sortedX[cur.ix]!) + Math.abs(sortedY[niy]! - sortedY[cur.iy]!);
      const bendCost = cur.dir !== dir && cur.dir !== 2 ? 30 : 0;
      const g = cur.g + dist + bendCost;
      const nid = (niy * nx + nix) * 3 + dir;

      if (g < (costs.get(nid) ?? Infinity)) {
        costs.set(nid, g);
        parents.set(nid, cur.id);
        const h = Math.abs(sortedX[nix]! - goalStub.x) + Math.abs(sortedY[niy]! - goalStub.y);
        push({ id: nid, ix: nix, iy: niy, dir, g, f: g + h });
      }
    }
  }

  const routePoints: Point[] = [];
  if (finishId !== undefined) {
    let curr: number | undefined = finishId;
    while (curr !== undefined) {
      const cell = Math.floor(curr / 3);
      const cix = cell % nx;
      const ciy = Math.floor(cell / nx);
      routePoints.push({ x: sortedX[cix]!, y: sortedY[ciy]! });
      curr = parents.get(curr);
    }
    routePoints.reverse();
  } else {
    // 寻路阻断时的保底绕行路径
    const topY = Math.min(fromRect.y, toRect.y) - 30;
    routePoints.push(startStub, { x: startStub.x, y: topY }, { x: goalStub.x, y: topY }, goalStub);
  }

  return simplifyPoints([start, ...routePoints, goal]);
}
