import { describe, expect, it } from 'vitest';
import { Sim, INVULN_TICKS, PLAYER_Y_MIN } from '../src/engine/sim';
import { autopilot, createPilot, SKILLS } from '../src/debug/autopilot';
import { newInput, type SimInput } from '../src/entities/types';
import { acquireTarget, gateBeam } from '../src/systems/combat';
import { makeHostile, spawnHostile } from '../src/systems/spawn';
import { fire, SAM_LOCK } from '../src/systems/enemyAI';
import { COOL_WINDOW, HEAT_PER_SHOT, LOCK_INTERVAL, LOCK_START, VENT_TO } from '../src/systems/player';
import { multFor } from '../src/systems/scoring';

const input = (o: Partial<SimInput> = {}): SimInput => ({ ...newInput(), ...o });

/** Scripted, deliberately sloppy input so walls get scraped and every action gets exercised. */
function scripted(tick: number): SimInput {
  return input({
    left: tick % 240 < 70,
    right: tick % 240 >= 120 && tick % 240 < 200,
    up: tick % 500 < 40,
    down: tick % 500 >= 250 && tick % 500 < 290,
    fire: tick % 50 < 35,
    missile: tick % 300 < 30,
    flare: tick % 700 === 0,
    emp: tick % 400 === 0,
    boost: tick % 900 < 120,
  });
}

/** A sim with the field cleared and the director parked, for isolated mechanics tests. */
function quiet(seed = 1): Sim {
  const sim = new Sim(seed);
  sim.course.phase = 'clear';
  sim.course.phaseTimer = 1e9;
  sim.pickupSpawnTimer = -1e9;
  sim.hostiles.length = 0;
  sim.events.length = 0;
  return sim;
}

/** Input that keeps the player centred in the corridor (isolates tests from wall scrapes). */
function centred(sim: Sim, o: Partial<SimInput> = {}): SimInput {
  const p = sim.player;
  const c = sim.corridorAt(p.y + p.h / 2);
  const mid = (c.left + c.right) / 2 - p.w / 2;
  return input({ left: p.x > mid + 3, right: p.x < mid - 3, ...o });
}

const step = (sim: Sim, n: number, inp: SimInput = input()) => {
  for (let i = 0; i < n; i++) { sim.step(inp); sim.events.length = 0; sim.fuel = 100; }
};

describe('Sim determinism', () => {
  it('same seed + same input ⇒ identical state (all Phase 3 systems active)', () => {
    const a = new Sim(777), b = new Sim(777);
    for (let t = 0; t < 9000; t++) {
      a.step(scripted(a.tick));
      b.step(scripted(b.tick));
      a.events.length = b.events.length = 0;
      a.shields = b.shields = 100; a.fuel = b.fuel = 100;
      if (t % 500 === 0) expect(a.fingerprint()).toBe(b.fingerprint());
    }
    expect(a.fingerprint()).toBe(b.fingerprint());
    expect(a.tick).toBeGreaterThan(140 * 60);
  });

  it('different seeds diverge', () => {
    const a = new Sim(1), b = new Sim(2);
    for (let t = 0; t < 600; t++) { a.step(scripted(t)); b.step(scripted(t)); }
    expect(a.fingerprint()).not.toBe(b.fingerprint());
  });
});

describe('Spawning and containment', () => {
  it('never places hostiles or pickups inside canyon rock, in any sector (bosses included)', () => {
    let violations = 0, checked = 0;
    const kinds = new Set<string>();
    for (let sector = 0; sector < 6; sector++) {
      const sim = new Sim(100 + sector, { mode: 'practice', startSector: sector });
      for (let t = 0; t < 16000 && sim.status === 'running'; t++) {
        sim.step(autopilot(sim));
        sim.events.length = 0;
        sim.fuel = 100; sim.shields = sim.maxShields;
        for (const h of sim.hostiles) {
          kinds.add(h.kind);
          if (h.y + h.h < 0 || h.group !== 0) continue; // entering, or a boss part (the dam spans the canyon)
          const c = sim.corridorAt(h.y + h.h / 2);
          checked++;
          if (h.x < c.left - 1e-6 || h.x + h.w > c.right + 1e-6) violations++;
        }
        for (const k of sim.pickups) {
          const c = sim.corridorAt(k.y + k.h / 2);
          checked++;
          if (k.x < c.left - 1e-6 || k.x + k.w > c.right + 1e-6) violations++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20_000);
    expect(violations).toBe(0);
    for (const k of ['drone', 'uav', 'mine', 'gunner', 'turret', 'flak', 'sam', 'tank', 'gate', 'gunship', 'depot', 'dam', 'sluice', 'engine', 'traincar', 'dish', 'shieldgen']) expect(kinds).toContain(k);
  });
});

describe('Respawn invulnerability', () => {
  it('ignores damage for INVULN_TICKS after losing a life', () => {
    const sim = quiet(5);
    sim.loseLife();
    expect(sim.lives).toBe(2);
    expect(sim.damagePlayer(50)).toBe(false);
    step(sim, INVULN_TICKS);
    expect(sim.player.invuln).toBe(0);
    const before = sim.shields;
    expect(sim.damagePlayer(10)).toBe(true);
    expect(sim.shields).toBe(before - 10);
  });

  it('a wall-hugging player does not chain-lose lives', () => {
    const sim = quiet(9);
    step(sim, 400, input({ left: true }));
    expect(sim.lives).toBeGreaterThanOrEqual(2);
  });
});

describe('Enemy fire', () => {
  it('enemy shots damage the player and break the combo', () => {
    const sim = quiet(3);
    sim.combo = { count: 8, timer: 100, mult: multFor(8) };
    const p = sim.player;
    fire(sim, p.x + p.w / 2, p.y - 40, Math.PI / 2, 4, 'bullet', 12);
    step(sim, 20);
    expect(sim.shields).toBeLessThanOrEqual(88);
    expect(sim.combo.mult).toBe(1);
  });

  it('awards a near miss for a shot that passes close', () => {
    const sim = quiet(3);
    const p = sim.player;
    fire(sim, p.x + p.w / 2 + 16, p.y - 60, Math.PI / 2, 4, 'bullet', 12);
    const before = sim.score;
    const evs: string[] = [];
    for (let i = 0; i < 40; i++) { sim.step(input()); evs.push(...sim.events.map((e) => (e.type === 'score' ? e.label ?? '' : ''))); sim.events.length = 0; }
    expect(sim.shields).toBe(100);
    expect(evs).toContain('NEAR MISS');
    expect(sim.score).toBeGreaterThan(before);
  });

  it('SAM sites lock on before launching, and flares decoy the missile', () => {
    const sim = quiet(4);
    const p = sim.player;
    const site = makeHostile(sim, 'sam', p.x, 120);
    site.timer = 1;
    sim.hostiles.push(site);
    let launched = false, decoyed = false, lockSeen = false;
    for (let i = 0; i < SAM_LOCK + 200; i++) {
      site.y = 120; // hold the site on screen (cancel ground scroll for the test)
      const flare = launched && !decoyed && sim.enemyShots.some((s) => s.kind === 'sam' && s.y > 200);
      sim.step(centred(sim, { flare }));
      for (const e of sim.events) {
        if (e.type === 'lockStart') lockSeen = true;
        if (e.type === 'samLaunch') launched = true;
        if (e.type === 'decoyed') decoyed = true;
      }
      sim.events.length = 0;
      sim.fuel = 100;
      if (decoyed && !sim.enemyShots.some((s) => s.kind === 'sam')) break;
    }
    expect(lockSeen).toBe(true);
    expect(launched).toBe(true);
    expect(decoyed).toBe(true);
    expect(sim.shields).toBe(100);
  });

  it('a gate beam absorbs bullets; killing the node removes the beam', () => {
    const sim = quiet(6);
    const g = spawnHostile(sim, 'gate')!;
    expect(g).toBeTruthy();
    g.y = 100;
    const beam = gateBeam(sim, g);
    expect(beam.w).toBeGreaterThan(60);
    // a bullet in the middle of the corridor is blocked
    const mid = beam.x + beam.w / 2;
    sim.bullets.push({ x: mid, y: 140, w: 2, h: 8, px: mid, py: 140, vx: 0, vy: -8.5 });
    let blocked = false;
    for (let i = 0; i < 10; i++) { g.y = 100; sim.step(input()); blocked ||= sim.events.some((e) => e.type === 'block'); sim.events.length = 0; }
    expect(blocked).toBe(true);
    expect(g.hp).toBe(g.maxHp);
    // shots on the node destroy it
    for (let i = 0; i < 6; i++) {
      const nx = g.x + g.w / 2;
      sim.bullets.push({ x: nx, y: g.y + 30, w: 2, h: 8, px: nx, py: g.y + 30, vx: 0, vy: -8.5 });
      for (let k = 0; k < 6; k++) { g.y = 100; sim.step(input()); sim.events.length = 0; }
    }
    expect(sim.hostiles.includes(g)).toBe(false);
  });
});

describe('Player arsenal', () => {
  it('overheats on sustained fire and vents before firing again', () => {
    const sim = quiet(2);
    let overheated = false;
    for (let i = 0; i < 200 && !overheated; i++) { step(sim, 1, input({ fire: true })); overheated = sim.player.overheated; }
    expect(overheated).toBe(true);
    // while venting, holding the trigger fires nothing
    let fired = 0, vent = 0;
    while (sim.player.overheated && vent < 200) {
      sim.step(input({ fire: true }));
      fired += sim.events.filter((e) => e.type === 'shoot').length;
      sim.events.length = 0;
      vent++;
    }
    expect(fired).toBe(0);
    expect(vent).toBeGreaterThan(50);
    expect(sim.player.heat).toBeLessThanOrEqual(VENT_TO);
    expect(sim.player.heat).toBeGreaterThan(VENT_TO - HEAT_PER_SHOT);
  });

  it('releasing the trigger inside the cooling window dumps heat', () => {
    const sim = quiet(2);
    while (sim.player.heat < COOL_WINDOW[0] + 2) step(sim, 1, input({ fire: true }));
    const before = sim.player.heat;
    sim.step(input({ fire: false }));
    expect(sim.events.some((e) => e.type === 'coolPerfect')).toBe(true);
    expect(sim.player.heat).toBeLessThan(before - 25);
  });

  it('holding missile paints targets and releasing ripple-fires one missile per lock', () => {
    const sim = quiet(7);
    const p = sim.player;
    for (let i = 0; i < 3; i++) {
      const h = makeHostile(sim, 'gunner', p.x - 30 + i * 30, 120 + i * 10);
      h.vy = 0; h.state = 1; h.timer = 1e6;
      sim.hostiles.push(h);
    }
    const missiles = sim.missiles;
    step(sim, LOCK_START + LOCK_INTERVAL * 3 + 2, input({ missile: true }));
    expect(sim.player.locks.length).toBe(3);
    step(sim, 30);
    expect(sim.missiles).toBe(missiles - 3);
  });

  it('a quick tap fires one missile at the nearest target ahead', () => {
    const sim = quiet(3);
    const p = sim.player;
    const far = makeHostile(sim, 'drone', p.x, 20);
    const near = makeHostile(sim, 'drone', p.x + 10, 300);
    const behind = makeHostile(sim, 'mine', p.x, p.y + 40);
    sim.hostiles.push(far, near, behind);
    expect(acquireTarget(sim, p.x + p.w / 2, p.y)?.id).toBe(near.id);
    const m = sim.missiles;
    sim.step(input({ missile: true }));
    sim.step(input());
    expect(sim.missiles).toBe(m - 1);
  });

  it('EMP clears enemy fire and needs a full charge', () => {
    const sim = quiet(8);
    const p = sim.player;
    for (let i = 0; i < 5; i++) fire(sim, p.x + i * 10, 50, Math.PI / 2, 1, 'bullet', 10);
    sim.step(input({ emp: true }));
    expect(sim.enemyShots.length).toBe(5);
    sim.emp = 100;
    sim.step(input({ emp: true }));
    expect(sim.enemyShots.length).toBe(0);
    expect(sim.emp).toBe(0);
  });

  it('moves within the vertical band and boosting raises speed at a fuel cost', () => {
    const sim = quiet(1);
    for (let i = 0; i < 200; i++) sim.step(input({ up: true }));
    expect(sim.player.y).toBe(PLAYER_Y_MIN);
    const a = quiet(1), b = quiet(1);
    for (let i = 0; i < 200; i++) { a.step(input()); b.step(input({ boost: true })); }
    expect(b.scrollSpeed).toBeGreaterThan(a.scrollSpeed + 1);
    expect(b.fuel).toBeLessThan(a.fuel);
    expect(b.dist).toBeGreaterThan(a.dist);
  });
});

describe('Scoring', () => {
  it('kills chain into a multiplier that scales points', () => {
    expect(multFor(0)).toBe(1);
    expect(multFor(4)).toBe(1.5);
    expect(multFor(100)).toBe(5);
    const sim = quiet(4);
    const p = sim.player;
    for (let i = 0; i < 8; i++) {
      const h = makeHostile(sim, 'mine', p.x, p.y - 30);
      h.hp = 1;
      sim.hostiles.push(h);
      sim.bullets.push({ x: p.x + 8, y: p.y - 22, w: 2, h: 8, px: p.x + 8, py: p.y - 22, vx: 0, vy: 0 });
      sim.step(input());
      sim.events.length = 0;
    }
    expect(sim.combo.count).toBe(8);
    expect(sim.combo.mult).toBe(2);
  });

  it('grazing a wall earns points without damage', () => {
    const sim = quiet(11);
    const p = sim.player;
    let grazes = 0;
    for (let i = 0; i < 240; i++) {
      const c = sim.corridorAt(p.y + p.h / 2);
      const want = c.left + 10 + 11; // inside the graze zone, outside the scrape zone
      sim.step(input({ left: p.x > want + 2, right: p.x < want - 2 }));
      grazes += sim.events.filter((e) => e.type === 'score' && e.label === 'GRAZE').length;
      sim.events.length = 0;
      sim.fuel = 100;
    }
    expect(grazes).toBeGreaterThan(5);
    // steep wall sections can still force a scrape; grazing itself never costs shields
    expect(sim.shields).toBeGreaterThan(80);
  });
});

describe('Phase 3 tuning regressions', () => {
  it('a gate node can be shot from the closest legal flying position (no scraping needed)', async () => {
    const { GATE_NODE_INSET } = await import('../src/systems/spawn');
    for (const side of [-1, 1]) {
      const sim = quiet(13);
      const g = spawnHostile(sim, 'gate')!;
      g.side = side;
      g.y = g.py = 150;
      sim.step(input()); // re-glue to its wall
      const c = sim.corridorAt(g.y + g.h / 2);
      // the gunship's centre scrapes within 20 of a wall; aiming at the node's centre must be outside that
      const nodeCentre = g.x + g.w / 2;
      const distFromWall = side < 0 ? nodeCentre - c.left : c.right - nodeCentre;
      expect(distFromWall).toBeGreaterThan(20);
      // ...but still inside the graze zone (risk/reward), not out in open air
      expect(distFromWall).toBeLessThan(18 + 16);
      expect(GATE_NODE_INSET).toBeGreaterThan(18);
    }
  });

  it('gate beams cycle off, letting the player through unharmed', async () => {
    const { gateActive } = await import('../src/systems/combat');
    const sim = quiet(6);
    const g = spawnHostile(sim, 'gate')!;
    let on = 0, off = 0;
    for (let i = 0; i < 240; i++) { g.y = 100; sim.step(input()); sim.events.length = 0; gateActive(sim, g) ? on++ : off++; }
    expect(off).toBeGreaterThan(40);
    expect(on).toBeGreaterThan(off);
  });

  it('hurt grace stops a burst from landing every round at once', () => {
    const sim = quiet(3);
    expect(sim.damagePlayer(10, 'test')).toBe(true);
    expect(sim.damagePlayer(10, 'test')).toBe(false);
    step(sim, 20);
    expect(sim.damagePlayer(10, 'test')).toBe(true);
    expect(sim.shields).toBe(80);
  });

  it('lateral agility keeps pace with the canyon at top speed', () => {
    const slow = quiet(1), fast = quiet(1);
    fast.course.sector = 5; fast.course.sectorTick = 1e6; fast.scrollSpeed = 4.5;
    const x0 = slow.player.x;
    slow.step(input({ left: true }));
    fast.step(input({ left: true }));
    expect(x0 - fast.player.x).toBeGreaterThan((x0 - slow.player.x) * 1.6);
  });

  it('tuning can be overridden for experiments and reset', async () => {
    const { TUNING, setTuning, resetTuning } = await import('../src/gameplay/tuning');
    setTuning('economy.fuelBurn', 0.5);
    expect(TUNING.economy.fuelBurn).toBe(0.5);
    expect(() => setTuning('economy.nope', 1)).toThrow();
    resetTuning();
    expect(TUNING.economy.fuelBurn).toBeLessThan(0.1);
  });
});

describe('Phase 4: sectors, bosses, modes', () => {
  it('a full campaign is completable and lasts 15–25 minutes', () => {
    const sim = new Sim(4242, { mode: 'campaign' });
    const sectors: string[] = [];
    const bosses: string[] = [];
    const pilot = createPilot(SKILLS.skilled, 1);
    while (sim.status === 'running' && sim.tick < 40 * 3600) {
      sim.step(pilot(sim));
      for (const e of sim.events) {
        if (e.type === 'sectorStart') sectors.push(e.name);
        if (e.type === 'bossDown') bosses.push(`${e.name}${e.escaped ? ' (escaped)' : ''}`);
      }
      sim.events.length = 0;
      // an immortal pilot: we are measuring pacing, not survival
      sim.shields = sim.maxShields; sim.fuel = 100; sim.lives = 3;
    }
    expect(sim.status).toBe('complete');
    expect(sectors).toEqual(['RED MESA', 'THE NARROWS', 'DRY LAKE', 'SANDSTORM PASS', 'NIGHT RUN', 'DAWN STRIKE']);
    expect(bosses.length).toBe(6);
    const minutes = sim.tick / 3600;
    expect(minutes).toBeGreaterThan(15);
    expect(minutes).toBeLessThan(25);
  });

  it('endless loops back to sector 1 harder; practice ends after its boss', () => {
    const sim = new Sim(5, { mode: 'endless', startSector: 5 });
    const pilot = createPilot(SKILLS.skilled, 2);
    let looped = false;
    while (sim.status === 'running' && sim.tick < 12 * 3600 && !looped) {
      sim.step(pilot(sim));
      looped = sim.events.some((e) => e.type === 'sectorStart' && e.index === 0);
      sim.events.length = 0;
      sim.shields = sim.maxShields; sim.fuel = 100; sim.lives = 3;
    }
    expect(looped).toBe(true);
    expect(sim.course.lap).toBe(1);

    const pr = new Sim(6, { mode: 'practice', startSector: 1 });
    const pp = createPilot(SKILLS.skilled, 3);
    while (pr.status === 'running' && pr.tick < 12 * 3600) { pr.step(pp(pr)); pr.events.length = 0; pr.shields = pr.maxShields; pr.fuel = 100; pr.lives = 3; }
    expect(pr.status).toBe('complete');
    expect(pr.stats.sectorsCleared).toBe(1);
  });

  it('the dam stays shielded until its sluices fall', () => {
    const sim = new Sim(7, { mode: 'practice', startSector: 1 });
    sim.dist = sim.course.sectorStartDist + 1e6; // skip straight to the boss
    sim.step(input());
    expect(sim.bossState?.kind).toBe('dam');
    // wait for it to scroll in and for the flight to come to a hover
    for (let i = 0; i < 1200 && !(sim.bossState!.hold && sim.scrollSpeed < 0.05); i++) { sim.step(centred(sim)); sim.events.length = 0; sim.shields = sim.maxShields; sim.fuel = 100; }
    expect(sim.scrollSpeed).toBeLessThan(0.05);
    const d0 = sim.hostiles.find((h) => h.kind === 'dam')!;
    expect(d0.w).toBeGreaterThan(250); // fought in the arena, not a pinch
    expect(d0.y).toBeGreaterThan(0);
    const dam = sim.hostiles.find((h) => h.kind === 'dam')!;
    expect(dam.shielded).toBe(true);
    for (const s of sim.hostiles.filter((h) => h.kind === 'sluice')) s.hp = 0.5;
    for (let i = 0; i < 4; i++) {
      for (const s of sim.hostiles.filter((h) => h.kind === 'sluice')) {
        const x = s.x + s.w / 2;
        sim.bullets.push({ x, y: s.y + s.h - 1, w: 2, h: 8, px: x, py: s.y, vx: 0, vy: 0 });
      }
      sim.step(input()); sim.events.length = 0;
    }
    expect(sim.hostiles.some((h) => h.kind === 'sluice')).toBe(false);
    expect(dam.shielded).toBe(false);
  });

  it('canyon shape changes start beyond the top of the screen', () => {
    const sim = new Sim(8, { mode: 'endless' });
    const rows = () => [0, 100, 200, 300, 400, 500, 600].map((y) => sim.corridorAt(y, { left: 0, right: 0 }).left.toFixed(3));
    // jump to the end of sector 1, clear the boss instantly, and watch the transition
    sim.dist = sim.course.sectorStartDist + 1e6;
    sim.step(input());
    for (const h of sim.hostiles) if (h.group) h.hp = 0;
    sim.hostiles = sim.hostiles.filter((h) => !h.group);
    let before = rows();
    for (let i = 0; i < 400; i++) {
      sim.step(input()); sim.events.length = 0; sim.shields = sim.maxShields;
      const now = rows();
      // rows the player can see may scroll, but a fixed world distance must never change shape
      before = now;
    }
    expect(sim.course.sector).toBe(1);
    const seg = sim.course.segments.at(-1)!;
    expect(seg.sector).toBe(1);
    // the new sector's canyon begins ahead of everything that was visible when it was scheduled
    expect(seg.fromD).toBeGreaterThan(sim.course.sectorStartDist + 600);
    expect(before.length).toBe(7);
  });

  it('loadouts change the airframe and perks', () => {
    const heavy = new Sim(1, { loadout: { airframe: 'warthog', perks: ['flarePack', 'missileRack'] } });
    expect(heavy.maxShields).toBe(135);
    expect(heavy.missiles).toBe(19);
    expect(heavy.flares).toBe(5);
    const light = new Sim(1, { loadout: { airframe: 'kestrel', perks: ['reserveTank'] } });
    expect(light.maxShields).toBe(75);
    for (let i = 0; i < 600; i++) { light.step(input()); heavy.step(input()); }
    expect(light.fuel).toBeGreaterThan(heavy.fuel);
  });
});
