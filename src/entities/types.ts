export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pure data shapes. Behaviour lives in systems/. `px`/`py` are last-tick positions for render interpolation. */
export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  py: number;
}

export type HostileKind =
  | 'drone'    // scout: weaves, single slow aimed shots
  | 'uav'      // diver: swings toward the player, rams
  | 'mine'     // proximity: arms then detonates
  | 'gunner'   // hovers, red glint, then 3-round burst
  | 'turret'   // wall-mounted, laser sight, then aimed burst
  | 'flak'     // floor emplacement, marks the ground, delayed airburst
  | 'sam'      // floor site, lock-on tone, heat-seeker (flares!)
  | 'tank'     // armour on the canyon floor, slow shells
  | 'gunship'  // rival gunship mini-boss
  | 'gate'     // barrier generator node; the beam spans the corridor
  // Phase 4
  | 'depot'    // fuel depot on the canyon floor: shoot it for fuel
  | 'dam'      // boss: fortified dam wall (core)
  | 'sluice'   // boss part: dam sluice gate (weak point)
  | 'traincar' // boss part: armoured train wagon with a turret
  | 'engine'   // boss: armoured train locomotive (core)
  | 'dish'     // boss: radar dish (core, shielded)
  | 'shieldgen'; // boss part: shield generator

export type PickupKind = 'fuel' | 'shield' | 'missile' | 'flare' | 'spread';

export interface Hostile extends Body {
  id: number;
  kind: HostileKind;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  flash: number;
  pulse: number;
  /** Behaviour state machine (meaning depends on kind). */
  state: number;
  timer: number;
  /** Telegraph progress 0..1 for the renderer (charge-up, lock, arming). */
  charge: number;
  /** Aim angle in radians (0 = +x), for turrets/barrels and laser sights. */
  aim: number;
  /** Shots remaining in the current burst. */
  burst: number;
  /** Attack cycles completed. */
  cycles: number;
  /** Scratch: length of the current wind-up (for charge 0..1). */
  burst2: number;
  /** -1 left wall, +1 right wall (turrets, gate node). */
  side: number;
  /** Ground-anchored: scrolls with the canyon floor. */
  ground: boolean;
  /** Boss group id (0 = not part of a boss). Parts move with their core. */
  group: number;
  /** Offset from the group anchor (boss parts). */
  ox: number;
  oy: number;
  /** Behaviour variant (e.g. Sunhammer vs Dust Devil for 'gunship'). */
  variant: number;
  /** Takes no damage while true (shielded boss cores). */
  shielded: boolean;
}

/** Scenery the player interacts with but can't shoot. */
export interface Feature {
  id: number;
  kind: 'bridge';
  y: number;
  py: number;
  /** Bonus already awarded for flying under it. */
  passed: boolean;
}

export type ShotKind = 'bullet' | 'shell' | 'sam' | 'rocket';

export interface Shot extends Body {
  id: number;
  kind: ShotKind;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  /** Near-miss already awarded. */
  grazed: boolean;
  /** Homing: flare id it has been decoyed onto, or null to chase the player. */
  decoy: number | null;
  /** Which hostile kind fired it (analytics / debrief). */
  source: string;
}

/** Flak: a ground marker that airbursts when its timer runs out. */
export interface Hazard {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  timer: number;
  maxTimer: number;
}

export interface Flare extends Body {
  id: number;
  vx: number;
  vy: number;
  life: number;
}

export interface Bullet extends Body {
  vx: number;
  vy: number;
}

export interface Missile extends Body {
  vx: number;
  vy: number;
  targetId: number | null;
}

export interface Pickup extends Body {
  kind: PickupKind;
  vy: number;
  rot: number;
}

export interface Player extends Body {
  speed: number;
  /** Ticks of invulnerability remaining after a respawn. */
  invuln: number;
  /** Damage flash ticks. */
  flash: number;
  /** Ticks during which further real hits are ignored. */
  hurtGrace: number;
  /** Muzzle flash ticks. */
  muzzle: number;
  fireCooldown: number;
  /** Chain-gun heat 0..100; at 100 the gun locks until it vents to VENT_TO. */
  heat: number;
  overheated: boolean;
  fireHeld: boolean;
  /** Ticks the missile button has been held (lock-on painting). */
  missileHold: number;
  missileHeld: boolean;
  /** Hostile ids painted for a ripple launch. */
  locks: number[];
  /** Missiles queued to ripple-fire (target ids). */
  ripple: number[];
  rippleTimer: number;
  flareCooldown: number;
  /** Ticks of spread-gun power-up remaining. */
  spread: number;
  boosting: boolean;
  /** -1 steering left, 0 none, 1 right (used by the renderer for banking). */
  steer: number;
}

export interface SimInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  missile: boolean;
  flare: boolean;
  emp: boolean;
  boost: boolean;
}

export const NO_INPUT: SimInput = { left: false, right: false, up: false, down: false, fire: false, missile: false, flare: false, emp: false, boost: false };
export const newInput = (): SimInput => ({ ...NO_INPUT });

export type SimEvent =
  | { type: 'shoot'; x: number; y: number }
  | { type: 'missile'; x: number; y: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'explode'; x: number; y: number; particles: number; big: boolean; shake: number; damage?: boolean }
  | { type: 'pickup'; x: number; y: number; kind: PickupKind }
  | { type: 'scrape'; x: number; y: number }
  | { type: 'playerHit'; x: number; y: number; cause: string }
  | { type: 'lifeLost' }
  | { type: 'gameOver' }
  | { type: 'alarm' }
  // Phase 3
  | { type: 'enemyShot'; x: number; y: number; kind: ShotKind }
  | { type: 'telegraph'; x: number; y: number; kind: HostileKind }
  | { type: 'lockStart' }
  | { type: 'lockEnd' }
  | { type: 'samLaunch'; x: number; y: number }
  | { type: 'flakMark'; x: number; y: number }
  | { type: 'airburst'; x: number; y: number; r: number }
  | { type: 'flare'; x: number; y: number }
  | { type: 'decoyed'; x: number; y: number }
  | { type: 'paint'; x: number; y: number; count: number }
  | { type: 'overheat' }
  | { type: 'coolPerfect'; x: number; y: number }
  | { type: 'block'; x: number; y: number }
  | { type: 'emp'; x: number; y: number }
  | { type: 'score'; x: number; y: number; amount: number; label?: string }
  | { type: 'combo'; mult: number }
  | { type: 'comboBreak' }
  | { type: 'bossEnter'; name?: string }
  | { type: 'bossDown'; name?: string; escaped?: boolean }
  // Phase 4
  | { type: 'sectorStart'; index: number; name: string; subtitle: string }
  | { type: 'sectorClear'; index: number; name: string }
  | { type: 'runComplete' }
  | { type: 'shieldDown'; x: number; y: number }
  | { type: 'bridge'; x: number; y: number }
  | { type: 'depot'; x: number; y: number };
