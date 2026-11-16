import type { Sim } from '../engine/sim';
import type { Flare, Shot } from '../entities/types';
import { compact, rectsOverlap } from '../core/math';
import { VIEW_H, WORLD_W } from '../world/canyon';
import { turnToward } from './enemyAI';
import { addEmp, award, NEAR_MISS_POINTS, refreshCombo } from './scoring';
import { TUNING as T } from '../gameplay/tuning';

const DECOY_RANGE = 180;
const NEAR_MISS_RANGE = 24;
const SHOT_DOWN_POINTS = 50;

/** Shots hit a slightly smaller core than the player's body hitbox: fair, readable dodging. */
function playerCore(sim: Sim) {
  const p = sim.player;
  return { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 4 };
}

function nearestFlare(sim: Sim, x: number, y: number, range: number): Flare | null {
  let best: Flare | null = null;
  let bestD = range;
  for (const f of sim.flareObjs) {
    const d = Math.hypot(f.x - x, f.y - y);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

export function updateShots(sim: Sim): void {
  const p = sim.player;
  const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
  const core = playerCore(sim);

  compact(sim.enemyShots, (s: Shot) => {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;

    // ---- homing ordnance
    if (s.kind === 'sam' || s.kind === 'rocket') {
      if (s.kind === 'sam' && s.decoy === null) {
        const f = nearestFlare(sim, cx, cy, DECOY_RANGE);
        if (f) { s.decoy = f.id; sim.emit({ type: 'decoyed', x: cx, y: cy }); }
      }
      let tx = pcx, ty = pcy;
      if (s.decoy !== null) {
        const f = sim.flareObjs.find((fl) => fl.id === s.decoy);
        if (!f || Math.hypot(f.x - cx, f.y - cy) < 8) {
          sim.emit({ type: 'explode', x: cx, y: cy, particles: 10, big: false, shake: 2 });
          return false;
        }
        tx = f.x; ty = f.y;
      }
      const speed = Math.hypot(s.vx, s.vy);
      const ang = turnToward(Math.atan2(s.vy, s.vx), Math.atan2(ty - cy, tx - cx), s.kind === 'sam' ? 0.05 : 0.02);
      const ns = s.kind === 'sam' ? Math.min(4.4, speed * 1.02) : speed;
      s.vx = Math.cos(ang) * ns;
      s.vy = Math.sin(ang) * ns;
    }

    s.x += s.vx;
    s.y += s.vy;
    s.life--;

    // ---- player gunfire can shoot down missiles and rockets
    if (s.kind === 'sam' || s.kind === 'rocket') {
      for (let i = 0; i < sim.bullets.length; i++) {
        const b = sim.bullets[i];
        if (b.x >= s.x - 3 && b.x <= s.x + s.w + 3 && b.y >= s.y - 3 && b.y <= s.y + s.h + 3) {
          sim.bullets.splice(i, 1);
          sim.emit({ type: 'explode', x: cx, y: cy, particles: 10, big: false, shake: 3 });
          award(sim, SHOT_DOWN_POINTS, cx, cy, 'SHOT DOWN');
          return false;
        }
      }
    }

    // ---- hit / near miss
    // a decoyed missile is chasing its flare and no longer fuses on the player
    if (p.invuln === 0 && s.decoy === null && rectsOverlap(s, core)) {
      sim.emit({ type: 'explode', x: cx, y: cy, particles: s.kind === 'bullet' ? 6 : 14, big: false, shake: s.damage / 3, damage: true });
      sim.damagePlayer(s.damage, `shot:${s.kind}:${s.source}`);
      return false;
    }
    if (!s.grazed && p.invuln === 0) {
      const dx = pcx - (s.x + s.w / 2), dy = pcy - (s.y + s.h / 2);
      const movingAway = dx * s.vx + dy * s.vy < 0;
      if (movingAway && Math.hypot(dx, dy) < NEAR_MISS_RANGE) {
        s.grazed = true;
        award(sim, NEAR_MISS_POINTS, s.x, s.y, 'NEAR MISS');
        sim.stats.nearMisses++;
        refreshCombo(sim);
        addEmp(sim, 4);
      }
    }

    return s.life > 0 && s.y < VIEW_H + 20 && s.y > -40 && s.x > -40 && s.x < WORLD_W + 40;
  });
}

/** Flak markers: airburst when the fuse runs out. */
export function updateHazards(sim: Sim): void {
  const p = sim.player;
  compact(sim.hazards, (h) => {
    if (--h.timer > 0) return true;
    sim.emit({ type: 'airburst', x: h.x, y: h.y, r: h.r });
    if (p.invuln === 0 && Math.hypot(p.x + p.w / 2 - h.x, p.y + p.h / 2 - h.y) < h.r + 4) sim.damagePlayer(T.damage.flak, 'flak');
    return false;
  });
}

export function updateFlares(sim: Sim): void {
  compact(sim.flareObjs, (f) => {
    f.x += f.vx;
    f.y += f.vy;
    f.vx *= 0.96;
    return --f.life > 0;
  });
}
