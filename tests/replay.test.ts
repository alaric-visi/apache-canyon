import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fromMask, playReplay, Recorder, toMask, type Replay } from '../src/debug/replay';
import { newInput } from '../src/entities/types';

const dir = new URL('./replays/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('input encoding', () => {
  it('round-trips every input combination', () => {
    for (let m = 0; m < 512; m++) expect(toMask(fromMask(m))).toBe(m);
  });
  it('run-length encodes held inputs', () => {
    const r = new Recorder();
    const a = { ...newInput(), fire: true };
    for (let i = 0; i < 100; i++) r.push(a);
    r.push(newInput());
    expect(r.inputs).toEqual([[toMask(a), 100], [0, 1]]);
  });
});

describe('golden replays', () => {
  it('there are golden replays to check', () => expect(files.length).toBeGreaterThanOrEqual(4));

  for (const f of files) {
    it(`${f} plays out exactly as recorded`, () => {
      const r = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Replay;
      const got = playReplay(r);
      // If this fails after an intended gameplay change, re-record: npx vite-node scripts/record-replays.ts
      expect({ tick: got.tick, score: got.score, status: got.status }).toEqual({ tick: r.expect.tick, score: r.expect.score, status: r.expect.status });
      expect(got.fingerprint).toBe(r.expect.fingerprint);
    });
  }
});
