import type { Sim } from '../../engine/sim';
import type { SimEvent } from '../../entities/types';
import { compact } from '../../core/math';
import { VIEW_H, WORLD_W } from '../../world/canyon';
import { SECTORS } from '../../content/sectors/sectors';

/**
 * Cosmetic effects and camera. Driven by sim events, stepped on the fixed tick,
 * free to use Math.random because nothing here feeds back into gameplay.
 */

export type PKind =
  | 'flash'   // additive burst of light
  | 'ring'    // additive expanding shock ring
  | 'fire'    // additive fireball puff, yellow → red with age
  | 'spark'   // additive streak aligned to velocity
  | 'ember'   // additive slow glowing dot
  | 'smoke'   // normal-blend lit puff, grows and drifts
  | 'dust'    // sand puff (rotor wash, scrapes)
  | 'debris'  // dark tumbling chunk on the ground
  | 'scorch'  // ground decal, long-lived
  | 'shock'   // additive EMP wave (cool tint)
  | 'streak'; // boost speed line

export interface Particle {
  kind: PKind;
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  size: number; grow: number;
  rot: number; vrot: number;
  alpha: number;
  drag: number;
  /** Scrolls with the canyon floor. */
  ground: boolean;
  /** 0..1 variation seed for the renderer (texture pick, tint). */
  seed: number;
  /** Ticks before the particle becomes visible and starts moving. */
  delay: number;
}

/** Floating score / status text. */
export interface Popup {
  x: number; y: number;
  text: string;
  life: number; maxLife: number;
  color: number;
  size: number;
}

export interface Mote { x: number; y: number; size: number; speed: number; drift: number; alpha: number; phase: number }

const MAX_PARTICLES = 1400;
/** Ground-shadow direction for anything airborne (sun at lower-left). */
export const SHADOW_OFFSET = { x: 12, y: -10 };

export interface Camera {
  /** 0..1; shake ∝ trauma². */
  trauma: number;
  /** Horizontal lead toward the player, world units. */
  leadX: number;
  /** Short vertical kick (missile launch recoil), world units. */
  kickY: number;
  /** Extra zoom-out at speed, 0..0.06. */
  zoomOut: number;
  /** Shake time accumulator. */
  t: number;
}

export class Fx {
  particles: Particle[] = [];
  popups: Popup[] = [];
  motes: Mote[] = [];
  camera: Camera = { trauma: 0, leadX: 0, kickY: 0, zoomOut: 0, t: 0 };
  /** Freeze-frame ticks requested by impacts; the game shell skips sim steps while > 0. */
  hitStop = 0;
  /** 0..1 damage pulse for chromatic aberration / red vignette. */
  hurt = 0;
  /** Accessibility: shake multiplier, and reduced motion (no shake, no hit-stop, fewer particles). */
  shakeScale = 1;
  reducedMotion = false;
  private free: Particle[] = [];

  constructor() {
    const count = Math.floor((WORLD_W * VIEW_H) / 12000);
    for (let i = 0; i < count; i++)
      this.motes.push({
        x: Math.random() * WORLD_W, y: Math.random() * VIEW_H,
        size: Math.random() * 1.4 + 0.5, speed: Math.random() * 0.6 + 0.2,
        drift: Math.random() * 0.3 + 0.05, alpha: Math.random() * 0.35 + 0.1, phase: Math.random() * Math.PI * 2,
      });
  }

  /** Back-compat for the Canvas2D fallback renderer. */
  get shake(): number {
    return this.camera.trauma * this.camera.trauma * 14;
  }

  reset(): void {
    this.free.push(...this.particles);
    this.particles.length = 0;
    this.popups.length = 0;
    this.camera.trauma = 0;
    this.camera.kickY = 0;
    this.hitStop = 0;
    this.hurt = 0;
  }

  addTrauma(t: number): void {
    if (this.reducedMotion) return;
    this.camera.trauma = Math.min(1, this.camera.trauma + t * this.shakeScale);
  }

  spawn(kind: PKind, x: number, y: number, vx: number, vy: number, life: number, size: number, o: Partial<Particle> = {}): Particle | null {
    if (this.particles.length >= (this.reducedMotion ? MAX_PARTICLES / 2 : MAX_PARTICLES)) return null;
    const p = this.free.pop() ?? ({} as Particle);
    p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.size = size;
    p.grow = o.grow ?? 0; p.rot = o.rot ?? Math.random() * Math.PI * 2; p.vrot = o.vrot ?? 0;
    p.alpha = o.alpha ?? 1; p.drag = o.drag ?? 1; p.ground = o.ground ?? false;
    p.seed = Math.random(); p.delay = o.delay ?? 0;
    this.particles.push(p);
    return p;
  }

  popup(x: number, y: number, text: string, color = 0xffc36b, size = 1, life = 50): void {
    if (this.popups.length > 40) this.popups.shift();
    this.popups.push({ x, y, text, life, maxLife: life, color, size });
  }

  explosion(x: number, y: number, scale: number, damage = false): void {
    const n = (k: number) => Math.round(k * scale);
    this.spawn('flash', x, y, 0, 0, 7, 24 * scale, { alpha: damage ? 0.7 : 1 });
    this.spawn('ring', x, y, 0, 0, 20, 6, { grow: 3.2 * scale, alpha: 0.8 });
    for (let i = 0; i < n(10); i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 2.2 * scale;
      this.spawn('fire', x + Math.cos(a) * 3, y + Math.sin(a) * 3, Math.cos(a) * s, Math.sin(a) * s, 16 + Math.random() * 16, (5 + Math.random() * 6) * scale, { grow: 0.35, drag: 0.9, delay: Math.floor(Math.random() * 4) });
    }
    for (let i = 0; i < n(14); i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 4 * scale;
      this.spawn('spark', x, y, Math.cos(a) * s, Math.sin(a) * s, 12 + Math.random() * 14, 1, { drag: 0.9 });
    }
    for (let i = 0; i < n(8); i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 1.2;
      this.spawn('smoke', x + (Math.random() - 0.5) * 10 * scale, y + (Math.random() - 0.5) * 10 * scale, Math.cos(a) * s + 0.2, Math.sin(a) * s - 0.15, 70 + Math.random() * 60, (6 + Math.random() * 6) * scale,
        { grow: 0.22, drag: 0.97, ground: true, alpha: damage ? 0.7 : 0.55, delay: 4 + Math.floor(Math.random() * 8), vrot: (Math.random() - 0.5) * 0.02 });
    }
    for (let i = 0; i < n(6); i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.5;
      this.spawn('debris', x, y, Math.cos(a) * s, Math.sin(a) * s, 160 + Math.random() * 120, 1.5 + Math.random() * 2, { drag: 0.9, ground: true, vrot: (Math.random() - 0.5) * 0.4 });
    }
    for (let i = 0; i < n(5); i++) {
      const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random() * 1.5;
      this.spawn('ember', x, y, Math.cos(a) * s, Math.sin(a) * s, 40 + Math.random() * 40, 1.5, { drag: 0.96 });
    }
    this.spawn('scorch', x, y, 0, 0, 900, 12 + 8 * scale, { ground: true, alpha: 0.38 });
  }

  handle(e: SimEvent, sim: Sim): void {
    switch (e.type) {
      case 'explode': {
        const scale = e.big ? 1.5 : e.damage ? 1.1 : 1;
        this.explosion(e.x, e.y, scale, e.damage);
        this.addTrauma(e.shake / 22);
        if (e.big && !this.reducedMotion) this.hitStop = Math.max(this.hitStop, 3);
        break;
      }
      case 'hit':
        this.spawn('flash', e.x, e.y, 0, 0, 4, 12, { alpha: 0.8 });
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
          this.spawn('spark', e.x, e.y, Math.cos(a) * s, Math.sin(a) * s - 1, 8 + Math.random() * 6, 1, { drag: 0.88 });
        }
        break;
      case 'pickup':
        this.spawn('ring', e.x, e.y, 0, 0, 22, 4, { grow: 2.2, alpha: 0.9 });
        this.spawn('flash', e.x, e.y, 0, 0, 8, 26, { alpha: 0.8 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.spawn('ember', e.x, e.y, Math.cos(a) * 1.8, Math.sin(a) * 1.8, 26, 1.8, { drag: 0.93 });
        }
        break;
      case 'scrape':
        for (let i = 0; i < 4; i++)
          this.spawn('spark', e.x, e.y, (Math.random() - 0.5) * 4, 1 + Math.random() * 3, 8 + Math.random() * 8, 1, { drag: 0.9 });
        this.spawn('dust', e.x, e.y, 0, 0.5, 30, 6, { grow: 0.3, ground: true, alpha: 0.4 });
        this.addTrauma(0.05);
        break;
      case 'missile':
        for (let i = 0; i < 5; i++)
          this.spawn('smoke', e.x + (Math.random() - 0.5) * 6, e.y + 6, (Math.random() - 0.5) * 0.8, 0.6 + Math.random(), 40, 4, { grow: 0.25, ground: true, alpha: 0.45 });
        this.spawn('flash', e.x, e.y, 0, 0, 5, 18, { alpha: 0.9 });
        if (!this.reducedMotion) this.camera.kickY = 3;
        this.addTrauma(0.12);
        break;
      case 'playerHit':
        this.hurt = 1;
        break;
      case 'enemyShot':
        this.spawn('flash', e.x, e.y, 0, 0, 4, e.kind === 'shell' ? 14 : 9, { alpha: 0.7 });
        break;
      case 'telegraph':
        this.spawn('flash', e.x, e.y, 0, 0, 10, 10, { alpha: 0.6 });
        break;
      case 'samLaunch':
        for (let i = 0; i < 8; i++)
          this.spawn('smoke', e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 60, 5, { grow: 0.25, ground: true, alpha: 0.55 });
        this.spawn('flash', e.x, e.y, 0, 0, 6, 20);
        break;
      case 'airburst':
        this.spawn('flash', e.x, e.y, 0, 0, 8, e.r * 1.2, { alpha: 0.9 });
        this.spawn('ring', e.x, e.y, 0, 0, 16, e.r * 0.4, { grow: e.r * 0.06, alpha: 0.9 });
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3;
          this.spawn('spark', e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 14, 1, { drag: 0.9 });
        }
        for (let i = 0; i < 4; i++) this.spawn('smoke', e.x + (Math.random() - 0.5) * e.r, e.y + (Math.random() - 0.5) * e.r, 0.2, -0.1, 70, 6, { grow: 0.2, alpha: 0.5, delay: 3 });
        this.addTrauma(0.2);
        break;
      case 'flare':
        this.spawn('flash', e.x, e.y, 0, 0, 8, 26, { alpha: 0.9 });
        break;
      case 'decoyed':
        this.popup(e.x, e.y - 8, 'DECOYED', 0x9fe8ff, 0.9);
        break;
      case 'paint':
        this.spawn('ring', e.x, e.y, 0, 0, 12, 14, { grow: -0.6, alpha: 0.9 });
        break;
      case 'overheat': {
        const p = sim.player;
        for (let i = 0; i < 8; i++) this.spawn('smoke', p.x + p.w / 2 + (Math.random() - 0.5) * 8, p.y, (Math.random() - 0.5) * 1.2, -0.4 - Math.random(), 40, 3, { grow: 0.2, alpha: 0.45 });
        this.popup(p.x + p.w / 2, p.y - 20, 'OVERHEAT', 0xff6a4a, 1);
        break;
      }
      case 'coolPerfect':
        this.spawn('shock', e.x, e.y, 0, 0, 14, 4, { grow: 1.4, alpha: 0.7 });
        this.popup(e.x, e.y - 10, 'COOLED', 0x9fe8ff, 0.8, 34);
        break;
      case 'block':
        for (let i = 0; i < 3; i++) this.spawn('spark', e.x, e.y, (Math.random() - 0.5) * 4, 1 + Math.random() * 2, 10, 1, { drag: 0.88 });
        this.spawn('flash', e.x, e.y, 0, 0, 4, 8, { alpha: 0.7 });
        break;
      case 'emp':
        this.spawn('shock', e.x, e.y, 0, 0, 40, 10, { grow: 22, alpha: 1 });
        this.spawn('shock', e.x, e.y, 0, 0, 30, 6, { grow: 14, alpha: 0.7, delay: 4 });
        this.spawn('flash', e.x, e.y, 0, 0, 10, 120, { alpha: 0.8 });
        this.addTrauma(0.5);
        this.popup(e.x, e.y - 30, 'EMP', 0x9fe8ff, 1.6, 60);
        break;
      case 'score':
        this.popup(e.x, e.y, e.label ? `${e.label} +${e.amount}` : `+${e.amount}`, e.label ? 0xffe9b8 : 0xffc36b, e.amount >= 1000 ? 1.5 : 0.8);
        break;
      case 'combo': {
        const p = sim.player;
        this.popup(p.x + p.w / 2, p.y - 38, `×${e.mult.toFixed(1)} CHAIN`, 0xffe070, 1.3, 70);
        break;
      }
      case 'comboBreak': {
        const p = sim.player;
        this.popup(p.x + p.w / 2, p.y - 38, 'CHAIN LOST', 0xff6a4a, 1, 50);
        break;
      }
      case 'bossEnter':
        this.addTrauma(0.35);
        break;
      case 'lifeLost': {
        const p = sim.player;
        this.explosion(p.x + p.w / 2, p.y + p.h / 2, 2, true);
        this.addTrauma(0.9);
        if (!this.reducedMotion) this.hitStop = Math.max(this.hitStop, 10);
        this.hurt = 1;
        break;
      }
    }
  }

  /** Advance one fixed tick. `sim` is null on screens without a run. */
  tick(sim: Sim | null, playing: boolean): void {
    const cam = this.camera;
    cam.t += 1;
    cam.trauma = Math.max(0, cam.trauma - 0.022);
    cam.kickY *= 0.8;
    this.hurt = Math.max(0, this.hurt - 0.04);

    const scroll = sim ? sim.scrollSpeed : 2.5;
    if (sim) {
      const p = sim.player;
      cam.leadX += ((p.x + p.w / 2 - WORLD_W / 2) * 0.14 - cam.leadX) * 0.05;
      cam.zoomOut += ((this.reducedMotion ? 0 : (sim.scrollSpeed - 2.5) * 0.03) - cam.zoomOut) * 0.02;
    }

    for (const m of this.motes) {
      m.y += m.speed * (scroll / 2.5) + 0.2;
      m.x += m.drift;
      m.phase += 0.03;
      if (m.y > VIEW_H + 20 || m.x > WORLD_W + 200) { m.y = -20; m.x = Math.random() * (WORLD_W + 400) - 200; }
    }

    if (sim && playing) this.ambient(sim);

    compact(this.popups, (p) => {
      p.y -= 0.5;
      return --p.life > 0;
    });

    compact(this.particles, (p) => {
      if (p.delay > 0) {
        p.delay--;
        if (p.ground) p.y += scroll;
        return true;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.ground) p.y += scroll;
      p.vx *= p.drag; p.vy *= p.drag;
      p.size += p.grow;
      p.rot += p.vrot;
      p.life--;
      if (p.life > 0 && p.y < VIEW_H + 80) return true;
      this.free.push(p);
      return false;
    });
  }

  /** Continuous emitters: rotor wash, missile trails, damage smoke. */
  private ambient(sim: Sim): void {
    const p = sim.player;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    // rotor wash kicks sand out from under the gunship's ground shadow
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 8;
    this.spawn('dust', cx + SHADOW_OFFSET.x + Math.cos(a) * r, cy + SHADOW_OFFSET.y + Math.sin(a) * r, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 26 + Math.random() * 14, 3 + Math.random() * 3, { grow: 0.18, ground: true, alpha: 0.22, drag: 0.96 });

    for (const m of sim.playerMissiles) {
      this.spawn('smoke', m.x + m.w / 2 + (Math.random() - 0.5) * 2, m.y + m.h, (Math.random() - 0.5) * 0.3, 0.2, 38 + Math.random() * 20, 2.5, { grow: 0.16, ground: true, alpha: 0.4, drag: 0.98 });
    }

    if (sim.shields < 35 && sim.tick % 3 === 0) {
      this.spawn('smoke', cx + (Math.random() - 0.5) * 6, cy + 4, (Math.random() - 0.5) * 0.4, 0.6, 40, 3, { grow: 0.2, ground: true, alpha: 0.55 });
      if (Math.random() < 0.3) this.spawn('ember', cx, cy, (Math.random() - 0.5) * 1.5, 0.5 + Math.random(), 20, 1.4, { drag: 0.95 });
    }

    // enemy missiles/rockets and flares leave trails
    for (const s of sim.enemyShots) {
      if (s.kind !== 'sam' && s.kind !== 'rocket') continue;
      this.spawn('smoke', s.x + s.w / 2 - s.vx * 2, s.y + s.h / 2 - s.vy * 2, (Math.random() - 0.5) * 0.3, 0, 40, 2.5, { grow: 0.15, ground: true, alpha: 0.45 });
    }
    for (const f of sim.flareObjs) {
      this.spawn('smoke', f.x, f.y, (Math.random() - 0.5) * 0.3, 0, 30, 2, { grow: 0.14, ground: true, alpha: 0.4 });
      if (Math.random() < 0.5) this.spawn('ember', f.x, f.y, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 12, 1.2, { drag: 0.9 });
    }
    // sandstorm: sand streaks blowing across the canyon
    const dust = SECTORS[sim.course.sector].light.dust;
    for (let i = 0; i < dust * 3; i++) {
      if (Math.random() < dust) this.spawn('streak', -40 + Math.random() * 200, Math.random() * VIEW_H, 9 + Math.random() * 6, 2 + Math.random() * 2, 70, 1, { alpha: 0.25 + Math.random() * 0.2 });
    }

    // boost: speed lines streaming past
    if (p.boosting) {
      for (let i = 0; i < 2; i++) this.spawn('streak', Math.random() * WORLD_W, -10, 0, 18 + Math.random() * 8, 40, 1, { alpha: 0.35 });
      if (Math.random() < 0.6) this.spawn('dust', cx + SHADOW_OFFSET.x + (Math.random() - 0.5) * 30, cy + SHADOW_OFFSET.y + 10, (Math.random() - 0.5) * 2, 2, 24, 4, { grow: 0.25, ground: true, alpha: 0.25 });
    }

    for (const h of sim.hostiles) {
      if (h.kind !== 'gate' && h.hp < h.maxHp && Math.random() < 0.25)
        this.spawn('smoke', h.x + h.w / 2, h.y + h.h / 2, (Math.random() - 0.5) * 0.3, 0.3, 36, 2.5, { grow: 0.18, ground: true, alpha: 0.45 });
    }
  }
}
