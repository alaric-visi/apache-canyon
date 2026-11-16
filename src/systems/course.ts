import type { Sim } from '../engine/sim';
import { SECTORS, type SectorDef } from '../content/sectors/sectors';
import { DEFAULT_PROFILE, VIEW_H, type CanyonProfile } from '../world/canyon';
import { TUNING as T } from '../gameplay/tuning';
import { ARENA, ARENA_BLEND, ARENA_LEAD } from '../gameplay/flight';
import { startBoss, updateBoss } from '../gameplay/bosses/bosses';
import { award } from './scoring';
import { spawnPickup } from './spawn';

/**
 * The run is a sequence of sectors. Each sector goes run → boss → clear.
 * Canyon shape changes are scheduled to begin just beyond the top of the
 * screen, so rows the player can already see never change shape.
 */

export type RunMode = 'campaign' | 'endless' | 'daily' | 'practice';
export type RunPhase = 'run' | 'boss' | 'clear';

const BLEND = 1600;
const ARENA_PROFILE: CanyonProfile = { width: 360, amp: 0.4, narrow: 0.3, height: 1.1 };
const profileOf = (sector: number): CanyonProfile => (sector === ARENA ? ARENA_PROFILE : SECTORS[sector]?.canyon ?? DEFAULT_PROFILE);
const CLEAR_TICKS = 200;
export const SECTOR_CLEAR_BONUS = 2000;

export interface CourseState {
  mode: RunMode;
  /** Index into SECTORS. */
  sector: number;
  /** Endless/daily: completed loops through all six sectors. */
  lap: number;
  phase: RunPhase;
  sectorTick: number;
  sectorStartDist: number;
  phaseTimer: number;
  /** Next set piece index in the current sector. */
  nextSetPiece: number;
  /** Where each sector's canyon begins (world distance) — for profile blending. */
  segments: { fromD: number; sector: number; blend?: number }[];
  /** Sectors this run started in (for practice unlocks). */
  reached: number[];
  /** Damage taken in the current sector (for the "untouchable" medal). */
  sectorDamage: number;
}

export function newCourse(mode: RunMode, startSector: number): CourseState {
  return {
    mode, sector: startSector, lap: 0, phase: 'run', sectorTick: 0, sectorStartDist: 0, phaseTimer: 0,
    nextSetPiece: 0, segments: [{ fromD: -1e9, sector: startSector }], reached: [startSector], sectorDamage: 0,
  };
}

export const sectorDef = (sim: Sim): SectorDef => SECTORS[sim.course.sector];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Canyon profile at distance d, blended across sector boundaries. */
export function profileAt(course: CourseState, d: number): CanyonProfile {
  const segs = course.segments;
  let i = segs.length - 1;
  while (i > 0 && segs[i].fromD > d) i--;
  const cur = profileOf(segs[i].sector);
  if (i === 0) return cur;
  const prev = profileOf(segs[i - 1].sector);
  const t = Math.min(1, (d - segs[i].fromD) / (segs[i].blend ?? BLEND));
  if (t >= 1) return cur;
  const s = t * t * (3 - 2 * t);
  return { width: lerp(prev.width, cur.width, s), amp: lerp(prev.amp, cur.amp, s), narrow: lerp(prev.narrow, cur.narrow, s), height: lerp(prev.height, cur.height, s) };
}

/** 0..1 progress through the current sector's run phase (1 during boss/clear). */
export function sectorProgress(sim: Sim): number {
  const c = sim.course;
  if (c.phase !== 'run') return 1;
  return Math.min(1, (sim.dist - c.sectorStartDist) / sectorDef(sim).length);
}

/** Difficulty base speed for the current sector/lap. */
export function courseBaseSpeed(sim: Sim): number {
  const c = sim.course;
  const ramp = Math.min(3, Math.floor(c.sectorTick / T.speed.every)) * T.speed.step;
  const max = T.speed.max + c.lap * 0.5;
  return Math.min(max, T.speed.start + c.sector * 0.22 + c.lap * 0.4 + ramp);
}

function beginSector(sim: Sim, index: number): void {
  const c = sim.course;
  c.sector = index;
  c.phase = 'run';
  c.sectorTick = 0;
  c.sectorStartDist = sim.dist;
  c.nextSetPiece = 0;
  c.sectorDamage = 0;
  if (!c.reached.includes(index)) c.reached.push(index);
  // the new canyon starts just past the top of the screen
  c.segments.push({ fromD: sim.dist + VIEW_H + 120, sector: index });
  sim.spawnTimers = {};
  const def = SECTORS[index];
  sim.emit({ type: 'sectorStart', index, name: def.name, subtitle: def.subtitle });
}

export function updateCourse(sim: Sim): void {
  const c = sim.course;
  c.sectorTick++;

  if (c.phase === 'run') {
    if (sim.dist - c.sectorStartDist >= sectorDef(sim).length) {
      c.phase = 'boss';
      c.phaseTimer = 0;
      // bosses are fought in an arena: the canyon opens out just beyond the top of the screen
      c.segments.push({ fromD: sim.dist + VIEW_H + ARENA_LEAD, sector: ARENA, blend: ARENA_BLEND });
      startBoss(sim, sectorDef(sim));
    }
    return;
  }

  if (c.phase === 'boss') {
    c.phaseTimer++;
    const result = updateBoss(sim);
    if (result === 'active') return;
    sim.stats.sectorsCleared++;
    if (c.sectorDamage === 0) sim.stats.untouchedSectors++;
    const p = sim.player;
    award(sim, result === 'defeated' ? SECTOR_CLEAR_BONUS : SECTOR_CLEAR_BONUS / 4, p.x + p.w / 2, p.y - 50, 'SECTOR CLEAR');
    sim.emit({ type: 'sectorClear', index: c.sector, name: sectorDef(sim).name });
    // resupply drop
    for (const k of ['shield', 'fuel', 'missile'] as const) spawnPickup(sim, k);
    c.phase = 'clear';
    c.phaseTimer = CLEAR_TICKS;
    return;
  }

  // clear: breather, then the next sector (or the end)
  if (--c.phaseTimer > 0) return;
  const last = c.sector === SECTORS.length - 1;
  if (c.mode === 'practice' || (c.mode === 'campaign' && last)) {
    sim.status = 'complete';
    sim.emit({ type: 'runComplete' });
    return;
  }
  if (last) c.lap++;
  beginSector(sim, last ? 0 : c.sector + 1);
}

/** Called once at run start so the first sector announces itself. */
export function startCourse(sim: Sim): void {
  const c = sim.course;
  c.sectorStartDist = sim.dist;
  const def = SECTORS[c.sector];
  sim.emit({ type: 'sectorStart', index: c.sector, name: def.name, subtitle: def.subtitle });
}
