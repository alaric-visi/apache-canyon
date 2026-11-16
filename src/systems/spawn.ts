import type { Sim } from '../engine/sim';
import type { Hostile, HostileKind, PickupKind } from '../entities/types';
import { HOSTILES } from '../gameplay/enemies/defs';
import { WORLD_W } from '../world/canyon';
import { TUNING as T } from '../gameplay/tuning';

const SPAWN_PAD = 15;
/**
 * Gate nodes hang this far off their wall. Shooting one means flying inside the
 * graze zone (risk/reward) but never into the scrape zone: the gunship's centre
 * scrapes at <=20 units from the wall, the node's centre sits at 30.
 */
export const GATE_NODE_INSET = 24;

/**
 * Horizontal spawn range for a w×h body whose top is at screen row y, using the
 * corridor across its whole height so it never starts inside rock.
 * Returns null if it doesn't fit.
 */
export function spawnRange(sim: Sim, y: number, w: number, h: number, pad = SPAWN_PAD): [number, number] | null {
  let left = -Infinity, right = Infinity;
  for (let yy = y; yy <= y + h; yy += Math.max(4, h / 4)) {
    const c = sim.corridorAt(yy);
    left = Math.max(left, c.left);
    right = Math.min(right, c.right);
  }
  const lo = left + pad;
  const hi = right - w - pad;
  return hi >= lo ? [lo, hi] : null;
}

export function makeHostile(sim: Sim, kind: HostileKind, x: number, y: number): Hostile {
  const def = HOSTILES[kind];
  return {
    id: sim.nextId++, kind, x, y, w: def.w, h: def.h, px: x, py: y,
    vx: def.vxSpread ? sim.rng.range(-def.vxSpread / 2, def.vxSpread / 2) : 0,
    vy: def.vy, hp: def.hp, maxHp: def.hp, flash: 0, pulse: 0,
    state: 0, timer: 30 + sim.rng.int(60), charge: 0, aim: Math.PI / 2, burst: 0, burst2: 1, cycles: 0,
    side: 1, ground: def.ground, group: 0, ox: 0, oy: 0, variant: 0, shielded: false,
  };
}

/** Spawn a hostile just above the screen in a legal position. Returns it, or null if it doesn't fit. */
export function spawnHostile(sim: Sim, kind: HostileKind): Hostile | null {
  const def = HOSTILES[kind];
  const y = -def.h - 6;
  let x: number;
  let side = 1;

  if (kind === 'turret' || kind === 'gate') {
    // mounted on a canyon wall (gate nodes sit out on an arm, within reach of the nose gun)
    side = sim.rng.chance(0.5) ? -1 : 1;
    const c = sim.corridorAt(y + def.h / 2);
    if (c.right - c.left < 90) return null;
    const inset = kind === 'gate' ? GATE_NODE_INSET : 1;
    x = side < 0 ? c.left + inset : c.right - def.w - inset;
  } else if (kind === 'gunship') {
    const c = sim.corridorAt(60);
    x = (c.left + c.right) / 2 - def.w / 2;
  } else {
    const range = spawnRange(sim, y, def.w, def.h);
    if (!range) return null;
    x = sim.rng.range(range[0], range[1]);
  }

  const h = makeHostile(sim, kind, Math.min(WORLD_W, x), y);
  h.side = side;
  if (kind === 'gate') h.hp = h.maxHp = T.gate.hp;
  if (kind === 'gunship') h.y = h.py = -40;
  sim.hostiles.push(h);
  return h;
}

export function spawnPickup(sim: Sim, kind: PickupKind): boolean {
  const range = spawnRange(sim, -20, 12, 12);
  if (!range) return false;
  const x = sim.rng.range(range[0], range[1]);
  sim.pickups.push({ kind, x, y: -20, w: 12, h: 12, px: x, py: -20, vy: 1.5, rot: 0 });
  return true;
}
