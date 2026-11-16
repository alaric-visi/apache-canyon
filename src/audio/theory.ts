/**
 * Pure music theory and pattern generation for the procedural score.
 * No Web Audio here, so it's unit-testable.
 */

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Scale intervals (semitones from the root). */
export const MODES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  /** "Desert" sound: phrygian with a major third. */
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
} as const;

export type ModeName = keyof typeof MODES;

export interface Key {
  /** MIDI note of the root, in the bass register. */
  root: number;
  mode: ModeName;
  bpm: number;
}

/** MIDI note for scale degree `deg` (0-based, may be negative or > 6 to cross octaves). */
export function degree(key: Key, deg: number): number {
  const s = MODES[key.mode];
  const oct = Math.floor(deg / s.length);
  const i = ((deg % s.length) + s.length) % s.length;
  return key.root + oct * 12 + s[i];
}

/** Tiny deterministic PRNG for pattern generation (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One bar = 16 sixteenth-note steps. null = rest. */
export type Pattern = (number | null)[];

/**
 * A four-bar chord progression as scale degrees of the chord roots.
 * Desert/western: i – bVI – bVII – i, or i – iv – V(phrygian bII) – i.
 */
export const PROGRESSIONS: number[][] = [
  [0, 5, 6, 0],
  [0, 3, 1, 0],
  [0, 6, 5, 4],
];

/** Driving bass: root on the beat with octave pushes, denser at higher intensity. */
export function bassPattern(key: Key, chordDeg: number, density: number): Pattern {
  const root = degree(key, chordDeg);
  // the diatonic fifth (not always 7 semitones: a diminished chord's is 6)
  const fifth = degree(key, chordDeg + 4);
  const p: Pattern = new Array(16).fill(null);
  for (let i = 0; i < 16; i += 4) p[i] = root;
  if (density > 0.3) { p[6] = root; p[14] = root + 12; }
  if (density > 0.6) { p[3] = fifth; p[10] = root; p[11] = root + 12; }
  return p;
}

/**
 * Lead motif: a short phrase from chord tones and passing notes, one octave up,
 * deterministic for a given seed so a sector always has "its" tune.
 */
export function leadPattern(key: Key, chordDeg: number, seed: number, busy: number): Pattern {
  const r = prng(seed * 977 + chordDeg * 131);
  const p: Pattern = new Array(16).fill(null);
  const tones = [0, 2, 4, 7].map((d) => chordDeg + d);
  const slots = busy > 0.5 ? [0, 3, 6, 8, 10, 12, 14] : [0, 6, 8, 12];
  let last = tones[0];
  for (const s of slots) {
    if (r() < 0.2) continue;
    // mostly step to a neighbour chord tone, sometimes leap
    const choice = r() < 0.7 ? tones[Math.min(tones.length - 1, Math.max(0, tones.indexOf(last) + (r() < 0.5 ? -1 : 1)))] : tones[Math.floor(r() * tones.length)];
    last = choice;
    p[s] = degree(key, choice) + 24;
  }
  return p;
}

/** Drum hits per step: k = kick, s = snare/rim, t = low tom, h = shaker. */
export type Hit = 'k' | 's' | 't' | 'h';
export function drumPattern(intensity: number, boss: boolean): Hit[][] {
  const p: Hit[][] = Array.from({ length: 16 }, () => []);
  // a loping western "train beat": kick on 1 and the "and" of 2, rim on 3
  p[0].push('k'); p[6].push('k'); p[8].push('s');
  if (intensity > 0.55 || boss) { p[10].push('k'); p[12].push('s'); }
  if (boss) { p[4].push('t'); p[14].push('t'); p[15].push('t'); }
  for (let i = 0; i < 16; i += intensity > 0.7 || boss ? 1 : 2) p[i].push('h');
  return p;
}

/**
 * Map a 0..1 intensity to layer gains (0..1): drone, bass, drums, lead.
 * Layers enter at thresholds and fade in over a short range so changes are smooth.
 */
export function layerMix(intensity: number, boss: boolean): { drone: number; bass: number; drums: number; lead: number } {
  const ramp = (lo: number, hi: number) => Math.max(0, Math.min(1, (intensity - lo) / (hi - lo)));
  return {
    drone: 0.6 + 0.4 * (1 - ramp(0.6, 1)),
    bass: boss ? 1 : ramp(0.15, 0.35),
    drums: boss ? 1 : ramp(0.4, 0.6),
    lead: boss ? 0.8 : ramp(0.6, 0.8),
  };
}
