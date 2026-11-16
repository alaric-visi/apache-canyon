/**
 * (Re)record the golden replays in tests/replays/.
 *
 *   npx vite-node scripts/record-replays.ts
 *
 * Each scenario is flown by a deterministic autopilot; its exact input stream
 * is saved with the end state it produced. Only re-record after a deliberate
 * gameplay change, and say so in the commit.
 */
import { writeFileSync } from 'node:fs';
import { Sim, type RunOptions } from '../src/engine/sim';
import { createPilot, SKILLS } from '../src/debug/autopilot';
import { Recorder, playReplay, type Replay } from '../src/debug/replay';

const SCENARIOS: { name: string; seed: number; options: Partial<RunOptions>; ticks: number; skill: keyof typeof SKILLS }[] = [
  { name: 'campaign-opening', seed: 1001, options: { mode: 'campaign' }, ticks: 4000, skill: 'average' },
  { name: 'narrows-dam', seed: 2002, options: { mode: 'practice', startSector: 1 }, ticks: 12000, skill: 'skilled' },
  { name: 'night-run-warthog', seed: 3003, options: { mode: 'practice', startSector: 4, loadout: { airframe: 'warthog', perks: ['flarePack', 'coolant'] } }, ticks: 6000, skill: 'skilled' },
  { name: 'endless-assist-novice', seed: 4004, options: { mode: 'endless', assist: true }, ticks: 5000, skill: 'novice' },
];

for (const sc of SCENARIOS) {
  const sim = new Sim(sc.seed, sc.options);
  const pilot = createPilot(SKILLS[sc.skill], sc.seed);
  const rec = new Recorder();
  for (let i = 0; i < sc.ticks && sim.status === 'running'; i++) {
    const inp = pilot(sim);
    rec.push(inp);
    sim.step(inp);
    sim.events.length = 0;
  }
  const replay: Replay = { name: sc.name, seed: sc.seed, options: sc.options, inputs: rec.inputs, expect: { tick: sim.tick, score: sim.score, fingerprint: sim.fingerprint(), status: sim.status } };
  // sanity: the recording must reproduce itself
  const back = playReplay(replay);
  if (back.fingerprint !== replay.expect.fingerprint) throw new Error(`${sc.name}: replay does not reproduce`);
  writeFileSync(`tests/replays/${sc.name}.json`, JSON.stringify(replay) + '\n');
  console.log(`${sc.name.padEnd(24)} ${String(sim.tick).padStart(6)} ticks  score ${String(sim.score).padStart(7)}  ${sim.status}  sector ${sim.course.sector + 1}  ${replay.inputs.length} input runs`);
}
