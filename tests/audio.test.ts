import { describe, expect, it } from 'vitest';
import { bassPattern, degree, drumPattern, layerMix, leadPattern, midiToHz, MODES, type Key } from '../src/audio/theory';
import { rawIntensity, smoothIntensity } from '../src/audio/intensity';
import { SECTOR_KEYS } from '../src/audio/music';
import { AMBIENCE } from '../src/audio/ambience';
import { curve, DEFAULT_VOLUMES } from '../src/audio/mixer';
import { Sim } from '../src/engine/sim';
import { makeHostile } from '../src/systems/spawn';
import { fire } from '../src/systems/enemyAI';
import { migrate, SAVE_VERSION } from '../src/save/save';
import { SECTORS } from '../src/content/sectors/sectors';

const D_MINOR: Key = { root: 38, mode: 'minor', bpm: 84 };

describe('music theory', () => {
  it('maps notes and scale degrees correctly', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(57)).toBeCloseTo(220);
    expect(degree(D_MINOR, 0)).toBe(38);
    expect(degree(D_MINOR, 2)).toBe(41); // F
    expect(degree(D_MINOR, 7)).toBe(50); // octave up
    expect(degree(D_MINOR, -1)).toBe(36); // C below
  });

  it('only ever plays notes from the key', () => {
    for (const key of SECTOR_KEYS) {
      const allowed = new Set(MODES[key.mode].map((s) => s % 12));
      for (let chord = 0; chord < 7; chord++)
        for (const p of [bassPattern(key, chord, 1), leadPattern(key, chord, 42, 1)])
          for (const n of p) if (n !== null) expect(allowed.has((((n - key.root) % 12) + 12) % 12)).toBe(true);
    }
  });

  it('lead motifs are deterministic per seed and differ between seeds', () => {
    expect(leadPattern(D_MINOR, 0, 5, 0.8)).toEqual(leadPattern(D_MINOR, 0, 5, 0.8));
    const variants = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(leadPattern(D_MINOR, 0, s, 0.8))));
    expect(variants.size).toBeGreaterThan(3);
  });

  it('layers enter in order as intensity rises, and a boss brings everything in', () => {
    const at = (i: number) => layerMix(i, false);
    expect(at(0).bass).toBe(0);
    expect(at(0).drums).toBe(0);
    expect(at(0.3).bass).toBeGreaterThan(0);
    expect(at(0.3).drums).toBe(0);
    expect(at(0.55).drums).toBeGreaterThan(0);
    expect(at(0.55).lead).toBe(0);
    expect(at(1).lead).toBe(1);
    expect(layerMix(0, true)).toMatchObject({ bass: 1, drums: 1 });
    // busier patterns at higher intensity
    expect(bassPattern(D_MINOR, 0, 1).filter((n) => n !== null).length).toBeGreaterThan(bassPattern(D_MINOR, 0, 0).filter((n) => n !== null).length);
    expect(drumPattern(1, true).flat().length).toBeGreaterThan(drumPattern(0, false).flat().length);
  });

  it('every sector has a key, a tempo and an ambience profile', () => {
    expect(SECTOR_KEYS.length).toBe(SECTORS.length);
    expect(AMBIENCE.length).toBe(SECTORS.length);
    for (const k of SECTOR_KEYS) expect(k.bpm).toBeGreaterThanOrEqual(70);
  });
});

describe('music intensity', () => {
  it('rises with threats and maxes out for a boss', () => {
    const sim = new Sim(1);
    const calm = rawIntensity(sim);
    for (let i = 0; i < 4; i++) { const h = makeHostile(sim, 'gunner', 300 + i * 20, 100); sim.hostiles.push(h); }
    for (let i = 0; i < 6; i++) fire(sim, 400, 100, Math.PI / 2, 1, 'bullet', 10);
    const busy = rawIntensity(sim);
    expect(busy).toBeGreaterThan(calm + 0.3);
    sim.bossState = { kind: 'dam', name: 'X', group: 1, t: 0, anchorY: 0, hold: false, anchored: false, escaped: false, core: 'dam' };
    expect(rawIntensity(sim)).toBe(1);
  });

  it('smooths quickly up and slowly down', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = smoothIntensity(v, 1);
    expect(v).toBeGreaterThan(0.85);
    for (let i = 0; i < 60; i++) v = smoothIntensity(v, 0);
    expect(v).toBeGreaterThan(0.55); // a second later the music is still riding high
  });
});

describe('mixer settings', () => {
  it('slider curve and defaults are sane', () => {
    expect(curve(0)).toBe(0);
    expect(curve(1)).toBe(1);
    expect(curve(0.5)).toBeCloseTo(0.25);
    expect(curve(2)).toBe(1);
    for (const v of Object.values(DEFAULT_VOLUMES)) expect(v).toBeGreaterThan(0);
  });

  it('save v5 adds volumes and validates them', () => {
    const m = migrate({ version: 4, settings: { muted: false, volumes: { master: 0.3, music: 7, sfx: -1 } } });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.settings.volumes.master).toBe(0.3);
    expect(m.settings.volumes.music).toBe(DEFAULT_VOLUMES.music);
    expect(m.settings.volumes.sfx).toBe(DEFAULT_VOLUMES.sfx);
    expect(m.settings.volumes.ambience).toBe(DEFAULT_VOLUMES.ambience);
  });
});
