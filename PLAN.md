# Apache//Can.yon — Dusk Ops: Improvement Plan

A phased roadmap for taking the single-file prototype (`legacy/index.html`) to a polished,
modular, extensible game. Every phase ends with a playable build. No phase starts until the
previous one meets its exit criteria.

---

## 0. Where the prototype stands

### What's working and worth keeping
- **The look:** a sunset desert palette, amber HUD, warm vignette and dust. The colours are
  already defined as tokens, so a full art pass can build on them.
- **The core loop:** a narrowing canyon, fuel and shields as two separate pressures, a gun
  plus limited homing missiles, pickups.
- **Procedural audio:** zero asset weight, and it already reacts to speed (engine pitch).
- **Feedback:** screen shake, shockwaves, muzzle flash, damage flash and a critical-state pulse.

### Defects and technical debt found in the code
| # | Issue | Impact |
|---|-------|--------|
| 1 | Simulation advances **once per `requestAnimationFrame`** with no delta time | On 120/144 Hz displays the game runs 2–2.4× faster. Fuel, spawns and difficulty all scale with refresh rate |
| 2 | Enemies, pickups and force fields take their spawn bounds from **`leftWall[60]`** (about 140 px above the bottom of the screen) but spawn at `y = -20` | Things can spawn inside rock and then get clipped out of view |
| 3 | Enemies move with `vx` but **never collide with the walls** | They drift into rock and turn invisible, which is unfair |
| 4 | Missiles always target **`game.enemies[0]`** (the oldest enemy) | Homing feels random and often chases things off-screen |
| 5 | Enemies have a `shootTimer` but **never shoot** | Combat is one-way; the only threats are contact damage and walls |
| 6 | **No invulnerability** after losing a life; shields reset, but wall scraping keeps draining | Lives can chain-drain in a tight corridor |
| 7 | The canvas is **not DPR-aware** | Blurry on Retina and HiDPI screens |
| 8 | Resizing the window **regenerates the canyon** and teleports the player | Mid-run resizes break the run |
| 9 | Canyon is stored as two arrays that are mutated and `shift()`ed every frame, plus a **linear scan to find the wall at the player's row** | O(n) work every frame, and an awkward base for adding features |
| 10 | Heavy use of `shadowBlur` on every entity, every frame | The main Canvas2D performance drain, especially at high resolution |
| 11 | HUD DOM nodes are rewritten every frame | Avoidable layout and style work |
| 12 | Input uses `e.key` (layout-dependent; `,`/`.` mappings), with **no blur handling** | Keys stick when focus is lost; AZERTY and other layouts break |
| 13 | High score isn't saved | No reason to come back |
| 14 | Mobile is blocked by UA sniffing | Locks out a large audience; a vertical scroller is a natural touch game |
| 15 | **Camera inconsistency:** a side-view sky, sun and ridgeline are drawn *behind* a top-down canyon | The scene doesn't read spatially; this is the biggest art-direction problem |
| 16 | All state lives in one global `game` object; update, collision, scoring and rendering are interleaved | Adding enemy or weapon types means copy-pasting collision blocks (already duplicated 4×) |

---

## 1. Target architecture

**Stack:** Vite + TypeScript, Vitest for unit tests and Playwright for smoke tests.
Rendering moves to **PixiJS v8 (WebGL/WebGPU)** in Phase 2. Phase 1 keeps Canvas2D behind a
renderer interface so the swap only touches `render/`.

```
apache-canyon/
├── PLAN.md                 ← this file
├── legacy/index.html       ← original prototype, frozen as the behaviour reference
├── docs/                   ← design notes, art bible, enemy/weapon specs
├── public/                 ← served as-is (fonts, audio stingers if any, favicon, manifest)
├── assets/
│   ├── sprites/            ← atlases (chopper, enemies, pickups, FX)
│   ├── tiles/              ← canyon wall/floor textures, strata, decals
│   └── shaders/            ← GLSL: heat haze, bloom, colour grade, sandstorm
├── src/
│   ├── main.ts             ← boot: create app, load assets, start state machine
│   ├── core/               ← fixed-timestep loop, seeded RNG, math, event bus, object pools
│   ├── engine/             ← state machine (Boot/Title/Hangar/Play/Pause/Debrief), scene mgmt
│   ├── world/              ← canyon generator (noise → ring buffer), floor, props, camera
│   ├── entities/           ← entity definitions + component data (pure data, no logic)
│   ├── systems/            ← movement, collision (spatial hash), damage, spawn, pickups, scoring
│   ├── gameplay/
│   │   ├── weapons/        ← data-driven weapon defs + behaviours (gun, missile, flare, …)
│   │   ├── enemies/        ← enemy defs + AI behaviours (drone, turret, gunship, SAM…)
│   │   └── bosses/         ← multi-phase boss scripts
│   ├── content/
│   │   ├── sectors/        ← sector definitions (palette, time of day, hazards, length)
│   │   └── waves/          ← authored wave patterns + procedural wave grammar
│   ├── render/
│   │   ├── layers/         ← floor, shadows, walls, entities, FX, HUD-in-world
│   │   └── fx/             ← particles, trails, shockwaves, post-processing chain
│   ├── audio/              ← WebAudio engine: buses, synth SFX, adaptive music
│   ├── ui/                 ← HUD, menus, hangar, debrief (DOM or Pixi, one place)
│   ├── input/              ← action map (keyboard via e.code, gamepad, touch), rebinding
│   ├── save/               ← versioned localStorage: hiscores, unlocks, settings
│   └── debug/              ← FPS/frame-time graph, hitbox view, spawn inspector, seed entry
└── tests/                  ← sim determinism, collision, canyon gen, save migration
```

**Principles**
- **The simulation is deterministic and separate from rendering.** The fixed 60 Hz sim uses a
  seeded RNG and the renderer interpolates between ticks. This gives you replays, daily-seed
  challenges and testable gameplay.
- **Content is data, behaviour is code.** An enemy is `{ sprite, hp, speed, behaviour: 'strafe', weapon: 'aa_burst', score }`.
  Adding an enemy shouldn't touch collision code.
- **World coordinates, not screen coordinates.** The canyon exists in world space (distance
  travelled) and the camera scrolls over it. Resizing changes the view, not the world.

---

## Phase 1 — Foundation and technical core ✅ *(complete; see README for what landed)*
*Goal: same game, rebuilt properly. Plays identically (minus bugs) and runs at the same speed everywhere.*

**Work**
1. Scaffold Vite + TS + ESLint/Prettier + Vitest. Copy the prototype into `legacy/` as the reference.
2. **Fixed-timestep loop** (`core/loop.ts`): accumulator, 60 Hz ticks, render interpolation,
   spiral-of-death clamp, and auto-pause on `visibilitychange` and `blur`.
3. **Seeded RNG** (`core/rng.ts`, e.g. mulberry32/sfc32). Replace every `Math.random()` in the sim with it.
4. **Canyon rewrite** (`world/canyon.ts`):
   - Sample the walls from layered noise as a function of world distance `d`, not of segment count.
   - Store them in a fixed-size ring buffer, with `wallsAt(worldY)` an O(1) index lookup.
   - Expose corridor width and centre to the spawners (fixes #2) and the AI (fixes #3).
5. **Entity/system split:** pooled entities, a spatial hash for collisions, and one generic
   `damage` system (removes the 4× duplicated collision blocks, #16).
6. **Input layer:** action map on `e.code`, cleared on blur, gamepad support (Gamepad API), rebindable.
7. **Renderer interface + Canvas2D implementation:** DPR-aware backing store (#7),
   resizing without regenerating the world (#8), glows pre-rendered to offscreen sprites instead of `shadowBlur` (#10).
8. **HUD:** only write to the DOM when a value changes (#11).
9. **Save system:** versioned schema in localStorage with high score and settings (#13).
10. **Bug fixes:** nearest/in-cone missile targeting (#4), 2 s invulnerability with blink on respawn (#6).
11. **Debug overlay** (backtick key): FPS, frame time, entity counts, hitboxes, seed.

**Exit criteria**
- Identical game speed at 60, 120 and 144 Hz (check with the debug overlay plus a determinism test: same seed + same inputs ⇒ same score).
- 60 fps at 4K on a mid-range laptop. No GC spikes over 2 ms in a 5-minute run.
- No entity spawns or moves inside canyon rock (unit test on the spawner).

---

## Phase 2 — Visual overhaul 🟡 *(first pass landed; see the README for what's open)*
*Goal: a game that looks like a key-art painting in motion.*

### 2a. Art direction: fix the camera (#15)
Commit to a **top-down, slightly tilted (¾) camera at golden hour**. The sunset stops being a
sky backdrop and becomes **lighting**:
- A **sand/dry-riverbed canyon floor** with texture, scrub, rocks and tyre tracks.
- **Long raking shadows** cast by the west wall across the floor. Shadow width follows wall height,
  so narrow sections feel deep and dark and wide sections are flooded with amber light.
- **Rim light** on the sun-facing wall lips, cool purple ambient in the shadows (the colour
  contrast that sells dusk).
- The sun and sky appear only as a **colour grade** and occasional **lens flares** when you leave a wall's shadow.
- **Height cues:** the chopper casts a soft offset shadow on the floor, and the offset grows when
  "climbing" (later gameplay hook). Walls get a vertical face drawn with strata so they read as cliffs, not flat polygons.

Write `docs/art-bible.md`: palette ramps per sector, light direction, silhouette rules (enemies
are read by shape first and colour second), and the scale reference (the chopper is about 6% of screen width).

### 2b. Move to WebGL (PixiJS v8)
- Wall meshes generated from the canyon ring buffer: triangle strips with UVs for tiling strata
  textures, plus a normal-mapped cliff face.
- Layered render passes: floor → floor decals → shadows → walls → ground units → air units → projectiles → FX → in-world UI.
- **Post-processing chain:** bloom (muzzle, explosions, tracers), heat-haze distortion near the
  floor and above explosions, film grain, chromatic aberration on damage, vignette, LUT colour grading per sector and time of day.

### 2c. Sprites and animation
- A detailed attack-helicopter sprite set: banking frames for left and right, a separate animated
  main rotor with motion blur, tail rotor, a damage state (smoke at <30% shield), and a nose cannon that tracks the target.
- Distinct silhouettes for each enemy type, hit-flash with a white shader (not a fill swap), and destruction debris that stays on the floor as decals.
- Pickups: physical crates or drop pods with parachutes and a beacon light, not rotating letter diamonds.

### 2d. FX and game feel
- A GPU particle system: smoke (soft, lit), fire, sparks, sand plumes from rotor wash that react
  to the floor, tracer streaks, missile smoke trails that linger and drift.
- Explosions in layers: flash → fireball sprite sheet → smoke → scorch decal → debris.
- Juice: hit-stop (2–3 frames) on big kills, directional camera shake (trauma model, Perlin-based
  rather than random jitter), camera lead in the direction of movement, slight zoom-out at high speed.
- The chopper banks and pitches with input, and the rotor-wash dust follows its velocity.

### 2e. UI redesign
- A diegetic **helmet-HUD** style: fuel and shield as curved gauges near the chopper, ammo ticks,
  and a warning panel ("FUEL LOW", "MISSILE LOCK", "TERRAIN") with an audio cue.
- The title screen becomes an attract mode: the game playing itself in the background with a slow camera.
- Animated menus with full keyboard and gamepad navigation.

**Exit criteria:** a 30-second capture holds up as a trailer shot. 60 fps held on integrated
GPUs at 1080p, with a "Performance" preset (no post-processing, half-resolution particles).

---

## Phase 3 — Combat depth 🟡 *(first pass landed; see README. Human playtesting is still needed for the exit criteria)*
*Goal: an interesting two-way fight, where the player makes a decision every few seconds.*

**Enemies fire back (#5), with readable telegraphs:**
| Enemy | Placement | Behaviour | Counterplay |
|-------|-----------|-----------|-------------|
| Scout drone | Air | Weaves, fires slow single shots | Shoot it |
| Gun drone | Air | Hovers, then fires 3-round bursts after a red charge-up glint | Strafe sideways during the charge-up |
| Wall turret | Mounted on canyon wall | Rotates, fires aimed bursts; only hittable from the corridor side | Hug the opposite wall |
| AA flak | Floor | Fills an area with delayed airburst rings | Read the ground marker and move |
| SAM site | Floor/wall | Locks on (warning tone + reticle), launches a heat-seeker | **Flares** (new) or a hard break turn |
| Armour column | Floor | Tanks moving up the canyon floor; slow, tanky, high score | Missiles |
| Rival gunship | Air | Matches your speed, duels from behind/beside | Mini-boss pattern |
| Mines (existing) | Air/floor | Drifting, proximity-triggered | Shoot early |
| Force gate (existing) | Corridor | Becomes a **barrier with a weak point**, not a block | Hit the generator node |

**Player arsenal (data-driven `gameplay/weapons/`):**
- **Chain gun:** the existing weapon, now with heat. Holding fire overheats it, and tapping in rhythm rewards you with an "active cooling" window.
- **Hellfire missiles:** a lock-on cone in front of the chopper. Hold to paint up to 4 targets, release to ripple-fire (fixes #4 properly).
- **Flares:** a limited counter to SAMs, with a short cooldown.
- **Rocket pods / spread / rail cannon:** secondary weapon slots found or unlocked as pickups.
- **EMP burst:** a rare screen-clear charged by combo.

**Scoring and risk/reward:**
- **Combo multiplier** that decays over time and resets when hit.
- **Canyon-hugging "graze" bonus:** flying within N px of a wall without touching it builds
  multiplier. This turns the wall from a pure hazard into a skill expression.
- **Near-miss bonus** for bullets that pass close.
- Chain kills and style bonuses shown as pop-up text in the world.

**Movement:**
- Add vertical movement within a band (the player is no longer locked to 70% of screen height)
  and a short **boost/brake** that changes scroll speed at a fuel cost.
- An optional **altitude toggle** (low/high) on the shadow-offset mechanic: low is dangerous near
  the walls but dodges flak; high is safer from walls but exposed to SAMs. This is a big depth
  lever, so prototype it before committing.

**Exit criteria:** playtesters can name what killed them every time (telegraph clarity), and the median run lasts over 3 minutes.

---

## Phase 4 — Structure, progression and content 🟡 *(first pass landed; forks and rockfalls are deferred; see README)*
*Goal: give runs a shape and players a reason to replay.*

1. **Sectors** (`content/sectors/`): a run is a sequence of 4–6 sectors, each with its own palette,
   time of day, hazards and wave tables:
   - *Red Mesa* (late afternoon, wide and forgiving) → *Narrows* (deep shadows, wall turrets) →
     *Dry Lake* (open, armour columns, wind) → *Sandstorm Pass* (visibility drops, radar pings) →
     *Night Run* (searchlights, NVG green colour grade as a twist on the palette) → *Dawn Strike* (boss).
   - The light progresses across the run: dusk → night → dawn, as the narrative arc of an "op".
2. **Canyon features:** **forks** (choose a branch: risky with more loot, or safe), bridges to fly
   under, rockfalls triggered by explosions, fuel depots you strafe for fuel (replaces some random fuel pickups).
3. **Bosses** (`gameplay/bosses/`): a scripted multi-phase boss at the end of each sector:
   a fortified dam, a heavy gunship, a train on a canyon-floor rail line, a radar complex with segmented weak points.
4. **Wave director:** authored set-piece waves mixed with a procedural "intensity budget" director
   (as in Left 4 Dead) that reads player health and performance and paces build-up and relief.
5. **Meta-progression (Hangar screen):** earn salvage per run and spend it on unlocks (new weapons,
   chopper variants with different stats), not on raw stat inflation that trivialises early sectors.
6. **Modes:** Campaign (fixed seeds, authored), Endless (the current game, now infinite and
   escalating), **Daily Op** (shared seed, one attempt, local and optional online leaderboard), Practice (pick a sector).
7. **Debrief screen:** accuracy, kills by type, grazes, the sector reached, and medals or achievements.

**Exit criteria:** a full campaign run takes 15–25 minutes with 6 bosses. Endless and Daily Op are playable, and a save migrates cleanly from Phase 1 data.

---

## Phase 5 — Audio overhaul ✅ *(first pass; procedural, no samples; see README)*
*Goal: audio that is half the experience, still largely procedural.*
- Mixer buses (SFX / music / UI / ambience) with a compressor on the master bus, and sidechain ducking on big explosions.
- Better synth SFX: layered rotor *thwop* tied to rotor RPM, stereo-panned by on-screen X;
  distance-filtered explosions; a distinct lock-on tone ladder; wind and sand ambience per sector.
- **Adaptive music:** a procedural or stem-based track (low-tempo desert-synth/dark-western) whose
  layers fade in with intensity, plus stingers on boss entry and phase changes.
- Optional recorded samples in `public/audio/` for a few hero sounds (rotor, cannon), lazy-loaded.

---

## Phase 6 — Platform, accessibility and release polish ✅ *(first pass; release candidate 1.0.0-rc.1; publishing is waiting on you, see README)*
- **Touch controls** (removes the mobile block, #14): drag-relative steering, auto-fire option,
  missile and flare buttons, portrait-first layout, haptics through the Vibration API.
- **Accessibility:** remappable controls, colourblind-safe telegraph shapes (not just red), a
  screen-shake and flash intensity slider, a reduced-motion mode, an assist mode (slower speed, wall
  damage off), subtitle-style text for audio warnings.
- **Performance:** quality presets, dynamic resolution scaling, object-pool audit, bundle size under 1.5 MB excluding audio.
- **PWA:** offline play, installable, a manifest with icons.
- **QA:** Playwright smoke test (boot → play 30 s → no console errors), recorded-input replay
  tests for regressions, and a cross-browser pass (Chrome, Firefox, Safari).
- Deploy with GitHub Pages, Netlify or itch.io, and set up CI that builds and runs the tests on every push.

---

## Suggested sequencing and effort

| Phase | Rough size | Can overlap with |
|-------|-----------|------------------|
| 1. Foundation | 1–2 weeks | — (blocks everything) |
| 2. Visuals | 3–5 weeks | 3 (after 2b lands) |
| 3. Combat | 2–3 weeks | 2c–2e, 5 |
| 4. Structure | 3–4 weeks | 5 |
| 5. Audio | 1–2 weeks | 3, 4 |
| 6. Polish/release | 1–2 weeks | — |

**Recommended first milestone ("Vertical Slice"):** Phase 1 complete + Phase 2a/2b + three Phase 3
enemies (gun drone, wall turret, SAM with flares) + one sector with one boss. This proves the art
direction and the combat loop before you invest in content volume.

## Decisions to make early
1. **Camera:** commit to top-down ¾ (recommended) vs. a behind-the-chopper pseudo-3D view. This changes everything in Phase 2.
2. **Renderer:** PixiJS v8 (recommended: mature, small, good filters) vs. raw WebGL2 vs. Three.js (only if you choose pseudo-3D).
3. **Art pipeline:** hand-made pixel art, vector art rendered to atlases, or procedurally drawn
   sprites baked at load time (keeps the zero-asset spirit of the prototype).
4. **Altitude mechanic:** in or out. Prototype it in Phase 3 before building content around it.
