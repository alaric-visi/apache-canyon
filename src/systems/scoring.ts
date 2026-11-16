import type { Sim } from '../engine/sim';

export const COMBO_WINDOW = 180;
const MAX_MULT = 5;
const GRAZE_ZONE = 16;
const GRAZE_INTERVAL = 10;
const GRAZE_POINTS = 20;
export const NEAR_MISS_POINTS = 50;

export function multFor(count: number): number {
  return Math.min(MAX_MULT, 1 + Math.floor(count / 4) * 0.5);
}

/** Award points scaled by the combo multiplier, with an on-screen popup. */
export function award(sim: Sim, base: number, x: number, y: number, label?: string): number {
  const amount = Math.round(base * sim.combo.mult);
  sim.score += amount;
  sim.emit({ type: 'score', x, y, amount, label });
  return amount;
}

/** Extend the chain (a kill or near-miss). */
export function bumpCombo(sim: Sim, n = 1): void {
  const c = sim.combo;
  const before = c.mult;
  c.count += n;
  c.timer = COMBO_WINDOW;
  c.mult = multFor(c.count);
  if (c.mult > before) sim.emit({ type: 'combo', mult: c.mult });
}

/** Keep the chain alive without growing it (grazing). */
export function refreshCombo(sim: Sim): void {
  if (sim.combo.count > 0) sim.combo.timer = Math.max(sim.combo.timer, 60);
}

export function breakCombo(sim: Sim): void {
  const c = sim.combo;
  if (c.count >= 4) sim.emit({ type: 'comboBreak' });
  c.count = 0;
  c.timer = 0;
  c.mult = 1;
}

export function addEmp(sim: Sim, amount: number): void {
  sim.emp = Math.min(100, sim.emp + amount);
}

/** Per-tick: combo decay, wall grazing, distance score. */
export function updateScoring(sim: Sim): void {
  const c = sim.combo;
  if (c.timer > 0 && --c.timer === 0) breakCombo(sim);

  // grazing: flying within GRAZE_ZONE of the rock without scraping it
  const p = sim.player;
  const cor = sim.corridorAt(p.y + p.h / 2);
  const gap = Math.min(p.x - (cor.left + 10), cor.right - 10 - (p.x + p.w));
  if (gap > 2 && gap < GRAZE_ZONE && p.invuln === 0) {
    sim.grazeTicks++;
    sim.stats.grazeTicks++;
    addEmp(sim, 0.25);
    refreshCombo(sim);
    if (sim.grazeTicks % GRAZE_INTERVAL === 0) {
      const leftSide = p.x - cor.left < cor.right - (p.x + p.w);
      award(sim, GRAZE_POINTS, leftSide ? p.x - 6 : p.x + p.w + 6, p.y, 'GRAZE');
    }
  } else {
    sim.grazeTicks = 0;
  }

  // distance score: 1 point per 20 units flown (boosting earns faster)
  sim.distScoreAcc += sim.scrollSpeed;
  while (sim.distScoreAcc >= 20) {
    sim.distScoreAcc -= 20;
    sim.score += Math.round(sim.combo.mult);
  }
}
