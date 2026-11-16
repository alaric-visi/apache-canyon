import type { Body } from '../entities/types';

/**
 * Uniform-grid broadphase. Rebuilt once per tick; queries return candidates
 * whose cells overlap the query box (callers still do the exact test).
 */
export class SpatialHash<T extends Body> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];
  private readonly out: T[] = [];
  private stamp = new Set<T>();

  constructor(private readonly cellSize = 64) {}

  private key(cx: number, cy: number) {
    return ((cx + 512) << 11) | (cy + 1024);
  }

  rebuild(items: readonly T[]): void {
    for (const list of this.cells.values()) {
      list.length = 0;
      this.pool.push(list);
    }
    this.cells.clear();
    for (const it of items) {
      const x0 = Math.floor(it.x / this.cellSize), x1 = Math.floor((it.x + it.w) / this.cellSize);
      const y0 = Math.floor(it.y / this.cellSize), y1 = Math.floor((it.y + it.h) / this.cellSize);
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = this.key(cx, cy);
          let list = this.cells.get(k);
          if (!list) {
            list = this.pool.pop() ?? [];
            this.cells.set(k, list);
          }
          list.push(it);
        }
    }
  }

  /** Candidates overlapping the box. The returned array is reused between calls. */
  query(x: number, y: number, w: number, h: number): readonly T[] {
    this.out.length = 0;
    this.stamp.clear();
    const x0 = Math.floor(x / this.cellSize), x1 = Math.floor((x + w) / this.cellSize);
    const y0 = Math.floor(y / this.cellSize), y1 = Math.floor((y + h) / this.cellSize);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const it of list)
          if (!this.stamp.has(it)) {
            this.stamp.add(it);
            this.out.push(it);
          }
      }
    return this.out;
  }
}
