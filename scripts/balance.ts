/**
 * Balance report. Autopilots of three skill levels play full runs on many
 * seeds; we report survival, causes of death, when damage happens, and where
 * score comes from, then check the numbers against the targets below.
 *
 *   npx vite-node scripts/balance.ts                       # 40 runs per skill
 *   npx vite-node scripts/balance.ts --runs 20
 *   npx vite-node scripts/balance.ts --set economy.fuelBurn=0.025 --set damage.gate=20
 *   npx vite-node scripts/balance.ts --json > report.json
 *
 * Autopilots are proxies for players, not predictions: use the report to compare
 * tuning changes against each other, and confirm with real playtests.
 */
import { Sim } from '../src/engine/sim';
import { createPilot, SKILLS, type PilotSkill } from '../src/debug/autopilot';
import { newInput } from '../src/entities/types';
import { setTuning } from '../src/gameplay/tuning';

/**
 * Median survival targets (seconds) per skill level, for the six-sector
 * structure (sector ≈ 2.5–3 min incl. boss): novice should fall in sector 2,
 * average should reach sectors 3–4, skilled should get past sector 4. The skilled target is a
 * goal for human playtests: the bots dodge one threat at a time, never use the
 * vertical band and never learn patterns, so the skilled bot is expected to
 * fall short of it. Don't soften the game just to make that bot pass.
 */
export const TARGETS = { novice: [150, 300], average: [300, 600], skilled: [600, Infinity] } as const;
const INFORMATIONAL = new Set(['skilled']);

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 40;
const asJson = args.includes('--json');
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [k, v] = args[i + 1].split('=');
  setTuning(k, JSON.parse(v));
}

const CAP = 20 * 60 * 60;
const BUCKET = 30; // seconds

interface RunResult {
  seconds: number;
  score: number;
  death: string;
  damage: Record<string, number>;
  /** Shield damage per 30 s bucket. */
  timeline: number[];
  scoreBy: Record<string, number>;
  pickups: Record<string, number>;
  bossesMet: number;
  bossesKilled: number;
}

function play(skill: PilotSkill, seed: number): RunResult {
  const sim = new Sim(seed);
  const pilot = createPilot(skill, seed);
  const inp = newInput();
  const r: RunResult = { seconds: 0, score: 0, death: 'survived', damage: {}, timeline: [], scoreBy: {}, pickups: {}, bossesMet: 0, bossesKilled: 0 };
  let shields = sim.shields, lastCause = 'scrape';
  let scoreSeen = 0;
  while (sim.status === 'running' && sim.tick < CAP) {
    sim.step(pilot(sim, inp));
    let cause = 'scrape', scored = 0, lifeLost = false;
    for (const e of sim.events) {
      if (e.type === 'playerHit') cause = e.cause;
      if (e.type === 'lifeLost') lifeLost = true;
      if (e.type === 'bossEnter') r.bossesMet++;
      if (e.type === 'bossDown') r.bossesKilled++;
      if (e.type === 'pickup') r.pickups[e.kind] = (r.pickups[e.kind] ?? 0) + 1;
      if (e.type === 'score') {
        const k = e.label ? e.label.toLowerCase() : 'kills';
        r.scoreBy[k] = (r.scoreBy[k] ?? 0) + e.amount;
        scored += e.amount;
      }
    }
    sim.events.length = 0;
    const dmg = shields - sim.shields;
    if (dmg > 0 && !lifeLost) {
      r.damage[cause] = (r.damage[cause] ?? 0) + dmg;
      const b = Math.floor(sim.tick / 60 / BUCKET);
      r.timeline[b] = (r.timeline[b] ?? 0) + dmg;
      lastCause = cause;
    }
    if (lifeLost) {
      // a life lost with shields still up means the tank ran dry
      const killer = shields > 1 && sim.fuel >= 99.9 && cause === 'scrape' ? 'fuel' : cause;
      if (killer !== 'fuel') {
        r.damage[killer] = (r.damage[killer] ?? 0) + Math.max(0, shields);
      }
      lastCause = killer;
      (r as unknown as { lifeCauses: string[] }).lifeCauses ??= [];
      (r as unknown as { lifeCauses: string[] }).lifeCauses.push(killer);
    }
    shields = sim.shields;
    r.scoreBy.distance = (r.scoreBy.distance ?? 0) + (sim.score - scoreSeen - scored);
    scoreSeen = sim.score;
  }
  r.seconds = sim.tick / 60;
  r.score = sim.score;
  r.death = sim.status === 'over' ? lastCause : 'survived';
  return r;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const fmt = (s: number) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
const share = (o: Record<string, number>) => {
  const total = Object.values(o).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(o).sort((a, b) => b[1] - a[1]).filter(([, v]) => v / total >= 0.01).map(([k, v]) => `${k} ${((v / total) * 100).toFixed(0)}%`);
};
const sum = (rs: Record<string, number>[]) => rs.reduce<Record<string, number>>((acc, o) => { for (const [k, v] of Object.entries(o)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
/** "shot:bullet:drone" → "drone", "contact:uav" → "uav ram" */
const group = (o: Record<string, number>) => {
  const g: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const parts = k.split(':');
    const key = parts[0] === 'shot' ? parts[2] : parts[0] === 'contact' ? `${parts[1]} ram` : k;
    g[key] = (g[key] ?? 0) + v;
  }
  return g;
};

const report: Record<string, unknown> = {};
let allOk = true;
for (const skill of Object.values(SKILLS)) {
  const results: RunResult[] = [];
  for (let i = 1; i <= runs; i++) results.push(play(skill, i * 7919));
  const secs = results.map((r) => r.seconds);
  const med = median(secs);
  const [lo, hi] = TARGETS[skill.name as keyof typeof TARGETS];
  const ok = med >= lo && med <= hi;
  if (!INFORMATIONAL.has(skill.name)) allOk &&= ok;
  const lifeCauses: Record<string, number> = {};
  for (const r of results) for (const c of (r as unknown as { lifeCauses?: string[] }).lifeCauses ?? []) {
    const k = group({ [c]: 1 });
    for (const kk of Object.keys(k)) lifeCauses[kk] = (lifeCauses[kk] ?? 0) + 1;
  }
  const buckets: number[] = [];
  for (const r of results) r.timeline.forEach((d, b) => { buckets[b] = (buckets[b] ?? 0) + (d ?? 0); });
  const dps = buckets.map((d, b) => {
    const alive = results.filter((r) => r.seconds > b * BUCKET).length;
    return alive ? d / alive / BUCKET : 0;
  });
  const totalMin = secs.reduce((a, b) => a + b, 0) / 60;
  const summary = {
    survival: { p25: pct(secs, 0.25), median: med, p75: pct(secs, 0.75), target: [lo, hi], ok },
    score: { median: median(results.map((r) => r.score)) },
    livesLostTo: share(lifeCauses),
    damage: share(group(sum(results.map((r) => r.damage)))),
    shieldLossPerSecond: dps.slice(0, 14).map((x) => +x.toFixed(2)),
    scoreSources: share(sum(results.map((r) => r.scoreBy))),
    pickupsPerMinute: Object.fromEntries(Object.entries(sum(results.map((r) => r.pickups))).map(([k, v]) => [k, +(v / totalMin).toFixed(2)])),
    gunships: { met: results.reduce((a, r) => a + r.bossesMet, 0), killed: results.reduce((a, r) => a + r.bossesKilled, 0) },
  };
  report[skill.name] = summary;
  if (!asJson) {
    console.log(`\n== ${skill.name.toUpperCase()} (${runs} runs) ${ok ? '✓' : INFORMATIONAL.has(skill.name) ? '·' : '✗'} target median ${fmt(lo)}–${hi === Infinity ? '∞' : fmt(hi)}`);
    console.log(`  survival   p25 ${fmt(summary.survival.p25)}  median ${fmt(med)}  p75 ${fmt(summary.survival.p75)}`);
    console.log(`  score      median ${summary.score.median}`);
    console.log(`  lives lost ${summary.livesLostTo.join(' · ')}`);
    console.log(`  damage     ${summary.damage.join(' · ')}`);
    console.log(`  shield/s   ${summary.shieldLossPerSecond.join(' ')}   (per ${BUCKET}s, per surviving run)`);
    console.log(`  score from ${summary.scoreSources.join(' · ')}`);
    console.log(`  pickups/m  ${Object.entries(summary.pickupsPerMinute).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`  gunships   met ${summary.gunships.met}, killed ${summary.gunships.killed}`);
  }
}
if (asJson) console.log(JSON.stringify(report, null, 2));
else console.log(`\n${allOk ? 'Novice and average are inside their targets (skilled is informational: confirm with humans).' : 'Some skill levels are outside their targets.'}`);
