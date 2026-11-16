import type { Sim } from '../../engine/sim';
import type { HostileKind } from '../../entities/types';
import { HOSTILES } from '../../gameplay/enemies/defs';
import { makeHostile } from '../../systems/spawn';
import { GATE_NODE_INSET } from '../../systems/spawn';

/**
 * Authored set pieces: formations that land at fixed points in a sector, as
 * deliberate moments between the director's random spawns. Positions are
 * fractions across the corridor (0 = left wall, 1 = right wall) at a row above
 * the screen, so formations always fit whatever canyon they spawn in.
 */

type Place = { kind: HostileKind; f: number; dy: number; side?: number; timer?: number };

function place(sim: Sim, items: Place[]): void {
  for (const it of items) {
    const def = HOSTILES[it.kind];
    const y = -def.h - 10 - it.dy;
    const c = sim.corridorAt(y + def.h / 2);
    const pad = 16;
    let x: number;
    if (it.kind === 'turret') x = it.side! < 0 ? c.left + 1 : c.right - def.w - 1;
    else if (it.kind === 'gate') x = it.side! < 0 ? c.left + GATE_NODE_INSET : c.right - def.w - GATE_NODE_INSET;
    else x = c.left + pad + (c.right - c.left - 2 * pad - def.w) * it.f;
    const h = makeHostile(sim, it.kind, x, y);
    if (it.side) h.side = it.side;
    if (it.timer !== undefined) h.timer = it.timer;
    h.vx = 0;
    sim.hostiles.push(h);
  }
}

export const WAVES: Record<string, (sim: Sim) => void> = {
  /** Five scouts in a V, staggered fire. */
  droneV: (sim) => place(sim, [0.5, 0.35, 0.65, 0.2, 0.8].map((f, i) => ({ kind: 'drone' as const, f, dy: Math.ceil(i / 2) * 26, timer: 60 + i * 18 }))),
  /** A field of mines with a clear lane that shifts sides. */
  mineField: (sim) => {
    const lane = sim.rng.next() < 0.5 ? 0.25 : 0.75;
    const items: Place[] = [];
    for (let r = 0; r < 3; r++)
      for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) if (Math.abs(f - (r === 1 ? 1 - lane : lane)) > 0.15) items.push({ kind: 'mine', f, dy: r * 70 });
    place(sim, items);
  },
  /** Turrets down alternating walls: weave between their sight lines. */
  turretAlley: (sim) => place(sim, [0, 1, 2, 3].map((i) => ({ kind: 'turret' as const, f: 0, dy: i * 90, side: i % 2 ? 1 : -1, timer: 20 + i * 25 }))),
  /** Two gunners drop in on both flanks at once. */
  gunnerPincer: (sim) => place(sim, [{ kind: 'gunner', f: 0.12, dy: 0 }, { kind: 'gunner', f: 0.88, dy: 0 }]),
  /** Three tanks nose to tail up the canyon floor. */
  tankColumn: (sim) => place(sim, [0, 1, 2].map((i) => ({ kind: 'tank' as const, f: 0.5 + (i - 1) * 0.12, dy: i * 46, timer: 80 + i * 30 }))),
  /** A SAM site covered by two flak guns. */
  samTrap: (sim) => place(sim, [{ kind: 'sam', f: 0.5, dy: 20, timer: 10 }, { kind: 'flak', f: 0.15, dy: 0 }, { kind: 'flak', f: 0.85, dy: 40 }]),
  /** Fuel depots guarded by scouts: a reward for flying aggressively. */
  depotRun: (sim) => place(sim, [
    { kind: 'depot', f: 0.2, dy: 0 }, { kind: 'depot', f: 0.8, dy: 60 }, { kind: 'depot', f: 0.5, dy: 120 },
    { kind: 'drone', f: 0.5, dy: 30 }, { kind: 'drone', f: 0.3, dy: 140 },
  ]),
};
