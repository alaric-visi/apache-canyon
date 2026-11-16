import type { Sim } from '../../engine/sim';
import type { Hostile, HostileKind } from '../../entities/types';
import type { BossKind, SectorDef } from '../../content/sectors/sectors';
import { makeHostile, spawnHostile } from '../../systems/spawn';
import { HOSTILES } from '../enemies/defs';
import { ARENA_BLEND, ARENA_LEAD, PLAYER_Y_MAX } from '../flight';

/**
 * Sector bosses. Multi-part bosses share a `group` id; this controller moves
 * the parts together each tick and decides when the fight is over. The parts'
 * own attacks run through systems/enemyAI.ts like any other hostile.
 *
 *  1 Red Mesa        Dust Devil   rival gunship (leaves if you outlast it)
 *  2 The Narrows     Dam          shielded wall; destroy 3 sluices, then the core
 *  3 Dry Lake        Iron Mule    armoured train; turret cars, kill the locomotive
 *  4 Sandstorm Pass  Viper Pair   two fast gunships that work opposite sides
 *  5 Night Run       Overwatch    radar dish shielded by 3 generators, SAM/flak cover
 *  6 Dawn Strike     Sunhammer    heavy gunship with a second phase
 */

export interface BossState {
  kind: BossKind;
  name: string;
  group: number;
  t: number;
  anchorY: number;
  /** Ground bosses (dam, radar) bring the scroll to a hover once in position. */
  hold: boolean;
  /** Ground-anchored boss that has reached its station. */
  anchored: boolean;
  escaped: boolean;
  /** Core part kinds whose death ends the fight. */
  core: HostileKind;
}

const DEAD = 99;
/** Where ground bosses come to rest (screen y of the anchor). */
const STATION_Y = 84;
/**
 * How far into the arena the structure stands. When the flight stops, every
 * row from the structure down to the bottom of the player's flight band must
 * already be fully inside the arena, or the two stretches of canyon may not
 * overlap and the boss can be out of reach.
 */
const ARENA_DEPTH = ARENA_BLEND + (PLAYER_Y_MAX + 20 - STATION_Y) + 40;
/** Start holding this far before the station: the scroll eases to a stop over ~50 units. */
const BRAKE = 50;

function part(sim: Sim, kind: HostileKind, group: number, ox: number, oy: number, o: Partial<Hostile> = {}): Hostile {
  const h = makeHostile(sim, kind, 0, -120); // the controller places it this tick
  Object.assign(h, { group, ox, oy, vx: 0, vy: 0 }, o);
  h.maxHp = h.hp = o.hp ?? HOSTILES[kind].hp;
  sim.hostiles.push(h);
  return h;
}

function gunship(sim: Sim, group: number, variant: number, side: number, hp: number): Hostile {
  const g = spawnHostile(sim, 'gunship')!;
  g.group = group;
  g.variant = variant;
  g.side = side;
  g.hp = g.maxHp = hp;
  if (variant === 2) { g.w = 36; g.h = 36; }
  if (side !== 0) { g.x += side * 60; g.px = g.x; }
  return g;
}

export function startBoss(sim: Sim, def: SectorDef): void {
  const group = sim.nextId++;
  // ground bosses stand in the arena, which begins ARENA_LEAD beyond the top of the screen
  const b: BossState = { kind: def.boss, name: def.bossName, group, t: 0, anchorY: -(ARENA_LEAD + ARENA_DEPTH), hold: false, anchored: false, escaped: false, core: 'gunship' };
  sim.bossState = b;
  switch (def.boss) {
    case 'dustDevil':
      gunship(sim, group, 0, 0, HOSTILES.gunship.hp);
      break;
    case 'twinVipers':
      gunship(sim, group, 1, -1, 55);
      gunship(sim, group, 1, 1, 55);
      break;
    case 'sunhammer':
      gunship(sim, group, 2, 0, 220);
      break;
    case 'dam': {
      b.core = 'dam';
      part(sim, 'dam', group, 0, 0, { shielded: true });
      for (const f of [0.2, 0.5, 0.8]) part(sim, 'sluice', group, f, 22);
      part(sim, 'turret', group, 0.06, 30, { side: -1, timer: 60 });
      part(sim, 'turret', group, 0.94, 30, { side: 1, timer: 120 });
      break;
    }
    case 'train': {
      b.core = 'engine';
      b.anchorY = -240;
      part(sim, 'engine', group, 0, 0);
      for (let i = 0; i < 4; i++) part(sim, 'traincar', group, 0, 44 + i * 40, { timer: 40 + i * 35 });
      break;
    }
    case 'radar': {
      b.core = 'dish';
      part(sim, 'dish', group, 0, 0, { shielded: true });
      part(sim, 'shieldgen', group, -64, 26);
      part(sim, 'shieldgen', group, 64, 26);
      part(sim, 'shieldgen', group, 0, -46);
      part(sim, 'sam', group, -96, -18, { timer: 120 });
      part(sim, 'sam', group, 96, -18, { timer: 420 });
      part(sim, 'flak', group, 0, 64, { timer: 200 });
      break;
    }
  }
  sim.emit({ type: 'bossEnter', name: def.bossName });
}

/** Move parts, check the win condition. */
export function updateBoss(sim: Sim): 'active' | 'defeated' | 'escaped' {
  const b = sim.bossState;
  if (!b) return 'defeated';
  b.t++;
  const parts = sim.hostiles.filter((h) => h.group === b.group);
  const c = { left: 0, right: 0 };

  switch (b.kind) {
    case 'dam':
    case 'radar': {
      // built into the canyon: scrolls in with the ground, then the flight hovers in front of it
      b.anchorY += sim.scrollSpeed;
      const station = STATION_Y + (b.kind === 'radar' ? 40 : 0);
      if (!b.hold && b.anchorY >= station - BRAKE) b.hold = true;
      b.anchored = b.hold;
      sim.corridorAt(b.anchorY + 14, c);
      const width = c.right - c.left;
      const mid = (c.left + c.right) / 2;
      for (const h of parts) {
        if (h.kind === 'dam') { h.x = c.left - 6; h.w = width + 12; h.y = b.anchorY; }
        else if (b.kind === 'dam') { h.x = c.left + width * h.ox - h.w / 2; h.y = b.anchorY + h.oy; }
        else { const k = Math.min(1, width / 300); h.x = mid + h.ox * k - h.w / 2; h.y = b.anchorY + h.oy - h.h / 2 + 18; }
      }
      // shields drop once every generator / sluice is gone
      const guards = parts.filter((h) => h.kind === 'sluice' || h.kind === 'shieldgen').length;
      for (const h of parts) {
        if ((h.kind === 'dam' || h.kind === 'dish') && h.shielded && guards === 0) {
          h.shielded = false;
          sim.emit({ type: 'shieldDown', x: h.x + h.w / 2, y: h.y + h.h / 2 });
        }
      }
      break;
    }
    case 'train': {
      // the train races up the canyon floor, drifting to and fro along the formation
      const target = 96 + Math.sin(b.t * 0.008) * 46;
      b.anchorY += Math.max(-1.2, Math.min(2.2, (target - b.anchorY) * 0.05 + (b.anchorY < 0 ? 2 : 0)));
      for (const h of parts) {
        h.y = b.anchorY + h.oy;
        sim.corridorAt(h.y + h.h / 2, c);
        const rail = Math.sin((sim.dist - h.oy) * 0.0016) * (c.right - c.left) * 0.22;
        h.x = (c.left + c.right) / 2 + rail - h.w / 2;
      }
      break;
    }
    default:
      // gunships fly themselves; note when one breaks off
      for (const h of parts) if (h.kind === 'gunship' && h.state === 5) b.escaped = true;
  }

  const coreAlive = parts.some((h) => h.kind === b.core);
  if (coreAlive) return 'active';

  // fight over: the rest of the formation goes up with it
  for (const h of parts) {
    sim.emit({ type: 'explode', x: h.x + h.w / 2, y: h.y + h.h / 2, particles: 18, big: true, shake: 6 });
    h.state = DEAD;
  }
  sim.hostiles = sim.hostiles.filter((h) => h.group !== b.group);
  const escaped = b.escaped && b.kind !== 'sunhammer' && !sim.stats.bossKills.includes(b.group);
  if (!escaped) sim.stats.bossesDefeated++;
  sim.emit({ type: 'bossDown', name: b.name, escaped });
  sim.bossState = null;
  return escaped ? 'escaped' : 'defeated';
}
