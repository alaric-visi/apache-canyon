import type { Sim } from '../engine/sim';
import type { SimEvent } from '../entities/types';
import { Mixer, DEFAULT_VOLUMES, type Volumes } from './mixer';
import { Sfx } from './sfx';
import { LockTone, RotorEngine } from './engine';
import { Ambience } from './ambience';
import { MENU_KEY, Music, SECTOR_KEYS } from './music';
import { rawIntensity, smoothIntensity } from './intensity';

export type AudioMode = 'menu' | 'run' | 'paused' | 'off';

/** The whole audio graph. Built on any BaseAudioContext (realtime or offline). */
export interface AudioGraph {
  mixer: Mixer;
  sfx: Sfx;
  rotor: RotorEngine;
  lock: LockTone;
  ambience: Ambience;
  music: Music;
}

export function buildGraph(ctx: BaseAudioContext): AudioGraph {
  const mixer = new Mixer(ctx);
  const sfx = new Sfx(mixer);
  const { white, brown } = sfx.noiseBuffers;
  return {
    mixer,
    sfx,
    rotor: new RotorEngine(mixer, white),
    lock: new LockTone(mixer),
    ambience: new Ambience(mixer, white, brown),
    music: new Music(mixer, white),
  };
}

/**
 * Game-facing audio. `handle()` maps sim events to sounds (like the FX system
 * does for visuals); `update()` runs once per tick for the continuous layers:
 * rotor, lock warning, ambience and the adaptive score.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private g: AudioGraph | null = null;
  private intensity = 0;
  private keyFor = -2;
  private tick = 0;

  constructor(private muted = false, private volumes: Volumes = DEFAULT_VOLUMES) {}

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.g = buildGraph(this.ctx);
    this.g.mixer.setVolumes(this.volumes);
    this.g.mixer.setMuted(this.muted);
    this.g.music.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.g?.mixer.setMuted(m);
  }

  setVolumes(v: Volumes): void {
    this.volumes = v;
    this.g?.mixer.setVolumes(v);
  }

  ui(kind: 'move' | 'select' | 'back' | 'buy' | 'start'): void {
    this.g?.sfx.ui(kind);
  }

  /** End-of-run music. */
  runEnd(result: 'over' | 'complete' | 'abandon'): void {
    if (!this.g) return;
    if (result === 'over') this.g.music.gameOver();
    if (result === 'complete') this.g.music.complete();
  }

  handle(e: SimEvent, sim: Sim): void {
    const g = this.g;
    if (!g) return;
    const s = g.sfx;
    const p = sim.player;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    const dist = (x: number, y: number) => Math.hypot(x - px, y - py);
    switch (e.type) {
      case 'shoot': s.gun(e.x); break;
      case 'missile': s.missile(e.x); break;
      case 'hit': s.armourHit(e.x); break;
      case 'explode': {
        const size = e.big ? 1.5 : e.damage ? 1.1 : 1;
        s.explosion(size, e.x, e.damage ? 0 : dist(e.x, e.y));
        if (e.big || e.damage) g.mixer.duck(e.damage ? 0.5 : 0.35, 0.6);
        break;
      }
      case 'airburst': s.explosion(1, e.x, dist(e.x, e.y)); break;
      case 'pickup': s.pickup(e.kind, e.x); break;
      case 'scrape': s.scrape(e.x); break;
      case 'lifeLost': s.explosion(2, px, 0); g.mixer.duck(0.85, 1.4); break;
      case 'alarm': s.alarm(); break;
      case 'enemyShot': s.enemyShot(e.kind, e.x); break;
      case 'telegraph': s.telegraph(e.kind, e.x); break;
      case 'samLaunch': s.samLaunch(e.x); break;
      case 'flakMark': s.flakMark(e.x); break;
      case 'flare': s.flare(e.x); break;
      case 'decoyed': s.decoyed(e.x); break;
      case 'paint': s.paint(e.count, e.x); break;
      case 'overheat': s.overheat(px); break;
      case 'coolPerfect': s.coolPerfect(e.x); break;
      case 'block': s.block(e.x); break;
      case 'emp': s.emp(e.x); g.mixer.duck(0.7, 1); break;
      case 'combo': s.combo(e.mult); break;
      case 'comboBreak': s.comboBreak(); break;
      case 'score': if (e.label === 'NEAR MISS') s.nearMiss(e.x); break;
      case 'bridge': s.bridge(e.x); break;
      case 'shieldDown': s.shieldDown(e.x); break;
      case 'bossEnter': g.music.bossEnter(); g.mixer.duck(0.3, 2); break;
      case 'bossDown': g.music.bossDown(); break;
      case 'sectorClear': g.music.sectorClear(); break;
      case 'runComplete': g.music.complete(); break;
    }
  }

  /** Once per fixed tick. `sim` is the run (or the attract run behind the menus). */
  update(sim: Sim, mode: AudioMode): void {
    const g = this.g;
    if (!g) return;
    this.tick++;
    const run = mode === 'run';
    const p = sim.player;

    g.rotor.update(run, sim.scrollSpeed, p.x + p.w / 2, p.boosting);
    g.lock.update(run ? sim.samLock : 0, run && sim.enemyShots.some((s) => s.kind === 'sam' && s.decoy === null));
    g.ambience.setSector(sim.course.sector);
    g.ambience.update(mode !== 'off');

    // music: key per sector (or the menu theme), layers by intensity
    const want = mode === 'menu' ? -1 : sim.course.sector;
    if (want !== this.keyFor) {
      this.keyFor = want;
      if (want === -1) g.music.setKey(MENU_KEY, 7, true);
      else g.music.setKey(SECTOR_KEYS[want], sim.seed + want, false);
    }
    this.intensity = run ? smoothIntensity(this.intensity, rawIntensity(sim)) : this.intensity * 0.99;
    if (this.tick % 10 === 0) g.music.setIntensity(this.intensity, run && !!sim.bossState);
    g.music.setPaused(mode === 'paused');
  }

  /** For the debug overlay. */
  get debugIntensity(): number {
    return this.intensity;
  }
}
