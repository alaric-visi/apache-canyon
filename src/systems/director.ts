import type { Sim } from '../engine/sim';
import type { PickupKind } from '../entities/types';
import { TUNING as T } from '../gameplay/tuning';
import { WAVES } from '../content/waves/waves';
import { sectorDef, sectorProgress } from './course';
import { spawnHostile, spawnPickup } from './spawn';

/**
 * Spawn director for the current sector:
 *  - the sector's rule table (unlock times count from the sector start)
 *  - authored set pieces at fixed points through the sector
 *  - adaptive relief: right after the player takes a hit, or while shields are
 *    low, spawn timers run slower, so a bad moment doesn't snowball
 *  - endless laps tighten the pace
 *  - fuel depots, bridges and pickups
 */
export function updateDirector(sim: Sim): void {
  const def = sectorDef(sim);
  const c = sim.course;
  const t = c.sectorTick / 60;
  const boss = c.phase === 'boss';
  const pace = (1 - Math.min(T.director.paceMax, (t / T.director.paceSeconds) * T.director.paceMax)) * Math.pow(0.85, c.lap);
  const relief = sim.sinceHit < T.director.reliefTicks || sim.shields < sim.maxShields * 0.3 ? T.director.reliefRate : 1;

  if (c.phase !== 'clear') {
    for (const r of def.rules) {
      if (t < r.from) continue;
      if (boss && !r.duringBoss) continue;
      const key = r.kind;
      if (sim.spawnTimers[key] === undefined) sim.spawnTimers[key] = sim.rng.int(r.every[0]);
      sim.spawnTimers[key] -= relief;
      if (sim.spawnTimers[key] > 0) continue;
      let alive = 0;
      for (const h of sim.hostiles) if (h.kind === r.kind && h.group === 0) alive++;
      if (alive < r.max) spawnHostile(sim, r.kind);
      sim.spawnTimers[key] = sim.rng.range(r.every[0], r.every[1]) * pace * (boss ? 2 : 1);
    }
  }

  if (c.phase === 'run') {
    // authored set pieces
    const sp = def.setPieces[c.nextSetPiece];
    if (sp && sectorProgress(sim) >= sp.at) {
      WAVES[sp.wave]?.(sim);
      c.nextSetPiece++;
    }
    // depots and bridges, as Poisson-ish trickles per minute
    if (sim.rng.next() < def.depots / 3600) spawnHostile(sim, 'depot');
    if (sim.rng.next() < def.bridges / 3600 && !sim.features.some((f) => f.y < 120)) {
      sim.features.push({ id: sim.nextId++, kind: 'bridge', y: -40, py: -40, passed: false });
    }
  }

  sim.pickupSpawnTimer++;
  if (sim.pickupSpawnTimer > T.economy.pickupInterval) {
    const weights = Object.entries({ ...T.economy.pickups, ...(def.pickups ?? {}) }) as [PickupKind, number][];
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let r = sim.rng.next() * total;
    let kind: PickupKind = 'fuel';
    for (const [k, w] of weights) {
      if (r < w) { kind = k; break; }
      r -= w;
    }
    spawnPickup(sim, kind);
    sim.pickupSpawnTimer = 0;
  }
}
