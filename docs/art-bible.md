# Art Bible: Dusk Ops

## Camera
- **Top-down**, looking straight down at the canyon. The player flies "up" the screen.
- The world is 800 × 600 units. The renderer scales it to fit, and extra width shows more mesa.
- The camera leads slightly toward the player's horizontal position and zooms out up to 5% at top speed.
- There is no sky. **The sunset is lighting, not a backdrop.**

## Light
- One **low sun, off-screen at the lower left** (west-southwest), at roughly 15° elevation.
  - Sun direction on screen: `normalize(-0.85, +0.5)` (pointing *toward* the sun).
- **Shadows fall up and to the right.** Every shadow in the game uses the same offset direction:
  - Air units: offset `(+12, -10)` × altitude factor, soft, 40–50% opacity.
  - The west (left) canyon wall casts a long raking shadow across the floor. Its width scales
    with the local wall height, so deep narrows sit in shade and wide sections are flooded with amber.
- **Sun-facing surfaces** (the east wall's west-facing cliff face, the left sides of objects) get a hot rim, `#ffcf8a` → `#ffe9b8`.
- **Shadow side and ambient** are cool violet, `#2a1838` → `#4a2f55`. Warm light against cool shadow is the core dusk contrast.

## Palette ramps
| Ramp | Stops |
|------|-------|
| Sand (lit floor) | `#7a3a1c` `#b0602e` `#d98a4f` `#efb27a` |
| Rock (mesa top) | `#3a1c10` `#5a2a18` `#7d3f22` `#9c4a26` |
| Shadow (cool) | `#1a0f22` `#2a1838` `#4a2f55` |
| Hot (light, fire, tracers) | `#d9502f` `#f0a44c` `#ffc36b` `#fff5e0` |
| Hostile accent | `#d9502f` with `#ff3b2f` eye lights |
| Friendly accent | `#ffc36b` (pickups and the player HUD) |

## Silhouettes (shape first, colour second)
| Thing | Shape language |
|-------|----------------|
| Player gunship | Long narrow fuselage, stub wings with pods, a 2-blade rotor disc. Reads as a **cross** |
| Drone | Quad-rotor **X** with four spinning discs |
| UAV | **Delta / arrowhead** wing pointing down the screen (toward the player) |
| Mine | **Spiked circle** with a pulsing light |
| Force gate | **Vertical bar** between two pylons, crackling |
| Pickups | **Square crate under a round striped parachute**, with an icon |

## Scale
- Gunship: 28 units long, rotor diameter 34 (about 4–6% of screen width). The hitbox stays 16 × 16, smaller than the art.
- Hostiles are drawn 1.2–1.6× their hitbox.

## Effects grammar
- **Explosions** come in layers: flash → fireball → sparks → smoke → debris → scorch decal on the ground.
- **Smoke** is lit from the lower left: warm on the sun side, violet on the shadow side.
- **Anything glowing is additive**, and the bloom pass picks it up. Keep large lit areas below the bloom threshold so only light sources bloom.
- **Ground-anchored effects** (scorch marks, dust, smoke bases) scroll with the canyon floor.

## Post-processing
Applied in this order: bloom → colour grade (shadows lifted toward violet, highlights warmed) →
sun glow from the lower left → heat haze → vignette → film grain. A red vignette pulse plus chromatic aberration signals damage and critical state.
The **Performance** quality preset skips post-processing and renders at 1× resolution.

## Sector light presets
Each sector defines a `LightPreset` in `src/content/sectors/sectors.ts`: sun tint, shadow tint and length, exposure, grade tints, corner glow, and the `night`, `nvg` and `dust` amounts. The renderer eases between presets over about 4 seconds when a sector changes.
- **Night:** everything is dark except the gunship's searchlight pool and forward beam. Anything bright enough to bloom (fire, tracers, eyes) stays visible.
- **NVG:** a green luminance grade with faint scanlines.
- **Sandstorm:** smooth, wind-stretched haze that thickens with distance from the gunship, plus sand-streak particles.
