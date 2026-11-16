import type { HostileKind } from '../../entities/types';

/**
 * Data-driven hostile definitions. Adding an enemy type means an entry here,
 * a behaviour in systems/enemyAI.ts and a draw routine; collision, damage and
 * scoring are shared. Damage the enemy deals lives in gameplay/tuning.ts.
 */
export interface HostileDef {
  w: number;
  h: number;
  hp: number;
  /** Own vertical speed (screen space). Ground units add the scroll speed on top. */
  vy: number;
  /** Spawn horizontal speed is uniform in [-vxSpread/2, vxSpread/2]. */
  vxSpread: number;
  score: number;
  /** Damage a missile deals. Infinity = always destroys. */
  missileDamage: number;
  particles: number;
  bigExplosion: boolean;
  shake: number;
  /** Bounce off canyon walls instead of clipping into rock. */
  bounces: boolean;
  /** Anchored to the canyon floor/walls; scrolls with the ground. */
  ground: boolean;
  /** EMP charge awarded on kill. */
  emp: number;
}

const air = { ground: false, bounces: true } as const;
const grd = { ground: true, bounces: false, vxSpread: 0 } as const;

export const HOSTILES: Record<HostileKind, HostileDef> = {
  drone:   { ...air, w: 16, h: 16, hp: 2, vy: 1.5, vxSpread: 1.5, score: 200, missileDamage: Infinity, particles: 12, bigExplosion: false, shake: 4, emp: 6 },
  uav:     { ...air, w: 16, h: 16, hp: 3, vy: 1.8, vxSpread: 1.0, score: 300, missileDamage: Infinity, particles: 18, bigExplosion: true, shake: 6, emp: 8 },
  mine:    { ...air, w: 16, h: 16, hp: 1, vy: 0.5, vxSpread: 1.0, score: 100, missileDamage: Infinity, particles: 12, bigExplosion: false, shake: 4, emp: 4 },
  gunner:  { ...air, w: 18, h: 18, hp: 4, vy: 2.2, vxSpread: 0, score: 400, missileDamage: Infinity, particles: 16, bigExplosion: true, shake: 6, emp: 10 },
  gunship: { ...air, w: 30, h: 30, hp: 70, vy: 1.6, vxSpread: 0, score: 3000, missileDamage: 6, particles: 40, bigExplosion: true, shake: 14, emp: 40 },
  turret:  { ...grd, w: 14, h: 14, hp: 4, vy: 0, score: 350, missileDamage: Infinity, particles: 14, bigExplosion: false, shake: 5, emp: 8 },
  flak:    { ...grd, w: 16, h: 16, hp: 5, vy: 0, score: 450, missileDamage: Infinity, particles: 16, bigExplosion: true, shake: 6, emp: 10 },
  sam:     { ...grd, w: 18, h: 18, hp: 5, vy: 0, score: 600, missileDamage: Infinity, particles: 20, bigExplosion: true, shake: 7, emp: 12 },
  tank:    { ...grd, w: 18, h: 22, hp: 8, vy: -0.6, score: 700, missileDamage: 5, particles: 22, bigExplosion: true, shake: 8, emp: 14 },
  depot:   { ...grd, w: 18, h: 18, hp: 3, vy: 0, score: 150, missileDamage: Infinity, particles: 22, bigExplosion: true, shake: 6, emp: 4 },
  dam:     { ...grd, w: 300, h: 28, hp: 90, vy: 0, score: 5000, missileDamage: 6, particles: 60, bigExplosion: true, shake: 16, emp: 30 },
  sluice:  { ...grd, w: 18, h: 12, hp: 14, vy: 0, score: 500, missileDamage: 5, particles: 18, bigExplosion: true, shake: 8, emp: 8 },
  traincar:{ ...grd, w: 20, h: 34, hp: 14, vy: 0, score: 600, missileDamage: 6, particles: 24, bigExplosion: true, shake: 8, emp: 10 },
  engine:  { ...grd, w: 22, h: 40, hp: 75, vy: 0, score: 5000, missileDamage: 6, particles: 50, bigExplosion: true, shake: 16, emp: 30 },
  dish:    { ...grd, w: 36, h: 36, hp: 70, vy: 0, score: 6000, missileDamage: 6, particles: 50, bigExplosion: true, shake: 16, emp: 30 },
  shieldgen: { ...grd, w: 14, h: 14, hp: 14, vy: 0, score: 500, missileDamage: 6, particles: 16, bigExplosion: true, shake: 6, emp: 8 },
  gate:    { ...grd, w: 12, h: 12, hp: 6, vy: 0, score: 400, missileDamage: Infinity, particles: 22, bigExplosion: true, shake: 8, emp: 10 },
};

/** Units that can be painted for a missile lock / are worth homing on. */
export const isTargetable = (kind: HostileKind) => kind !== 'mine';
