import { CanvasSource, Texture } from 'pixi.js';
import type { PickupKind } from '../../entities/types';

/**
 * All game art is drawn procedurally with Canvas2D at load time (supersampled)
 * and uploaded as textures. No image files. Lighting follows docs/art-bible.md:
 * sun at the lower-left, so left/lower edges catch warm rim light and the
 * right/upper sides fall into cool shadow.
 */

const K = 4; // supersampling factor; textures report sizes in world units

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * K);
  c.height = Math.ceil(h * K);
  const g = c.getContext('2d')!;
  g.scale(K, K);
  return [c, g];
}

function toTexture(c: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: c, resolution: K }) });
}

function bakeCanvas(w: number, h: number, draw: Draw): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  draw(g, w, h);
  return c;
}

/** Same silhouette filled solid white (hit flash overlay). */
function whiteOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Soft black silhouette (ground shadow), padded so the blur isn't clipped. */
function shadowOf(src: HTMLCanvasElement, blurWorld = 1.6): HTMLCanvasElement {
  const pad = Math.ceil(blurWorld * K * 3);
  const c = document.createElement('canvas');
  c.width = src.width + pad * 2; c.height = src.height + pad * 2;
  const g = c.getContext('2d')!;
  g.filter = `blur(${blurWorld * K}px)`;
  g.drawImage(src, pad, pad);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000000';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function litGradient(g: CanvasRenderingContext2D, x0: number, x1: number, light: string, dark: string): CanvasGradient {
  // horizontal-ish gradient from the sun side (lower-left) to the shade side (upper-right)
  const grad = g.createLinearGradient(x0, x1 * 0.6, x1, -x1 * 0.2);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  return grad;
}

export interface SpriteSet {
  tex: Texture;
  white: Texture;
  shadow: Texture;
}

function set(w: number, h: number, draw: Draw, blur = 1.6): SpriteSet {
  const c = bakeCanvas(w, h, draw);
  return { tex: toTexture(c), white: toTexture(whiteOf(c)), shadow: toTexture(shadowOf(c, blur)) };
}

// ------------------------------------------------------------------ gunship

const HULL_LIGHT = '#7a5a40';
const HULL = '#3b2c22';
const HULL_DARK = '#1d1520';
const RIM = '#ffcf8a';

function drawGunship(g: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  g.lineJoin = 'round';

  // tail boom + horizontal stabiliser
  g.fillStyle = litGradient(g, cx - 3, cx + 3, HULL_LIGHT, HULL_DARK);
  g.beginPath();
  g.moveTo(cx - 1.8, 18); g.lineTo(cx + 1.8, 18); g.lineTo(cx + 1.1, h - 4); g.lineTo(cx - 1.1, h - 4);
  g.closePath(); g.fill();
  g.beginPath();
  g.roundRect(cx - 5.5, h - 8, 11, 2.6, 1);
  g.fill();
  // tail fin (seen from above, a thin line) + tail-rotor hub
  g.fillStyle = HULL_DARK;
  g.fillRect(cx + 0.6, h - 5.5, 1.2, 4);

  // stub wings with rocket pods
  g.fillStyle = litGradient(g, cx - 10, cx + 10, HULL_LIGHT, HULL_DARK);
  g.beginPath();
  g.roundRect(cx - 10, 15, 20, 3.4, 1);
  g.fill();
  for (const sx of [-1, 1]) {
    const px = cx + sx * 9.5;
    const pod = g.createLinearGradient(px - 1.8, 0, px + 1.8, 0);
    pod.addColorStop(0, sx < 0 ? '#6e5038' : '#3a2a20');
    pod.addColorStop(1, '#181216');
    g.fillStyle = pod;
    g.beginPath(); g.roundRect(px - 1.8, 12.6, 3.6, 8.2, 1.6); g.fill();
    // rocket tubes
    g.fillStyle = '#0d0a0c';
    for (let i = 0; i < 3; i++) g.beginPath(), g.arc(px - 0.9 + i * 0.9, 13.4, 0.35, 0, Math.PI * 2), g.fill();
  }
  // hellfire rails (inboard)
  g.fillStyle = '#2a201c';
  for (const sx of [-1, 1]) g.fillRect(cx + sx * 6 - 0.8, 13.5, 1.6, 6);

  // fuselage
  const body = g.createLinearGradient(cx - 4.5, 0, cx + 4.5, 0);
  body.addColorStop(0, HULL_LIGHT);
  body.addColorStop(0.35, HULL);
  body.addColorStop(1, HULL_DARK);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(cx, 1.5);
  g.bezierCurveTo(cx + 3.6, 2.5, cx + 4.4, 7, cx + 4.2, 13);
  g.bezierCurveTo(cx + 4.0, 18, cx + 2.6, 21, cx + 1.8, 22);
  g.lineTo(cx - 1.8, 22);
  g.bezierCurveTo(cx - 2.6, 21, cx - 4.0, 18, cx - 4.2, 13);
  g.bezierCurveTo(cx - 4.4, 7, cx - 3.6, 2.5, cx, 1.5);
  g.fill();

  // engine nacelles
  g.fillStyle = '#2a1f1c';
  for (const sx of [-1, 1]) g.beginPath(), g.roundRect(cx + sx * 3.4 - 1.3, 12, 2.6, 6.5, 1.2), g.fill();
  g.fillStyle = '#120d10';
  for (const sx of [-1, 1]) g.fillRect(cx + sx * 3.4 - 0.7, 17.6, 1.4, 1);

  // tandem canopy
  const glass = g.createLinearGradient(cx - 2.5, 3, cx + 2.5, 10);
  glass.addColorStop(0, '#ffd9a0');
  glass.addColorStop(0.25, '#6a4a52');
  glass.addColorStop(1, '#141020');
  g.fillStyle = glass;
  g.beginPath(); g.ellipse(cx, 5.2, 2.1, 2.6, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx, 9.4, 2.4, 2.4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#100c10';
  g.lineWidth = 0.35;
  g.beginPath(); g.moveTo(cx - 2.3, 7.3); g.lineTo(cx + 2.3, 7.3); g.stroke();

  // chin gun
  g.fillStyle = '#100c0e';
  g.beginPath(); g.arc(cx, 2.6, 1, 0, Math.PI * 2); g.fill();
  g.fillRect(cx - 0.3, -0.5, 0.6, 2.5);

  // rim light along the sun-facing (left) edges
  g.strokeStyle = RIM;
  g.globalAlpha = 0.85;
  g.lineWidth = 0.55;
  g.beginPath();
  g.moveTo(cx - 0.5, 1.7);
  g.bezierCurveTo(cx - 3.6, 2.5, cx - 4.4, 7, cx - 4.2, 13);
  g.bezierCurveTo(cx - 4.0, 18, cx - 2.6, 21, cx - 1.8, 22);
  g.stroke();
  g.beginPath(); g.moveTo(cx - 10, 18.2); g.lineTo(cx - 4, 18.2); g.stroke();
  g.beginPath(); g.moveTo(cx - 1.7, 18.5); g.lineTo(cx - 1.1, h - 4); g.stroke();
  g.globalAlpha = 1;
}

function drawRotor(g: CanvasRenderingContext2D, w: number): void {
  const c = w / 2, r = w / 2 - 0.5;
  // faint disc
  const disc = g.createRadialGradient(c, c, 0, c, c, r);
  disc.addColorStop(0, 'rgba(40,30,30,0.05)');
  disc.addColorStop(0.85, 'rgba(60,45,40,0.13)');
  disc.addColorStop(1, 'rgba(255,207,138,0.18)');
  g.fillStyle = disc;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  // motion-blurred blades: smeared wedges trailing each blade
  for (const base of [0, Math.PI]) {
    for (let i = 0; i < 14; i++) {
      const a = base - i * 0.045;
      g.strokeStyle = `rgba(20,14,16,${(0.5 * (1 - i / 14)).toFixed(3)})`;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 2, c + Math.sin(a) * 2);
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      g.stroke();
    }
    // sunlit tip
    g.strokeStyle = 'rgba(255,207,138,0.5)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.arc(c, c, r - 0.6, base - 0.5, base);
    g.stroke();
  }
  g.fillStyle = '#1a1214';
  g.beginPath(); g.arc(c, c, 1.6, 0, Math.PI * 2); g.fill();
}

// ------------------------------------------------------------------ hostiles

const EN_LIGHT = '#6a4a40';
const EN = '#30201e';
const EN_DARK = '#140c12';
const EYE = '#ff3b2f';

function drawDrone(g: CanvasRenderingContext2D, w: number): void {
  const c = w / 2;
  // arms
  g.strokeStyle = EN;
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(5, 5); g.lineTo(w - 5, w - 5);
  g.moveTo(w - 5, 5); g.lineTo(5, w - 5);
  g.stroke();
  // rotor discs
  for (const [x, y] of [[5, 5], [w - 5, 5], [5, w - 5], [w - 5, w - 5]]) {
    const d = g.createRadialGradient(x, y, 0, x, y, 4.6);
    d.addColorStop(0, 'rgba(30,20,20,0.7)');
    d.addColorStop(0.7, 'rgba(60,40,36,0.35)');
    d.addColorStop(1, 'rgba(255,190,130,0.35)');
    g.fillStyle = d;
    g.beginPath(); g.arc(x, y, 4.6, 0, Math.PI * 2); g.fill();
  }
  // body
  g.fillStyle = litGradient(g, c - 5, c + 5, EN_LIGHT, EN_DARK);
  g.beginPath(); g.roundRect(c - 4.5, c - 4.5, 9, 9, 2.5); g.fill();
  g.strokeStyle = '#d9502f';
  g.lineWidth = 0.6;
  g.stroke();
  // rim
  g.strokeStyle = RIM;
  g.globalAlpha = 0.7;
  g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(c - 4.3, c - 2); g.lineTo(c - 4.3, c + 4.3); g.lineTo(c + 2, c + 4.3); g.stroke();
  g.globalAlpha = 1;
  // sensor
  g.fillStyle = EYE;
  g.beginPath(); g.arc(c, c + 1.5, 1.4, 0, Math.PI * 2); g.fill();
}

function drawUav(g: CanvasRenderingContext2D, w: number, h: number): void {
  const c = w / 2;
  // delta wing pointing down-screen, toward the player
  g.fillStyle = litGradient(g, 0, w, EN_LIGHT, EN_DARK);
  g.beginPath();
  g.moveTo(c, h - 1);
  g.lineTo(w - 1, 5);
  g.lineTo(c + 3, 7);
  g.lineTo(c, 2);
  g.lineTo(c - 3, 7);
  g.lineTo(1, 5);
  g.closePath(); g.fill();
  g.strokeStyle = '#d9502f';
  g.lineWidth = 0.6;
  g.stroke();
  // twin tails
  g.fillStyle = EN_DARK;
  g.fillRect(c - 4, 2, 1.2, 5);
  g.fillRect(c + 2.8, 2, 1.2, 5);
  // spine + intake
  g.fillStyle = '#4a3430';
  g.beginPath(); g.roundRect(c - 1.6, 4, 3.2, h - 8, 1.5); g.fill();
  // rim along the left leading edge
  g.strokeStyle = RIM;
  g.globalAlpha = 0.8;
  g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(1.3, 5.4); g.lineTo(c - 0.4, h - 1.5); g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = EYE;
  g.beginPath(); g.arc(c, h - 6, 1.3, 0, Math.PI * 2); g.fill();
}

function drawMine(g: CanvasRenderingContext2D, w: number): void {
  const c = w / 2, r = w / 2 - 4;
  g.fillStyle = '#2a1e1c';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(a - 0.22) * r, c + Math.sin(a - 0.22) * r);
    g.lineTo(c + Math.cos(a) * (r + 3.6), c + Math.sin(a) * (r + 3.6));
    g.lineTo(c + Math.cos(a + 0.22) * r, c + Math.sin(a + 0.22) * r);
    g.fill();
  }
  const body = g.createRadialGradient(c - r * 0.4, c + r * 0.4, 0.5, c, c, r);
  body.addColorStop(0, '#9a6a4a');
  body.addColorStop(0.4, '#4a3028');
  body.addColorStop(1, '#120a10');
  g.fillStyle = body;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d9502f';
  g.lineWidth = 0.5;
  g.beginPath(); g.arc(c, c, r * 0.55, 0, Math.PI * 2); g.stroke();
}

// ------------------------------------------------------------------ pickups & ordnance

function drawPickup(kind: PickupKind): Draw {
  return (g, w) => {
    const c = w / 2;
    // canopy, drawn offset up-screen (it's above the crate)
    const cy = 8, cr = 8;
    g.strokeStyle = 'rgba(40,30,25,0.8)';
    g.lineWidth = 0.35;
    for (const x of [c - 4, c - 1.5, c + 1.5, c + 4]) {
      g.beginPath(); g.moveTo(x, cy); g.lineTo(c + (x - c) * 0.5, 19); g.stroke();
    }
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 === 0 ? '#e8763a' : '#f4e2c4';
      g.beginPath();
      g.moveTo(c, cy);
      g.arc(c, cy, cr, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2);
      g.closePath();
      g.fill();
    }
    const shade = g.createRadialGradient(c - 3, cy + 3, 1, c, cy, cr);
    shade.addColorStop(0, 'rgba(255,230,190,0.25)');
    shade.addColorStop(1, 'rgba(40,20,40,0.45)');
    g.fillStyle = shade;
    g.beginPath(); g.arc(c, cy, cr, 0, Math.PI * 2); g.fill();

    // crate
    const bx = c - 5, by = 18;
    g.fillStyle = litGradient(g, bx, bx + 10, '#9a7040', '#3a2818');
    g.fillRect(bx, by, 10, 10);
    g.strokeStyle = '#1c1208';
    g.lineWidth = 0.5;
    g.strokeRect(bx + 0.25, by + 0.25, 9.5, 9.5);
    g.strokeStyle = RIM;
    g.globalAlpha = 0.7;
    g.beginPath(); g.moveTo(bx + 0.3, by + 0.5); g.lineTo(bx + 0.3, by + 9.7); g.lineTo(bx + 9.5, by + 9.7); g.stroke();
    g.globalAlpha = 1;
    // icon
    g.fillStyle = '#ffc36b';
    g.strokeStyle = '#ffc36b';
    const ix = c, iy = by + 5;
    if (kind === 'fuel') {
      g.beginPath(); g.roundRect(ix - 2.4, iy - 3, 4.8, 6, 0.8); g.fill();
      g.fillStyle = '#3a2818'; g.fillRect(ix - 1.4, iy - 1.2, 2.8, 0.7); g.fillRect(ix - 1.4, iy + 0.4, 2.8, 0.7);
    } else if (kind === 'shield') {
      g.beginPath(); g.moveTo(ix, iy - 3.2); g.lineTo(ix + 2.8, iy - 2); g.lineTo(ix + 2.4, iy + 1); g.lineTo(ix, iy + 3.2); g.lineTo(ix - 2.4, iy + 1); g.lineTo(ix - 2.8, iy - 2); g.closePath(); g.fill();
    } else if (kind === 'flare') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillRect(ix + Math.cos(a) * 1.2 - 0.4, iy + Math.sin(a) * 1.2 - 0.4, Math.cos(a) * 2.2 + 0.8, Math.sin(a) * 2.2 + 0.8);
      }
      g.beginPath(); g.arc(ix, iy, 1.3, 0, Math.PI * 2); g.fill();
    } else if (kind === 'spread') {
      g.lineWidth = 0.9;
      for (const a of [-0.45, 0, 0.45]) { g.beginPath(); g.moveTo(ix, iy + 3); g.lineTo(ix + Math.sin(a) * 4, iy + 3 - Math.cos(a) * 6); g.stroke(); }
    } else {
      g.fillRect(ix - 0.8, iy - 2, 1.6, 4.6);
      g.beginPath(); g.moveTo(ix - 0.8, iy - 2); g.lineTo(ix, iy - 3.4); g.lineTo(ix + 0.8, iy - 2); g.fill();
      g.fillRect(ix - 2, iy + 1.6, 4, 1);
    }
  };
}

function drawMissile(g: CanvasRenderingContext2D, w: number, h: number): void {
  const c = w / 2;
  g.fillStyle = '#d8c8b0';
  g.beginPath(); g.roundRect(c - 1, 1.5, 2, h - 3, 1); g.fill();
  g.fillStyle = '#2a2020';
  g.beginPath(); g.moveTo(c - 1, 1.6); g.lineTo(c, 0); g.lineTo(c + 1, 1.6); g.fill();
  g.fillRect(c - 2.2, h - 3.5, 4.4, 1.2);
  g.fillStyle = '#ffcf8a';
  g.fillRect(c - 1, 2, 0.5, h - 5);
}

function drawPylon(g: CanvasRenderingContext2D, w: number): void {
  const c = w / 2;
  g.fillStyle = litGradient(g, 0, w, '#6a4a3a', '#140c12');
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = c + Math.cos(a) * (w / 2 - 0.5), y = c + Math.sin(a) * (w / 2 - 0.5);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  g.strokeStyle = '#f0a44c';
  g.lineWidth = 0.6;
  g.stroke();
  g.fillStyle = '#ffc36b';
  g.beginPath(); g.arc(c, c, 1.8, 0, Math.PI * 2); g.fill();
}


// ------------------------------------------------------------------ Phase 3 hostiles

function drawGunner(g: CanvasRenderingContext2D, w: number, h: number): void {
  const c = w / 2, cy = h / 2;
  // H-frame with two big tilt-rotor discs
  g.strokeStyle = EN;
  g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(4, cy); g.lineTo(w - 4, cy); g.stroke();
  for (const x of [5.5, w - 5.5]) {
    const d = g.createRadialGradient(x, cy, 0, x, cy, 5.5);
    d.addColorStop(0, 'rgba(30,20,20,0.75)');
    d.addColorStop(0.7, 'rgba(60,40,36,0.35)');
    d.addColorStop(1, 'rgba(255,190,130,0.4)');
    g.fillStyle = d;
    g.beginPath(); g.arc(x, cy, 5.5, 0, Math.PI * 2); g.fill();
  }
  // armoured body
  g.fillStyle = litGradient(g, c - 6, c + 6, EN_LIGHT, EN_DARK);
  g.beginPath(); g.roundRect(c - 5.5, cy - 6, 11, 12, 3); g.fill();
  g.strokeStyle = '#d9502f'; g.lineWidth = 0.6; g.stroke();
  // twin gun pods pointing down-screen
  g.fillStyle = '#120c10';
  g.fillRect(c - 3.4, cy + 4, 1.6, 5);
  g.fillRect(c + 1.8, cy + 4, 1.6, 5);
  g.strokeStyle = RIM; g.globalAlpha = 0.7; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(c - 5.3, cy - 3); g.lineTo(c - 5.3, cy + 5.8); g.lineTo(c + 1, cy + 5.8); g.stroke();
  g.globalAlpha = 1;
}

function drawPad(g: CanvasRenderingContext2D, w: number): void {
  // octagonal concrete emplacement pad with bolts
  const c = w / 2, r = w / 2 - 0.5;
  g.fillStyle = litGradient(g, 0, w, '#6a5040', '#1c1418');
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); else g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  g.strokeStyle = '#120c0e'; g.lineWidth = 0.5; g.stroke();
  g.fillStyle = '#d9502f';
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.beginPath(); g.arc(c + Math.cos(a) * r * 0.7, c + Math.sin(a) * r * 0.7, 0.6, 0, Math.PI * 2); g.fill(); }
}

function drawSandbags(g: CanvasRenderingContext2D, w: number): void {
  const c = w / 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = c + Math.cos(a) * (w / 2 - 2.6), y = c + Math.sin(a) * (w / 2 - 2.6);
    const lit = Math.cos(a - 2.6) * 0.5 + 0.5;
    g.fillStyle = `rgb(${Math.round(90 + lit * 70)},${Math.round(70 + lit * 50)},${Math.round(50 + lit * 30)})`;
    g.beginPath(); g.ellipse(x, y, 2.6, 1.7, a + Math.PI / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,12,10,0.6)'; g.lineWidth = 0.3; g.stroke();
  }
  g.fillStyle = '#2a201c';
  g.beginPath(); g.arc(c, c, w / 2 - 5, 0, Math.PI * 2); g.fill();
}

/** Barrel pointing along +x from the pivot at (2, h/2). */
function drawBarrel(len: number, thick: number, twin = false): Draw {
  return (g, _w, h) => {
    const cy = h / 2;
    g.fillStyle = '#2a2020';
    g.beginPath(); g.arc(2.5, cy, thick + 1.2, 0, Math.PI * 2); g.fill();
    const offs = twin ? [-thick * 0.9, thick * 0.9] : [0];
    for (const o of offs) {
      const grad = g.createLinearGradient(0, cy + o - thick / 2, 0, cy + o + thick / 2);
      grad.addColorStop(0, '#1a1214'); grad.addColorStop(1, '#6a5244');
      g.fillStyle = grad;
      g.fillRect(2, cy + o - thick / 2, len, thick);
      g.fillStyle = '#0a0608';
      g.fillRect(2 + len - 1, cy + o - thick / 2, 1, thick);
    }
  };
}

function drawSam(g: CanvasRenderingContext2D, w: number): void {
  drawPad(g, w);
  const c = w / 2;
  // four launch tubes pointing along +x (rotated to aim at runtime)
  for (const o of [-4.5, -1.5, 1.5, 4.5]) {
    g.fillStyle = '#3a3030';
    g.fillRect(c - 5, c + o - 1.2, 11, 2.4);
    g.fillStyle = '#e8dccc';
    g.fillRect(c + 5, c + o - 0.9, 2, 1.8);
    g.fillStyle = '#d9502f';
    g.fillRect(c + 6.4, c + o - 0.9, 0.7, 1.8);
  }
}

function drawTankHull(g: CanvasRenderingContext2D, w: number, h: number): void {
  // tracks
  g.fillStyle = '#1a1414';
  g.fillRect(0.5, 1, 4, h - 2);
  g.fillRect(w - 4.5, 1, 4, h - 2);
  g.fillStyle = '#3a3030';
  for (let y = 2; y < h - 2; y += 2) { g.fillRect(0.8, y, 3.4, 0.6); g.fillRect(w - 4.2, y, 3.4, 0.6); }
  // hull
  g.fillStyle = litGradient(g, 4, w - 4, '#7a6040', '#2a2018');
  g.beginPath(); g.roundRect(3.5, 2, w - 7, h - 4, 1.5); g.fill();
  g.strokeStyle = '#120c0a'; g.lineWidth = 0.4; g.stroke();
  g.strokeStyle = RIM; g.globalAlpha = 0.6; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(3.8, 3); g.lineTo(3.8, h - 2.5); g.stroke();
  g.globalAlpha = 1;
  // engine deck grille at the back (top of the sprite: tanks drive up-screen)
  g.fillStyle = '#1a1210';
  for (let i = 0; i < 3; i++) g.fillRect(6, 3.5 + i * 1.4, w - 12, 0.6);
}

function drawTankTurret(g: CanvasRenderingContext2D, w: number, h: number): void {
  drawBarrel(13, 1.8)(g, w, h);
  const cy = h / 2;
  g.fillStyle = litGradient(g, 0, 10, '#8a6e48', '#2a2018');
  g.beginPath(); g.ellipse(4, cy, 4.6, 4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#120c0a'; g.lineWidth = 0.4; g.stroke();
  g.fillStyle = '#1a1210';
  g.beginPath(); g.arc(3, cy - 1.2, 1.1, 0, Math.PI * 2); g.fill();
}

function drawRival(g: CanvasRenderingContext2D, w: number, h: number): void {
  // the player's gunship silhouette in hostile livery, nose pointing down-screen
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(Math.PI);
  g.scale(w / 24, h / 34);
  g.translate(-12, -17);
  drawGunship(g, 24, 34);
  g.restore();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(120,20,20,0.45)';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}


// ------------------------------------------------------------------ Phase 4: depots and boss structures

function drawDepot(g: CanvasRenderingContext2D, w: number): void {
  // three fuel tanks on a pad, connected by pipes
  g.fillStyle = '#2a201a';
  g.fillRect(1, 1, w - 2, w - 2);
  g.strokeStyle = '#4a3a2c'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(5, 5); g.lineTo(w - 5, w - 5); g.moveTo(w - 5, 5); g.lineTo(5, w - 5); g.stroke();
  for (const [x, y, r] of [[5.5, 6, 4], [w - 5.5, 7, 3.6], [w / 2, w - 5.5, 4.2]] as const) {
    const grad = g.createRadialGradient(x - r * 0.4, y + r * 0.4, 0.3, x, y, r);
    grad.addColorStop(0, '#f0e0c0'); grad.addColorStop(0.5, '#b09070'); grad.addColorStop(1, '#3a2a20');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9502f';
    g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill();
  }
}

function drawSluice(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = litGradient(g, 0, w, '#8a8070', '#2a2622');
  g.fillRect(0.5, 0.5, w - 1, h - 1);
  // hazard stripes
  g.save();
  g.beginPath(); g.rect(1, h - 4, w - 2, 3); g.clip();
  for (let x = -h; x < w + h; x += 3) { g.fillStyle = (x / 3) % 2 ? '#1a1410' : '#e8a030'; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 1.5, h); g.lineTo(x + 4.5, h - 4); g.lineTo(x + 3, h - 4); g.fill(); }
  g.restore();
  g.fillStyle = '#141010';
  for (let i = 0; i < 3; i++) g.fillRect(3 + i * ((w - 6) / 3), 2, (w - 6) / 3 - 1.5, h - 7);
  g.strokeStyle = RIM; g.globalAlpha = 0.6; g.lineWidth = 0.5;
  g.strokeRect(0.7, 0.7, w - 1.4, h - 1.4);
  g.globalAlpha = 1;
}

function drawTrainCar(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#121010';
  g.fillRect(2, 1, 2, h - 2); g.fillRect(w - 4, 1, 2, h - 2); // wheels/bogies
  g.fillStyle = litGradient(g, 0, w, '#7a6650', '#241c18');
  g.beginPath(); g.roundRect(3, 2, w - 6, h - 4, 1.5); g.fill();
  g.strokeStyle = '#100c0a'; g.lineWidth = 0.4; g.stroke();
  // armour plates
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 5; y < h - 4; y += 6) g.fillRect(4, y, w - 8, 0.6);
  // turret ring
  g.fillStyle = '#2a2220';
  g.beginPath(); g.arc(w / 2, h / 2, 5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = RIM; g.globalAlpha = 0.6; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(3.3, 3); g.lineTo(3.3, h - 3); g.stroke();
  g.globalAlpha = 1;
}

function drawEngine(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#121010';
  g.fillRect(1.5, 2, 2.4, h - 4); g.fillRect(w - 3.9, 2, 2.4, h - 4);
  g.fillStyle = litGradient(g, 0, w, '#9a5a3a', '#2a1410');
  g.beginPath(); g.moveTo(w / 2, 0.5); g.lineTo(w - 3, 7); g.lineTo(w - 3, h - 2); g.lineTo(3, h - 2); g.lineTo(3, 7); g.closePath(); g.fill();
  g.strokeStyle = '#100808'; g.lineWidth = 0.5; g.stroke();
  // cab and boiler
  g.fillStyle = '#3a2420'; g.fillRect(5, h - 13, w - 10, 9);
  g.fillStyle = '#ffcf8a'; g.fillRect(6.5, h - 11.5, w - 13, 1.6);
  g.fillStyle = '#1a1010';
  g.beginPath(); g.arc(w / 2, 12, 3, 0, Math.PI * 2); g.fill(); // smokestack
  g.fillStyle = '#d9502f'; g.fillRect(w / 2 - 4, 3, 8, 1.2); // cow-catcher stripe
  g.strokeStyle = RIM; g.globalAlpha = 0.7; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(w / 2, 0.8); g.lineTo(3.3, 7); g.lineTo(3.3, h - 2.5); g.stroke();
  g.globalAlpha = 1;
}

function drawDish(g: CanvasRenderingContext2D, w: number): void {
  const c = w / 2, r = w / 2 - 1;
  const grad = g.createRadialGradient(c - r * 0.35, c + r * 0.35, 1, c, c, r);
  grad.addColorStop(0, '#e8e0d0'); grad.addColorStop(0.55, '#8a8478'); grad.addColorStop(1, '#2a2826');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(30,26,24,0.55)'; g.lineWidth = 0.4;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke(); }
  for (const k of [0.35, 0.7]) { g.beginPath(); g.arc(c, c, r * k, 0, Math.PI * 2); g.stroke(); }
  // feed horn on a tripod, pointing along +x
  g.strokeStyle = '#1a1614'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(c + r * 0.6, c - 2); g.lineTo(c + r * 1.0, c); g.lineTo(c + r * 0.6, c + 2); g.stroke();
  g.fillStyle = '#d9502f'; g.beginPath(); g.arc(c + r * 0.95, c, 1.6, 0, Math.PI * 2); g.fill();
}

function drawShieldGen(g: CanvasRenderingContext2D, w: number): void {
  drawPad(g, w);
  const c = w / 2;
  for (const r of [4.2, 2.8]) { g.strokeStyle = '#9fe8ff'; g.lineWidth = 0.8; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#e8fbff'; g.beginPath(); g.arc(c, c, 1.4, 0, Math.PI * 2); g.fill();
}

// ------------------------------------------------------------------ fx textures (white, tinted at runtime)

function radial(size: number, stops: [number, number][]): HTMLCanvasElement {
  return bakeCanvas(size, size, (g) => {
    const c = size / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    for (const [o, a] of stops) grad.addColorStop(o, `rgba(255,255,255,${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}

function puff(size: number, seed: number): HTMLCanvasElement {
  // lumpy smoke puff: several overlapping soft blobs, lit from the lower-left
  return bakeCanvas(size, size, (g) => {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const c = size / 2;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * size * 0.18;
      const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, r = size * (0.22 + rnd() * 0.16);
      const grad = g.createRadialGradient(x - r * 0.3, y + r * 0.3, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.3)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
}

function streak(): HTMLCanvasElement {
  return bakeCanvas(16, 4, (g) => {
    const grad = g.createLinearGradient(0, 0, 16, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(8, 2, 8, 1.2, 0, 0, Math.PI * 2); g.fill();
  });
}

function ring(): HTMLCanvasElement {
  return bakeCanvas(32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 10, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  });
}

function scorch(): HTMLCanvasElement {
  return bakeCanvas(32, 32, (g) => {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 7;
      const x = 16 + Math.cos(a) * d, y = 16 + Math.sin(a) * d, r = 4 + Math.random() * 7;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(20,10,12,0.35)');
      grad.addColorStop(1, 'rgba(20,10,12,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // radial blast streaks
    g.strokeStyle = 'rgba(15,8,10,0.35)';
    g.lineWidth = 0.6;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      g.beginPath(); g.moveTo(16 + Math.cos(a) * 5, 16 + Math.sin(a) * 5); g.lineTo(16 + Math.cos(a) * (10 + Math.random() * 5), 16 + Math.sin(a) * (10 + Math.random() * 5)); g.stroke();
    }
  });
}

function chunk(): HTMLCanvasElement {
  return bakeCanvas(6, 6, (g) => {
    g.fillStyle = '#1a1210';
    g.beginPath(); g.moveTo(1, 2); g.lineTo(4, 0.5); g.lineTo(5.5, 3); g.lineTo(3.5, 5.5); g.lineTo(0.5, 4.5); g.closePath(); g.fill();
    g.fillStyle = '#c08050';
    g.fillRect(1, 3, 2, 1);
  });
}

export interface Art {
  gunship: SpriteSet;
  rotor: Texture;
  drone: SpriteSet;
  uav: SpriteSet;
  mine: SpriteSet;
  pickups: Record<PickupKind, SpriteSet>;
  gunner: SpriteSet;
  pad: SpriteSet;
  sandbags: SpriteSet;
  barrel: Texture;
  flakBarrel: Texture;
  sam: SpriteSet;
  tankHull: SpriteSet;
  tankTurret: SpriteSet;
  rival: SpriteSet;
  depot: SpriteSet;
  sluice: SpriteSet;
  trainCar: SpriteSet;
  engine: SpriteSet;
  dish: SpriteSet;
  shieldGen: SpriteSet;
  missile: SpriteSet;
  pylon: Texture;
  glow: Texture;
  softGlow: Texture;
  puffs: Texture[];
  streak: Texture;
  ring: Texture;
  scorch: Texture[];
  chunk: Texture;
}

export function bakeArt(): Art {
  return {
    gunship: set(24, 34, drawGunship, 1.4),
    rotor: toTexture(bakeCanvas(38, 38, (g, w) => drawRotor(g, w))),
    drone: set(24, 24, (g, w) => drawDrone(g, w)),
    uav: set(26, 22, drawUav),
    mine: set(22, 22, (g, w) => drawMine(g, w)),
    pickups: {
      fuel: set(20, 30, drawPickup('fuel')),
      shield: set(20, 30, drawPickup('shield')),
      missile: set(20, 30, drawPickup('missile')),
      flare: set(20, 30, drawPickup('flare')),
      spread: set(20, 30, drawPickup('spread')),
    },
    gunner: set(26, 22, drawGunner),
    pad: set(16, 16, (g, w) => drawPad(g, w), 0.8),
    sandbags: set(20, 20, (g, w) => drawSandbags(g, w), 0.8),
    barrel: toTexture(bakeCanvas(14, 8, drawBarrel(10, 2))),
    flakBarrel: toTexture(bakeCanvas(16, 10, drawBarrel(12, 1.6, true))),
    sam: set(22, 22, (g, w) => drawSam(g, w), 0.8),
    tankHull: set(18, 24, drawTankHull, 0.8),
    tankTurret: set(20, 10, drawTankTurret, 0.8),
    rival: set(32, 44, drawRival, 1.8),
    depot: set(20, 20, (g, w) => drawDepot(g, w), 0.8),
    sluice: set(20, 14, drawSluice, 0.6),
    trainCar: set(22, 36, drawTrainCar, 0.8),
    engine: set(24, 42, drawEngine, 0.8),
    dish: set(40, 40, (g, w) => drawDish(g, w), 1),
    shieldGen: set(16, 16, (g, w) => drawShieldGen(g, w), 0.6),
    missile: set(5, 13, drawMissile, 0.8),
    pylon: toTexture(bakeCanvas(12, 12, (g, w) => drawPylon(g, w))),
    glow: toTexture(radial(32, [[0, 1], [0.25, 0.6], [1, 0]])),
    softGlow: toTexture(radial(32, [[0, 0.5], [0.5, 0.18], [1, 0]])),
    puffs: [0, 1, 2, 3].map((s) => toTexture(puff(24, s + 1))),
    streak: toTexture(streak()),
    ring: toTexture(ring()),
    scorch: [0, 1].map(() => toTexture(scorch())),
    chunk: toTexture(chunk()),
  };
}
