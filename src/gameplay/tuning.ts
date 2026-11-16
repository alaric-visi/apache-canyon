import type { HostileKind, PickupKind } from '../entities/types';

/**
 * Every difficulty-relevant number in one place.
 *
 * It's a plain mutable object so the balance script can try variants without
 * editing code:  npx vite-node scripts/balance.ts --set economy.fuelBurn=0.025
 * Values are per fixed tick (60 Hz) unless noted.
 */

export interface SpawnRule {
  kind: HostileKind;
  /** Unlock time, seconds. */
  from: number;
  /** Respawn interval range, ticks. */
  every: [number, number];
  /** Max alive at once. */
  max: number;
  /** Still spawns while the gunship is on station. */
  duringBoss?: boolean;
}

export const TUNING = {
  player: {
    lives: 3,
    missiles: 10,
    flares: 3,
    maxFlares: 6,
    invulnTicks: 120,
    scrapeDamage: 0.5,
    /** After a real hit (≥5 damage), further hits are ignored for this many ticks (no burst stacking). */
    hurtGrace: 12,
    /**
     * Lateral speed multiplier = max(1, scrollSpeed / speed.start) ^ this.
     * ~1 keeps steep canyon sections followable at any speed (see scripts/balance.ts notes).
     */
    agilityExponent: 1,
  },

  speed: {
    /** Sector 1 base speed; each sector adds 0.22, each endless lap 0.4. */
    start: 2.5,
    max: 4.5,
    /** Within a sector the base speed rises by `step` every `every` ticks (max 3 steps). */
    step: 0.2,
    every: 1200,
    boost: 1.6,
  },

  economy: {
    fuelBurn: 0.025,
    boostFuelBurn: 0.05,
    pickupInterval: 210,
    /** Weights (normalised at use). */
    pickups: { fuel: 0.34, shield: 0.25, missile: 0.2, flare: 0.13, spread: 0.12 } as Record<PickupKind, number>,
    fuelPickup: 35,
    shieldPickup: 40,
    missilePickup: 5,
    flarePickup: 2,
    spreadTicks: 900,
  },

  /** Damage dealt to the player's shields. */
  damage: {
    droneShot: 8,
    gunnerShot: 10,
    turretShot: 10,
    tankShell: 20,
    sam: 30,
    gunshipBullet: 12,
    gunshipRocket: 20,
    flak: 15,
    mine: 25,
    gate: 15,
  },

  /** Body-contact (ram) damage; the rammer is destroyed too. */
  ram: {
    drone: 10,
    uav: 12,
    mine: 20,
    gunner: 20,
    gunship: 35,
  } as Record<string, number>,

  gate: {
    hp: 4,
    /** The beam cycles: on for `on` ticks, off for `off` (a gap you can time). */
    on: 90,
    off: 30,
  },

  uav: {
    /** Lateral acceleration toward the player's column. */
    steer: 0.03,
    maxVx: 2,
  },

  /** Enemy projectile speeds (units/tick). */
  shotSpeed: {
    drone: 2.6,
    gunner: 3.6,
    turret: 3.8,
    tank: 2.3,
    sam: 2.4,
    gunshipFan: 3,
    gunshipBurst: 4,
    rocket: 3,
  },

  /** Telegraph lengths (ticks). Longer = easier to read. */
  telegraph: {
    scout: 26,
    gunner: 45,
    turretAim: 55,
    turretLock: 14,
    mineFuse: 42,
    flakFuse: 62,
    samLock: 95,
    tank: 40,
  },

  director: {
    /** Intervals shrink by up to `paceMax` over `paceSeconds` within a sector. */
    paceMax: 0.3,
    paceSeconds: 600,
    /** After a real hit, spawn timers run at `reliefRate` for `reliefTicks`. */
    reliefTicks: 180,
    reliefRate: 0.55,
  },
};

export type Tuning = typeof TUNING;

/** Snapshot for resetting between experiments. */
export const DEFAULT_TUNING: Tuning = structuredClone(TUNING);

/** Set a dotted path, e.g. setTuning('economy.fuelBurn', 0.025). */
export function setTuning(path: string, value: unknown): void {
  const keys = path.split('.');
  let o: Record<string, unknown> = TUNING as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) {
    if (!(k in o)) throw new Error(`unknown tuning key: ${path}`);
    o = o[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (!(last in o)) throw new Error(`unknown tuning key: ${path}`);
  o[last] = value;
}

export function resetTuning(): void {
  const fresh = structuredClone(DEFAULT_TUNING);
  for (const k of Object.keys(fresh) as (keyof Tuning)[]) (TUNING as Record<string, unknown>)[k] = fresh[k];
}
