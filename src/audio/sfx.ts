import type { Bus, Mixer } from './mixer';

/**
 * Procedural sound effects. Every voice is panned by its on-screen x, far
 * explosions are low-passed by distance from the gunship, and each sound type
 * has a voice cap so rapid fire never stacks into clipping.
 */

const WORLD_W = 800;

interface ToneOpts {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  x?: number;
  bus?: Bus;
  /** Optional low-pass cutoff. */
  lp?: number;
  /** Start delay, seconds. */
  at?: number;
  detune?: number;
}

interface NoiseOpts {
  dur: number;
  vol?: number;
  lp?: number;
  hp?: number;
  /** Band-pass centre (sweeps to bpTo). */
  bp?: number;
  bpTo?: number;
  q?: number;
  x?: number;
  bus?: Bus;
  brown?: boolean;
  attack?: number;
  at?: number;
}

export class Sfx {
  private readonly white: AudioBuffer;
  private readonly brown: AudioBuffer;
  private readonly voices = new Map<string, number[]>();

  constructor(private readonly mix: Mixer) {
    const ctx = mix.ctx;
    const n = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, n, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
  }

  get noiseBuffers() {
    return { white: this.white, brown: this.brown };
  }

  /** Voice limiting: false if `max` voices of `name` are still sounding. */
  private allow(name: string, max: number, dur: number): boolean {
    const now = this.mix.now;
    const list = (this.voices.get(name) ?? []).filter((t) => t > now);
    if (list.length >= max) return false;
    list.push(now + dur);
    this.voices.set(name, list);
    return true;
  }

  /** Destination chain: [lowpass] → panner → bus. Returns the node to connect sources into. */
  private out(bus: Bus = 'sfx', x?: number, lp?: number): AudioNode {
    const ctx = this.mix.ctx;
    let node: AudioNode = this.mix.buses[bus];
    if (x !== undefined) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.85, Math.min(0.85, (x / WORLD_W) * 2 - 1));
      pan.connect(node);
      node = pan;
    }
    if (lp !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      f.connect(node);
      node = f;
    }
    return node;
  }

  tone(o: ToneOpts): void {
    const ctx = this.mix.ctx;
    const t0 = this.mix.now + (o.at ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.detune) osc.detune.value = o.detune;
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    const vol = o.vol ?? 0.2;
    const atk = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.out(o.bus, o.x, o.lp));
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  noise(o: NoiseOpts): void {
    const ctx = this.mix.ctx;
    const t0 = this.mix.now + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? this.brown : this.white;
    src.loop = true;
    let head: AudioNode = src;
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.setValueAtTime(f, t0);
      b.Q.value = q;
      head.connect(b);
      head = b;
      return b;
    };
    if (o.hp) filt('highpass', o.hp);
    if (o.bp) {
      const b = filt('bandpass', o.bp, o.q ?? 1.2);
      if (o.bpTo) b.frequency.exponentialRampToValueAtTime(o.bpTo, t0 + o.dur);
    }
    if (o.lp) filt('lowpass', o.lp);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    head.connect(g).connect(this.out(o.bus, o.x));
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.05);
  }

  // ------------------------------------------------------------------ weapons

  gun(x: number): void {
    if (!this.allow('gun', 3, 0.06)) return;
    const p = 1 + (Math.random() - 0.5) * 0.08;
    this.noise({ dur: 0.05, vol: 0.16, bp: 2600 * p, q: 0.9, x });
    this.tone({ freq: 140 * p, to: 70, dur: 0.06, type: 'sine', vol: 0.18, x });
  }

  missile(x: number): void {
    this.noise({ dur: 0.5, vol: 0.18, bp: 600, bpTo: 2400, q: 0.8, x, attack: 0.02 });
    this.tone({ freq: 180, to: 70, dur: 0.35, type: 'sawtooth', vol: 0.07, x, lp: 900 });
  }

  /** Big or small, low-passed by distance from the listener (the gunship). */
  explosion(size: number, x: number, dist: number): void {
    if (!this.allow('boom', 6, 0.4)) return;
    const near = 1 / (1 + dist / 180);
    const lp = 280 + 3200 * near;
    const vol = (0.2 + 0.25 * Math.min(1.5, size) * (0.5 + 0.5 * near)) * 2.2;
    this.noise({ dur: 0.02, vol: vol * 0.6 * near, hp: 2500, x }); // crack
    this.noise({ dur: 0.35 + 0.35 * size, vol, lp, brown: true, x, attack: 0.006 }); // body
    this.tone({ freq: 70 + 40 * near, to: 28, dur: 0.3 + 0.3 * size, type: 'sine', vol: Math.min(0.9, vol * 0.6), x }); // thump
    if (size >= 1.4) this.noise({ dur: 1.2, vol: vol * 0.35, lp: 500, brown: true, x, at: 0.08, attack: 0.1 }); // rumble tail
  }

  armourHit(x: number): void {
    if (!this.allow('ping', 3, 0.05)) return;
    this.tone({ freq: 1500 + Math.random() * 600, to: 900, dur: 0.05, type: 'square', vol: 0.05, x });
    this.noise({ dur: 0.03, vol: 0.06, hp: 3500, x });
  }

  block(x: number): void {
    if (!this.allow('block', 2, 0.05)) return;
    this.tone({ freq: 2400, to: 1100, dur: 0.05, type: 'sawtooth', vol: 0.04, x, lp: 4000 });
  }

  // ------------------------------------------------------------------ enemy

  enemyShot(kind: string, x: number): void {
    if (kind === 'shell') this.tone({ freq: 150, to: 55, dur: 0.22, type: 'square', vol: 0.09, x, lp: 700 });
    else if (kind === 'bullet' && this.allow('epew', 3, 0.08)) this.tone({ freq: 760, to: 360, dur: 0.07, type: 'triangle', vol: 0.06, x });
  }

  /** Each threat has its own wind-up voice so it can be read by ear. */
  telegraph(kind: string, x: number): void {
    switch (kind) {
      case 'drone': this.tone({ freq: 1200, to: 1900, dur: 0.12, vol: 0.06, x }); break;
      case 'gunner': this.tone({ freq: 500, to: 1500, dur: 0.6, type: 'triangle', vol: 0.07, x, attack: 0.3 }); break;
      case 'turret': case 'traincar': this.tone({ freq: 1500, dur: 0.6, type: 'sine', vol: 0.04, x, attack: 0.1 }); break;
      case 'tank': case 'engine': this.noise({ dur: 0.18, vol: 0.12, bp: 380, q: 3, x }); this.tone({ freq: 110, dur: 0.12, type: 'square', vol: 0.05, x, lp: 500 }); break;
      case 'mine': this.tone({ freq: 1900, dur: 0.07, type: 'square', vol: 0.05, x }); break;
      case 'gunship': this.tone({ freq: 196, dur: 0.45, type: 'sawtooth', vol: 0.08, x, lp: 1400, detune: 8 }); this.tone({ freq: 294, dur: 0.45, type: 'sawtooth', vol: 0.06, x, lp: 1400, detune: -8 }); break;
      case 'dish': this.tone({ freq: 400, to: 1600, dur: 0.5, vol: 0.05, x }); break;
    }
  }

  samLaunch(x: number): void {
    this.noise({ dur: 0.9, vol: 0.22, lp: 1100, brown: true, x, attack: 0.03 });
    this.tone({ freq: 260, to: 900, dur: 0.7, type: 'sawtooth', vol: 0.06, x, lp: 1800 });
  }

  flakMark(x: number): void { this.tone({ freq: 90, to: 48, dur: 0.16, vol: 0.18, x }); }
  shieldDown(x: number): void { this.tone({ freq: 900, to: 70, dur: 0.9, type: 'sawtooth', vol: 0.09, x, lp: 2200 }); this.noise({ dur: 0.6, vol: 0.06, hp: 4000, x }); }

  // ------------------------------------------------------------------ player feedback

  pickup(kind: string, x: number): void {
    const base = kind === 'fuel' ? 523 : kind === 'shield' ? 659 : kind === 'missile' ? 587 : kind === 'flare' ? 784 : 698;
    [1, 1.25, 1.5].forEach((m, i) => this.tone({ freq: base * m, dur: 0.12, type: 'sine', vol: 0.12, x, at: i * 0.05 }));
  }

  scrape(x: number): void { if (this.allow('scrape', 2, 0.1)) this.noise({ dur: 0.1, vol: 0.08, bp: 2600, q: 0.6, x }); }
  nearMiss(x: number): void { if (this.allow('whoosh', 2, 0.16)) this.noise({ dur: 0.16, vol: 0.09, bp: 3200, bpTo: 700, q: 1.5, x }); }
  bridge(x: number): void { this.noise({ dur: 0.5, vol: 0.18, bp: 260, bpTo: 900, q: 1, brown: true, x, attack: 0.08 }); }
  flare(x: number): void { this.tone({ freq: 300, to: 120, dur: 0.06, vol: 0.12, x }); this.noise({ dur: 0.45, vol: 0.12, hp: 4500, x, attack: 0.02 }); }
  decoyed(x: number): void { this.tone({ freq: 1100, to: 420, dur: 0.22, vol: 0.08, x }); }
  overheat(x: number): void { this.noise({ dur: 0.6, vol: 0.13, hp: 5000, x, attack: 0.02 }); this.tone({ freq: 150, to: 90, dur: 0.12, type: 'square', vol: 0.08, x, lp: 600 }); }
  coolPerfect(x: number): void { this.tone({ freq: 1319, dur: 0.09, vol: 0.09, x }); this.tone({ freq: 1760, dur: 0.14, vol: 0.08, x, at: 0.05 }); }

  /** Paint ladder: each extra lock climbs a pentatonic step. */
  paint(n: number, x: number): void {
    const steps = [0, 2, 4, 7, 9, 12];
    this.tone({ freq: 880 * Math.pow(2, steps[Math.min(n, steps.length - 1)] / 12), dur: 0.07, type: 'square', vol: 0.06, x, lp: 3500 });
  }

  emp(x: number): void {
    this.tone({ freq: 2200, to: 120, dur: 0.8, vol: 0.12, x });
    this.tone({ freq: 70, to: 30, dur: 1.0, vol: 0.25, x });
    this.noise({ dur: 0.9, vol: 0.18, lp: 900, brown: true, x, attack: 0.02 });
  }

  combo(mult: number): void { this.tone({ freq: 660 * (1 + mult / 6), to: 660 * (1 + mult / 6) * 1.5, dur: 0.12, type: 'triangle', vol: 0.08, bus: 'ui' }); }
  comboBreak(): void { this.tone({ freq: 420, to: 160, dur: 0.28, type: 'triangle', vol: 0.08, bus: 'ui' }); }
  alarm(): void { this.tone({ freq: 660, to: 560, dur: 0.1, type: 'square', vol: 0.06, bus: 'ui', lp: 2500 }); }

  // ------------------------------------------------------------------ UI

  ui(kind: 'move' | 'select' | 'back' | 'buy' | 'start'): void {
    switch (kind) {
      case 'move': this.tone({ freq: 1400, dur: 0.03, type: 'square', vol: 0.03, bus: 'ui', lp: 3000 }); break;
      case 'select': this.tone({ freq: 880, to: 1320, dur: 0.08, type: 'triangle', vol: 0.08, bus: 'ui' }); break;
      case 'back': this.tone({ freq: 700, to: 440, dur: 0.08, type: 'triangle', vol: 0.07, bus: 'ui' }); break;
      case 'buy': [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.12, vol: 0.08, bus: 'ui', at: i * 0.05 })); break;
      case 'start': this.tone({ freq: 440, to: 880, dur: 0.15, type: 'square', vol: 0.08, bus: 'ui', lp: 3000 }); break;
    }
  }
}
