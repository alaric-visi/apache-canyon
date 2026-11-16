import type { Mixer } from './mixer';

/**
 * Per-sector ambience: a wind bed (brown noise through a slowly wandering
 * band-pass), a sand hiss for the storm, and occasional life: night insects,
 * dawn birds, a distant hawk over the mesa.
 */

export interface AmbienceProfile {
  wind: number;
  /** How much the wind swells and drops. */
  gust: number;
  hiss: number;
  insects: number;
  birds: number;
  hawk: number;
}

/** Indexed by sector (0–5). */
export const AMBIENCE: AmbienceProfile[] = [
  { wind: 0.35, gust: 0.4, hiss: 0, insects: 0, birds: 0, hawk: 0.6 },   // Red Mesa
  { wind: 0.5, gust: 0.6, hiss: 0, insects: 0, birds: 0, hawk: 0.3 },    // The Narrows: wind funnels through
  { wind: 0.3, gust: 0.2, hiss: 0.05, insects: 0, birds: 0, hawk: 0.2 }, // Dry Lake: hot and still
  { wind: 0.9, gust: 1.0, hiss: 0.6, insects: 0, birds: 0, hawk: 0 },    // Sandstorm Pass
  { wind: 0.25, gust: 0.3, hiss: 0, insects: 0.8, birds: 0, hawk: 0 },   // Night Run
  { wind: 0.3, gust: 0.3, hiss: 0, insects: 0.1, birds: 0.8, hawk: 0.3 },// Dawn Strike
];

export class Ambience {
  private readonly windGain: GainNode;
  private readonly windBp: BiquadFilterNode;
  private readonly hissGain: GainNode;
  private profile: AmbienceProfile = AMBIENCE[0];
  private phase = 0;

  constructor(private readonly mix: Mixer, white: AudioBuffer, brown: AudioBuffer) {
    const ctx = mix.ctx;
    const bus = mix.buses.ambience;

    const wind = ctx.createBufferSource();
    wind.buffer = brown;
    wind.loop = true;
    this.windBp = ctx.createBiquadFilter();
    this.windBp.type = 'bandpass';
    this.windBp.frequency.value = 400;
    this.windBp.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windBp).connect(this.windGain).connect(bus);

    const hiss = ctx.createBufferSource();
    hiss.buffer = white;
    hiss.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(hp).connect(this.hissGain).connect(bus);

    wind.start();
    hiss.start(0, 0.7);
  }

  setSector(i: number): void {
    this.profile = AMBIENCE[Math.max(0, Math.min(AMBIENCE.length - 1, i))];
  }

  /** Call once per fixed tick (1/60 s). `on` fades the whole bed. */
  update(on: boolean): void {
    const p = this.profile;
    const t = this.mix.now;
    this.phase += 1 / 60;
    // slow, irregular gusts from two incommensurate sines
    const g = 0.5 + 0.5 * Math.sin(this.phase * 0.31) * Math.sin(this.phase * 0.13 + 1.7);
    const level = on ? p.wind * (1 - p.gust * 0.6 + p.gust * 0.6 * g) : 0;
    this.windGain.gain.setTargetAtTime(level * 0.5, t, 0.4);
    this.windBp.frequency.setTargetAtTime(260 + 500 * g * (0.4 + p.gust), t, 0.6);
    this.hissGain.gain.setTargetAtTime(on ? p.hiss * (0.04 + 0.05 * g) : 0, t, 0.4);

    if (!on) return;
    if (Math.random() < p.insects * 0.02) this.insect();
    if (Math.random() < p.birds * 0.006) this.bird();
    if (Math.random() < p.hawk * 0.0015) this.hawk();
  }

  private chirp(freq: number, to: number, dur: number, vol: number, at: number, pan: number): void {
    const ctx = this.mix.ctx;
    const t0 = this.mix.now + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.mix.buses.ambience);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private insect(): void {
    const f = 4200 + Math.random() * 1500, pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) this.chirp(f, f * 0.97, 0.03, 0.012, i * 0.06, pan);
  }

  private bird(): void {
    const f = 2400 + Math.random() * 1200, pan = Math.random() * 1.6 - 0.8;
    this.chirp(f, f * 1.4, 0.08, 0.015, 0, pan);
    this.chirp(f * 1.2, f * 0.8, 0.12, 0.012, 0.12, pan);
  }

  private hawk(): void {
    const pan = Math.random() * 1.6 - 0.8;
    this.chirp(2600, 1700, 1.1, 0.012, 0, pan);
  }
}
