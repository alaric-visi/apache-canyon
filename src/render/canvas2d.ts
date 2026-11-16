import { lerp } from '../core/math';
import { PAL } from '../core/palette';
import { VIEW_H, WORLD_W } from '../world/canyon';
import type { Body, Hostile } from '../entities/types';
import type { RenderView, Renderer } from './renderer';

const ROW_STEP = 4;
const STRATA_SPACING = 56;
const OUTCROP_SPACING = 40;
const MAX_DPR = 2;

/** Pre-rendered soft glow, tinted per colour. Replaces per-draw `shadowBlur`. */
class GlowCache {
  private cache = new Map<string, HTMLCanvasElement>();
  get(color: string): HTMLCanvasElement {
    let c = this.cache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color + '88');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.cache.set(color, c);
    return c;
  }
}

export class Canvas2DRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  /** world → CSS px */
  private scale = 1;
  private offX = 0;
  private offY = 0;
  /** Visible world rect (wider/taller than the playfield when letterboxed). */
  private vis = { x0: 0, y0: 0, x1: WORLD_W, y1: VIEW_H };
  private bg: HTMLCanvasElement = document.createElement('canvas');
  private readonly glow = new GlowCache();
  private readonly ridges: { x: number; y: number }[][];
  private lx = new Float32Array(0);
  private rx = new Float32Array(0);
  private ry = new Float32Array(0);
  private rows = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    // Ridges are generated once in world space so resizing never changes them
    this.ridges = [0, 1].map((layer) => {
      const pts: { x: number; y: number }[] = [];
      let h = VIEW_H * (layer === 0 ? 0.42 : 0.5);
      for (let x = -600; x <= WORLD_W + 600; x += 40) {
        h += (Math.random() - 0.5) * (layer === 0 ? 24 : 34);
        h = Math.max(VIEW_H * 0.25, Math.min(VIEW_H * 0.6, h));
        pts.push({ x, y: h });
      }
      return pts;
    });
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(100, rect.width);
    this.cssH = Math.max(100, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.scale = Math.min(this.cssW / WORLD_W, this.cssH / VIEW_H);
    this.offX = (this.cssW - WORLD_W * this.scale) / 2;
    this.offY = (this.cssH - VIEW_H * this.scale) / 2;
    this.vis = {
      x0: -this.offX / this.scale,
      y0: -this.offY / this.scale,
      x1: (this.cssW - this.offX) / this.scale,
      y1: (this.cssH - this.offY) / this.scale,
    };
    this.rows = Math.ceil((this.vis.y1 - this.vis.y0 + 32) / ROW_STEP) + 1;
    this.lx = new Float32Array(this.rows);
    this.rx = new Float32Array(this.rows);
    this.ry = new Float32Array(this.rows);
    this.buildBackground();
  }

  /** Sky, sun and ridgelines are static: render once per resize into a cache. */
  private buildBackground(): void {
    const bg = this.bg;
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const g = bg.getContext('2d')!;
    this.applyWorldTransform(g, 0, 0);
    const { x0, y0, x1, y1 } = this.vis;

    const sky = g.createLinearGradient(0, y0, 0, VIEW_H * 0.7);
    sky.addColorStop(0, PAL.skyTop);
    sky.addColorStop(0.45, PAL.skyMid);
    sky.addColorStop(1, PAL.skyHorizon);
    g.fillStyle = sky;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);

    const sx = WORLD_W / 2, sy = VIEW_H * 0.44, sr = 70;
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
    glow.addColorStop(0, 'rgba(255,233,184,0.55)');
    glow.addColorStop(0.4, 'rgba(255,180,84,0.22)');
    glow.addColorStop(1, 'rgba(255,180,84,0)');
    g.fillStyle = glow;
    g.fillRect(sx - sr * 3.2, sy - sr * 3.2, sr * 6.4, sr * 6.4);
    g.fillStyle = PAL.sunCore;
    g.beginPath();
    g.arc(sx, sy, sr, 0, Math.PI * 2);
    g.fill();

    const colors = ['rgba(58, 28, 16, 0.75)', 'rgba(107, 47, 26, 0.6)'];
    this.ridges.forEach((pts, i) => {
      g.fillStyle = colors[i];
      g.beginPath();
      g.moveTo(pts[0].x, VIEW_H * 0.65);
      for (const p of pts) g.lineTo(p.x, p.y);
      g.lineTo(pts[pts.length - 1].x, VIEW_H * 0.65);
      g.closePath();
      g.fill();
    });
  }

  private applyWorldTransform(g: CanvasRenderingContext2D, shakeX: number, shakeY: number): void {
    const k = this.dpr * this.scale;
    g.setTransform(k, 0, 0, k, this.dpr * (this.offX + shakeX), this.dpr * (this.offY + shakeY));
  }

  render(v: RenderView): void {
    const g = this.ctx;
    const { sim, fx, alpha } = v;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, 0, 0);

    const sh = fx.shake;
    const shx = sh > 0.1 ? (Math.random() - 0.5) * sh * this.scale : 0;
    const shy = sh > 0.1 ? (Math.random() - 0.5) * sh * this.scale : 0;
    this.applyWorldTransform(g, shx, shy);

    this.drawHaze(v.idle);
    this.drawDust(v);
    const dist = lerp(sim.prevDist, sim.dist, alpha);
    this.sampleWalls(v, dist);
    this.drawWalls(dist);

    g.save();
    this.clipCorridor();
    for (const h of sim.hostiles) if (h.kind === 'gate') this.drawField(h, alpha);
    this.drawPickups(v);
    for (const h of sim.hostiles) if (h.kind !== 'gate') this.drawEnemy(h, alpha);
    this.drawProjectiles(v);
    this.drawParticles(v);
    this.drawPlayer(v);
    if (v.debug) this.drawHitboxes(v);
    g.restore();

  }

  // ---------------------------------------------------------------- world

  private drawHaze(idle: number): void {
    const g = this.ctx;
    const { x0, x1 } = this.vis;
    g.save();
    g.globalAlpha = 0.25;
    g.strokeStyle = 'rgba(255,207,138,0.5)';
    g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const yy = VIEW_H * 0.6 + i * 6;
      g.beginPath();
      g.moveTo(x0, yy + Math.sin(idle * 0.05 + i) * 3);
      for (let x = x0; x <= x1; x += 20) g.lineTo(x, yy + Math.sin(x * 0.03 + idle * 0.06 + i) * 3);
      g.stroke();
    }
    g.restore();
  }

  private drawDust(v: RenderView): void {
    const g = this.ctx;
    for (const m of v.fx.motes) {
      const tw = 0.5 + Math.sin(m.phase) * 0.5;
      g.fillStyle = `rgba(255,208,150,${(m.alpha * tw).toFixed(3)})`;
      g.fillRect(m.x, m.y, m.size, m.size);
    }
  }

  private sampleWalls(v: RenderView, dist: number): void {
    const c = { left: 0, right: 0 };
    const top = this.vis.y0 - 16;
    for (let i = 0; i < this.rows; i++) {
      const y = top + i * ROW_STEP;
      v.sim.canyon.at(dist + (VIEW_H - y), c);
      this.lx[i] = c.left;
      this.rx[i] = c.right;
      this.ry[i] = y;
    }
  }

  private wallPath(xs: Float32Array, edgeX: number): void {
    const g = this.ctx;
    const n = this.rows;
    g.beginPath();
    g.moveTo(edgeX, this.ry[0]);
    for (let i = 0; i < n; i++) g.lineTo(xs[i], this.ry[i]);
    g.lineTo(edgeX, this.ry[n - 1]);
    g.closePath();
  }

  private edgePath(xs: Float32Array): void {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(xs[0], this.ry[0]);
    for (let i = 1; i < this.rows; i++) g.lineTo(xs[i], this.ry[i]);
  }

  private drawWalls(dist: number): void {
    const g = this.ctx;
    const { x0, x1, y0, y1 } = this.vis;
    const rock = g.createLinearGradient(0, y0, 0, y1);
    rock.addColorStop(0, PAL.sandDark);
    rock.addColorStop(1, PAL.sandShadow);
    g.fillStyle = rock;
    this.wallPath(this.lx, x0);
    g.fill();
    this.wallPath(this.rx, x1);
    g.fill();

    // Strata bands, anchored to world distance so they scroll with the ground
    const top = this.ry[0];
    g.save();
    g.globalAlpha = 0.35;
    g.lineWidth = 2;
    const dTop = dist + (VIEW_H - top);
    for (let k = Math.floor(dTop / STRATA_SPACING); ; k--) {
      const y = VIEW_H - (k * STRATA_SPACING - dist);
      if (y > y1 + 8) break;
      const i = Math.round((y - top) / ROW_STEP);
      if (i < 0 || i >= this.rows) continue;
      g.strokeStyle = k % 2 === 0 ? PAL.sandLight : PAL.sandMid;
      g.beginPath();
      g.moveTo(x0, y); g.lineTo(this.lx[i], y);
      g.moveTo(x1, y); g.lineTo(this.rx[i], y);
      g.stroke();
    }
    g.restore();

    // Rim light: wide faint stroke as a cheap glow, then a crisp core
    g.save();
    g.strokeStyle = PAL.rim;
    g.lineJoin = 'round';
    g.globalAlpha = 0.18;
    g.lineWidth = 7;
    this.edgePath(this.lx); g.stroke();
    this.edgePath(this.rx); g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 1.5;
    this.edgePath(this.lx); g.stroke();
    this.edgePath(this.rx); g.stroke();
    g.restore();

    // Outcrop ticks
    g.strokeStyle = 'rgba(58, 28, 16, 0.6)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = Math.floor(dTop / OUTCROP_SPACING); ; k--) {
      const y = VIEW_H - (k * OUTCROP_SPACING - dist);
      if (y > y1 + 8) break;
      const i = Math.round((y - top) / ROW_STEP);
      if (i < 0 || i >= this.rows) continue;
      g.moveTo(this.lx[i], y); g.lineTo(this.lx[i] + 10, y + 6);
      g.moveTo(this.rx[i], y); g.lineTo(this.rx[i] - 10, y + 6);
    }
    g.stroke();

    const haze = g.createLinearGradient(0, VIEW_H * 0.75, 0, y1);
    haze.addColorStop(0, 'rgba(217,138,79,0)');
    haze.addColorStop(1, 'rgba(217,138,79,0.08)');
    g.fillStyle = haze;
    g.fillRect(x0, VIEW_H * 0.75, x1 - x0, y1 - VIEW_H * 0.75);
  }

  private clipCorridor(): void {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(this.lx[0], this.ry[0]);
    for (let i = 1; i < this.rows; i++) g.lineTo(this.lx[i], this.ry[i]);
    for (let i = this.rows - 1; i >= 0; i--) g.lineTo(this.rx[i], this.ry[i]);
    g.closePath();
    g.clip();
  }

  // ---------------------------------------------------------------- entities

  private glowAt(color: string, x: number, y: number, radius: number, a = 1): void {
    const g = this.ctx;
    const prevOp = g.globalCompositeOperation;
    const prevA = g.globalAlpha;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a;
    g.drawImage(this.glow.get(color), x - radius, y - radius, radius * 2, radius * 2);
    g.globalCompositeOperation = prevOp;
    g.globalAlpha = prevA;
  }

  private pos(b: Body, alpha: number): [number, number] {
    return [lerp(b.px, b.x, alpha), lerp(b.py, b.y, alpha)];
  }

  private drawEnemy(e: Hostile, alpha: number): void {
    const g = this.ctx;
    const [x, y] = this.pos(e, alpha);
    const flashing = e.flash > 0;
    const cx = x + e.w / 2, cy = y + e.h / 2;
    this.glowAt(flashing ? PAL.hot : PAL.rust, cx, cy, e.w * (flashing ? 1.4 : 1), flashing ? 0.8 : 0.45);
    g.strokeStyle = flashing ? PAL.hot : PAL.rust;
    g.fillStyle = flashing ? 'rgba(255,245,224,0.5)' : 'rgba(30,15,8,0.85)';
    g.lineWidth = 1;
    g.beginPath();
    if (e.kind === 'drone') {
      g.rect(x, y, e.w, e.h);
      g.fill(); g.stroke();
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + e.w, y + e.h);
      g.moveTo(x + e.w, y); g.lineTo(x, y + e.h);
      g.stroke();
    } else if (e.kind === 'uav') {
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const px = cx + (Math.cos(a) * e.w) / 2, py = cy + (Math.sin(a) * e.h) / 2;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill(); g.stroke();
    } else if (e.kind === 'mine') {
      g.arc(cx, cy, e.w / 2, 0, Math.PI * 2);
      g.fill(); g.stroke();
    } else {
      // everything else (turrets, vehicles, boss structures) as a plain box in the fallback renderer
      g.rect(x, y, e.w, e.h);
      g.fill(); g.stroke();
    }
    g.fillStyle = flashing ? '#ffffff' : PAL.amberBright;
    g.beginPath();
    g.arc(cx, cy, 2, 0, Math.PI * 2);
    g.fill();

    const r = e.hp / e.maxHp;
    g.fillStyle = r > 0.5 ? PAL.amberBright : r > 0.2 ? '#ffcf3a' : PAL.rust;
    g.fillRect(x, y - 4, e.w * r, 2);
  }

  private drawField(f: Hostile, alpha: number): void {
    const g = this.ctx;
    const [x, y] = this.pos(f, alpha);
    g.save();
    g.strokeStyle = f.flash > 0 ? PAL.hot : PAL.amber;
    g.lineWidth = 2;
    g.globalAlpha = 0.3 + Math.sin(f.pulse) * 0.2;
    g.beginPath();
    for (let i = 0; i < f.w; i += 8) {
      const off = Math.sin(f.pulse + i * 0.2) * 4;
      g.moveTo(x + i, y); g.lineTo(x + i + off, y + f.h);
    }
    g.stroke();
    g.globalAlpha = 1;
    g.strokeRect(x, y, f.w, f.h);
    g.fillStyle = PAL.amberBright;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 6; j++) {
        const p = Math.sin(f.pulse + i + j) * 2;
        g.fillRect(x + ((i + 1) * f.w) / 4 + p, y + ((j + 1) * f.h) / 7 + p, 2, 2);
      }
    g.restore();
  }

  private drawPickups(v: RenderView): void {
    const g = this.ctx;
    g.font = '8px "Share Tech Mono", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const k of v.sim.pickups) {
      const [x, y] = this.pos(k, v.alpha);
      const cx = x + k.w / 2, cy = y + k.h / 2;
      this.glowAt(PAL.amberBright, cx, cy, 14, 0.5);
      g.save();
      g.translate(cx, cy);
      g.rotate(k.rot);
      g.strokeStyle = PAL.amberBright;
      g.lineWidth = 1;
      g.fillStyle = 'rgba(240, 164, 76, 0.25)';
      g.beginPath();
      g.moveTo(0, -k.h / 2); g.lineTo(k.w / 2, 0); g.lineTo(0, k.h / 2); g.lineTo(-k.w / 2, 0);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = PAL.amberBright;
      g.fillText(k.kind === 'fuel' ? 'F' : k.kind === 'shield' ? 'S' : 'M', 0, 0);
      g.restore();
    }
  }

  private drawProjectiles(v: RenderView): void {
    const g = this.ctx;
    // enemy fire, hazards and flares (simple shapes in the fallback renderer)
    for (const s of v.sim.enemyShots) {
      const [x, y] = this.pos(s, v.alpha);
      this.glowAt(PAL.rust, x + s.w / 2, y + s.h / 2, s.w * 1.6, 0.9);
      g.fillStyle = PAL.hot;
      g.beginPath(); g.arc(x + s.w / 2, y + s.h / 2, s.w / 3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = PAL.rust;
    g.lineWidth = 1.2;
    for (const hz of v.sim.hazards) {
      g.beginPath(); g.arc(hz.x, hz.y, hz.r, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(hz.x, hz.y, hz.r * (hz.timer / hz.maxTimer), 0, Math.PI * 2); g.stroke();
    }
    for (const f of v.sim.flareObjs) this.glowAt('#ffd0f0', f.x, f.y, 10, 1);
    for (const b of v.sim.bullets) {
      const [x, y] = this.pos(b, v.alpha);
      this.glowAt(PAL.amberBright, x + 1, y + 4, 7, 0.6);
      g.fillStyle = PAL.hot;
      g.fillRect(x, y, b.w, b.h);
    }
    for (const m of v.sim.playerMissiles) {
      const [x, y] = this.pos(m, v.alpha);
      this.glowAt(PAL.rust, x + 2, y + 6, 12, 0.7);
      g.fillStyle = PAL.amberBright;
      g.fillRect(x, y, m.w, m.h);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `rgba(217, 80, 47, ${0.5 - i * 0.15})`;
        g.fillRect(x, y + m.h + i * 3, m.w, 2);
      }
    }
  }

  private drawParticles(v: RenderView): void {
    const g = this.ctx;
    for (const p of v.fx.particles) {
      if (p.delay > 0) continue;
      const age = 1 - p.life / p.maxLife;
      const a = Math.max(0, Math.min(1, p.alpha * (1 - age)));
      const color =
        p.kind === 'smoke' ? `rgba(90,70,80,${(a * 0.6).toFixed(3)})`
        : p.kind === 'dust' ? `rgba(217,160,112,${(a * 0.5).toFixed(3)})`
        : p.kind === 'scorch' || p.kind === 'debris' ? `rgba(20,10,12,${(a * 0.5).toFixed(3)})`
        : `rgba(255,${Math.round(220 - age * 140)},${Math.round(150 - age * 120)},${a.toFixed(3)})`;
      if (p.kind === 'ring') {
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.stroke();
      } else if (p.kind === 'spark') {
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
        g.stroke();
      } else {
        g.fillStyle = color;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(0.5, p.kind === 'flash' ? p.size * 0.5 : p.size), 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawPlayer(v: RenderView): void {
    const g = this.ctx;
    const p = v.sim.player;
    // Blink while invulnerable after a respawn
    if (p.invuln > 0 && Math.floor(p.invuln / 5) % 2 === 0) return;
    const [x, y] = this.pos(p, v.alpha);
    const t = v.sim.tick;

    g.save();
    g.globalAlpha = (0.6 + Math.sin(t * 0.4) * 0.15) * 0.45;
    g.fillStyle = PAL.dust;
    g.beginPath();
    g.ellipse(x + 8, y + 15, 5, 3, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    this.glowAt(PAL.rust, x + 8, y + 9, 14, 0.35);

    g.save();
    // Slight bank into the turn
    g.translate(x + 8, y + 9);
    g.rotate(p.steer * 0.12);
    g.translate(-8, -9);
    g.fillStyle = '#241108';
    g.save();
    g.globalAlpha = 0.3;
    g.fillRect(-8, 2, 32, 1);
    g.restore();
    if (Math.floor(t / 2) % 2 === 0) g.fillRect(-6, 2, 28, 2);
    else g.fillRect(6, 0, 2, 6);
    g.fillRect(4, 6, 8, 6);
    g.fillRect(2, 8, 12, 4);
    g.fillRect(12, 9, 4, 2);
    g.fillRect(15, 7, 2, 6);
    g.fillRect(2, 12, 2, 2);
    g.fillRect(10, 12, 2, 2);
    g.strokeStyle = PAL.rim;
    g.lineWidth = 1;
    g.strokeRect(2, 8, 12, 4);
    g.fillStyle = PAL.amberBright;
    g.fillRect(5, 7, 2, 1.5);
    g.restore();

    if (p.muzzle > 0) {
      const k = p.muzzle / 4;
      this.glowAt(PAL.hot, x + p.w / 2, y - 2, 10 * k, 1);
      g.fillStyle = `rgba(255,230,180,${k})`;
      g.beginPath();
      g.arc(x + p.w / 2, y - 2, 5 * k, 0, Math.PI * 2);
      g.fill();
    }
    if (p.flash > 0) {
      g.strokeStyle = `rgba(217,80,47,${p.flash / 6})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x + p.w / 2, y + p.h / 2, 16, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // ---------------------------------------------------------------- overlays

  private drawHitboxes(v: RenderView): void {
    const g = this.ctx;
    g.lineWidth = 1;
    g.strokeStyle = '#00ff88';
    const p = v.sim.player;
    g.strokeRect(p.x, p.y, p.w, p.h);
    g.strokeStyle = '#ff3366';
    for (const h of v.sim.hostiles) g.strokeRect(h.x, h.y, h.w, h.h);
    g.strokeStyle = '#66ccff';
    for (const k of v.sim.pickups) g.strokeRect(k.x, k.y, k.w, k.h);
  }
}
