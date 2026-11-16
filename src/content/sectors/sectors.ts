import type { CanyonProfile } from '../../world/canyon';
import type { SpawnRule } from '../../gameplay/tuning';
import type { PickupKind } from '../../entities/types';

/**
 * The campaign: six sectors flown dusk → night → dawn. Each sector owns its
 * canyon shape, light, weather, enemy mix, authored set pieces and boss.
 * Everything here is data; systems/course.ts and systems/director.ts run it.
 */

export type BossKind = 'dustDevil' | 'dam' | 'train' | 'twinVipers' | 'radar' | 'sunhammer';

/** How a sector is lit. Colours are linear-ish RGB 0..1; the renderer blends presets between sectors. */
export interface LightPreset {
  /** Multiplies sunlit ground. */
  sun: [number, number, number];
  /** Tint of shadowed ground. */
  shadow: [number, number, number];
  /** Shadow length scale (low sun = long shadows). */
  shadowLen: number;
  /** Overall exposure. */
  exposure: number;
  /** Grade: added to dark tones / multiplied into bright tones. */
  gradeLow: [number, number, number];
  gradeHigh: [number, number, number];
  /** Corner sun glow colour and strength. */
  glow: [number, number, number];
  glowStrength: number;
  /** 0..1: darkness; the gunship's searchlight pools light around it. */
  night: number;
  /** 0..1: green night-vision grade. */
  nvg: number;
  /** 0..1: blowing sand: haze and reduced visibility. */
  dust: number;
}

export interface SetPiece {
  /** Fraction (0..1) of the sector's run where it triggers. */
  at: number;
  wave: string;
}

export interface SectorDef {
  id: string;
  name: string;
  subtitle: string;
  /** World distance of the run before the boss arrives. */
  length: number;
  canyon: CanyonProfile;
  light: LightPreset;
  /** Spawn rules; `from` is seconds since the sector started. */
  rules: SpawnRule[];
  setPieces: SetPiece[];
  boss: BossKind;
  bossName: string;
  /** Pickup weight overrides for this sector. */
  pickups?: Partial<Record<PickupKind, number>>;
  /** Fuel depots per minute (ground targets that drop fuel). */
  depots: number;
  /** Bridges across the canyon per minute (fly under for a bonus). */
  bridges: number;
}

const rule = (kind: SpawnRule['kind'], from: number, every: [number, number], max: number, duringBoss = false): SpawnRule => ({ kind, from, every, max, duringBoss });

export const SECTORS: SectorDef[] = [
  {
    id: 'red-mesa',
    name: 'RED MESA',
    subtitle: 'Late afternoon · wide canyon',
    length: 27600,
    canyon: { width: 340, amp: 0.85, narrow: 0.7, height: 0.8 },
    light: {
      sun: [1.12, 1.0, 0.86], shadow: [0.32, 0.25, 0.42], shadowLen: 0.7, exposure: 1.05,
      gradeLow: [0.08, 0.04, 0.12], gradeHigh: [1.05, 0.99, 0.9], glow: [1.0, 0.7, 0.35], glowStrength: 0.18,
      night: 0, nvg: 0, dust: 0,
    },
    rules: [
      rule('drone', 0, [100, 150], 3, true),
      rule('uav', 12, [180, 260], 2),
      rule('mine', 25, [260, 360], 2),
      rule('gunner', 40, [360, 500], 1),
    ],
    setPieces: [{ at: 0.3, wave: 'droneV' }, { at: 0.55, wave: 'depotRun' }, { at: 0.8, wave: 'gunnerPincer' }],
    boss: 'dustDevil',
    bossName: 'RIVAL GUNSHIP "DUST DEVIL"',
    depots: 0.75,
    bridges: 0.5,
  },
  {
    id: 'narrows',
    name: 'THE NARROWS',
    subtitle: 'Golden hour · deep shadow',
    length: 30000,
    canyon: { width: 240, amp: 1.1, narrow: 0.9, height: 1.35 },
    light: {
      sun: [1.15, 0.95, 0.75], shadow: [0.26, 0.19, 0.38], shadowLen: 1.25, exposure: 0.98,
      gradeLow: [0.1, 0.04, 0.16], gradeHigh: [1.08, 0.96, 0.82], glow: [1.0, 0.6, 0.25], glowStrength: 0.24,
      night: 0, nvg: 0, dust: 0,
    },
    rules: [
      rule('drone', 0, [110, 160], 3, true),
      rule('turret', 5, [240, 340], 2),
      rule('gunner', 20, [340, 480], 1),
      rule('gate', 30, [700, 1000], 1),
      rule('mine', 40, [300, 400], 2),
    ],
    setPieces: [{ at: 0.25, wave: 'turretAlley' }, { at: 0.6, wave: 'mineField' }, { at: 0.85, wave: 'turretAlley' }],
    boss: 'dam',
    bossName: 'FORTIFIED DAM',
    depots: 0.45,
    bridges: 1,
  },
  {
    id: 'dry-lake',
    name: 'DRY LAKE',
    subtitle: 'Sunset · open flats',
    length: 32200,
    canyon: { width: 470, amp: 0.55, narrow: 0.55, height: 0.55 },
    light: {
      sun: [1.18, 0.92, 0.72], shadow: [0.3, 0.2, 0.36], shadowLen: 1.0, exposure: 1.0,
      gradeLow: [0.12, 0.04, 0.12], gradeHigh: [1.1, 0.94, 0.8], glow: [1.0, 0.55, 0.3], glowStrength: 0.3,
      night: 0, nvg: 0, dust: 0,
    },
    rules: [
      rule('drone', 0, [100, 150], 3, true),
      rule('tank', 6, [380, 520], 2),
      rule('flak', 25, [500, 660], 1),
      rule('uav', 10, [200, 280], 2),
      rule('gunner', 35, [380, 520], 1),
    ],
    setPieces: [{ at: 0.2, wave: 'tankColumn' }, { at: 0.5, wave: 'depotRun' }, { at: 0.75, wave: 'tankColumn' }],
    boss: 'train',
    bossName: 'ARMOURED TRAIN "IRON MULE"',
    depots: 1.8,
    bridges: 0.3,
  },
  {
    id: 'sandstorm',
    name: 'SANDSTORM PASS',
    subtitle: 'Dusk · visibility falling',
    length: 30000,
    canyon: { width: 300, amp: 1.0, narrow: 1.0, height: 1.0 },
    light: {
      sun: [0.95, 0.78, 0.6], shadow: [0.36, 0.27, 0.3], shadowLen: 0.6, exposure: 0.92,
      gradeLow: [0.12, 0.07, 0.06], gradeHigh: [1.04, 0.92, 0.78], glow: [0.9, 0.6, 0.35], glowStrength: 0.12,
      night: 0, nvg: 0, dust: 0.85,
    },
    rules: [
      rule('drone', 0, [110, 160], 3, true),
      rule('uav', 0, [200, 280], 2),
      rule('mine', 10, [240, 340], 3, true),
      rule('sam', 20, [520, 720], 1),
      rule('gunner', 30, [380, 520], 1),
    ],
    setPieces: [{ at: 0.3, wave: 'samTrap' }, { at: 0.65, wave: 'mineField' }],
    pickups: { flare: 0.25 },
    boss: 'twinVipers',
    bossName: 'TWIN GUNSHIPS "VIPER PAIR"',
    depots: 0.75,
    bridges: 0.4,
  },
  {
    id: 'night',
    name: 'NIGHT RUN',
    subtitle: 'Night · NVG on',
    length: 30000,
    canyon: { width: 280, amp: 1.0, narrow: 0.95, height: 1.1 },
    light: {
      sun: [0.55, 0.65, 0.9], shadow: [0.18, 0.2, 0.34], shadowLen: 0.4, exposure: 0.85,
      gradeLow: [0.02, 0.05, 0.1], gradeHigh: [0.9, 1.0, 1.1], glow: [0.4, 0.5, 0.9], glowStrength: 0.08,
      night: 0.75, nvg: 0.55, dust: 0,
    },
    rules: [
      rule('drone', 0, [110, 160], 3, true),
      rule('turret', 5, [280, 380], 2),
      rule('sam', 15, [560, 760], 1),
      rule('flak', 25, [440, 600], 1),
      rule('gunner', 30, [380, 520], 1),
      rule('gate', 45, [800, 1100], 1),
    ],
    setPieces: [{ at: 0.25, wave: 'samTrap' }, { at: 0.55, wave: 'turretAlley' }, { at: 0.8, wave: 'gunnerPincer' }],
    boss: 'radar',
    bossName: 'RADAR COMPLEX "OVERWATCH"',
    depots: 0.9,
    bridges: 0.6,
  },
  {
    id: 'dawn',
    name: 'DAWN STRIKE',
    subtitle: 'Sunrise · everything they have',
    length: 32200,
    canyon: { width: 300, amp: 1.05, narrow: 1.0, height: 1.0 },
    light: {
      sun: [1.12, 0.92, 0.95], shadow: [0.3, 0.26, 0.45], shadowLen: 1.1, exposure: 1.08,
      gradeLow: [0.06, 0.04, 0.14], gradeHigh: [1.06, 0.98, 1.0], glow: [1.0, 0.7, 0.75], glowStrength: 0.26,
      night: 0, nvg: 0, dust: 0,
    },
    rules: [
      rule('drone', 0, [100, 150], 3, true),
      rule('gunner', 5, [340, 460], 2),
      rule('turret', 10, [280, 380], 2),
      rule('tank', 20, [440, 600], 1),
      rule('sam', 30, [560, 760], 1),
      rule('flak', 40, [460, 620], 1),
      rule('uav', 15, [200, 280], 2),
      rule('gate', 50, [800, 1100], 1),
    ],
    setPieces: [{ at: 0.2, wave: 'gunnerPincer' }, { at: 0.45, wave: 'tankColumn' }, { at: 0.7, wave: 'samTrap' }, { at: 0.9, wave: 'droneV' }],
    boss: 'sunhammer',
    bossName: 'HEAVY GUNSHIP "SUNHAMMER"',
    depots: 0.9,
    bridges: 0.5,
  },
];
