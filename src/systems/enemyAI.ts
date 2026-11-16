import type { Sim } from '../engine/sim';
import type { Hostile, ShotKind } from '../entities/types';
import { HOSTILES } from '../gameplay/enemies/defs';
import { clamp, compact } from '../core/math';
import { VIEW_H } from '../world/canyon';
import { TUNING as T } from '../gameplay/tuning';
import { GATE_NODE_INSET, spawnHostile } from './spawn';

/**
 * Enemy behaviours. Every attack is telegraphed: the unit spends a visible
 * wind-up (`charge` 0→1, plus a 'telegraph' event) before it fires, so the
 * player can always read what's coming.
 */

const DEAD = 99;
const WALL_PAD = 4;

// timings (ticks)
const MINE_TRIGGER = 70;
export const MINE_RADIUS = 46;
export const FLAK_RADIUS = 30;
/** @deprecated read TUNING.telegraph.samLock; kept for tests. */
export const SAM_LOCK = T.telegraph.samLock;

const center = (h: Hostile): [number, number] => [h.x + h.w / 2, h.y + h.h / 2];

function playerCenter(sim: Sim): [number, number] {
  const p = sim.player;
  return [p.x + p.w / 2, p.y + p.h / 2];
}

function angleToPlayer(sim: Sim, h: Hostile): number {
  const [hx, hy] = center(h);
  const [px, py] = playerCenter(sim);
  return Math.atan2(py - hy, px - hx);
}

export function fire(sim: Sim, x: number, y: number, angle: number, speed: number, kind: ShotKind, damage: number, source = 'test'): void {
  const size = kind === 'shell' ? 7 : kind === 'bullet' ? 5 : 6;
  if (sim.options.assist) speed *= 0.85;
  sim.enemyShots.push({
    id: sim.nextId++, kind, x: x - size / 2, y: y - size / 2, w: size, h: size, px: x - size / 2, py: y - size / 2,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    life: kind === 'sam' || kind === 'rocket' ? 300 : 400, damage, grazed: false, decoy: null, source,
  });
  sim.emit({ type: 'enemyShot', x, y, kind });
}

const onScreen = (h: Hostile, top = 0, bottom = VIEW_H - 120) => h.y + h.h > top && h.y < bottom;

/** Rotate `from` toward `to` by at most `max` radians. */
export function turnToward(from: number, to: number, max: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + clamp(d, -max, max);
}

function telegraph(sim: Sim, h: Hostile): void {
  const [x, y] = center(h);
  sim.emit({ type: 'telegraph', x, y, kind: h.kind });
}

export function updateEnemies(sim: Sim): void {
  const c = { left: 0, right: 0 };
  for (const h of sim.hostiles) {
    if (h.flash > 0) h.flash--;
    h.pulse = (h.pulse + 0.1) % (Math.PI * 2);
    const def = HOSTILES[h.kind];

    // ---- motion
    if (h.group !== 0 && h.kind !== 'gunship') {
      // boss parts are positioned by their boss controller
    } else if (h.ground) {
      h.y += sim.scrollSpeed + h.vy;
    } else if (h.kind !== 'gunship') {
      h.x += h.vx;
      h.y += h.vy;
    }

    BEHAVIOURS[h.kind](sim, h);

    // ---- containment: wall units glue to their wall, everything else stays in the corridor
    if (h.group !== 0) continue;
    sim.corridorAt(h.y + h.h / 2, c);
    if (h.kind === 'turret' || h.kind === 'gate') {
      const inset = h.kind === 'gate' ? GATE_NODE_INSET : 1;
      h.x = h.side < 0 ? c.left + inset : c.right - h.w - inset;
    } else {
      const lo = c.left + WALL_PAD;
      const hi = Math.max(lo, c.right - h.w - WALL_PAD);
      if (h.x < lo) { h.x = lo; if (def.bounces) h.vx = Math.abs(h.vx); }
      else if (h.x > hi) { h.x = hi; if (def.bounces) h.vx = -Math.abs(h.vx); }
    }
  }
  compact(sim.hostiles, (h) => h.state !== DEAD);
}

type Behaviour = (sim: Sim, h: Hostile) => void;

const BEHAVIOURS: Record<Hostile['kind'], Behaviour> = {
  // Scout drone: weaves, occasionally a single slow aimed shot after a short eye-flare.
  drone(sim, h) {
    h.x += Math.sin(sim.tick * 0.05 + h.id) * 0.6;
    if (h.state === 0) {
      if (--h.timer <= 0 && onScreen(h, 10, 320)) { h.state = 1; h.timer = T.telegraph.scout; telegraph(sim, h); }
    } else if (h.state === 1) {
      h.charge = 1 - h.timer / T.telegraph.scout;
      if (--h.timer <= 0) {
        const [x, y] = center(h);
        fire(sim, x, y, angleToPlayer(sim, h), T.shotSpeed.drone, 'bullet', T.damage.droneShot, h.kind);
        h.state = 0; h.charge = 0; h.timer = 110 + sim.rng.int(90);
      }
    }
  },

  // UAV: swings toward the player's column and rams.
  uav(sim, h) {
    const [px] = playerCenter(sim);
    // steers toward the player's column, then commits to its line in the last stretch (dodge window)
    if (h.y < sim.player.y - 110) h.vx = clamp(h.vx + Math.sign(px - (h.x + h.w / 2)) * T.uav.steer, -T.uav.maxVx, T.uav.maxVx);
  },

  // Mine: drifts; arms when the player comes close, then detonates unless shot.
  mine(sim, h) {
    const [hx, hy] = center(h);
    const [px, py] = playerCenter(sim);
    if (h.state === 0) {
      if (Math.hypot(px - hx, py - hy) < MINE_TRIGGER) { h.state = 1; h.timer = T.telegraph.mineFuse; h.vx *= 0.3; h.vy = 0.3; telegraph(sim, h); }
    } else if (h.state === 1) {
      h.charge = 1 - h.timer / T.telegraph.mineFuse;
      if (--h.timer <= 0) {
        sim.emit({ type: 'airburst', x: hx, y: hy, r: MINE_RADIUS });
        if (Math.hypot(px - hx, py - hy) < MINE_RADIUS + 6) sim.damagePlayer(T.damage.mine, 'mine');
        h.state = DEAD;
      }
    }
  },

  // Gunner: drops in, hovers, red glint charge, 3-round burst; leaves after three cycles.
  gunner(sim, h) {
    const hoverY = 70 + (h.id % 4) * 32;
    switch (h.state) {
      case 0: // entering
        if (h.y >= hoverY) { h.vy = 0; h.state = 1; h.timer = 30; }
        break;
      case 1: { // hover and line up
        const [px] = playerCenter(sim);
        h.vx = clamp((px - (h.x + h.w / 2)) * 0.02, -0.9, 0.9);
        h.aim = angleToPlayer(sim, h);
        if (--h.timer <= 0) { h.state = 2; h.timer = T.telegraph.gunner; telegraph(sim, h); }
        break;
      }
      case 2: // charging (aim keeps tracking until the last 10 ticks)
        h.vx *= 0.9;
        if (h.timer > 10) h.aim = angleToPlayer(sim, h);
        h.charge = 1 - h.timer / T.telegraph.gunner;
        if (--h.timer <= 0) { h.state = 3; h.burst = 3; h.timer = 0; h.charge = 0; }
        break;
      case 3: // burst
        if (--h.timer <= 0) {
          const [x, y] = center(h);
          fire(sim, x, y, h.aim, T.shotSpeed.gunner, 'bullet', T.damage.gunnerShot, h.kind);
          h.timer = 6;
          if (--h.burst <= 0) {
            h.cycles++;
            if (h.cycles >= 3) { h.state = 4; h.vy = 2.6; h.vx = 0; }
            else { h.state = 1; h.timer = 55; }
          }
        }
        break;
    }
  },

  // Wall turret: tracks with a laser sight, locks briefly, then a 4-round aimed burst.
  turret(sim, h) { turretBehaviour(sim, h); },

  // ---- Phase 4: depots and boss parts
  depot() {},
  sluice() {},
  shieldgen() {},
  // train wagons carry turrets
  traincar(sim, h) { turretBehaviour(sim, h); },
  // the dam's spillway guns throw flak around the player
  dam(sim, h) {
    if (h.shielded && h.timer > 300) h.timer = 300;
    if (--h.timer <= 0) {
      const p = sim.player;
      const px = p.x + p.w / 2, py = p.y + p.h / 2;
      const n = h.shielded ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const x = clamp(px + (i - (n - 1) / 2) * 70 + p.steer * p.speed * 12, 0, 800);
        sim.hazards.push({ id: sim.nextId++, x, y: py - 10 + i * 8, px: x, py: py - 10 + i * 8, r: FLAK_RADIUS, timer: T.telegraph.flakFuse, maxTimer: T.telegraph.flakFuse });
        sim.emit({ type: 'flakMark', x, y: py });
      }
      h.timer = h.shielded ? 230 : 170;
    }
  },
  // the locomotive lobs heavy shells like a tank
  engine(sim, h) { BEHAVIOURS.tank(sim, h); },
  // the radar dish sweeps and calls in drone pairs
  dish(sim, h) {
    h.aim += 0.03;
    if (--h.timer <= 0) {
      spawnHostile(sim, 'drone');
      spawnHostile(sim, 'drone');
      h.timer = h.shielded ? 320 : 220;
      telegraph(sim, h);
    }
  },

  // Flak: marks where the player is heading; the shell airbursts there after a fuse.
  flak(sim, h) {
    h.aim = turnToward(h.aim, angleToPlayer(sim, h), 0.05);
    if (--h.timer <= 0 && onScreen(h, 0, 400)) {
      const p = sim.player;
      const [px, py] = playerCenter(sim);
      const x = clamp(px + p.steer * p.speed * 14, 0, 800);
      sim.hazards.push({ id: sim.nextId++, x, y: py, px: x, py, r: FLAK_RADIUS, timer: T.telegraph.flakFuse, maxTimer: T.telegraph.flakFuse });
      sim.emit({ type: 'flakMark', x, y: py });
      h.timer = 120 + sim.rng.int(50);
    }
  },

  // SAM site: a long lock-on (tone + reticle), then a heat-seeker. Flares decoy it.
  sam(sim, h) {
    switch (h.state) {
      case 0:
        if (--h.timer <= 0 && onScreen(h, 30, 340)) { h.state = 1; h.timer = T.telegraph.samLock; h.charge = 0; sim.emit({ type: 'lockStart' }); telegraph(sim, h); }
        break;
      case 1:
        h.charge = 1 - h.timer / T.telegraph.samLock;
        h.aim = angleToPlayer(sim, h);
        if (!onScreen(h, 0, 430)) { h.state = 0; h.timer = 9999; h.charge = 0; sim.emit({ type: 'lockEnd' }); break; }
        if (--h.timer <= 0) {
          const [x, y] = center(h);
          fire(sim, x, y, h.aim, T.shotSpeed.sam, 'sam', T.damage.sam, h.kind);
          sim.emit({ type: 'samLaunch', x, y });
          sim.emit({ type: 'lockEnd' });
          h.state = 2; h.timer = 260; h.charge = 0;
        }
        break;
      case 2:
        if (--h.timer <= 0) h.state = 0;
        break;
    }
  },

  // Tank: grinds up the canyon floor, turret tracks, slow heavy shells after a wind-up.
  tank(sim, h) {
    h.aim = turnToward(h.aim, angleToPlayer(sim, h), 0.035);
    if (h.state === 0) {
      if (--h.timer <= 0 && onScreen(h, 0, 420)) { h.state = 1; h.timer = T.telegraph.tank; telegraph(sim, h); }
    } else {
      h.charge = 1 - h.timer / T.telegraph.tank;
      if (--h.timer <= 0) {
        const [x, y] = center(h);
        fire(sim, x + Math.cos(h.aim) * 12, y + Math.sin(h.aim) * 12, h.aim, T.shotSpeed.tank, 'shell', T.damage.tankShell, h.kind);
        h.state = 0; h.charge = 0; h.timer = 140 + sim.rng.int(70);
      }
    }
  },

  // Rival gunship: shadows the player and cycles fan / burst / rocket patterns.
  gunship(sim, h) {
    const [px] = playerCenter(sim);
    if (h.state === 0) {
      h.y += 1.6;
      if (h.y >= 60) { h.state = 1; h.timer = 60; }
      return;
    }
    if (h.state === 5) { // leaving
      h.y -= 2.2;
      if (h.y < -60) h.state = DEAD;
      return;
    }
    // variant 0 Dust Devil · 1 Viper (works one flank, quicker) · 2 Sunhammer (heavy, second phase)
    const viper = h.variant === 1, hammer = h.variant === 2;
    const enraged = hammer && h.hp < h.maxHp / 2;
    const tx = px + (viper ? h.side * 90 : 0) + Math.sin(sim.tick * 0.021 + h.side) * 70 - h.w / 2;
    const lat = viper ? 3 : enraged ? 2.6 : 2;
    h.vx = clamp((tx - h.x) * 0.03, -lat, lat);
    h.x += h.vx;
    h.y = 60 + Math.sin(sim.tick * 0.03) * 14;
    h.aim = angleToPlayer(sim, h);
    const [x, y] = center(h);

    switch (h.state) {
      case 1: // between patterns
        if (--h.timer <= 0) {
          if (!hammer && h.cycles >= (viper ? 10 : 12)) { h.state = 5; break; }
          h.state = enraged && h.cycles % 4 === 3 ? 6 : 2 + (h.cycles % 3);
          const k = viper ? 0.75 : 1;
          h.timer = Math.round((h.state === 2 ? 50 : h.state === 3 ? 32 : h.state === 6 ? 56 : 42) * k);
          h.burst2 = h.timer;
          h.burst = h.state === 3 ? 6 : 0;
          telegraph(sim, h);
        }
        break;
      case 2: // fan
        h.charge = 1 - h.timer / h.burst2;
        if (--h.timer <= 0) {
          const n = hammer ? 4 : 3;
          for (let i = -n; i <= n; i++) fire(sim, x, y + 10, h.aim + i * 0.2, T.shotSpeed.gunshipFan, 'bullet', T.damage.gunshipBullet, h.kind);
          endPattern(h);
        }
        break;
      case 3: // aimed burst
        if (h.timer > 0) { h.charge = 1 - h.timer / h.burst2; h.timer--; break; }
        if (sim.tick % 5 === 0) {
          fire(sim, x, y + 10, h.aim, T.shotSpeed.gunshipBurst, 'bullet', T.damage.gunshipBullet, h.kind);
          if (--h.burst <= 0) endPattern(h);
        }
        break;
      case 4: // rocket pair
        h.charge = 1 - h.timer / h.burst2;
        if (--h.timer <= 0) {
          fire(sim, x - 12, y + 4, h.aim - 0.5, T.shotSpeed.rocket, 'rocket', T.damage.gunshipRocket, h.kind);
          fire(sim, x + 12, y + 4, h.aim + 0.5, T.shotSpeed.rocket, 'rocket', T.damage.gunshipRocket, h.kind);
          if (hammer) {
            fire(sim, x - 20, y, h.aim - 0.9, T.shotSpeed.rocket, 'rocket', T.damage.gunshipRocket, h.kind);
            fire(sim, x + 20, y, h.aim + 0.9, T.shotSpeed.rocket, 'rocket', T.damage.gunshipRocket, h.kind);
          }
          endPattern(h);
        }
        break;
      case 6: // Sunhammer phase two: a full ring with a gap aimed at the player
        h.charge = 1 - h.timer / h.burst2;
        if (--h.timer <= 0) {
          for (let i = 0; i < 18; i++) {
            const a = h.aim + (i / 18) * Math.PI * 2;
            if (Math.abs(Math.sin((a - h.aim) / 2)) < 0.18) continue; // the gap is where you're standing
            fire(sim, x, y, a, 2.4, 'bullet', T.damage.gunshipBullet, h.kind);
          }
          endPattern(h);
        }
        break;
    }
  },

  // Gate node: the beam is handled in combat; the node itself just rides its wall.
  gate() {},
};

/** Track with a laser sight, lock briefly, then a 4-round aimed burst (wall turrets, train cars). */
function turretBehaviour(sim: Sim, h: Hostile): void {
  const target = angleToPlayer(sim, h);
  switch (h.state) {
    case 0:
      h.aim = turnToward(h.aim, target, 0.05);
      if (--h.timer <= 0 && onScreen(h, 0, 440)) { h.state = 1; h.timer = T.telegraph.turretAim; telegraph(sim, h); }
      break;
    case 1:
      if (h.timer > T.telegraph.turretLock) h.aim = turnToward(h.aim, target, 0.06);
      h.charge = 1 - h.timer / T.telegraph.turretAim;
      if (--h.timer <= 0) { h.state = 2; h.burst = 4; h.timer = 0; h.charge = 0; }
      break;
    case 2:
      if (--h.timer <= 0) {
        const [x, y] = center(h);
        fire(sim, x + Math.cos(h.aim) * 8, y + Math.sin(h.aim) * 8, h.aim, T.shotSpeed.turret, 'bullet', T.damage.turretShot, h.kind);
        h.timer = 5;
        if (--h.burst <= 0) { h.state = 0; h.timer = 100 + sim.rng.int(40); }
      }
      break;
  }
}

function endPattern(h: Hostile): void {
  h.state = 1;
  h.timer = 70;
  h.charge = 0;
  h.cycles++;
}
