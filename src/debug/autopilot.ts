import type { Sim } from '../engine/sim';
import { newInput, type Hostile, type SimInput } from '../entities/types';
import { Rng } from '../core/rng';
import { COOL_WINDOW } from '../systems/player';

/**
 * Deterministic autopilots used as stand-in players: by tests, by the title
 * attract mode, and by scripts/balance.ts to estimate difficulty for a range
 * of skill levels. They are proxies, not people: they never panic, but they
 * also never learn a pattern. Use them to compare tuning changes.
 */
export interface PilotSkill {
  name: string;
  /** Ticks between decisions (reaction time). */
  reaction: number;
  /** How far ahead (units) it reads the canyon when steering. */
  lookahead: number;
  /** Distance it tries to keep from the rock. */
  wallMargin: number;
  /** How far ahead (units) it notices incoming fire. */
  threatHorizon: number;
  /** Steering error, units. */
  noise: number;
  rhythmCool: boolean;
  /** Hold missile to paint several targets. */
  usesLocks: boolean;
  /** SAM lock level (0..1) at which it pops flares; Infinity = never. */
  flareAt: number;
  /** Enemy shots on screen before it fires a full EMP; Infinity = never. */
  empAt: number;
  seeksPickups: boolean;
  handlesGates: boolean;
  /** Lines up under targets to shoot them. */
  hunts: boolean;
}

export const SKILLS: Record<'novice' | 'average' | 'skilled', PilotSkill> = {
  novice: { name: 'novice', reaction: 14, lookahead: 30, wallMargin: 12, threatHorizon: 90, noise: 14, rhythmCool: false, usesLocks: false, flareAt: Infinity, empAt: Infinity, seeksPickups: false, handlesGates: false, hunts: false },
  average: { name: 'average', reaction: 7, lookahead: 60, wallMargin: 16, threatHorizon: 130, noise: 6, rhythmCool: false, usesLocks: false, flareAt: 0.85, empAt: 5, seeksPickups: true, handlesGates: true, hunts: true },
  skilled: { name: 'skilled', reaction: 3, lookahead: 60, wallMargin: 18, threatHorizon: 170, noise: 2, rhythmCool: true, usesLocks: true, flareAt: 0.6, empAt: 3, seeksPickups: true, handlesGates: true, hunts: true },
};

export type Pilot = (sim: Sim, out?: SimInput) => SimInput;

export function createPilot(skill: PilotSkill, seed = 1): Pilot {
  const rng = new Rng(seed ^ 0xa11ce);
  let targetX = NaN;
  let jitter = 0;
  let missileHoldUntil = 0;

  return (sim, out = newInput()) => {
    const p = sim.player;
    const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;

    // safe lane: the tightest corridor between here and the lookahead row
    let lo = -Infinity, hi = Infinity;
    for (let dy = 0; dy <= skill.lookahead; dy += 15) {
      const c = sim.corridorAt(pcy - dy);
      lo = Math.max(lo, c.left + 10 + p.w / 2 + skill.wallMargin);
      hi = Math.min(hi, c.right - 10 - p.w / 2 - skill.wallMargin);
    }
    if (lo > hi) lo = hi = (lo + hi) / 2;

    if (sim.tick % skill.reaction === 0 || Number.isNaN(targetX)) {
      let tx = (lo + hi) / 2;
      const gate = skill.handlesGates ? sim.hostiles.find((h) => h.kind === 'gate' && h.y < p.y && h.y > -20) : undefined;
      if (gate) {
        // shooting the node means flying close to the wall: relax the safety margin
        const c = sim.corridorAt(pcy);
        tx = gate.x + gate.w / 2;
        lo = Math.min(lo, c.left + 10 + p.w / 2 + 6);
        hi = Math.max(hi, c.right - 10 - p.w / 2 - 6);
      }
      else {
        const pick = skill.seeksPickups ? sim.pickups.find((k) => k.y < p.y && k.y > p.y - 260) : undefined;
        const prey = skill.hunts ? nearestAhead(sim, pcx, pcy) : null;
        if (pick) tx = pick.x + pick.w / 2;
        else if (prey) tx = prey.x + prey.w / 2;
      }

      // dodge the most urgent threat
      let threat = 0;
      for (const s of sim.enemyShots) {
        const dy = pcy - (s.y + s.h / 2);
        if (dy > 0 && dy < skill.threatHorizon && s.vy > 0) {
          const xAt = s.x + s.w / 2 + s.vx * (dy / s.vy);
          if (Math.abs(xAt - pcx) < 18) threat = xAt < pcx ? 1 : -1;
        }
      }
      for (const hz of sim.hazards) if (Math.hypot(hz.x - pcx, hz.y - pcy) < hz.r + 14) threat = hz.x < pcx ? 1 : -1;
      for (const h of sim.hostiles) {
        if (h.ground) continue;
        const dy = p.y - (h.y + h.h);
        if (dy > 0 && dy < skill.threatHorizon * 0.8 && Math.abs(h.x + h.w / 2 - pcx) < 26) { threat = h.x + h.w / 2 < pcx ? 1 : -1; break; }
      }
      if (threat !== 0) {
        tx = pcx + threat * 60;
        // boxed in against a wall? dodge the other way
        if (tx > hi + 20 || tx < lo - 20) tx = pcx - threat * 60;
      }
      jitter = (rng.next() - 0.5) * 2 * skill.noise;
      targetX = Math.min(hi, Math.max(lo, tx + jitter));
    }

    out.left = pcx > targetX + 3;
    out.right = pcx < targetX - 3;
    out.up = false;
    out.down = false;

    out.fire = skill.rhythmCool
      ? !(p.heat >= COOL_WINDOW[0] + 5 && p.heat <= COOL_WINDOW[1] && p.fireHeld) && !p.overheated
      : true;

    // missiles: skilled pilots paint 2+ targets and ripple; others tap
    const ahead = sim.hostiles.filter((h) => h.y > 0 && h.y < p.y - 40 && h.kind !== 'mine').length;
    if (skill.usesLocks && ahead >= 2 && sim.missiles > 0 && missileHoldUntil === 0) missileHoldUntil = sim.tick + 40;
    if (missileHoldUntil) {
      out.missile = sim.tick < missileHoldUntil;
      if (!out.missile) missileHoldUntil = 0;
    } else {
      out.missile = ahead > 0 && sim.tick % 200 < 2;
    }

    out.flare = sim.samLock > skill.flareAt || (skill.flareAt < 1 && sim.enemyShots.some((s) => s.kind === 'sam' && s.decoy === null && Math.hypot(s.x - pcx, s.y - pcy) < 150));
    out.emp = sim.emp >= 100 && sim.enemyShots.length >= skill.empAt;
    out.boost = false;
    return out;
  };
}

function nearestAhead(sim: Sim, x: number, y: number): Hostile | null {
  let best: Hostile | null = null;
  let bd = Infinity;
  for (const h of sim.hostiles) {
    if (h.kind === 'mine' || h.y < 0 || h.shielded) continue;
    const dy = y - (h.y + h.h / 2);
    if (dy < 60 || dy > 400) continue;
    const d = dy + Math.abs(h.x + h.w / 2 - x) * 2;
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

const pilots = new WeakMap<Sim, Pilot>();

/** The average pilot, one per sim (keeps tests and the attract mode deterministic). */
export function autopilot(sim: Sim, out: SimInput = newInput()): SimInput {
  let pilot = pilots.get(sim);
  if (!pilot) {
    pilot = createPilot(SKILLS.average, sim.seed);
    pilots.set(sim, pilot);
  }
  return pilot(sim, out);
}
