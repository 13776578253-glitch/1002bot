/** Uniform-grid index for canvas obstacles, path segments and label rectangles. */
import type { Rect } from '../../core/layout/geometry.ts';

export function expandBounds(rect: Rect, padding: number): Rect {
  return { x: rect.x - padding, y: rect.y - padding, w: rect.w + padding * 2, h: rect.h + padding * 2 };
}

export function boundsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export class SpatialIndex<T> {
  private cells = new Map<string, Set<string>>();
  private entries = new Map<string, { bounds: Rect; value: T; cells: string[] }>();
  private cellSize: number;

  constructor(cellSize = 256) { this.cellSize = cellSize; }

  private keys(bounds: Rect): string[] {
    const keys: string[] = [];
    for (let x = Math.floor(bounds.x / this.cellSize); x <= Math.floor((bounds.x + bounds.w) / this.cellSize); x++) {
      for (let y = Math.floor(bounds.y / this.cellSize); y <= Math.floor((bounds.y + bounds.h) / this.cellSize); y++) keys.push(`${x},${y}`);
    }
    return keys;
  }

  set(id: string, bounds: Rect, value: T): void {
    this.delete(id);
    const cells = this.keys(bounds);
    this.entries.set(id, { bounds, value, cells });
    for (const key of cells) {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = new Set());
      cell.add(id);
    }
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const key of entry.cells) {
      const cell = this.cells.get(key)!;
      cell.delete(id);
      if (!cell.size) this.cells.delete(key);
    }
    this.entries.delete(id);
  }

  query(bounds: Rect): T[] {
    const found = new Set<string>();
    for (const key of this.keys(bounds)) for (const id of this.cells.get(key) ?? []) found.add(id);
    return [...found].flatMap((id) => {
      const entry = this.entries.get(id)!;
      return boundsIntersect(entry.bounds, bounds) ? [entry.value] : [];
    });
  }
}
