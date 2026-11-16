# Apache//Can.yon — Dusk Ops

A vertical-scrolling canyon helicopter shooter set at golden hour.

```bash
npm install
npm run dev             # http://localhost:5173
npm test                # unit, sim, audio and golden-replay tests
npm run build           # typecheck + production bundle in dist/
npm run e2e             # Playwright smoke tests: Chromium, Firefox, WebKit, Pixel 7, iPhone 14
npm run balance         # autopilot balance report
npm run replays:record  # re-record golden replays after an intended gameplay change
npm run package         # dist/ zipped for itch.io / any static host
```

First-time e2e setup: `npx playwright install chromium firefox webkit`.

**Controls**

| Key | Action |
|-----|--------|
| Arrows / WASD | Fly (left/right freely, up/down within a flight band) |
| `Z` | Chain gun. Watch the heat bar; letting go inside the blue window dumps heat ("active cooling") |
| `X` | Missile. Tap for one missile at the nearest target; hold to paint up to 4 targets, release to ripple-fire |
| `C` | Flares. Decoys SAMs; use them when you hear the lock tone or see MISSILE LOCK |
| `V` | EMP when charged. Clears all enemy fire and damages everything on screen |
| `Shift` | Boost. Faster scrolling and distance score, but extra fuel burn |
| `Space` / `Esc` | Start / pause |
| `Q` / `M` / `` ` `` | Quality toggle / mute / debug overlay |

Gamepad: stick or d-pad flies · A or RT fire · X or RB missile · Y or LB flare · B EMP · LT or L3 boost · Start pauses.
URL options:
- `?seed=1234` replays a specific canyon and spawn sequence.
- `?canvas2d` forces the fallback renderer.
- `?zoom=3` follows the gunship up close, for inspecting art.

In dev builds, `window.__dusk` is the running `Game` and can be stepped from the console.

- `legacy/index.html` is the original single-file prototype, frozen as the behaviour reference.
- `PLAN.md` is the phased roadmap.

## Layout

| Path | What lives there |
|------|------------------|
| `src/core/` | Fixed-timestep loop, seeded RNG, math helpers, palette |
| `src/engine/sim.ts` | Headless, deterministic game simulation (no DOM, no `Math.random`) |
| `src/engine/game.ts` | Screen state machine; routes sim events to audio and FX; saving |
| `src/world/canyon.ts` | Canyon as a pure function of world distance |
| `src/entities/` | Plain data types and sim events |
| `src/systems/` | Player arsenal, enemy AI, enemy shots and hazards, spawn director, combat, scoring, spatial hash |
| `src/content/sectors/` | **The campaign**: six sectors (canyon shape, light, weather, enemy mix, set pieces, boss) |
| `src/content/waves/` | Authored set-piece formations |
| `src/content/hangar.ts`, `src/content/medals.ts` | Airframes, perks, salvage formula, medals |
| `src/systems/course.ts` | Sector progression (run → boss → clear), canyon profile blending, boss arenas |
| `src/gameplay/bosses/` | The six boss controllers (multi-part bosses share a group id) |
| `src/ui/menu.ts` | Keyboard/gamepad/mouse menus (title, practice, hangar, pause, debrief) |
| `src/gameplay/tuning.ts` | **Every difficulty number in one place** (damage, economy, telegraph lengths, spawn schedule) |
| `scripts/balance.ts` | Balance report: autopilots at three skill levels play many seeded runs |
| `src/gameplay/enemies/defs.ts` | Data-driven hostile definitions |
| `src/render/pixi/` | WebGL renderer (PixiJS 8): terrain shader, baked procedural sprites, post-processing |
| `src/render/fx/` | Cosmetic particles, camera trauma and lead, hit-stop |
| `src/render/canvas2d.ts` | Fallback renderer, used when WebGL is unavailable |
| `docs/art-bible.md` | Camera, light direction, palette ramps, silhouettes, effects grammar |
| `src/input/` | Action map on physical key codes, gamepad, rebinding |
| `src/audio/` | **Procedural audio**: mixer (buses, compressor, ducking), effects, rotor and lock tone, per-sector ambience, adaptive music sequencer, and pure music theory |
| `src/ui/`, `src/save/` | DOM HUD, menus, versioned localStorage save |

## Phase 1 status: done

Done:
- The fixed 60 Hz simulation runs at the same speed on any refresh rate.
- The playfield is a fixed 800×600 world scaled to fit the screen, so resizing never changes the run.
- Seeded and deterministic.
- Enemies and pickups never spawn in or drift into rock.
- Missiles home on the nearest target ahead.
- 2 s invulnerability after respawn.
- Rendering is DPR-aware, with no `shadowBlur`.
- The HUD only touches the DOM when a value changes.
- Keys can't stick when the window loses focus. The game auto-pauses then.
- High score persists between sessions.
- Gamepad support.
- Debug overlay.

## Phase 2 status: first pass done

Done:
- **Camera:** top-down at golden hour, with the sun low at the lower left. The sunset is now lighting rather than a sky backdrop.
- **Terrain:** one shader draws the canyon: sand floor with ripples, a dry riverbed and pebbles; long raking shadows from the west wall; cliff faces lit by the sun; and mesa tops that fade into violet haze. The walls are sampled from `Canyon`, which stays the single source of truth.
- **Sprites:** all art is drawn in code at load time, with no image files. The gunship banks and has a spinning rotor and nav lights. Each enemy type has its own silhouette, pickups are crates under parachutes, and every flying thing casts a ground shadow.
- **Effects:**
  - Explosions are layered: flash, fireball, sparks, lit smoke, debris and scorch marks that stay on the ground.
  - Continuous effects: rotor-wash dust, missile smoke trails, and smoke from damaged units.
  - Game feel: hit-stop, a smoothed camera shake, camera lead, and zoom-out at speed.
- **Post-processing:** bloom; a colour grade with violet shadows and amber highlights; sun glow; heat haze over explosions; chromatic aberration and a red pulse on damage; vignette; film grain.
- **HUD:** shield and fuel arcs around the gunship, missile pips, and SHIELD LOW / FUEL LOW / TERRAIN callouts.
- **Title screen:** the autopilot flies a live run behind the title.
- **Quality setting:** a Performance preset (no post-processing, 1× resolution) is saved with the other settings.

Still open in Phase 2:
- A frame-rate pass on integrated GPUs (not yet measured).
- Menus you can navigate with keyboard or gamepad.
- A nose cannon that tracks targets.
- Colour grades per sector (arrives with Phase 4 sectors).
- Moving particles to the GPU if pooled sprites become the bottleneck.

## Phase 3 status: first pass done

**Enemies fire back, and every attack is telegraphed** (visible wind-up plus its own sound):

| Enemy | Where | Attack | Telegraph | Counter |
|-------|-------|--------|-----------|---------|
| Scout drone | Air | Single slow aimed shot | Its eye flares red | Shoot it; sidestep |
| UAV | Air | Rams you | Swings toward your column | Shoot it early |
| Mine | Air | Proximity blast | Fast red blink and a blast-radius ring | Shoot it, or leave the ring |
| Gunner | Air | 3-round burst ×3, then leaves | Red glint and an aim line | Strafe during the glint |
| Wall turret | Canyon wall | 4-round aimed burst | Laser sight that blinks when it locks | Break line of sight; hug the opposite wall |
| Flak | Floor | Delayed airburst | Target circle with a shrinking fuse ring | Leave the circle |
| SAM site | Floor | Heat-seeking missile | Warbling lock tone, closing reticle, MISSILE LOCK callout | Flares, shoot the missile down, or kill the site |
| Tank | Floor | Slow heavy shell | Turret tracks you; the muzzle glows | Missiles (8 HP) |
| Rival gunship | Air, first at about 1m40s | Fan, burst and rocket patterns | Nose glow; fan preview lines | Missiles and a sustained gun; it leaves if you outlast it |
| Gate | Spans the corridor | A beam that blocks your fire and costs 25 shield if you fly through | Bracketed generator node on one wall | Line up under the node and shoot it |

**Player arsenal:**
- Chain gun with heat, overheat and active cooling.
- Missile lock-on with ripple fire.
- Flares, and SAMs or rockets can be shot down.
- EMP charged by kills, grazes and near misses.
- Spread-gun and flare pickups.
- Boost, and a vertical flight band.

**Scoring:**
- A chain multiplier up to ×5, which drops if you take damage or the timer runs out.
- Graze bonus for flying within 16 units of a wall without touching it.
- Near-miss bonus for shots that pass close.
- Score for shooting down missiles, and distance score.
- Floating score popups.

**Balance:** see *Tuning* below.

**Not done yet:** the altitude toggle (flagged in the plan as needing a prototype before committing), a brake to pair with boost, and more secondary weapons (rocket pods, rail).

## Tuning

All difficulty numbers live in [`src/gameplay/tuning.ts`](src/gameplay/tuning.ts). To compare changes, run the balance report. You can try a variant without editing code:

```bash
npx vite-node scripts/balance.ts --runs 40
npx vite-node scripts/balance.ts --set economy.fuelBurn=0.02 --set damage.gate=10
```

Three deterministic autopilots (novice, average, skilled, in `src/debug/autopilot.ts`) act as stand-in players. The report shows survival time, what took each life, shield loss per 30 seconds, where score comes from, pickups collected per minute, and gunship kills. It also checks median survival against targets.

| Pilot | Target median (six-sector campaign) | Current (30 runs) |
|-------|---------------|-------------------|
| Novice | 2m30s–5m00s (falls in sector 2) | **3m38s** ✓ |
| Average | 5m00s–10m00s (reaches sectors 3–4) | **7m31s** ✓ |
| Skilled | ≥ 10m00s (*human playtest target*) | 8m46s |

These targets were revised in Phase 4. A sector-based run with a gentle first sector is measured by how far into the campaign each skill level gets, not by flat survival time.

The bots dodge one threat at a time, never use the vertical band and never learn patterns. Treat the skilled row as a goal for human playtests, not as a reason to soften the game further.

**What the tuning pass found and changed:**
- **Gate nodes were unreachable.** They sat closer to the wall than the gunship's nose can get, so gates could only be cleared with missiles. Nodes now hang 24 units off the wall: shooting one puts you in the graze zone, but never the scrape zone. The beam also drops for half a second every two seconds, so you can time the gap instead. A regression test covers the reachability.
- **Some damage was unavoidable at speed.** At top speed, about 16% of the canyon moved sideways faster than the gunship could steer. Lateral speed now scales with flight speed.
- **Fuel couldn't be sustained.** Burn outpaced even perfect pickup collection. Burn dropped from 0.030 to 0.025 per tick, and fuel pickups rose from 30 to 35.
- **Rams and bursts stacked.** Rams now test against the same smaller core as bullets and do less damage. A 12-tick grace after any real hit stops a burst from landing every round at once.
- **The opening was crowded.** Enemy types now unlock about every 20 seconds instead of five in the first 30, the gunship arrives at 2m10s, and the base speed ramps every 20 seconds instead of every 15.
- **Readability:**
  - Each enemy shows a one-line hint, naming the threat and its counter, the first time you meet it. It's saved, so it shows once.
  - The game-over screen says what downed you.

**Still for human playtests:**
- Whether the telegraphs read at full speed.
- Whether grazing and near misses feel worth the risk: bots barely use them, so score is about 90% kills.
- The skilled-player target.

## Phase 4 status: first pass done

**Structure:**
- **Six sectors, flown dusk → night → dawn:**

  | Sector | Light and weather | Boss |
  |--------|-------------------|------|
  | Red Mesa | Late afternoon | Rival gunship *Dust Devil* |
  | The Narrows | Golden hour, deep shadow | *Fortified Dam* |
  | Dry Lake | Sunset, open flats | Armoured train *Iron Mule* |
  | Sandstorm Pass | Blowing sand, low visibility | *Viper Pair* gunships |
  | Night Run | Night vision and a searchlight | Radar complex *Overwatch* |
  | Dawn Strike | Sunrise | Heavy gunship *Sunhammer*, with a second phase |

- **Each sector has its own:** canyon shape, light preset, enemy mix, authored set-piece waves, fuel-depot and bridge rates, and boss.
- **Canyon transitions:** shape changes are scheduled just past the top of the screen, so ground you can already see never changes shape.
- **Boss arenas:** bosses are fought in a wide, gentle stretch of canyon. Ground bosses (the dam and the radar complex) bring the flight to a hover.
- **Adaptive pacing:** spawn timers slow down right after you take a hit, or while shields are low, so a bad moment doesn't snowball.
- **Campaign length:** an immortal skilled autopilot completes the campaign in about 18 minutes, against a 15–25 minute target. A test asserts this.

**Canyon features:**
- Fuel depots: shoot them for fuel.
- Bridges: fly under them for a bonus.

**Modes:**
- **Campaign:** sectors 1–6, then done.
- **Endless:** loops through the sectors, faster and denser on each lap.
- **Daily Op:** a shared date seed, with one attempt per day.
- **Practice:** any sector you've reached.

**Progression:**
- Each run earns salvage.
- The hangar sells two extra airframes (*Kestrel*: light and quick; *Warthog*: heavy) and five perks, with two perk slots. Airframes are trade-offs, not upgrades.
- Eight medals.
- A debrief after every run: result or cause of death, the sector reached, score and best, kills by type, accuracy, style stats, medals and salvage.
- Save format v4, which migrates v1–v3 saves.

**Not done yet:**
- Canyon forks and rockfalls (they need a two-corridor canyon model).
- Online leaderboards for the Daily Op.
- A frame-rate check of the sector effects on integrated GPUs.

## Phase 5 status: done (first pass)

All audio is still procedural Web Audio, with no sample files.

- **Mix:** four channels (effects, music, ambience, UI) feed a master compressor. Big explosions, a lost life, the EMP and boss entrances briefly duck the music and ambience. Volume per channel is set in **Options** and saved (save v5).
- **Effects:**
  - Positioning: every sound is panned by its on-screen position, explosions are muffled with distance from the gunship, and each sound type has a voice cap so rapid fire can't stack into clipping.
  - Warnings: each enemy's wind-up has its own voice, so threats can be read by ear. Lock-on blips climb a pentatonic ladder, and the SAM warning warbles faster as its lock completes, then screams once a missile is in the air.
- **The gunship:** the rotor "thwop" follows flight speed, with a turbine hum, plus a whine when boosting. It's panned with the gunship.
- **Ambience per sector:** a gusting wind bed in every sector. Sandstorm Pass adds sand hiss, Night Run insects, Dawn Strike birds, and the mesa an occasional distant hawk.
- **Adaptive music:** a dark desert-western score.
  - Instruments: a drone, a plucked bass, a loping "train beat", and a twangy lead with slap-back echo.
  - Each sector has its own key and tempo, for example E phrygian for The Narrows, C♯ phrygian dominant for the sandstorm, and D major for dawn.
  - Layers fade in with a 0–1 intensity, computed from on-screen threats, low shields and the chain multiplier. It rises fast and falls slowly.
  - Stingers play for boss entrances, boss kills, sector clears, game over and campaign completion. The menu has its own sparse theme.

**Verification:**
- Unit tests cover the music theory (every note stays in key, motifs are deterministic, layers enter in order), the intensity curve and the volume migration.
- The full audio graph was rendered offline in the browser. Results: no NaN or Infinity values, no clipping (worst case peaks at 0.61), music level rising with intensity (+7 dB from calm to boss), explosions sitting above the music, and panning working (hard-left fire ≈ 8.5:1).

**Not done yet:** recorded hero samples (planned as optional), and a human listening pass for taste and balance.

## Phase 6 status: done (first pass), release candidate `1.0.0-rc.1`

**Touch and phones:**
- The mobile block screen is gone. Steering is drag-relative: the gunship follows your finger's movement, not its position.
- Auto-fire runs while you steer (optional). There are MISSILE (hold to lock), FLARE, EMP and BOOST buttons, plus pause, and haptics on hits.
- Portrait gets its own camera, 520 units across and following the gunship. The overlays position themselves under the HUD however it wraps.

**Accessibility** (Options → Accessibility):
- Screen-shake and flash-strength sliders.
- **Reduced motion:** no shake, camera roll, zoom, freeze-frames or CSS flicker, and fewer particles. A fresh save follows the OS "reduce motion" setting.
- **High-contrast threats:** shape-coded enemy fire (ring, square, chevron), dashed white and yellow aim lines, hatched flak circles.
- **Sound captions:** subtitles for every warning sound, with a direction arrow.
- **Assist mode:** 20% slower, no wall damage, an extra life, slower enemy fire. It earns salvage and medals but doesn't set best scores.
- **Controls** (Options → Controls): rebind any action by pressing a key, with conflicts cleared automatically and a reset to defaults.

**Performance:**
- Three quality presets: High, Balanced (≤1.5× resolution, lighter bloom) and Performance (no post-processing).
- On High and Balanced, dynamic resolution drops to as low as 60% if frames run long, and recovers when there's headroom.
- The bundle is ~800 KB of JS and CSS (~230 KB gzipped), against a 1.5 MB budget that CI enforces.

**Offline and installable:**
- A web manifest, plus icons (192 px, 512 px, maskable and Apple touch), drawn in code.
- A service worker precaches the shell and every hashed asset on the first visit, so the game installs and plays offline. It only runs in production builds.

**QA:**
- **Golden replays** in `tests/replays/` (campaign opening, the whole dam fight, Night Run with the heavy airframe, assist mode). These are exact input recordings that must reproduce the same end state. In dev, `copy(__dusk.exportReplay('bug-123'))` turns any real run into a regression test.
- **Playwright smoke tests** against the production build:
  - In Chromium, Firefox and WebKit: boot, launch the campaign and fly for 30 s, plus keyboard menu navigation.
  - On a Pixel 7 and an iPhone 14: touch controls.
  - In Chromium only: offline play after one visit.

  The suites caught two real bugs: touch taps shorter than a frame were lost, and the first visit wasn't cached for offline play.

**Release tooling** (nothing has been published):
- `.github/workflows/ci.yml` runs on every push and PR: typecheck, unit tests, build, the bundle budget, and the Playwright suite on all three engines.
- `.github/workflows/pages.yml` deploys to GitHub Pages, but only when run by hand.
- `npm run package` makes `apache-canyon-web.zip` (without source maps) for itch.io.

### Release checklist
1. `git init`, commit, and push to a GitHub repo, which turns on CI.
2. Repo Settings → Pages → Source: *GitHub Actions*. Then Actions → *Deploy to GitHub Pages* → Run.
3. Or upload `apache-canyon-web.zip` to itch.io as an HTML5 game (set the viewport to "click to launch in fullscreen" on mobile).
4. Human playtests: the skilled-player survival target, telegraph readability at speed, an audio listening pass, and frame rate on an integrated GPU and a mid-range phone.
