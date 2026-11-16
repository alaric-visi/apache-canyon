/**
 * The mix: four buses into a master compressor.
 *
 *   sfx ──┐
 *   ui ───┤
 *   music ─ duck ─┤── master ── compressor ── limiter-ish gain ── destination
 *   amb ── duck ──┘
 *
 * Music and ambience pass through a "duck" gain that big explosions pull down
 * for a moment (sidechain-style), so impacts punch through the score.
 * Works on any BaseAudioContext, so the same graph renders offline in checks.
 */

export type Bus = 'sfx' | 'music' | 'ambience' | 'ui';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}

export const DEFAULT_VOLUMES: Volumes = { master: 0.8, music: 0.6, sfx: 0.85, ambience: 0.6 };

/** Perceptual-ish curve so a 0..1 slider feels even. */
export const curve = (v: number) => Math.max(0, Math.min(1, v)) ** 2;

export class Mixer {
  readonly master: GainNode;
  readonly buses: Record<Bus, GainNode>;
  private readonly duckNode: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private muted = false;
  private vol: Volumes = { ...DEFAULT_VOLUMES };

  constructor(readonly ctx: BaseAudioContext) {
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    const out = ctx.createGain();
    out.gain.value = 0.9; // headroom after makeup from the compressor
    this.comp.connect(out).connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(this.comp);

    this.duckNode = ctx.createGain();
    this.duckNode.connect(this.master);

    this.buses = {
      sfx: ctx.createGain(),
      ui: ctx.createGain(),
      music: ctx.createGain(),
      ambience: ctx.createGain(),
    };
    this.buses.sfx.connect(this.master);
    this.buses.ui.connect(this.master);
    this.buses.music.connect(this.duckNode);
    this.buses.ambience.connect(this.duckNode);
    this.apply(0);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setVolumes(v: Volumes): void {
    this.vol = { ...v };
    this.apply(0.05);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.apply(0.05);
  }

  private apply(t: number): void {
    const at = this.ctx.currentTime;
    const set = (g: GainNode, v: number) => (t ? g.gain.setTargetAtTime(v, at, t) : (g.gain.value = v));
    set(this.master, this.muted ? 0 : curve(this.vol.master));
    set(this.buses.sfx, curve(this.vol.sfx));
    set(this.buses.ui, curve(this.vol.sfx) * 0.8);
    set(this.buses.music, curve(this.vol.music) * 2.2);
    set(this.buses.ambience, curve(this.vol.ambience) * 0.8);
  }

  /** Pull music and ambience down by `amount` (0..1), recovering over `release` seconds. */
  duck(amount: number, release = 0.6): void {
    const g = this.duckNode.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(Math.max(0.15, 1 - amount), t + 0.02);
    g.setTargetAtTime(1, t + 0.08, release / 3);
  }
}
