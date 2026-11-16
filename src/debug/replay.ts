import { Sim, type RunOptions } from '../engine/sim';
import { newInput, type SimInput } from '../entities/types';

/**
 * Input replays. The sim is deterministic, so a seed + options + the per-tick
 * input stream reproduces a run exactly. Inputs are stored as a run-length
 * encoded list of bitmasks: [[mask, ticks], ...].
 *
 * Golden replays in tests/replays/ pin behaviour: if a change alters how any
 * of them plays out, the replay test fails and says so. If the change was
 * intended, re-record with `npx vite-node scripts/record-replays.ts`.
 */

const KEYS = ['left', 'right', 'up', 'down', 'fire', 'missile', 'flare', 'emp', 'boost'] as const satisfies readonly (keyof SimInput)[];

export interface Replay {
  name: string;
  seed: number;
  options: Partial<RunOptions>;
  /** [[mask, ticks], ...] */
  inputs: [number, number][];
  expect: { tick: number; score: number; fingerprint: string; status: string };
}

export const toMask = (i: SimInput): number => KEYS.reduce((m, k, b) => (i[k] ? m | (1 << b) : m), 0);

export function fromMask(m: number, out: SimInput = newInput()): SimInput {
  KEYS.forEach((k, b) => (out[k] = (m & (1 << b)) !== 0));
  return out;
}

/** Records input masks as they're played. */
export class Recorder {
  private runs: [number, number][] = [];
  push(i: SimInput): void {
    const m = toMask(i);
    const last = this.runs[this.runs.length - 1];
    if (last && last[0] === m) last[1]++;
    else this.runs.push([m, 1]);
  }
  get inputs(): [number, number][] {
    return this.runs.map(([m, n]) => [m, n]);
  }
  reset(): void {
    this.runs = [];
  }
}

/** Play a replay back on a fresh sim and report where it ended up. */
export function playReplay(r: Pick<Replay, 'seed' | 'options' | 'inputs'>): Replay['expect'] & { sim: Sim } {
  const sim = new Sim(r.seed, r.options);
  const inp = newInput();
  outer: for (const [mask, n] of r.inputs) {
    fromMask(mask, inp);
    for (let i = 0; i < n; i++) {
      if (sim.status !== 'running') break outer;
      sim.step(inp);
      sim.events.length = 0;
    }
  }
  return { tick: sim.tick, score: sim.score, fingerprint: sim.fingerprint(), status: sim.status, sim };
}
