import { Rng } from '../core/rng';
import { Canyon, Corridor, VIEW_H, WORLD_W } from '../world/canyon';
import type { Bullet, Feature, Flare, Hazard, Hostile, HostileKind, Missile, Pickup, Player, Shot, SimEvent, SimInput } from '../entities/types';
import { SpatialHash } from '../systems/spatial';
import { updatePlayer } from '../systems/player';
import { updateDirector } from '../systems/director';
import { updateProjectiles, updateHostileCollisions, updatePickups } from '../systems/combat';
import { updateEnemies } from '../systems/enemyAI';
import { updateShots, updateHazards, updateFlares } from '../systems/shots';
import { breakCombo, updateScoring } from '../systems/scoring';
import { courseBaseSpeed, newCourse, profileAt, startCourse, updateCourse, type CourseState, type RunMode } from '../systems/course';
import type { BossState } from '../gameplay/bosses/bosses';
import { TUNING as T } from '../gameplay/tuning';
import { AIRFRAMES, DEFAULT_LOADOUT, type Airframe, type Loadout } from '../content/hangar';

import { PLAYER_Y } from '../gameplay/flight';
export { PLAYER_Y, PLAYER_Y_MIN, PLAYER_Y_MAX } from '../gameplay/flight';
/** @deprecated read TUNING.player.invulnTicks; kept for tests. */
export const INVULN_TICKS = T.player.invulnTicks;
/** Scroll speed while a ground boss holds the canyon (dam, radar): the gunship hovers. */
const HOLD_SPEED = 0;

export type SimStatus = 'running' | 'over' | 'complete';

export interface Combo {
  /** Kills (and near-misses) chained without the timer running out or taking damage. */
  count: number;
  /** Ticks left before the chain drops. */
  timer: number;
  mult: number;
}

export interface RunOptions {
  mode: RunMode;
  /** Practice: which sector to fly. */
  startSector: number;
  loadout: Loadout;
  /** Assist mode: slower flight, no wall damage, an extra life, slower enemy fire. */
  assist: boolean;
}

/** Everything the debrief needs. All deterministic. */
export interface RunStats {
  shotsFired: number;
  shotsHit: number;
  missilesFired: number;
  kills: Partial<Record<HostileKind, number>>;
  grazeTicks: number;
  nearMisses: number;
  flaresUsed: number;
  empsUsed: number;
  damageTaken: number;
  sectorsCleared: number;
  bossesDefeated: number;
  /** Boss group ids whose core the player destroyed. */
  bossKills: number[];
  untouchedSectors: number;
  bridges: number;
}

const newStats = (): RunStats => ({
  shotsFired: 0, shotsHit: 0, missilesFired: 0, kills: {}, grazeTicks: 0, nearMisses: 0, flaresUsed: 0, empsUsed: 0,
  damageTaken: 0, sectorsCleared: 0, bossesDefeated: 0, bossKills: [], untouchedSectors: 0, bridges: 0,
});

/**
 * The whole game simulation. Headless: no DOM, no audio, no Math.random.
 * Call `step(input)` once per fixed tick; read `events` afterwards for
 * audio/FX, then clear them.
 */
export class Sim {
  readonly rng: Rng;
  readonly canyon: Canyon;
  readonly events: SimEvent[] = [];
  readonly hostileGrid = new SpatialHash<Hostile>(64);
  readonly options: RunOptions;
  readonly airframe: Airframe;

  status: SimStatus = 'running';
  tick = 0;
  /** World distance travelled. Row y on screen is world distance `dist + (VIEW_H - y)`. */
  dist = 0;
  prevDist = 0;
  /** Difficulty speed for the current sector. `scrollSpeed` eases toward this (+ boost). */
  baseSpeed = T.speed.start;
  scrollSpeed = T.speed.start;

  score = 0;
  lives = T.player.lives;
  fuel = 100;
  maxShields = 100;
  shields = 100;
  missiles = T.player.missiles;
  flares = T.player.flares;
  /** EMP charge 0..100. */
  emp = 0;
  combo: Combo = { count: 0, timer: 0, mult: 1 };
  /** Ticks spent continuously grazing a wall. */
  grazeTicks = 0;
  /** Accumulated distance for distance score. */
  distScoreAcc = 0;
  /** Ticks since the player last took a real hit (the director eases off right after). */
  sinceHit = 9999;

  course: CourseState;
  bossState: BossState | null = null;
  stats: RunStats = newStats();
  /** Loadout-derived modifiers. */
  mods = { agility: 1, heat: 1, coolWiden: 0, fuelBurn: 1, magnet: 0 };

  player: Player;
  hostiles: Hostile[] = [];
  bullets: Bullet[] = [];
  playerMissiles: Missile[] = [];
  pickups: Pickup[] = [];
  enemyShots: Shot[] = [];
  hazards: Hazard[] = [];
  flareObjs: Flare[] = [];
  features: Feature[] = [];

  /** Director state. */
  spawnTimers: Record<string, number> = {};
  pickupSpawnTimer = 0;
  nextId = 1;

  private readonly scratch: Corridor = { left: 0, right: 0 };

  constructor(readonly seed: number, opts: Partial<RunOptions> = {}) {
    this.options = { mode: opts.mode ?? 'endless', startSector: opts.startSector ?? 0, loadout: opts.loadout ?? DEFAULT_LOADOUT, assist: opts.assist ?? false };
    this.rng = new Rng(seed);
    this.canyon = new Canyon(seed);
    this.course = newCourse(this.options.mode, this.options.startSector);
    this.canyon.profileAt = (d) => profileAt(this.course, d);

    // loadout
    this.airframe = AIRFRAMES[this.options.loadout.airframe] ?? AIRFRAMES.apache;
    this.maxShields = this.shields = this.airframe.maxShields;
    if (this.options.assist) this.lives += 1;
    this.missiles = this.airframe.missiles;
    this.mods.agility = this.airframe.agility;
    this.mods.heat = this.airframe.heat;
    for (const perk of this.options.loadout.perks) {
      if (perk === 'flarePack') this.flares += 2;
      if (perk === 'missileRack') this.missiles += 5;
      if (perk === 'coolant') this.mods.coolWiden = 10;
      if (perk === 'reserveTank') this.mods.fuelBurn = 0.88;
      if (perk === 'magnet') this.mods.magnet = 70;
    }

    this.player = {
      x: 0, y: PLAYER_Y, w: 16, h: 16, px: 0, py: PLAYER_Y,
      speed: 4, invuln: 0, flash: 0, hurtGrace: 0, muzzle: 0, fireCooldown: 0,
      heat: 0, overheated: false, fireHeld: false,
      missileHold: 0, missileHeld: false, locks: [], ripple: [], rippleTimer: 0,
      flareCooldown: 0, spread: 0, boosting: false, steer: 0,
    };
    this.centerPlayer();
    this.baseSpeed = this.scrollSpeed = courseBaseSpeed(this);
    startCourse(this);
  }

  get timeSeconds(): number {
    return Math.floor(this.tick / 60);
  }

  /** The boss currently on station (its core, or the first gunship), if any. */
  get boss(): Hostile | undefined {
    const b = this.bossState;
    if (!b) return undefined;
    return this.hostiles.find((h) => h.group === b.group && h.kind === b.core);
  }

  /** Summed health of the whole boss formation, for the boss bar. */
  get bossBar(): { name: string; hp: number; maxHp: number; shielded: boolean } | null {
    const b = this.bossState;
    if (!b) return null;
    let hp = 0, maxHp = 0, shielded = false;
    for (const h of this.hostiles) if (h.group === b.group) { hp += Math.max(0, h.hp); maxHp += h.maxHp; shielded ||= h.shielded; }
    return { name: b.name, hp, maxHp: Math.max(1, maxHp), shielded };
  }

  /** 0..1: strongest SAM lock currently building on the player (0 = none). */
  get samLock(): number {
    let m = 0;
    for (const h of this.hostiles) if (h.kind === 'sam' && h.state === 1) m = Math.max(m, h.charge);
    return m;
  }

  /** World distance at screen row y. */
  distAt(y: number): number {
    return this.dist + (VIEW_H - y);
  }

  /** Corridor at screen row y. The returned object is shared scratch; copy if you need to keep it. */
  corridorAt(y: number, out: Corridor = this.scratch): Corridor {
    return this.canyon.at(this.distAt(y), out);
  }

  centerPlayer(): void {
    const c = this.corridorAt(this.player.y + this.player.h / 2);
    this.player.x = this.player.px = (c.left + c.right) / 2 - this.player.w / 2;
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  step(input: SimInput): void {
    if (this.status !== 'running') return;
    this.tick++;
    this.sinceHit++;

    // snapshot positions for render interpolation
    this.prevDist = this.dist;
    const p = this.player;
    p.px = p.x; p.py = p.y;
    for (const list of [this.hostiles, this.bullets, this.playerMissiles, this.pickups, this.enemyShots, this.flareObjs] as { x: number; y: number; px: number; py: number }[][])
      for (const b of list) { b.px = b.x; b.py = b.y; }
    for (const hz of this.hazards) { hz.px = hz.x; hz.py = hz.y; }
    for (const f of this.features) f.py = f.y;

    // speed: sector base plus boost, eased; bosses that hold position slow the scroll
    this.baseSpeed = courseBaseSpeed(this) * (this.options.assist ? 0.8 : 1);
    p.boosting = input.boost && this.fuel > 5;
    const target = this.bossState?.hold ? HOLD_SPEED : this.baseSpeed + (p.boosting ? T.speed.boost : 0);
    this.scrollSpeed += (target - this.scrollSpeed) * 0.06;
    this.dist += this.scrollSpeed;

    updatePlayer(this, input);
    if (this.status !== 'running') return;
    updateProjectiles(this);
    updateCourse(this);
    if (this.status !== 'running') return;
    updateDirector(this);
    updateEnemies(this);
    updateShots(this);
    if (this.status !== 'running') return;
    updateHazards(this);
    if (this.status !== 'running') return;
    updateHostileCollisions(this);
    if (this.status !== 'running') return;
    updatePickups(this);
    updateFlares(this);
    updateFeatures(this);
    updateScoring(this);

    this.fuel -= (T.economy.fuelBurn + (p.boosting ? T.economy.boostFuelBurn : 0)) * this.mods.fuelBurn;
    if (this.fuel <= 0) this.loseLife();

    if ((this.fuel < 25 || this.shields < this.maxShields * 0.25) && this.tick % 40 === 0) this.emit({ type: 'alarm' });
  }

  /** Apply damage to the player's shields. Ignored while invulnerable. Returns true if applied. */
  damagePlayer(amount: number, cause = 'unknown'): boolean {
    if (this.player.invuln > 0 || this.status !== 'running') return false;
    if (amount >= 5) {
      if (this.player.hurtGrace > 0) return false;
      this.player.hurtGrace = T.player.hurtGrace;
    }
    this.shields -= amount;
    this.stats.damageTaken += amount;
    this.course.sectorDamage += amount;
    if (amount >= 5) {
      this.sinceHit = 0;
      this.player.flash = 6;
      this.emit({ type: 'playerHit', x: this.player.x + this.player.w / 2, y: this.player.y + this.player.h / 2, cause });
      breakCombo(this);
    }
    if (this.shields <= 0) this.loseLife();
    return true;
  }

  loseLife(): void {
    this.lives--;
    this.emit({ type: 'lifeLost' });
    breakCombo(this);
    if (this.lives <= 0) {
      this.lives = 0;
      this.shields = Math.max(0, this.shields);
      this.status = 'over';
      this.emit({ type: 'gameOver' });
      return;
    }
    this.shields = this.maxShields;
    this.fuel = 100;
    // Replace (don't truncate) the lists: this can run from inside a system that is
    // mid-iteration over one of them, and truncating would corrupt that loop.
    // Boss formations stay; everything else is cleared.
    this.hostiles = this.hostiles.filter((h) => h.group !== 0);
    this.bullets = [];
    this.playerMissiles = [];
    this.enemyShots = [];
    this.hazards = [];
    const p = this.player;
    p.invuln = T.player.invulnTicks;
    p.locks.length = 0;
    p.ripple.length = 0;
    p.heat = 0;
    p.overheated = false;
    this.emit({ type: 'lockEnd' });
    this.centerPlayer();
  }

  /** Compact numeric fingerprint of the state, for determinism tests. */
  fingerprint(): string {
    const r = (n: number) => n.toFixed(4);
    const parts = [this.tick, this.score, this.lives, r(this.fuel), r(this.shields), this.missiles, this.flares, r(this.emp), r(this.dist), r(this.player.x), r(this.player.y), r(this.player.heat), this.course.sector, this.course.phase];
    for (const e of this.hostiles) parts.push(`${e.kind}:${r(e.x)},${r(e.y)},${e.hp},${e.state}`);
    for (const s of this.enemyShots) parts.push(`${s.kind}:${r(s.x)},${r(s.y)}`);
    return parts.join('|');
  }
}

/** Bridges scroll with the ground; flying under one is worth a bonus. */
function updateFeatures(sim: Sim): void {
  const p = sim.player;
  const py = p.y + p.h / 2;
  for (const f of sim.features) {
    const before = f.y;
    f.y += sim.scrollSpeed;
    if (!f.passed && before < py && f.y >= py) {
      f.passed = true;
      sim.stats.bridges++;
      sim.emit({ type: 'bridge', x: p.x + p.w / 2, y: py });
      // bonus is awarded through scoring so it multiplies with the chain
      sim.score += Math.round(250 * sim.combo.mult);
      sim.emit({ type: 'score', x: p.x + p.w / 2, y: py - 20, amount: Math.round(250 * sim.combo.mult), label: 'UNDER THE BRIDGE' });
    }
  }
  sim.features = sim.features.filter((f) => f.y < VIEW_H + 60);
}

export { WORLD_W, VIEW_H };
