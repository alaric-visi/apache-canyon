import { Rng } from '../core/rng';

/** Logical playfield, in world units. The renderer scales this to fit the screen. */
export const WORLD_W = 800;
export const VIEW_H = 600;

const BASE_WIDTH = 300;
const MIN_WIDTH = 72;
const EDGE_MARGIN = 24;
/** The prototype sampled one wall segment per 4 px; keep its frequencies in those units. */
const SEG = 4;

export interface Corridor {
  left: number;
  right: number;
}

/** Per-sector shaping of the canyon (1 = the Phase 1–3 canyon). */
export interface CanyonProfile {
  /** Base corridor width, world units. */
  width: number;
  /** Scale on the meander (how far the corridor swings sideways). */
  amp: number;
  /** Scale on the pinch/widen term. */
  narrow: number;
  /** Scale on wall height (shadow length, cliff face size). */
  height: number;
}

export const DEFAULT_PROFILE: CanyonProfile = { width: BASE_WIDTH, amp: 1, narrow: 1, height: 1 };

/**
 * The canyon is a pure function of world distance `d` (units travelled from the
 * start). There is no mutable wall buffer: any row can be queried in O(1),
 * which makes spawning, AI and rendering independent of screen size.
 */
export class Canyon {
  private readonly ph: number[];
  /** Shape at distance d; the course swaps this in to give each sector its own canyon. */
  profileAt: (d: number) => CanyonProfile = () => DEFAULT_PROFILE;

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x5ca1ab1e);
    this.ph = Array.from({ length: 8 }, () => rng.range(0, Math.PI * 2));
  }

  /** Writes the corridor at distance `d` into `out` (no allocation) and returns it. */
  at(d: number, out: Corridor = { left: 0, right: 0 }): Corridor {
    const t = d / SEG;
    const p = this.ph;
    const prof = this.profileAt(d);
    const variation = prof.amp * (
      Math.sin(t * 0.0234 + p[0]) * 70 +
      Math.cos(t * 0.0431 + p[1]) * 55 +
      Math.sin(t * 0.0627 + p[2]) * 40 +
      Math.cos(t * 0.0089 + p[3]) * 60 +
      Math.sin(t * 0.0153 + p[4]) * 35);
    let narrowing = prof.narrow *
      (Math.sin(t * 0.0179 + p[5]) * 55 + Math.cos(t * 0.0347 + p[6]) * 45 + Math.sin(t * 0.0521 + p[7]) * 30);
    // Never pinch shut: corridor width = width + 2 * narrowing
    narrowing = Math.max(narrowing, (MIN_WIDTH - prof.width) / 2);

    const center = WORLD_W / 2 + variation;
    let left = center - prof.width / 2 - narrowing;
    let right = center + prof.width / 2 + narrowing;
    // Keep the corridor inside the playfield by sliding it, preserving width
    if (left < EDGE_MARGIN) {
      right += EDGE_MARGIN - left;
      left = EDGE_MARGIN;
    } else if (right > WORLD_W - EDGE_MARGIN) {
      left -= right - (WORLD_W - EDGE_MARGIN);
      right = WORLD_W - EDGE_MARGIN;
    }
    out.left = left;
    out.right = right;
    return out;
  }

  /** Relative wall height in [0.15, 1] at distance `d`. Cosmetic: drives shadow length and cliff shading. */
  height(d: number): number {
    const t = d / SEG;
    const p = this.ph;
    const h = (0.6 + Math.sin(t * 0.0113 + p[2]) * 0.25 + Math.sin(t * 0.0371 + p[6]) * 0.15) * this.profileAt(d).height;
    return Math.min(1, Math.max(0.15, h));
  }
}
