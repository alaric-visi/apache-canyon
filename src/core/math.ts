export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const pointInRect = (px: number, py: number, r: Rect) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

/** Remove items failing `keep` in place (order not preserved). Avoids per-frame array allocation. */
export function compact<T>(arr: T[], keep: (item: T) => boolean): void {
  let i = 0;
  while (i < arr.length) {
    if (keep(arr[i])) i++;
    else {
      arr[i] = arr[arr.length - 1];
      arr.pop();
    }
  }
}
