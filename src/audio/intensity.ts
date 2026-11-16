import type { Sim } from '../engine/sim';

/**
 * How intense the moment is, 0..1, from the sim state. Drives the adaptive
 * score. Pure (reads only), so it can be unit-tested.
 */
export function rawIntensity(sim: Sim): number {
  if (sim.bossState) return 1;
  let threat = 0;
  for (const h of sim.hostiles) if (h.y > -10) threat += h.kind === 'drone' || h.kind === 'mine' || h.kind === 'depot' ? 0.07 : 0.14;
  threat += sim.enemyShots.length * 0.03 + sim.hazards.length * 0.08 + sim.samLock * 0.3;
  const danger = sim.shields < sim.maxShields * 0.3 ? 0.25 : 0;
  const chain = Math.min(0.2, (sim.combo.mult - 1) * 0.08);
  // later sectors sit higher even when quiet
  const base = 0.12 + sim.course.sector * 0.04;
  return Math.max(0, Math.min(1, base + threat + danger + chain));
}

/** Smooth toward the raw value: quick to rise, slow to fall (music shouldn't flap). */
export function smoothIntensity(prev: number, raw: number): number {
  const k = raw > prev ? 0.04 : 0.006;
  return prev + (raw - prev) * k;
}
