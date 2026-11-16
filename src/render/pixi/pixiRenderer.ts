import { Application, BitmapText, Container, Graphics, Rectangle, Sprite, Text, Texture, type BLEND_MODES } from 'pixi.js';
import { VIEW_H, WORLD_W } from '../../world/canyon';
import { lerp } from '../../core/math';
import type { Body, Hostile } from '../../entities/types';
import type { Sim } from '../../engine/sim';
import { gateActive, gateBeam, gateSwitchIn } from '../../systems/combat';
import { COOL_WINDOW, LOCK_START } from '../../systems/player';
import { MINE_RADIUS } from '../../systems/enemyAI';
import { SECTORS, type LightPreset } from '../../content/sectors/sectors';
import type { Particle } from '../fx/fx';
import { SHADOW_OFFSET } from '../fx/fx';
import { DEFAULT_ACCESS, type Access, type Quality, type RenderView, type Renderer } from '../renderer';
import { Terrain, type WorldRect } from './terrain';
import { bakeArt, type Art, type SpriteSet } from './sprites';
import { GradeFilter, makeBloom, type HazeSource } from './postfx';

const MAX_DPR = 2;
/** In portrait the camera shows this many world units across and follows the gunship. */
const PORTRAIT_W = 520;

/** Pooled sprites for one layer; call begin() → get()… → end() each frame. */
class Pool {
  private items: Sprite[] = [];
  private used = 0;
  constructor(private readonly parent: Container, private readonly blend?: BLEND_MODES) {}
  begin(): void { this.used = 0; }
  get(tex: Texture, x: number, y: number): Sprite {
    let s = this.items[this.used];
    if (!s) {
      s = new Sprite(tex);
      if (this.blend) s.blendMode = this.blend;
      this.parent.addChild(s);
      this.items.push(s);
    }
    this.used++;
    s.texture = tex;
    s.visible = true;
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.alpha = 1;
    s.tint = 0xffffff;
    s.rotation = 0;
    s.scale.set(1);
    return s;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
}

const rgb = (r: number, g: number, b: number) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
const mixHex = (a: number, b: number, t: number) =>
  rgb(lerp((a >> 16) & 255, (b >> 16) & 255, t), lerp((a >> 8) & 255, (b >> 8) & 255, t), lerp(a & 255, b & 255, t));

/** Smooth pseudo-noise in [-1, 1] for camera shake. */
const shakeNoise = (t: number, k: number) => (Math.sin(t * 0.91 + k * 7.3) + Math.sin(t * 1.73 + k * 3.1) * 0.6 + Math.sin(t * 2.97 + k) * 0.3) / 1.9;

export class PixiRenderer implements Renderer {
  private readonly root = new Container();
  private readonly world = new Container();
  private readonly terrain = new Terrain();
  private readonly art: Art;
  private readonly grade = new GradeFilter();
  private readonly bloom = makeBloom();
  private quality: Quality = 'high';
  private access: Access = { ...DEFAULT_ACCESS };
  /** Dynamic resolution multiplier (0.6..1), lowered when frames run long. */
  private dynRes = 1;
  private frameEma = 16.7;
  private lastFrame = 0;
  private framesSinceRes = 0;
  private lastScale = 1;
  private portraitX = WORLD_W / 2;

  private readonly decals: Pool;
  private readonly groundUnits: Pool;
  private readonly tele = new Graphics();
  /** Ground structures with variable size (dam wall). */
  private readonly structGfx = new Graphics();
  /** Things the gunship flies under (bridges). */
  private readonly overGfx = new Graphics();
  /** Current light, eased toward the sector's preset. */
  private light: LightPreset = structuredClone(SECTORS[0].light);
  private readonly popupLayer = new Container();
  private readonly popupPool: BitmapText[] = [];
  private readonly shadows: Pool;
  private readonly groundFx: Pool;
  private readonly pickups: Pool;
  private readonly gateGfx = new Graphics();
  private readonly gates: Pool;
  private readonly units: Pool;
  private readonly unitFlash: Pool;
  private readonly smoke: Pool;
  private readonly additive: Pool;
  private readonly player: Pool;
  private readonly hud = new Graphics();
  private readonly debugGfx = new Graphics();
  private readonly warning: Text;

  private cssW = 1;
  private cssH = 1;
  private bank = 0;
  private rotorAngle = 0;
  private time = 0;
  private readonly haze: HazeSource[] = [];
  private readonly inspectZoom = Math.max(1, Math.min(8, Number(new URLSearchParams(location.search).get('zoom')) || 1));

  private constructor(private readonly app: Application) {
    this.art = bakeArt();
    app.stage.addChild(this.root);
    this.root.addChild(this.world);

    const layer = () => this.world.addChild(new Container());
    this.world.addChild(this.terrain.mesh);
    this.decals = new Pool(layer());
    this.world.addChild(this.structGfx);
    this.groundUnits = new Pool(layer());
    this.shadows = new Pool(layer());
    this.groundFx = new Pool(layer());
    this.world.addChild(this.tele);
    this.tele.blendMode = 'add';
    this.world.addChild(this.gateGfx);
    this.gateGfx.blendMode = 'add';
    this.gates = new Pool(layer());
    this.pickups = new Pool(layer());
    this.units = new Pool(layer());
    this.unitFlash = new Pool(layer());
    this.smoke = new Pool(layer());
    this.player = new Pool(layer());
    this.world.addChild(this.overGfx);
    this.additive = new Pool(layer(), 'add');
    this.world.addChild(this.hud);
    this.world.addChild(this.popupLayer);
    this.world.addChild(this.debugGfx);

    this.warning = new Text({
      text: '',
      style: { fontFamily: 'Share Tech Mono, monospace', fontSize: 40, fill: 0xffc36b, letterSpacing: 6, align: 'center' },
    });
    this.warning.anchor.set(0.5);
    this.warning.scale.set(0.25);
    this.world.addChild(this.warning);
  }

  static async create(canvas: HTMLCanvasElement): Promise<PixiRenderer> {
    const app = new Application();
    const rect = canvas.getBoundingClientRect();
    await app.init({
      canvas,
      width: Math.max(100, rect.width),
      height: Math.max(100, rect.height),
      resolution: Math.min(window.devicePixelRatio || 1, MAX_DPR),
      autoDensity: true,
      antialias: false,
      background: 0x140b08,
      preference: 'webgl',
      autoStart: false,
      sharedTicker: false,
      powerPreference: 'high-performance',
    });
    const r = new PixiRenderer(app);
    r.resize();
    return r;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.dynRes = 1;
    this.bloom.quality = q === 'high' ? 5 : 3;
    this.resize();
  }

  setAccess(a: Access): void {
    this.access = { ...a };
  }

  worldScale(): number {
    return this.lastScale;
  }

  /** Base resolution for the quality preset, before dynamic scaling. */
  private baseRes(): number {
    const dpr = window.devicePixelRatio || 1;
    return this.quality === 'high' ? Math.min(dpr, MAX_DPR) : this.quality === 'balanced' ? Math.min(dpr, 1.5) : 1;
  }

  /**
   * Dynamic resolution: if frames run long for a couple of seconds, render at
   * a lower resolution; claw it back when there's headroom again.
   */
  private adaptResolution(): void {
    const now = performance.now();
    if (this.lastFrame) this.frameEma = this.frameEma * 0.95 + Math.min(100, now - this.lastFrame) * 0.05;
    this.lastFrame = now;
    if (this.quality === 'performance' || document.hidden || ++this.framesSinceRes < 120) return;
    let next = this.dynRes;
    if (this.frameEma > 21 && this.dynRes > 0.6) next = Math.max(0.6, this.dynRes - 0.15);
    else if (this.frameEma < 14 && this.dynRes < 1) next = Math.min(1, this.dynRes + 0.1);
    if (next !== this.dynRes) {
      this.dynRes = next;
      this.app.renderer.resize(this.cssW, this.cssH, Math.max(0.75, this.baseRes() * this.dynRes));
    }
    this.framesSinceRes = 0;
  }

  /** For the debug overlay. */
  get resolutionInfo(): string {
    return `${this.quality} · res ${(this.baseRes() * this.dynRes).toFixed(2)} (${Math.round(this.dynRes * 100)}%)`;
  }

  resize(): void {
    const canvas = this.app.canvas;
    canvas.style.width = '';
    canvas.style.height = '';
    const rect = canvas.getBoundingClientRect();
    this.cssW = Math.max(100, rect.width);
    this.cssH = Math.max(100, rect.height);
    this.app.renderer.resize(this.cssW, this.cssH, Math.max(0.75, this.baseRes() * this.dynRes));
    this.root.filterArea = new Rectangle(0, 0, this.cssW, this.cssH);
    this.root.filters = this.quality === 'performance' ? [] : [this.bloom, this.grade];
  }

  render(v: RenderView): void {
    const { sim, fx, alpha } = v;
    this.time += 1 / 60;
    this.adaptResolution();
    const reduced = this.access.reducedMotion;

    // ------------------------------------------------ camera
    const cam = fx.camera;
    // portrait (phones): a narrower view that follows the gunship, world top at the screen top
    const portrait = this.cssH > this.cssW * 1.15;
    const base = portrait ? this.cssW / PORTRAIT_W : Math.min(this.cssW / WORLD_W, this.cssH / VIEW_H);
    const s = base * (1 - cam.zoomOut) * this.inspectZoom;
    this.lastScale = s;
    const tr = cam.trauma * cam.trauma;
    const t = cam.t * 0.9;
    const shx = shakeNoise(t, 1) * 14 * tr;
    const shy = shakeNoise(t, 2) * 14 * tr + cam.kickY;
    const rot = reduced ? 0 : shakeNoise(t, 3) * 0.025 * tr;
    let cx = WORLD_W / 2 + cam.leadX, cy = VIEW_H / 2;
    if (portrait) {
      const pcx = sim.player.x + sim.player.w / 2;
      const half = PORTRAIT_W / 2;
      this.portraitX += (Math.min(WORLD_W - half, Math.max(half, pcx)) - this.portraitX) * 0.08;
      cx = this.portraitX;
      cy = this.cssH / 2 / s;
    }
    if (this.inspectZoom > 1) {
      // dev aid (?zoom=N): follow the player up close to inspect art
      cx = sim.player.x + sim.player.w / 2;
      cy = sim.player.y + sim.player.h / 2 - 40 / this.inspectZoom;
    }
    this.world.pivot.set(cx, cy);
    this.world.position.set(this.cssW / 2 + shx * s, this.cssH / 2 + shy * s);
    this.world.scale.set(s);
    this.world.rotation = rot;

    const hw = this.cssW / 2 / s, hh = this.cssH / 2 / s;
    const pad = Math.abs(rot) * Math.max(hw, hh) + 24;
    const view: WorldRect = { x: cx - hw - pad, y: cy - hh - pad, w: (hw + pad) * 2, h: (hh + pad) * 2 };
    const toScreen = (x: number, y: number): [number, number] => {
      const dx = (x - cx) * s, dy = (y - cy) * s;
      const c = Math.cos(rot), sn = Math.sin(rot);
      return [this.cssW / 2 + shx * s + dx * c - dy * sn, this.cssH / 2 + shy * s + dx * sn + dy * c];
    };

    const dist = lerp(sim.prevDist, sim.dist, alpha);
    this.terrain.update(sim.canyon, dist, view);

    for (const p of [this.decals, this.groundUnits, this.shadows, this.groundFx, this.gates, this.pickups, this.units, this.unitFlash, this.smoke, this.player, this.additive]) p.begin();
    this.gateGfx.clear();
    this.tele.clear();
    this.structGfx.clear();
    this.overGfx.clear();
    this.hud.clear();
    this.debugGfx.clear();

    this.drawParticles(v);
    this.drawMotes(v);
    this.drawBridges(v);
    this.drawHazards(v);
    for (const h of sim.hostiles) if (h.kind === 'gate') this.drawGate(sim, h, alpha);
    this.drawPickups(v);
    for (const h of sim.hostiles) if (h.kind !== 'gate') this.drawHostile(sim, h, alpha);
    this.drawProjectiles(v);
    this.drawEnemyShots(v);
    this.drawFlares(v);
    this.drawPlayer(v);
    this.drawPopups(v);
    if (v.screen === 'playing' || v.screen === 'paused') this.drawHud(v);
    else this.warning.visible = false;
    if (v.debug) this.drawHitboxes(v);

    for (const p of [this.decals, this.groundUnits, this.shadows, this.groundFx, this.gates, this.pickups, this.units, this.unitFlash, this.smoke, this.player, this.additive]) p.end();

    // ------------------------------------------------ light: ease toward the sector's preset
    const target = SECTORS[sim.course.sector].light;
    const k = v.screen === 'title' && this.idle(v) ? 1 : 0.015;
    const L = this.light as unknown as Record<string, number | number[]>;
    for (const [key, val] of Object.entries(target) as [string, number | number[]][]) {
      if (Array.isArray(val)) (L[key] as number[]).forEach((x, i, arr) => (arr[i] = x + (val[i] - x) * k));
      else L[key] = (L[key] as number) + (val - (L[key] as number)) * k;
    }
    this.terrain.setLight(this.light.sun, this.light.shadow, this.light.shadowLen);

    // ------------------------------------------------ post
    if (this.quality === 'high') {
      const pl = sim.player;
      const [psx, psy] = toScreen(pl.x + pl.w / 2, pl.y + pl.h / 2);
      this.grade.setLight(this.light, psx / this.cssW, psy / this.cssH);
      this.haze.length = 0;
      for (const p of fx.particles) {
        if (p.kind !== 'ring' || this.haze.length >= 4) continue;
        const [sx, sy] = toScreen(p.x, p.y);
        this.haze.push({ x: sx / this.cssW, y: sy / this.cssH, radius: (p.size * s * 3) / this.cssH, strength: p.life / p.maxLife });
      }
      const critical = v.screen === 'playing' && (sim.fuel < 25 || sim.shields < 25) ? 1 : 0;
      this.grade.set(this.time, fx.hurt * this.access.flash, critical * (reduced ? 0.4 : 1), this.haze);
    }

    this.app.render();
  }

  // ---------------------------------------------------------------- helpers

  private lastSector = -1;
  /** True once when the attract sim changes sector (snap the light instead of easing). */
  private idle(v: RenderView): boolean {
    const changed = v.sim.course.sector !== this.lastSector;
    this.lastSector = v.sim.course.sector;
    return changed;
  }

  private drawBridges(v: RenderView): void {
    const sim = v.sim;
    for (const f of sim.features) {
      const y = lerp(f.py, f.y, v.alpha);
      const c = sim.corridorAt(y);
      const x0 = c.left - 30, x1 = c.right + 30;
      // shadow on the floor (sun at lower-left)
      this.structGfx.rect(x0 + 14, y - 16, x1 - x0, 12).fill({ color: 0x000000, alpha: 0.32 });
      // deck, girders and lights, drawn over the gunship
      const g = this.overGfx;
      g.rect(x0, y - 7, x1 - x0, 14).fill({ color: 0x3a2a22, alpha: 0.96 });
      g.rect(x0, y + 5, x1 - x0, 2).fill({ color: 0xffcf8a, alpha: 0.55 });
      g.rect(x0, y - 7, x1 - x0, 1.5).fill({ color: 0x140c0a, alpha: 0.9 });
      for (let x = x0 + 6; x < x1; x += 12) {
        g.moveTo(x, y - 6).lineTo(x + 6, y + 5).stroke({ width: 1, color: 0x1a120e, alpha: 0.8 });
        g.moveTo(x + 6, y - 6).lineTo(x, y + 5).stroke({ width: 1, color: 0x1a120e, alpha: 0.8 });
      }
      for (let x = c.left + 10; x < c.right; x += 40) this.glow(x, y, 8, 0xff3020, Math.floor(this.time * 2 + x) % 2 ? 0.7 : 0.2);
    }
  }

  private pos(b: Body, alpha: number): [number, number] {
    return [lerp(b.px, b.x, alpha) + b.w / 2, lerp(b.py, b.y, alpha) + b.h / 2];
  }

  /** Shadow sprite for a baked set, anchored to the same point as the art. */
  private shadow(set: SpriteSet, x: number, y: number, ax = 0.5, ay = 0.5, altitude = 1, alphaMul = 1): Sprite {
    const tw = set.tex.width, th = set.tex.height;
    const pw = (set.shadow.width - tw) / 2, ph = (set.shadow.height - th) / 2;
    const sp = this.shadows.get(set.shadow, x + SHADOW_OFFSET.x * altitude, y + SHADOW_OFFSET.y * altitude);
    sp.anchor.set((pw + ax * tw) / set.shadow.width, (ph + ay * th) / set.shadow.height);
    sp.alpha = 0.42 * alphaMul;
    return sp;
  }

  private glow(x: number, y: number, size: number, tint: number, a: number): Sprite {
    const g = this.additive.get(this.art.glow, x, y);
    g.scale.set(size / 32);
    g.tint = tint;
    g.alpha = a;
    return g;
  }

  // ---------------------------------------------------------------- layers

  private drawParticles(v: RenderView): void {
    const art = this.art;
    for (const p of v.fx.particles) {
      if (p.delay > 0) continue;
      const age = 1 - p.life / p.maxLife; // 0 → 1
      switch (p.kind) {
        case 'scorch': {
          const sp = this.decals.get(art.scorch[p.seed < 0.5 ? 0 : 1], p.x, p.y);
          sp.scale.set((p.size * 2) / 32);
          sp.rotation = p.rot;
          sp.alpha = p.alpha * Math.min(1, p.life / 120);
          break;
        }
        case 'debris': {
          const sp = this.groundFx.get(art.chunk, p.x, p.y);
          sp.scale.set(p.size / 3);
          sp.rotation = p.rot;
          sp.alpha = Math.min(1, p.life / 40);
          break;
        }
        case 'dust': {
          const sp = this.groundFx.get(art.puffs[Math.floor(p.seed * 4)], p.x, p.y);
          sp.scale.set((p.size * 2) / 24);
          sp.rotation = p.rot;
          sp.tint = 0xd9a070;
          sp.alpha = p.alpha * fade(age);
          break;
        }
        case 'smoke': {
          const sp = this.smoke.get(art.puffs[Math.floor(p.seed * 4)], p.x, p.y);
          sp.scale.set((p.size * 2) / 24);
          sp.rotation = p.rot;
          // fresh smoke is hot and dark, it cools to a lit violet-grey
          sp.tint = mixHex(0x4a3430, 0x9a8090, Math.min(1, age * 1.4));
          sp.alpha = p.alpha * fade(age);
          // shadow of the column on the ground
          if (p.size > 6) {
            const sh = this.shadows.get(art.puffs[Math.floor(p.seed * 4)], p.x + 8, p.y - 6);
            sh.scale.set((p.size * 2) / 24);
            sh.tint = 0x000000;
            sh.alpha = p.alpha * fade(age) * 0.25;
          }
          break;
        }
        case 'fire': {
          const sp = this.additive.get(art.puffs[Math.floor(p.seed * 4)], p.x, p.y);
          sp.scale.set((p.size * 2) / 24);
          sp.rotation = p.rot;
          sp.tint = age < 0.3 ? mixHex(0xfff0c0, 0xffa040, age / 0.3) : mixHex(0xffa040, 0x802010, (age - 0.3) / 0.7);
          sp.alpha = (1 - age) * 1.1;
          break;
        }
        case 'flash': {
          this.glow(p.x, p.y, p.size * 2 * (1 + age * 0.5), 0xfff0d0, p.alpha * (1 - age) * (1 - age) * (0.3 + 0.7 * this.access.flash));
          break;
        }
        case 'ring': {
          const sp = this.additive.get(art.ring, p.x, p.y);
          sp.scale.set((p.size * 2) / 32);
          sp.tint = 0xffb454;
          sp.alpha = p.alpha * (1 - age) * 0.7;
          break;
        }
        case 'spark': {
          const sp = this.additive.get(art.streak, p.x, p.y);
          const speed = Math.hypot(p.vx, p.vy);
          sp.rotation = Math.atan2(p.vy, p.vx);
          sp.scale.set(Math.max(0.25, speed * 0.22), 0.6);
          sp.tint = mixHex(0xfff0c0, 0xff8030, age);
          sp.alpha = 1 - age;
          break;
        }
        case 'shock': {
          const sp = this.additive.get(art.ring, p.x, p.y);
          sp.scale.set((p.size * 2) / 32);
          sp.tint = 0x9fe8ff;
          sp.alpha = p.alpha * (1 - age);
          break;
        }
        case 'streak': {
          const sp = this.additive.get(art.streak, p.x, p.y);
          sp.rotation = Math.atan2(p.vy, p.vx);
          sp.scale.set(Math.hypot(p.vx, p.vy) * 0.18, 0.5);
          sp.tint = p.seed > 0.5 ? 0xffe0b0 : 0xd9a070;
          sp.alpha = p.alpha * fade(age);
          break;
        }
        case 'ember': {
          const flick = 0.6 + 0.4 * Math.sin(p.seed * 50 + p.life * 0.7);
          this.glow(p.x, p.y, 5 + p.size * 2, 0xff9040, (1 - age) * flick);
          break;
        }
      }
    }
  }

  private drawMotes(v: RenderView): void {
    for (const m of v.fx.motes) {
      const tw = 0.5 + Math.sin(m.phase) * 0.5;
      this.glow(m.x, m.y, m.size * 4, 0xffd096, m.alpha * tw * 0.6);
    }
  }


  private drawGate(sim: Sim, g: Hostile, alpha: number): void {
    const [x, y] = this.pos(g, alpha);
    const beam = gateBeam(sim, { ...g, y: y - g.h / 2 });
    const gfx = this.gateGfx;
    const flash = g.flash > 0;
    const hp = g.hp / g.maxHp;
    const by = beam.y + beam.h / 2;
    const live = gateActive(sim, g);
    const soon = gateSwitchIn(sim, g) < 18;
    if (!live || (soon && Math.floor(this.time * 30) % 2 === 0)) {
      // gap: a faint dashed line marks where the beam will return
      for (let gx = beam.x; gx < beam.x + beam.w; gx += 10) gfx.moveTo(gx, by).lineTo(Math.min(gx + 5, beam.x + beam.w), by);
      gfx.stroke({ width: 1, color: 0xffc36b, alpha: live ? 0.5 : 0.3 });
    }
    if (live && !(soon && Math.floor(this.time * 30) % 2 === 0)) {
    // glow band + crackling strands across the corridor
    gfx.rect(beam.x, by - 5, beam.w, 10).fill({ color: 0xf0a44c, alpha: 0.06 + 0.04 * Math.sin(this.time * 9) });
    for (let k = 0; k < 3; k++) {
      gfx.moveTo(beam.x, by);
      const n = Math.max(4, Math.floor(beam.w / 10));
      for (let j = 1; j <= n; j++) {
        const jx = beam.x + (beam.w * j) / n;
        gfx.lineTo(jx, by + (j === n ? 0 : Math.sin(j * 2.3 + k * 1.9 + this.time * 24) * 3.2 * (0.5 + hp)));
      }
      gfx.stroke({ width: 1.1, color: flash ? 0xffffff : 0xffc36b, alpha: 0.5 + 0.35 * Math.sin(this.time * 31 + k) });
    }
    }
    // emitter pylons on both walls; the live node is the one on g.side
    const nodeX = x, otherX = g.side < 0 ? beam.x + beam.w - 6 : beam.x + 6;
    const dummy = this.gates.get(this.art.pylon, otherX, by);
    dummy.alpha = 0.7;
    const node = this.gates.get(this.art.pylon, nodeX, by);
    node.scale.set(1.25);
    node.rotation = this.time * 2;
    if (flash) { node.tint = 0xffffff; }
    this.glow(nodeX, by, 26 + Math.sin(this.time * 8) * 4, 0xffb454, 0.8);
    this.glow(otherX, by, 12, 0xffb454, 0.4);
    // weak-point marker: rotating brackets around the node
    this.brackets(this.tele, nodeX, by, 10 + Math.sin(this.time * 6) * 1.5, 0xffe070, 0.8);
  }

  private drawPickups(v: RenderView): void {
    for (const k of v.sim.pickups) {
      const [x, y] = this.pos(k, v.alpha);
      const set = this.art.pickups[k.kind];
      const sway = Math.sin(k.rot * 0.6) * 0.12;
      this.shadow(set, x, y, 0.5, 0.75, 1.8).rotation = sway;
      const sp = this.pickups.get(set.tex, x, y);
      sp.anchor.set(0.5, 0.75); // the crate sits on the hitbox, the canopy floats above
      sp.rotation = sway;
      // beacon
      const blink = Math.sin(k.rot * 2) > 0.6;
      this.glow(x, y, blink ? 14 : 9, 0xffc36b, blink ? 0.9 : 0.35);
    }
  }


  private drawHostile(sim: Sim, h: Hostile, alpha: number): void {
    const [x, y] = this.pos(h, alpha);
    const art = this.art;
    const t = this.time;
    const tele = this.tele;
    const pulse = 0.6 + 0.4 * Math.sin(t * 5 + h.id);
    const flashOver = (tex: Texture, rot: number, ax = 0.5, ay = 0.5, pool = this.unitFlash) => {
      if (h.flash <= 0) return;
      const w = pool.get(tex, x, y);
      w.anchor.set(ax, ay);
      w.rotation = rot;
      w.alpha = (h.flash / 4) * this.access.flash;
    };

    switch (h.kind) {
      case 'drone':
      case 'uav':
      case 'mine': {
        const set = h.kind === 'drone' ? art.drone : h.kind === 'uav' ? art.uav : art.mine;
        const bob = h.kind === 'drone' ? Math.sin(t * 4 + h.id) * 0.6 : 0;
        const rot = h.kind === 'mine' ? t * (h.state === 1 ? 4 : 0.8) + h.id : h.kind === 'uav' ? h.vx * 0.15 : Math.sin(t * 2 + h.id) * 0.08;
        this.shadow(set, x, y, 0.5, 0.5, h.kind === 'mine' ? 0.6 : 1.1).rotation = rot;
        this.units.get(set.tex, x, y + bob).rotation = rot;
        flashOver(set.white, rot);
        const eyeY = h.kind === 'uav' ? 5 : h.kind === 'drone' ? 1.5 : 0;
        if (h.kind === 'mine' && h.state === 1) {
          // arming: fast blink + blast radius
          const blink = Math.floor(t * (8 + h.charge * 20)) % 2 === 0;
          this.glow(x, y, 22, 0xff3b2f, blink ? 1 : 0.2);
          tele.circle(x, y, MINE_RADIUS).stroke({ width: 1.2, color: 0xff3b2f, alpha: 0.25 + 0.5 * h.charge });
          tele.circle(x, y, MINE_RADIUS * h.charge).fill({ color: 0xff3b2f, alpha: 0.06 + 0.08 * h.charge });
        } else {
          const charge = h.kind === 'drone' && h.state === 1 ? h.charge : 0;
          this.glow(x, y + bob + eyeY, (h.kind === 'mine' ? 16 : 10) * (1 + charge * 2.2), 0xff3b2f, Math.max(pulse, charge));
        }
        break;
      }
      case 'gunner': {
        this.shadow(art.gunner, x, y, 0.5, 0.5, 1.2);
        const sp = this.units.get(art.gunner.tex, x, y);
        sp.rotation = h.vx * 0.1;
        flashOver(art.gunner.white, sp.rotation);
        if (h.state === 2) {
          // red glint on the gun pods, plus a faint aim line in the last half
          const g = h.charge;
          this.glow(x, y + 7, 6 + g * 26, 0xff3020, 0.5 + g * 0.5);
          this.glow(x, y + 7, 3 + g * 6, 0xffffff, g);
          if (g > 0.5) this.ray(x, y + 7, h.aim, 220, 0xff3020, (g - 0.5) * 0.6, 1);
        } else this.glow(x, y + 2, 8, 0xff3b2f, pulse * 0.6);
        break;
      }
      case 'turret': {
        this.groundUnits.get(art.pad.tex, x, y);
        const b = this.groundUnits.get(art.barrel, x, y);
        b.anchor.set(2.5 / 14, 0.5);
        b.rotation = h.aim;
        flashOver(art.pad.white, 0, 0.5, 0.5, this.groundUnits);
        if (h.state === 1) {
          const locked = h.charge > 1 - 14 / 55;
          const blink = !locked || Math.floor(t * 20) % 2 === 0;
          this.ray(x + Math.cos(h.aim) * 10, y + Math.sin(h.aim) * 10, h.aim, 700, 0xff2a1a, blink ? 0.2 + h.charge * 0.6 : 0.1, locked ? 1.4 : 0.8);
        }
        this.glow(x, y, 7, 0xff3b2f, h.state === 1 ? 1 : pulse * 0.5);
        break;
      }
      case 'flak': {
        this.groundUnits.get(art.sandbags.tex, x, y);
        const b = this.groundUnits.get(art.flakBarrel, x, y);
        b.anchor.set(2.5 / 16, 0.5);
        b.rotation = h.aim;
        flashOver(art.sandbags.white, 0, 0.5, 0.5, this.groundUnits);
        break;
      }
      case 'sam': {
        const sp = this.groundUnits.get(art.sam.tex, x, y);
        sp.rotation = h.aim;
        flashOver(art.sam.white, h.aim, 0.5, 0.5, this.groundUnits);
        if (h.state === 1) {
          const p = sim.player;
          const tx = p.x + p.w / 2, ty = p.y + p.h / 2;
          this.tele.moveTo(x, y).lineTo(tx, ty).stroke({ width: 0.8, color: 0xff3020, alpha: 0.12 + h.charge * 0.3 });
          this.glow(x, y, 14 + h.charge * 10, 0xff3020, 0.5 + 0.5 * Math.sin(t * (6 + h.charge * 20)));
        }
        break;
      }
      case 'tank': {
        this.groundUnits.get(art.tankHull.tex, x, y);
        const tur = this.groundUnits.get(art.tankTurret.tex, x, y - 1);
        tur.anchor.set(4 / 20, 0.5);
        tur.rotation = h.aim;
        flashOver(art.tankHull.white, 0, 0.5, 0.5, this.groundUnits);
        if (h.state === 1) {
          const mx = x + Math.cos(h.aim) * 15, my = y - 1 + Math.sin(h.aim) * 15;
          this.glow(mx, my, 6 + h.charge * 16, 0xff7020, 0.4 + h.charge * 0.6);
        }
        // dust kicked up by the tracks is handled by FX; tread marks are the scorch layer's job
        break;
      }
      case 'depot': {
        this.groundUnits.get(art.depot.tex, x, y);
        flashOver(art.depot.white, 0, 0.5, 0.5, this.groundUnits);
        this.glow(x, y, 8, 0xffc36b, 0.3 + 0.2 * Math.sin(t * 3 + h.id));
        break;
      }
      case 'dam': {
        // concrete wall spanning the canyon; its width is set by the boss controller each tick
        const top = y - h.h / 2, left = x - h.w / 2;
        const g = this.structGfx;
        g.rect(left + 12, top - 10, h.w, h.h).fill({ color: 0x000000, alpha: 0.35 }); // shadow
        g.rect(left, top, h.w, h.h).fill({ color: h.flash > 0 ? 0xd8c8b0 : 0x6a5a4a });
        g.rect(left, top + h.h - 6, h.w, 6).fill({ color: 0x3a3028 }); // face in shade
        g.rect(left, top, h.w, 2).fill({ color: 0xffcf8a, alpha: 0.6 }); // sunlit lip
        for (let px = left + 8; px < left + h.w; px += 16) g.rect(px, top + 3, 1, h.h - 10).fill({ color: 0x3a3028, alpha: 0.6 });
        if (h.shielded) {
          const a = 0.35 + 0.2 * Math.sin(t * 6);
          this.tele.rect(left, top + h.h + 2, h.w, 2).fill({ color: 0x9fe8ff, alpha: a });
          this.tele.rect(left, top - 3, h.w, 1.5).fill({ color: 0x9fe8ff, alpha: a * 0.6 });
        }
        break;
      }
      case 'sluice': {
        this.groundUnits.get(art.sluice.tex, x, y);
        flashOver(art.sluice.white, 0, 0.5, 0.5, this.groundUnits);
        this.brackets(this.tele, x, y, 12 + Math.sin(t * 6) * 1.2, 0xffe070, 0.8);
        this.glow(x, y + 3, 6, 0xff3020, pulse);
        break;
      }
      case 'traincar': {
        this.groundUnits.get(art.trainCar.tex, x, y);
        const b = this.groundUnits.get(art.barrel, x, y);
        b.anchor.set(2.5 / 14, 0.5);
        b.rotation = h.aim;
        flashOver(art.trainCar.white, 0, 0.5, 0.5, this.groundUnits);
        if (h.state === 1) this.ray(x + Math.cos(h.aim) * 10, y + Math.sin(h.aim) * 10, h.aim, 600, 0xff2a1a, 0.15 + h.charge * 0.5, h.charge > 0.75 ? 1.4 : 0.8);
        break;
      }
      case 'engine': {
        this.groundUnits.get(art.engine.tex, x, y);
        flashOver(art.engine.white, 0, 0.5, 0.5, this.groundUnits);
        if (h.state === 1) this.glow(x, y - 16, 8 + h.charge * 18, 0xff7020, 0.4 + h.charge * 0.6);
        if (Math.random() < 0.4) this.glow(x, y - 9, 6, 0xffb060, 0.3); // firebox
        break;
      }
      case 'dish': {
        const sp = this.groundUnits.get(art.dish.tex, x, y);
        sp.rotation = h.aim;
        flashOver(art.dish.white, h.aim, 0.5, 0.5, this.groundUnits);
        if (h.shielded) {
          const a = 0.25 + 0.15 * Math.sin(t * 5);
          this.tele.circle(x, y, 30).stroke({ width: 1.6, color: 0x9fe8ff, alpha: a });
          this.tele.circle(x, y, 30).fill({ color: 0x9fe8ff, alpha: a * 0.18 });
        } else this.brackets(this.tele, x, y, 24, 0xffe070, 0.8, t);
        break;
      }
      case 'shieldgen': {
        this.groundUnits.get(art.shieldGen.tex, x, y);
        flashOver(art.shieldGen.white, 0, 0.5, 0.5, this.groundUnits);
        this.glow(x, y, 14, 0x9fe8ff, 0.5 + 0.3 * Math.sin(t * 8 + h.id));
        this.brackets(this.tele, x, y, 11, 0xffe070, 0.7);
        // beam to the dish
        const dish = sim.hostiles.find((o) => o.kind === 'dish' && o.group === h.group);
        if (dish) {
          const [dx, dy] = this.pos(dish, alpha);
          this.tele.moveTo(x, y).lineTo(dx, dy).stroke({ width: 1, color: 0x9fe8ff, alpha: 0.35 + 0.2 * Math.sin(t * 12 + h.id) });
        }
        break;
      }
      case 'gunship': {
        const scale = h.w / 30;
        this.shadow(art.rival, x, y, 0.5, 0.5, 1.6).scale.set(scale);
        const sp = this.units.get(art.rival.tex, x, y);
        sp.scale.set(scale);
        if (h.variant === 2) sp.tint = 0xffd0a0;
        if (h.variant === 1) sp.tint = 0xd0ffd0;
        sp.rotation = (h.vx || 0) * 0.05;
        flashOver(art.rival.white, sp.rotation);
        this.glow(x, y, 70, 0xff3020, 0.18 + 0.06 * Math.sin(t * 3)); // hostile aura so it reads over any ground
        const rotor = this.units.get(art.rotor, x, y + 4);
        rotor.scale.set(1.35 * scale);
        rotor.rotation = -t * 50;
        // nav lights read hostile: red both sides
        this.glow(x - 13, y - 2, 5, 0xff3020, Math.floor(t * 3) % 2 ? 0.9 : 0.3);
        this.glow(x + 13, y - 2, 5, 0xff3020, Math.floor(t * 3) % 2 ? 0.3 : 0.9);
        if (h.state >= 2 && h.state <= 4 && h.charge > 0) {
          this.glow(x, y + 16, 8 + h.charge * 26, 0xff4020, 0.4 + h.charge * 0.6);
          if (h.state === 2) for (let i = -3; i <= 3; i++) this.ray(x, y + 16, h.aim + i * 0.2, 160, 0xff3020, h.charge * 0.25, 1);
        }
        break;
      }
    }
  }

  /** Thin additive line from (x, y) along `angle`. */
  private ray(x: number, y: number, angle: number, len: number, color: number, alpha: number, width: number): void {
    if (this.access.contrast) {
      // high-contrast: dashed white-and-yellow, readable without relying on red
      const c = Math.cos(angle), s = Math.sin(angle);
      for (let d = 0; d < len; d += 14) {
        this.tele.moveTo(x + c * d, y + s * d).lineTo(x + c * Math.min(len, d + 8), y + s * Math.min(len, d + 8));
        this.tele.stroke({ width: width + 0.6, color: (d / 14) % 2 ? 0xffffff : 0xffe040, alpha: Math.min(1, alpha * 1.8 + 0.2) });
      }
      return;
    }
    this.tele.moveTo(x, y).lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len).stroke({ width, color, alpha });
  }

  /** Four corner brackets around a point. */
  private brackets(g: Graphics, x: number, y: number, r: number, color: number, alpha: number, rot = 0): void {
    const k = r * 0.45;
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2 + Math.PI / 4;
      const cx = x + Math.cos(a) * r, cy = y + Math.sin(a) * r;
      const a1 = a + Math.PI * 0.75, a2 = a - Math.PI * 0.75;
      g.moveTo(cx + Math.cos(a1) * k, cy + Math.sin(a1) * k).lineTo(cx, cy).lineTo(cx + Math.cos(a2) * k, cy + Math.sin(a2) * k);
      g.stroke({ width: 1.2, color, alpha });
    }
  }

  private drawEnemyShots(v: RenderView): void {
    for (const s of v.sim.enemyShots) {
      const [x, y] = this.pos(s, v.alpha);
      if (s.kind === 'sam' || s.kind === 'rocket') {
        const ang = Math.atan2(s.vy, s.vx) + Math.PI / 2;
        this.shadow(this.art.missile, x, y, 0.5, 0.5, 0.8).rotation = ang;
        const sp = this.units.get(this.art.missile.tex, x, y);
        sp.rotation = ang;
        sp.tint = s.kind === 'sam' ? 0xffb0a0 : 0xc0a090;
        sp.scale.set(s.kind === 'sam' ? 1.3 : 1);
        const tx = x - Math.sin(ang) * 8, ty = y + Math.cos(ang) * 8;
        this.glow(tx, ty, 18 * (0.8 + Math.random() * 0.2), 0xff5020, 1);
        this.glow(tx, ty, 6, 0xfff0d0, 1);
        if (s.kind === 'sam' && s.decoy === null) this.glow(x, y, 26, 0xff2010, 0.25 + 0.2 * Math.sin(this.time * 30));
      } else {
        const big = s.kind === 'shell';
        this.glow(x, y, big ? 20 : 13, big ? 0xff6a20 : 0xff3a1a, 0.95);
        this.glow(x, y, big ? 7 : 4.5, 0xfff0d0, 1);
      }
      if (this.access.contrast) {
        // shape-coded outlines: bullets ring, shells square, missiles chevron
        const g = this.hud;
        if (s.kind === 'bullet') g.circle(x, y, 5).stroke({ width: 2.2, color: 0x000000 }).circle(x, y, 5).stroke({ width: 1, color: 0xffffff });
        else if (s.kind === 'shell') g.rect(x - 6, y - 6, 12, 12).stroke({ width: 2.2, color: 0x000000 }).rect(x - 6, y - 6, 12, 12).stroke({ width: 1, color: 0xffe040 });
        else {
          const a = Math.atan2(s.vy, s.vx);
          const pt = (r: number, o: number): [number, number] => [x + Math.cos(a + o) * r, y + Math.sin(a + o) * r];
          const [ax, ay] = pt(10, 0), [bx, by] = pt(8, 2.5), [cx2, cy2] = pt(8, -2.5);
          g.moveTo(bx, by).lineTo(ax, ay).lineTo(cx2, cy2).stroke({ width: 2.6, color: 0x000000 });
          g.moveTo(bx, by).lineTo(ax, ay).lineTo(cx2, cy2).stroke({ width: 1.2, color: 0xffffff });
        }
      }
    }
  }

  private drawHazards(v: RenderView): void {
    const g = this.tele;
    for (const hz of v.sim.hazards) {
      const k = hz.timer / hz.maxTimer; // 1 → 0
      const blink = k < 0.3 && Math.floor(this.time * 16) % 2 === 0;
      g.circle(hz.x, hz.y, hz.r).fill({ color: 0xff3020, alpha: 0.05 + (1 - k) * 0.1 });
      g.circle(hz.x, hz.y, hz.r).stroke({ width: 1.4, color: 0xff3020, alpha: blink ? 0.95 : 0.55 });
      g.circle(hz.x, hz.y, hz.r * k).stroke({ width: 1, color: 0xffb454, alpha: 0.8 });
      g.moveTo(hz.x - hz.r - 5, hz.y).lineTo(hz.x - hz.r + 6, hz.y).moveTo(hz.x + hz.r - 6, hz.y).lineTo(hz.x + hz.r + 5, hz.y);
      g.moveTo(hz.x, hz.y - hz.r - 5).lineTo(hz.x, hz.y - hz.r + 6).moveTo(hz.x, hz.y + hz.r - 6).lineTo(hz.x, hz.y + hz.r + 5);
      g.stroke({ width: 1, color: 0xff3020, alpha: 0.8 });
      if (this.access.contrast) {
        for (let k = -hz.r; k < hz.r; k += 8) g.moveTo(hz.x + k, hz.y - hz.r * 0.7).lineTo(hz.x + k + hz.r * 0.5, hz.y + hz.r * 0.7);
        g.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
        g.circle(hz.x, hz.y, hz.r).stroke({ width: 2, color: 0xffe040, alpha: 0.9 });
      }
    }
  }

  private drawFlares(v: RenderView): void {
    for (const f of v.sim.flareObjs) {
      const [x, y] = this.pos(f, v.alpha);
      const fl = 0.75 + Math.random() * 0.25;
      this.glow(x, y, 22 * fl * Math.min(1, f.life / 20 + 0.3), 0xffd0f0, 0.9);
      this.glow(x, y, 6, 0xffffff, 1);
    }
  }

  private drawPopups(v: RenderView): void {
    let i = 0;
    for (const p of v.fx.popups) {
      let t = this.popupPool[i];
      if (!t) {
        t = new BitmapText({ text: '', style: { fontFamily: 'Share Tech Mono, monospace', fontSize: 40, fill: 0xffffff, letterSpacing: 2 } });
        t.anchor.set(0.5);
        this.popupLayer.addChild(t);
        this.popupPool.push(t);
      }
      i++;
      t.visible = true;
      if (t.text !== p.text) t.text = p.text;
      t.position.set(p.x, p.y);
      const age = 1 - p.life / p.maxLife;
      const pop = age < 0.12 ? 1 + (0.12 - age) * 3 : 1;
      t.scale.set(0.2 * p.size * pop);
      t.tint = p.color;
      t.alpha = Math.min(1, (p.life / p.maxLife) * 2.2);
    }
    for (; i < this.popupPool.length; i++) this.popupPool[i].visible = false;
  }

  private drawProjectiles(v: RenderView): void {
    const art = this.art;
    for (const b of v.sim.bullets) {
      const [x, y] = this.pos(b, v.alpha);
      const sp = this.additive.get(art.streak, x, y);
      sp.rotation = -Math.PI / 2;
      sp.scale.set(1.1, 0.9);
      sp.tint = 0xfff0c0;
      this.glow(x, y - 4, 9, 0xffb454, 0.55);
    }
    for (const m of v.sim.playerMissiles) {
      const [x, y] = this.pos(m, v.alpha);
      const ang = Math.atan2(m.vy, m.vx) + Math.PI / 2;
      this.shadow(art.missile, x, y, 0.5, 0.5, 0.9).rotation = ang;
      const sp = this.units.get(art.missile.tex, x, y);
      sp.rotation = ang;
      const tx = x - Math.sin(ang) * 7, ty = y + Math.cos(ang) * 7; // behind the nose
      const flick = 0.75 + Math.random() * 0.25;
      this.glow(tx, ty, 16 * flick, 0xff9040, 0.95);
      this.glow(tx, ty, 6, 0xfff0d0, 1);
    }
  }

  private drawPlayer(v: RenderView): void {
    const p = v.sim.player;
    const art = this.art;
    const [x, y] = this.pos(p, v.alpha);
    this.bank += (p.steer - this.bank) * 0.18;
    this.rotorAngle += 0.9;
    const visible = !(p.invuln > 0 && Math.floor(p.invuln / 5) % 2 === 0);
    const a = visible ? 1 : 0.35;
    const ANCHOR_Y = 12 / 34;

    // ground shadow (body + rotor disc)
    const sh = this.shadow(art.gunship, x, y, 0.5, ANCHOR_Y, 1.4, a);
    sh.rotation = this.bank * 0.1;
    sh.scale.x = 1 - Math.abs(this.bank) * 0.1;
    const rs = this.shadows.get(art.softGlow, x + SHADOW_OFFSET.x * 1.4, y + SHADOW_OFFSET.y * 1.4);
    rs.scale.set(38 / 32);
    rs.tint = 0x000000;
    rs.alpha = 0.35 * a;

    const body = this.player.get(art.gunship.tex, x, y);
    body.anchor.set(0.5, ANCHOR_Y);
    body.rotation = this.bank * 0.1;
    body.scale.x = 1 - Math.abs(this.bank) * 0.12;
    body.alpha = a;
    if (p.flash > 0) {
      const w = this.player.get(art.gunship.white, x, y);
      w.anchor.set(0.5, ANCHOR_Y);
      w.rotation = body.rotation;
      w.scale.x = body.scale.x;
      w.alpha = (p.flash / 6) * this.access.flash;
      w.tint = 0xffb0a0;
    }
    const rotor = this.player.get(art.rotor, x, y);
    rotor.rotation = this.rotorAngle;
    rotor.alpha = a;

    // nav lights: red port, green starboard, white tail strobe
    const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
    const at = (lx: number, ly: number): [number, number] => [x + lx * c - ly * s, y + lx * s + ly * c];
    const blink = Math.floor(this.time * 2) % 2 === 0;
    const [plx, ply] = at(-9.5 * body.scale.x, 5);
    const [srx, sry] = at(9.5 * body.scale.x, 5);
    this.glow(plx, ply, 4, 0xff3020, blink ? 0.8 : 0.25);
    this.glow(srx, sry, 4, 0x40ff80, blink ? 0.8 : 0.25);
    if (Math.floor(this.time * 10) % 12 === 0) {
      const [tx, ty] = at(0, 18);
      this.glow(tx, ty, 5, 0xffffff, 0.7);
    }
    // muzzle flash at the chin gun
    if (p.muzzle > 0) {
      const k = p.muzzle / 4;
      const [mx, my] = at(0, -13);
      this.glow(mx, my, 7 * k, 0xfff0c0, 0.9);
      this.glow(mx, my, 15 * k, 0xffa040, 0.35);
    }
  }

  private drawHud(v: RenderView): void {
    const sim = v.sim;
    const p = sim.player;
    const [x, y] = this.pos(p, v.alpha);
    const g = this.hud;
    const blink = Math.floor(this.time * 5) % 2 === 0;
    const arc = (a0: number, a1: number, frac: number, low: boolean) => {
      const r = 25;
      g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
      g.arc(x, y, r, a0, a1, a1 < a0);
      g.stroke({ width: 1.4, color: 0x000000, alpha: 0.35 });
      if (frac <= 0) return;
      const end = a0 + (a1 - a0) * Math.max(0, Math.min(1, frac));
      g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
      g.arc(x, y, r, a0, end, a1 < a0);
      g.stroke({ width: 1.6, color: low ? 0xff4a2a : 0xffc36b, alpha: low ? (blink ? 0.95 : 0.4) : 0.65 });
    };
    // shields: left arc filling upward; fuel: right arc filling upward
    arc(Math.PI * 0.72, Math.PI * 1.28, sim.shields / sim.maxShields, sim.shields < sim.maxShields * 0.3);
    arc(Math.PI * 0.28, -Math.PI * 0.28, sim.fuel / 100, sim.fuel < 30);
    // missile pips
    const n = Math.min(sim.missiles, 12);
    for (let i = 0; i < n; i++) g.rect(x - n * 1.25 + i * 2.5, y + 29, 1.4, 3).fill({ color: 0xffc36b, alpha: 0.7 });

    // chain-gun heat bar with the active-cooling window marked
    const hw = 30, hy = y + 35;
    g.rect(x - hw / 2, hy, hw, 2.2).fill({ color: 0x000000, alpha: 0.45 });
    const heat = p.heat / 100;
    const heatCol = p.overheated ? (blink ? 0xff3020 : 0x802010) : heat > COOL_WINDOW[1] / 100 ? 0xff6a2a : 0xffc36b;
    g.rect(x - hw / 2, hy, hw * heat, 2.2).fill({ color: heatCol, alpha: 0.85 });
    const inWindow = p.heat >= COOL_WINDOW[0] && p.heat <= COOL_WINDOW[1] && !p.overheated;
    for (const w of COOL_WINDOW) g.rect(x - hw / 2 + (hw * w) / 100 - 0.4, hy - 1.2, 0.8, 4.6).fill({ color: 0x9fe8ff, alpha: inWindow ? 1 : 0.5 });

    // painted locks and the forward lock cone while holding missile
    for (const id of p.locks) {
      const h = sim.hostiles.find((e) => e.id === id);
      if (h) {
        const [hx, hy2] = this.pos(h, v.alpha);
        this.brackets(g, hx, hy2, Math.max(h.w, h.h) * 0.8 + 3, 0xffe070, 0.95, this.time * 2);
      }
    }
    if (p.missileHold >= LOCK_START) {
      const len = 260;
      for (const sgn of [-1, 1]) g.moveTo(x, y - 10).lineTo(x + sgn * (len * 0.8 + 40), y - 10 - len).stroke({ width: 0.8, color: 0xffe070, alpha: 0.18 });
    }

    // SAM lock: closing reticle on the gunship
    const lock = sim.samLock;
    if (lock > 0) {
      const r = 34 - 20 * lock;
      this.brackets(g, x, y, r, 0xff3020, 0.5 + 0.5 * Math.sin(this.time * (8 + lock * 30)), lock * Math.PI);
    }

    // warning callout
    let msg = '';
    const c = sim.corridorAt(p.y + p.h / 2);
    const samIncoming = sim.enemyShots.some((s) => s.kind === 'sam' && s.decoy === null);
    if (samIncoming) msg = 'MISSILE — FLARE [C]';
    else if (lock > 0) msg = 'MISSILE LOCK';
    else if (p.overheated) msg = 'GUN OVERHEAT';
    else if (sim.shields < sim.maxShields * 0.3) msg = 'SHIELD LOW';
    else if (sim.fuel < 30) msg = 'FUEL LOW';
    else if (p.x - c.left < 18 || c.right - (p.x + p.w) < 18) msg = 'TERRAIN';
    this.warning.visible = msg !== '' && (blink || msg === 'TERRAIN');
    if (msg) {
      this.warning.text = msg;
      this.warning.position.set(x, y - 34);
      this.warning.tint = msg === 'TERRAIN' ? 0xffc36b : 0xff6a4a;
      this.warning.position.set(x, y - 44);
    }
  }

  private drawHitboxes(v: RenderView): void {
    const g = this.debugGfx;
    const p = v.sim.player;
    g.rect(p.x, p.y, p.w, p.h).stroke({ width: 1, color: 0x00ff88 });
    for (const h of v.sim.hostiles) g.rect(h.x, h.y, h.w, h.h).stroke({ width: 1, color: 0xff3366 });
    for (const k of v.sim.pickups) g.rect(k.x, k.y, k.w, k.h).stroke({ width: 1, color: 0x66ccff });
  }
}

function fade(age: number): number {
  return Math.min(1, age * 8) * (1 - age);
}

export type { Particle };
