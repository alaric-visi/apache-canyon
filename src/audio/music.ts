import type { Mixer } from './mixer';
import { bassPattern, degree, drumPattern, layerMix, leadPattern, midiToHz, PROGRESSIONS, type Hit, type Key, type Pattern } from './theory';

/**
 * Adaptive procedural score: dark desert-western.
 * Four layers (drone, bass, drums, twangy lead with a slap-back echo) fade in
 * with intensity; each sector has its own key, mode and tempo; stingers mark
 * bosses and sector clears. A look-ahead scheduler places notes on the audio
 * clock; `scheduleUntil()` can also drive it manually (offline rendering).
 */

/** Indexed by sector (0–5). */
export const SECTOR_KEYS: Key[] = [
  { root: 38, mode: 'minor', bpm: 84 },             // Red Mesa: D minor
  { root: 40, mode: 'phrygian', bpm: 90 },          // The Narrows: E phrygian
  { root: 45, mode: 'minor', bpm: 96 },             // Dry Lake: A minor
  { root: 37, mode: 'phrygianDominant', bpm: 100 }, // Sandstorm Pass: C# phrygian dominant
  { root: 41, mode: 'minor', bpm: 78 },             // Night Run: F minor, slow and tense
  { root: 38, mode: 'major', bpm: 104 },            // Dawn Strike: D major, the sun comes up
];
export const MENU_KEY: Key = { root: 38, mode: 'dorian', bpm: 72 };

type LayerName = 'drone' | 'bass' | 'drums' | 'lead';

export class Music {
  private readonly layers: Record<LayerName, GainNode>;
  private readonly out: GainNode;
  private readonly echoIn: GainNode;
  private readonly droneOscs: OscillatorNode[] = [];
  private readonly droneLp: BiquadFilterNode;
  private key: Key = MENU_KEY;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private progression = PROGRESSIONS[0];
  private bass: Pattern = [];
  private lead: Pattern = [];
  private drums: Hit[][] = [];
  private intensity = 0;
  private boss = false;
  private menu = true;
  private playing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seed = 1;

  constructor(private readonly mix: Mixer, private readonly noise: AudioBuffer) {
    const ctx = mix.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mix.buses.music);
    const mk = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.out); return g; };
    this.layers = { drone: mk(), bass: mk(), drums: mk(), lead: mk() };

    // slap-back / dotted-eighth echo on the lead (the spaghetti-western sound)
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.32;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    this.echoIn.connect(delay).connect(tone).connect(fb).connect(delay);
    tone.connect(this.layers.lead);

    // drone: root + fifth, detuned saws under a slowly breathing low-pass
    this.droneLp = ctx.createBiquadFilter();
    this.droneLp.type = 'lowpass';
    this.droneLp.frequency.value = 500;
    this.droneLp.Q.value = 2;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.018;
    this.droneLp.connect(droneGain).connect(this.layers.drone);
    for (const [semi, det] of [[0, -6], [0, 7], [7, 3], [12, -4]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.value = midiToHz(this.key.root + semi - 12);
      o.connect(this.droneLp);
      o.start();
      this.droneOscs.push(o);
    }
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.07;
    const bd = ctx.createGain();
    bd.gain.value = 260;
    breathe.connect(bd).connect(this.droneLp.frequency);
    breathe.start();
  }

  /** Start the scheduler (realtime contexts). */
  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.mix.now + 0.1;
    this.out.gain.setTargetAtTime(1, this.mix.now, 0.8);
    if (typeof setInterval !== 'undefined') this.timer = setInterval(() => this.scheduleUntil(this.mix.now + 0.15), 25);
  }

  /** Fade out (pause menu) without losing position. */
  setPaused(p: boolean): void {
    this.out.gain.setTargetAtTime(p ? 0.25 : 1, this.mix.now, 0.3);
  }

  stop(): void {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.out.gain.setTargetAtTime(0, this.mix.now, 0.5);
  }

  /** Switch key/tempo (sector change, menu ↔ run). Patterns regenerate on the next bar. */
  setKey(key: Key, seed: number, menu = false): void {
    this.key = key;
    this.seed = seed;
    this.menu = menu;
    this.progression = PROGRESSIONS[seed % PROGRESSIONS.length];
    const t = this.mix.now;
    this.droneOscs.forEach((o, i) => o.frequency.setTargetAtTime(midiToHz(key.root + [0, 0, 7, 12][i] - 12), t, 1.2));
  }

  setIntensity(i: number, boss: boolean): void {
    this.intensity = i;
    this.boss = boss;
    const m = this.menu ? { drone: 0.9, bass: 0, drums: 0, lead: 0.55 } : layerMix(i, boss);
    const t = this.mix.now;
    for (const k of Object.keys(m) as LayerName[]) this.layers[k].gain.setTargetAtTime(m[k], t, 0.8);
  }

  /** Schedule every sixteenth note that starts before `until` (audio-clock seconds). */
  scheduleUntil(until: number): void {
    if (this.nextTime < this.mix.now - 0.2) this.nextTime = this.mix.now + 0.05; // fell behind (tab hidden)
    while (this.nextTime < until) {
      if (this.step === 0) this.newBar();
      this.playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.key.bpm / 4;
      this.step = (this.step + 1) % 16;
    }
  }

  private newBar(): void {
    const chord = this.progression[this.bar % this.progression.length];
    this.bass = bassPattern(this.key, chord, this.intensity);
    this.lead = leadPattern(this.key, chord, this.seed + Math.floor(this.bar / 4), this.menu ? 0.2 : this.intensity);
    this.drums = drumPattern(this.intensity, this.boss);
    this.bar++;
  }

  private playStep(s: number, t: number): void {
    const b = this.bass[s];
    if (b !== null && b !== undefined && !this.menu) this.pluckBass(midiToHz(b), t);
    const l = this.lead[s];
    if (l !== null && l !== undefined) this.twang(midiToHz(l), t, this.menu ? 0.9 : 0.45);
    if (!this.menu) for (const h of this.drums[s] ?? []) this.drum(h, t);
  }

  // ------------------------------------------------------------------ instruments

  private pluckBass(f: number, t: number): void {
    const ctx = this.mix.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(lp).connect(g).connect(this.layers.bass);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** Baritone-guitar-ish pluck: bright saw through a resonant band-pass, fast decay, vibrato, echo. */
  private twang(f: number, t: number, dur: number): void {
    const ctx = this.mix.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vd = ctx.createGain();
    vd.gain.setValueAtTime(0, t);
    vd.gain.linearRampToValueAtTime(f * 0.006, t + dur * 0.6);
    vib.connect(vd).connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f * 3.2, t);
    bp.frequency.exponentialRampToValueAtTime(f * 1.6, t + dur);
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp).connect(g);
    g.connect(this.layers.lead);
    g.connect(this.echoIn);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }

  private drum(h: Hit, t: number): void {
    const ctx = this.mix.ctx;
    const out = this.layers.drums;
    const tone = (f: number, to: number, dur: number, vol: number) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    const noise = (hp: number, dur: number, vol: number, bp = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = bp ? 'bandpass' : 'highpass';
      f.frequency.value = bp || hp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + dur + 0.02);
    };
    switch (h) {
      case 'k': tone(120, 42, 0.28, 0.32); break;
      case 's': noise(0, 0.09, 0.14, 1900); tone(330, 220, 0.05, 0.05); break;
      case 't': tone(170, 95, 0.22, 0.2); break;
      case 'h': noise(6500, 0.035, 0.035); break;
    }
  }

  // ------------------------------------------------------------------ stingers

  private chord(notes: number[], t: number, dur: number, vol: number, type: OscillatorType = 'sawtooth', lp = 1800): void {
    const ctx = this.mix.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(lp * 0.3, t);
    f.frequency.exponentialRampToValueAtTime(lp, t + dur * 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.out);
    for (const n of notes) for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.value = midiToHz(n);
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** Low brass cluster and a timpani roll: something big is coming. */
  bossEnter(): void {
    const t = this.mix.now + 0.02, k = this.key;
    this.chord([degree(k, 0), degree(k, 0) + 1, degree(k, 4)], t, 2.2, 0.12, 'sawtooth', 1200);
    for (let i = 0; i < 12; i++) {
      const tt = t + i * 0.06;
      const ctx = this.mix.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(110, tt); o.frequency.exponentialRampToValueAtTime(70, tt + 0.15);
      g.gain.setValueAtTime(0.04 + i * 0.012, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.15);
      o.connect(g).connect(this.out); o.start(tt); o.stop(tt + 0.17);
    }
  }

  /** Resolution: the boss is down. */
  bossDown(): void {
    const t = this.mix.now + 0.05, k = this.key;
    this.chord([degree(k, 7), degree(k, 9) + 12, degree(k, 11) + 12], t, 2.6, 0.1, 'triangle', 3000);
  }

  /** Rising fanfare arpeggio. */
  sectorClear(): void {
    const t = this.mix.now + 0.05, k = this.key;
    [0, 2, 4, 7].forEach((d, i) => this.twang(midiToHz(degree(k, d) + 24), t + i * 0.12, 0.9));
  }

  /** Descending minor line. */
  gameOver(): void {
    const t = this.mix.now + 0.05;
    [62, 60, 57, 53].forEach((n, i) => this.twang(midiToHz(n), t + i * 0.28, 1.2));
  }

  /** Full major swell: dawn. */
  complete(): void {
    const t = this.mix.now + 0.05;
    this.chord([50, 54, 57, 62, 66], t, 4, 0.1, 'triangle', 3500);
  }
}
