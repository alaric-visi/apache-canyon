import type { Mixer } from './mixer';

/**
 * The gunship: a rotor "thwop" (band-passed noise amplitude-modulated at the
 * blade-pass rate), a low turbine hum, and a thin turbine whine that rises when
 * boosting. Panned with the gunship. RPM follows flight speed.
 */
export class RotorEngine {
  private readonly out: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly lfo: OscillatorNode;
  private readonly hum: OscillatorNode;
  private readonly whine: OscillatorNode;
  private readonly whineGain: GainNode;
  private readonly bp: BiquadFilterNode;

  constructor(private readonly mix: Mixer, noise: AudioBuffer) {
    const ctx = mix.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.out.connect(this.pan).connect(mix.buses.sfx);

    // rotor: noise → band-pass → AM by the blade-pass LFO
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.bp = ctx.createBiquadFilter();
    this.bp.type = 'bandpass';
    this.bp.frequency.value = 180;
    this.bp.Q.value = 0.9;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 5;
    // shape the sine into short pulses: each blade pass is a "thwop"
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 127.5 - 1; curve[i] = Math.pow(Math.max(0, v), 3) * 0.9; }
    shaper.curve = curve;
    this.lfo.connect(shaper).connect(am.gain);
    const rotorGain = ctx.createGain();
    rotorGain.gain.value = 0.55;
    src.connect(this.bp).connect(am).connect(rotorGain).connect(this.out);

    // turbine hum
    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.hum.frequency.value = 62;
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 220;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.09;
    this.hum.connect(humLp).connect(humGain).connect(this.out);

    // turbine whine
    this.whine = ctx.createOscillator();
    this.whine.frequency.value = 2100;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0.004;
    this.whine.connect(this.whineGain).connect(this.out);

    src.start();
    this.lfo.start();
    this.hum.start();
    this.whine.start();
  }

  /** speed: scroll speed; x: gunship x (world units); boosting adds RPM and whine. */
  update(on: boolean, speed: number, x: number, boosting: boolean): void {
    const t = this.mix.now;
    const rpm = 4.2 + speed * 0.75 + (boosting ? 1.4 : 0);
    this.lfo.frequency.setTargetAtTime(rpm, t, 0.3);
    this.bp.frequency.setTargetAtTime(150 + speed * 22, t, 0.3);
    this.hum.frequency.setTargetAtTime(55 + speed * 9 + (boosting ? 12 : 0), t, 0.3);
    this.whine.frequency.setTargetAtTime(1900 + speed * 120 + (boosting ? 500 : 0), t, 0.2);
    this.whineGain.gain.setTargetAtTime(boosting ? 0.012 : 0.004, t, 0.2);
    this.pan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, (x / 800) * 2 - 1)), t, 0.08);
    this.out.gain.setTargetAtTime(on ? 0.24 : 0, t, on ? 0.3 : 0.5);
  }
}

/** SAM lock warning: a warble that speeds up and rises as the lock completes. */
export class LockTone {
  private readonly osc: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly depth: GainNode;
  private readonly out: GainNode;

  constructor(private readonly mix: Mixer) {
    const ctx = mix.ctx;
    this.osc = ctx.createOscillator();
    this.osc.type = 'square';
    this.osc.frequency.value = 1000;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfo.frequency.value = 6;
    this.depth = ctx.createGain();
    this.depth.gain.value = 0.5;
    this.lfo.connect(this.depth).connect(am.gain);
    this.osc.connect(lp).connect(am).connect(this.out).connect(mix.buses.ui);
    this.osc.start();
    this.lfo.start();
  }

  /** lock: 0 = none, 0..1 = building; incoming: a missile is in the air. */
  update(lock: number, incoming: boolean): void {
    const t = this.mix.now;
    const level = incoming ? 1 : lock;
    this.out.gain.setTargetAtTime(level > 0 ? 0.05 : 0, t, 0.03);
    this.lfo.frequency.setTargetAtTime(incoming ? 22 : 5 + lock * 13, t, 0.05);
    this.osc.frequency.setTargetAtTime(incoming ? 1450 : 1000 + lock * 300, t, 0.05);
  }
}
