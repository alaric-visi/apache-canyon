import type { Sim } from '../engine/sim';
import { VIEW_H } from '../world/canyon';
import type { Hostile, Rect } from '../entities/types';
import { HOSTILES } from '../gameplay/enemies/defs';
import { compact, pointInRect, rectsOverlap } from '../core/math';
import { coneTarget } from './player';
import { addEmp, award, bumpCombo } from './scoring';
import { TUNING as T } from '../gameplay/tuning';

const MISSILE_ACCEL = 0.5;
const MISSILE_MAX_SPEED = 8;
const WALL_PAD = 4;

/** Kept for API compatibility with Phase 1 callers/tests: nearest target ahead. */
export function acquireTarget(sim: Sim, x: number, y: number): Hostile | null {
  return coneTarget(sim, x, y);
}

/** Gate beams cycle on/off; the off window is a gap the player can time. */
export function gateActive(sim: Sim, g: Hostile): boolean {
  const { on, off } = T.gate;
  return (sim.tick + g.id * 37) % (on + off) < on;
}

/** Ticks until the beam switches state (for the renderer's flicker warning). */
export function gateSwitchIn(sim: Sim, g: Hostile): number {
  const { on, off } = T.gate;
  const ph = (sim.tick + g.id * 37) % (on + off);
  return ph < on ? on - ph : on + off - ph;
}

/** The gate's beam: spans the corridor at the node's row. */
export function gateBeam(sim: Sim, g: Hostile): Rect {
  const cy = g.y + g.h / 2;
  const c = sim.corridorAt(cy);
  return { x: c.left, y: cy - 3, w: c.right - c.left, h: 6 };
}

/** Shared damage path for every damage source. Returns true if the hostile died. */
export function damageHostile(sim: Sim, e: Hostile, amount: number): boolean {
  const def = HOSTILES[e.kind];
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  if (e.shielded) {
    sim.emit({ type: 'block', x: cx, y: cy });
    return false;
  }
  e.hp -= amount;
  e.flash = 4;
  if (e.hp > 0) {
    sim.emit({ type: 'hit', x: cx, y: cy });
    return false;
  }
  sim.emit({ type: 'explode', x: cx, y: cy, particles: def.particles, big: def.bigExplosion, shake: def.shake });
  bumpCombo(sim);
  award(sim, def.score, cx, cy);
  addEmp(sim, def.emp);
  sim.stats.kills[e.kind] = (sim.stats.kills[e.kind] ?? 0) + 1;
  if (e.group !== 0 && sim.bossState && e.kind === sim.bossState.core) sim.stats.bossKills.push(e.group);
  if (e.kind === 'depot') {
    sim.emit({ type: 'depot', x: cx, y: cy });
    const c = sim.corridorAt(cy);
    const x = Math.min(Math.max(cx - 6, c.left + WALL_PAD), c.right - 12 - WALL_PAD);
    sim.pickups.push({ kind: 'fuel', x, y: cy - 6, w: 12, h: 12, px: x, py: cy - 6, vy: sim.scrollSpeed * 0.6, rot: 0 });
  }
  if (e.kind === 'sam' && e.state === 1) sim.emit({ type: 'lockEnd' });
  return true;
}

export function updateProjectiles(sim: Sim): void {
  for (const b of sim.bullets) { b.x += b.vx; b.y += b.vy; }
  compact(sim.bullets, (b) => b.y > -10 && b.x > -20 && b.x < 820);

  for (const m of sim.playerMissiles) {
    let target = m.targetId !== null ? sim.hostiles.find((h) => h.id === m.targetId) : undefined;
    if (!target) {
      const t = coneTarget(sim, m.x + m.w / 2, m.y);
      m.targetId = t ? t.id : null;
      target = t ?? undefined;
    }
    if (target) {
      const dx = target.x + target.w / 2 - (m.x + m.w / 2);
      const dy = target.y + target.h / 2 - m.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) { m.vx += (dx / d) * MISSILE_ACCEL; m.vy += (dy / d) * MISSILE_ACCEL; }
    }
    const s = Math.hypot(m.vx, m.vy);
    if (s > MISSILE_MAX_SPEED) { m.vx = (m.vx / s) * MISSILE_MAX_SPEED; m.vy = (m.vy / s) * MISSILE_MAX_SPEED; }
    m.x += m.vx;
    m.y += m.vy;
  }
  compact(sim.playerMissiles, (m) => m.y > -10 && m.y < VIEW_H);
}

/** Player projectiles vs hostiles (and gate beams), then body contact with the player. */
export function updateHostileCollisions(sim: Sim): void {
  sim.hostileGrid.rebuild(sim.hostiles);
  const dead = new Set<Hostile>();
  const gates = sim.hostiles.filter((h) => h.kind === 'gate' && gateActive(sim, h));
  const beams = gates.map((g) => gateBeam(sim, g));

  const hitTest = (x: number, y: number, amount: (e: Hostile) => number): boolean => {
    for (const e of sim.hostileGrid.query(x, y, 0, 0)) {
      if (dead.has(e) || !pointInRect(x, y, e)) continue;
      if (damageHostile(sim, e, amount(e))) dead.add(e);
      return true;
    }
    // a live gate beam absorbs fire
    for (let i = 0; i < gates.length; i++) {
      if (!dead.has(gates[i]) && pointInRect(x, y, beams[i])) {
        sim.emit({ type: 'block', x, y: beams[i].y + 3 });
        return true;
      }
    }
    return false;
  };

  compact(sim.bullets, (b) => {
    const before = sim.events.length;
    if (!hitTest(b.x, b.y, () => 1)) return true;
    // count it as a hit unless a beam or shield soaked it up
    if (!sim.events.slice(before).some((ev) => ev.type === 'block')) sim.stats.shotsHit++;
    return false;
  });
  compact(sim.playerMissiles, (m) => !hitTest(m.x + m.w / 2, m.y, (e) => HOSTILES[e.kind].missileDamage));

  // body contact. Passes through while invulnerable.
  const p = sim.player;
  if (p.invuln === 0) {
    const core = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 4 };
    for (const e of sim.hostileGrid.query(p.x, p.y, p.w, p.h)) {
      const ram = T.ram[e.kind as keyof typeof T.ram] ?? 0;
      if (dead.has(e) || ram === 0 || !rectsOverlap(e, core)) continue;
      dead.add(e);
      sim.emit({ type: 'explode', x: e.x + e.w / 2, y: e.y + e.h / 2, particles: 14, big: false, shake: 10, damage: true });
      sim.damagePlayer(ram, `contact:${e.kind}`);
      if (sim.status !== 'running' || p.invuln > 0) break;
    }
    // flying into a live gate beam
    for (let i = 0; i < gates.length && p.invuln === 0 && sim.status === 'running'; i++) {
      if (dead.has(gates[i]) || !rectsOverlap(beams[i], p)) continue;
      dead.add(gates[i]);
      sim.emit({ type: 'explode', x: p.x + p.w / 2, y: p.y + p.h / 2, particles: 16, big: false, shake: 12, damage: true });
      sim.damagePlayer(T.damage.gate, 'gate');
    }
  }

  if (sim.status !== 'running') return;
  // boss parts are owned by their controller and may wait far above the screen
  compact(sim.hostiles, (e) => !dead.has(e) && (e.group !== 0 || (e.y < VIEW_H + 30 && e.y > -200)));
}

export function updatePickups(sim: Sim): void {
  const p = sim.player;
  const c = { left: 0, right: 0 };
  compact(sim.pickups, (k) => {
    k.y += k.vy;
    k.rot += 0.1;
    // tow hook perk: pickups drift in from further away
    if (sim.mods.magnet > 0) {
      const dx = p.x + p.w / 2 - (k.x + k.w / 2), dy = p.y + p.h / 2 - (k.y + k.h / 2);
      const d = Math.hypot(dx, dy);
      if (d < sim.mods.magnet && d > 1) { k.x += (dx / d) * 2.2; k.y += (dy / d) * 2.2; }
    }
    // The ground scrolls faster than pickups fall, so walls slide past them: keep them reachable
    sim.corridorAt(k.y + k.h / 2, c);
    k.x = Math.min(Math.max(k.x, c.left + WALL_PAD), Math.max(c.left + WALL_PAD, c.right - k.w - WALL_PAD));
    if (rectsOverlap(k, p)) {
      const e = T.economy;
      if (k.kind === 'fuel') sim.fuel = Math.min(100, sim.fuel + e.fuelPickup);
      else if (k.kind === 'shield') sim.shields = Math.min(sim.maxShields, sim.shields + e.shieldPickup);
      else if (k.kind === 'missile') sim.missiles = Math.min(99, sim.missiles + e.missilePickup);
      else if (k.kind === 'flare') sim.flares = Math.min(T.player.maxFlares, sim.flares + e.flarePickup);
      else p.spread = e.spreadTicks;
      sim.emit({ type: 'pickup', x: k.x + k.w / 2, y: k.y + k.h / 2, kind: k.kind });
      return false;
    }
    return k.y < VIEW_H;
  });
}
