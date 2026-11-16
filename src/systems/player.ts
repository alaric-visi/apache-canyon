import type { Sim } from '../engine/sim';
import { PLAYER_Y_MAX, PLAYER_Y_MIN } from '../gameplay/flight';
import type { Hostile, SimInput } from '../entities/types';
import { clamp } from '../core/math';
import { isTargetable } from '../gameplay/enemies/defs';
import { damageHostile } from './combat';
import { TUNING as T } from '../gameplay/tuning';

const WALL_MARGIN = 10;
const SCRAPE_ZONE = 2;
const VERTICAL_SPEED = 3;

// chain gun
export const FIRE_INTERVAL = 5;
const BULLET_SPEED = -8.5;
export const HEAT_PER_SHOT = 7;
const COOL_RATE = 1.1;
const VENT_RATE = 1.0;
export const VENT_TO = 30;
/** Releasing the trigger with heat in this window dumps heat ("active cooling"). */
export const COOL_WINDOW: readonly [number, number] = [55, 82];
const COOL_DUMP = 32;
const SPREAD_ANGLE = 0.2;

// missiles
const MISSILE_LAUNCH_SPEED = -6;
/** Holding the missile button longer than this starts painting targets. */
export const LOCK_START = 10;
export const LOCK_INTERVAL = 12;
export const MAX_LOCKS = 4;
const RIPPLE_INTERVAL = 6;

// flares / EMP
const FLARE_COOLDOWN = 45;
const EMP_DAMAGE = 3;

export function updatePlayer(sim: Sim, input: SimInput): void {
  const p = sim.player;
  if (p.invuln > 0) p.invuln--;
  if (p.flash > 0) p.flash--;
  if (p.hurtGrace > 0) p.hurtGrace--;
  if (p.muzzle > 0) p.muzzle--;
  if (p.fireCooldown > 0) p.fireCooldown--;
  if (p.flareCooldown > 0) p.flareCooldown--;
  if (p.spread > 0) p.spread--;

  // ---- movement: free in x, within a band in y
  p.steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // lateral agility scales with flight speed so steep walls stay flyable at top speed
  p.x += p.steer * p.speed * sim.mods.agility * Math.max(1, sim.scrollSpeed / T.speed.start) ** T.player.agilityExponent;
  p.y = clamp(p.y + ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * VERTICAL_SPEED, PLAYER_Y_MIN, PLAYER_Y_MAX);

  // keep inside the corridor at the player's row; touching the rock scrapes shields
  const c = sim.corridorAt(p.y + p.h / 2);
  const lb = c.left + WALL_MARGIN;
  const rb = c.right - p.w - WALL_MARGIN;
  p.x = clamp(p.x, lb, Math.max(lb, rb));
  const onLeft = p.x <= lb + SCRAPE_ZONE;
  const onRight = p.x >= rb - SCRAPE_ZONE;
  if ((onLeft || onRight) && p.invuln === 0) {
    if (sim.tick % 8 === 0) sim.emit({ type: 'scrape', x: onLeft ? p.x : p.x + p.w, y: p.y + p.h / 2 });
    if (!sim.options.assist) sim.damagePlayer(T.player.scrapeDamage, 'scrape');
    if (sim.status !== 'running') return;
  }

  updateGun(sim, input);
  updateMissiles(sim, input);

  // ---- flares
  if (input.flare && p.flareCooldown === 0 && sim.flares > 0) {
    sim.flares--;
    sim.stats.flaresUsed++;
    p.flareCooldown = FLARE_COOLDOWN;
    for (let i = 0; i < 4; i++) {
      const vx = (i - 1.5) * 1.1;
      sim.flareObjs.push({ id: sim.nextId++, x: p.x + p.w / 2 - 2, y: p.y + p.h, w: 4, h: 4, px: p.x + p.w / 2 - 2, py: p.y + p.h, vx, vy: 1.2 + Math.abs(vx) * 0.3, life: 80 });
    }
    sim.emit({ type: 'flare', x: p.x + p.w / 2, y: p.y + p.h });
  }

  // ---- EMP burst: clears enemy fire, damages everything on screen
  if (input.emp && sim.emp >= 100) {
    sim.emp = 0;
    sim.stats.empsUsed++;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    sim.emit({ type: 'emp', x: cx, y: cy });
    for (const s of sim.enemyShots) sim.emit({ type: 'hit', x: s.x, y: s.y });
    sim.enemyShots.length = 0;
    sim.hazards.length = 0;
    const dead: Hostile[] = [];
    for (const h of sim.hostiles) {
      if (h.y + h.h < 0) continue;
      if (damageHostile(sim, h, EMP_DAMAGE)) dead.push(h);
      else if (h.kind === 'sam' && h.state === 1) { h.state = 0; h.timer = 120; h.charge = 0; }
    }
    if (dead.length) sim.hostiles = sim.hostiles.filter((h) => !dead.includes(h));
  }
}

function updateGun(sim: Sim, input: SimInput): void {
  const p = sim.player;
  const firing = input.fire && !p.overheated;

  // active cooling: let go of the trigger inside the window
  if (!input.fire && p.fireHeld && !p.overheated && p.heat >= COOL_WINDOW[0] - sim.mods.coolWiden / 2 && p.heat <= COOL_WINDOW[1] + sim.mods.coolWiden / 2) {
    p.heat = Math.max(0, p.heat - COOL_DUMP);
    sim.emit({ type: 'coolPerfect', x: p.x + p.w / 2, y: p.y - 6 });
  }
  p.fireHeld = input.fire;

  if (p.overheated) {
    p.heat = Math.max(0, p.heat - VENT_RATE);
    if (p.heat <= VENT_TO) p.overheated = false;
  } else if (!firing) {
    p.heat = Math.max(0, p.heat - COOL_RATE);
  }

  if (firing && p.fireCooldown === 0) {
    const bx = p.x + p.w / 2 - 1;
    sim.bullets.push({ x: bx, y: p.y, w: 2, h: 8, px: bx, py: p.y, vx: 0, vy: BULLET_SPEED });
    if (p.spread > 0) {
      for (const a of [-SPREAD_ANGLE, SPREAD_ANGLE]) {
        sim.bullets.push({ x: bx, y: p.y + 2, w: 2, h: 8, px: bx, py: p.y + 2, vx: Math.sin(a) * -BULLET_SPEED, vy: Math.cos(a) * BULLET_SPEED });
      }
    }
    p.fireCooldown = FIRE_INTERVAL;
    p.muzzle = 4;
    p.heat += HEAT_PER_SHOT * sim.mods.heat;
    sim.stats.shotsFired++;
    sim.emit({ type: 'shoot', x: p.x + p.w / 2, y: p.y });
    if (p.heat >= 100) {
      p.heat = 100;
      p.overheated = true;
      sim.emit({ type: 'overheat' });
    }
  }
}

/** Nearest targetable hostile above the point inside a forward cone, excluding `skip`. */
export function coneTarget(sim: Sim, x: number, y: number, skip: readonly number[] = []): Hostile | null {
  let best: Hostile | null = null;
  let bestD = Infinity;
  for (const e of sim.hostiles) {
    if (!isTargetable(e.kind) || e.shielded || skip.includes(e.id)) continue;
    const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
    const ahead = y - ey;
    if (ahead <= 0 || ey < -10) continue;
    if (Math.abs(ex - x) > ahead * 0.8 + 40) continue;
    const d = (ex - x) ** 2 + ahead ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function launch(sim: Sim, targetId: number | null): void {
  const p = sim.player;
  if (sim.missiles <= 0) return;
  sim.missiles--;
  sim.stats.missilesFired++;
  const mx = p.x + p.w / 2 - 2;
  sim.playerMissiles.push({ x: mx, y: p.y, w: 4, h: 12, px: mx, py: p.y, vx: (sim.rng.next() - 0.5) * 2, vy: MISSILE_LAUNCH_SPEED, targetId });
  sim.emit({ type: 'missile', x: p.x + p.w / 2, y: p.y });
}

/**
 * Tap: fire one missile at the nearest target ahead.
 * Hold: paint up to MAX_LOCKS targets in the forward cone, release to ripple-fire.
 */
function updateMissiles(sim: Sim, input: SimInput): void {
  const p = sim.player;
  const alive = (id: number) => sim.hostiles.some((h) => h.id === id);
  p.locks = p.locks.filter(alive);

  if (input.missile) {
    p.missileHold++;
    if (p.missileHold >= LOCK_START && (p.missileHold - LOCK_START) % LOCK_INTERVAL === 0 && p.locks.length < Math.min(MAX_LOCKS, sim.missiles)) {
      const t = coneTarget(sim, p.x + p.w / 2, p.y, p.locks);
      if (t) {
        p.locks.push(t.id);
        sim.emit({ type: 'paint', x: t.x + t.w / 2, y: t.y + t.h / 2, count: p.locks.length });
      }
    }
  } else if (p.missileHeld) {
    // released
    if (p.missileHold < LOCK_START || p.locks.length === 0) {
      launch(sim, null);
    } else {
      p.ripple.push(...p.locks);
      p.rippleTimer = 0;
    }
    p.locks.length = 0;
    p.missileHold = 0;
  }
  p.missileHeld = input.missile;

  if (p.ripple.length > 0) {
    if (p.rippleTimer-- <= 0) {
      const id = p.ripple.shift()!;
      launch(sim, alive(id) ? id : null);
      p.rippleTimer = RIPPLE_INTERVAL;
    }
  }
}
