import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { FixedStepper, TICK_MS } from '../src/core/loop';
import { Canyon, WORLD_W } from '../src/world/canyon';
import { migrate, loadSave, writeSave, SAVE_VERSION, dailySeed, todayKey } from '../src/save/save';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe('FixedStepper', () => {
  const run = (hz: number, seconds: number) => {
    let ticks = 0;
    const s = new FixedStepper({ tick: () => ticks++, render: () => {} });
    const dt = 1000 / hz;
    for (let t = 0; t <= seconds * 1000 + 1e-6; t += dt) s.frame(t);
    return ticks;
  };

  it('runs the same number of ticks regardless of display refresh rate', () => {
    const expected = Math.floor((10 * 1000) / TICK_MS);
    for (const hz of [30, 60, 75, 120, 144, 240]) expect(Math.abs(run(hz, 10) - expected)).toBeLessThanOrEqual(1);
  });

  it('clamps catch-up after a long stall', () => {
    let ticks = 0;
    const s = new FixedStepper({ tick: () => ticks++, render: () => {} });
    s.frame(0);
    s.frame(5000);
    expect(ticks).toBeLessThanOrEqual(5);
  });
});

describe('Canyon', () => {
  it('stays inside the playfield, never pinches shut, and is continuous', () => {
    const canyon = new Canyon(1234);
    const first = canyon.at(0);
    let prevL = first.left, prevR = first.right;
    let minLeft = Infinity, maxRight = -Infinity, minWidth = Infinity, maxStep = 0;
    for (let d = 4; d < 400_000; d += 4) {
      const c = canyon.at(d);
      minLeft = Math.min(minLeft, c.left);
      maxRight = Math.max(maxRight, c.right);
      minWidth = Math.min(minWidth, c.right - c.left);
      maxStep = Math.max(maxStep, Math.abs(c.left - prevL), Math.abs(c.right - prevR));
      prevL = c.left; prevR = c.right;
    }
    expect(minLeft).toBeGreaterThanOrEqual(24 - 1e-6);
    expect(maxRight).toBeLessThanOrEqual(WORLD_W - 24 + 1e-6);
    expect(minWidth).toBeGreaterThanOrEqual(72 - 1e-6);
    expect(maxStep).toBeLessThan(12);
  });
});

describe('Save', () => {
  it('migrates garbage and partial data safely', () => {
    expect(migrate(null).hiscore).toBe(0);
    expect(migrate({ hiscore: 'lots' }).hiscore).toBe(0);
    const m = migrate({ hiscore: 1234.7, settings: { muted: true } });
    expect(m).toMatchObject({ version: SAVE_VERSION, hiscore: 1234, settings: { muted: true } });
    expect(m.settings.bindings.fire).toContain('KeyZ');
  });

  it('round-trips through storage and survives corrupt JSON', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = loadSave(store);
    s.hiscore = 999;
    writeSave(s, store);
    expect(loadSave(store).hiscore).toBe(999);
    mem.set('apache-canyon:save', '{not json');
    expect(loadSave(store).hiscore).toBe(0);
  });
});

describe('Save v4 migration', () => {
  it('carries a v3 save forward: high score becomes the endless best, hints and settings survive', () => {
    const v3 = { version: 3, hiscore: 48000, seen: ['drone', 'overheat'], settings: { muted: true, quality: 'performance' } };
    const m = migrate(v3);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.best.endless).toBe(48000);
    expect(m.seen).toEqual(['drone', 'overheat']);
    expect(m.settings).toMatchObject({ muted: true, quality: 'performance' });
    expect(m.unlocked.airframes).toEqual(['apache']);
    expect(m.loadout.airframe).toBe('apache');
    expect(m.reached).toEqual([0]);
  });

  it('refuses loadouts and unlocks that were never bought', () => {
    const m = migrate({ version: 4, unlocked: { airframes: ['kestrel', 'jetpack'], perks: ['magnet', 'godmode'] }, loadout: { airframe: 'warthog', perks: ['magnet', 'coolant', 'godmode'] } });
    expect(m.unlocked.airframes).toEqual(['apache', 'kestrel']);
    expect(m.unlocked.perks).toEqual(['magnet']);
    expect(m.loadout).toEqual({ airframe: 'apache', perks: ['magnet'] });
  });

  it('daily seeds are stable per date and differ between dates', () => {
    expect(dailySeed('2026-11-15')).toBe(dailySeed('2026-11-15'));
    expect(dailySeed('2026-11-15')).not.toBe(dailySeed('2026-11-16'));
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
