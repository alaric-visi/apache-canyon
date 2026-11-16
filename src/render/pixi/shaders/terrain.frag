// Top-down canyon at golden hour. Everything is computed per pixel from the
// wall edges (packed into uData, one row per 4 world units) and ground noise.
// Sun is low at the lower-left: shadows fall up and to the right.

in vec2 vWorld;
out vec4 finalColor;

uniform sampler2D uData;
uniform float uRowTop;
uniform float uRowStep;
uniform float uRows;
uniform float uDist;      // ground distance, wrapped to PERIOD
uniform float uViewH;
uniform vec3 uSun;        // sector light: sunlit multiplier
uniform vec3 uShadowTint; // sector light: shadow colour
uniform float uShadowLen; // sector light: shadow length scale

const float PERIOD = 4096.0;
const vec2 SUN = vec2(-0.862, 0.507);

// ---------------------------------------------------------------- data
float decode16(vec2 hiLo) {
    vec2 b = floor(hiLo * 255.0 + 0.5);
    return (b.x * 256.0 + b.y) / 65535.0 * 2048.0 - 512.0;
}

vec3 rowAt(float r) {
    float v = (clamp(r, 0.0, uRows - 1.0) + 0.5) / uRows;
    vec4 a = texture(uData, vec2(0.25, v));
    vec4 b = texture(uData, vec2(0.75, v));
    return vec3(decode16(a.rg), decode16(b.rg), a.b);
}

// left, right, height at world row y (linearly interpolated between rows)
vec3 walls(float y) {
    float r = (y - uRowTop) / uRowStep - 0.5;
    float r0 = floor(r);
    return mix(rowAt(r0), rowAt(r0 + 1.0), r - r0);
}

// ---------------------------------------------------------------- noise (periodic in y so the wrap is seamless)
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float vnoise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float y0 = mod(i.y, period), y1 = mod(i.y + 1.0, period);
    float a = hash(vec2(i.x, y0)), b = hash(vec2(i.x + 1.0, y0));
    float c = hash(vec2(i.x, y1)), d = hash(vec2(i.x + 1.0, y1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// scale must divide PERIOD
float fbm(vec2 g, float scale) {
    vec2 p = g / scale;
    float period = PERIOD / scale;
    float s = 0.0, amp = 0.5;
    for (int k = 0; k < 4; k++) {
        s += amp * vnoise(p, period);
        p *= 2.0;
        period *= 2.0;
        amp *= 0.5;
    }
    return s;
}

// ---------------------------------------------------------------- palette
const vec3 SAND_DEEP  = vec3(0.478, 0.227, 0.110);
const vec3 SAND_MID   = vec3(0.690, 0.376, 0.180);
const vec3 SAND_LIGHT = vec3(0.851, 0.541, 0.310);
const vec3 SAND_HOT   = vec3(0.937, 0.698, 0.478);
const vec3 ROCK_DARK  = vec3(0.227, 0.110, 0.063);
const vec3 ROCK_MID   = vec3(0.353, 0.165, 0.094);
const vec3 ROCK_LIGHT = vec3(0.490, 0.247, 0.133);
const vec3 ROCK_TAN   = vec3(0.612, 0.290, 0.149);
const vec3 SHADOW     = vec3(0.290, 0.215, 0.420);
const vec3 VIOLET     = vec3(0.165, 0.094, 0.220);
const vec3 RIM        = vec3(1.000, 0.811, 0.541);

vec3 floorColor(vec2 g, float x, float L, float R) {
    float n = fbm(g, 64.0);
    vec3 col = mix(SAND_MID, SAND_LIGHT, smoothstep(0.25, 0.75, n));

    // wind ripples: contour lines of stretched noise
    float rip = fbm(vec2(g.x * 1.6, g.y * 0.55), 32.0);
    float lines = abs(fract(rip * 7.0) - 0.5);
    col *= 0.97 + 0.04 * smoothstep(0.02, 0.3, lines);

    // dry riverbed meandering down the middle
    float mid = 0.5 * (L + R);
    float wander = (fbm(vec2(7.0, g.y), 256.0) - 0.5) * (R - L) * 0.7;
    float cw = 6.0 + 10.0 * fbm(vec2(3.0, g.y), 128.0);
    float ch = 1.0 - smoothstep(cw * 0.6, cw, abs(x - (mid + wander)));
    float mud = fbm(g, 8.0);
    vec3 bed = mix(SAND_DEEP, SAND_MID, smoothstep(0.3, 0.7, mud)) * (0.92 + 0.12 * smoothstep(0.4, 0.6, fract(mud * 3.0)));
    col = mix(col, bed, ch * 0.6);

    // scattered pebbles with a lit lower-left edge
    vec2 cell = floor(g / 7.0);
    vec2 cellY = vec2(cell.x, mod(cell.y, PERIOD / 7.0));
    float h = hash(cellY);
    if (h > 0.93) {
        vec2 c = (cell + 0.25 + 0.5 * vec2(hash(cellY + 3.1), hash(cellY + 7.7))) * 7.0;
        float d = length(g - c);
        float pr = 0.8 + 1.4 * hash(cellY + 1.3);
        if (d < pr) {
            float lit = dot(normalize(g - c + 0.001), vec2(SUN.x, -SUN.y));
            col = mix(col, mix(ROCK_MID, SAND_HOT, 0.5 + 0.5 * lit), 0.8);
        }
    }
    return col;
}

vec3 mesaColor(vec2 g, float e, float H, vec2 normal, bool sunFacing) {
    float faceW = 6.0 + 14.0 * H;
    float lambert = max(dot(normal, SUN), 0.0);

    if (e < faceW) {
        // cliff face seen from above: strata run parallel to the edge
        float t = e / faceW; // 0 at base, 1 at the lip
        float wob = (vnoise(vec2(e * 0.1, g.y / 24.0), PERIOD / 24.0) - 0.5) * 2.2;
        float band = fract(t * (3.0 + 3.0 * H) + wob * 0.3);
        vec3 strata = band < 0.33 ? ROCK_TAN : band < 0.66 ? ROCK_LIGHT : ROCK_MID;
        strata *= 0.85 + 0.3 * fbm(vec2(g.x * 0.5, g.y * 2.0), 16.0);
        vec3 lit = strata * (0.45 + 1.15 * lambert) + RIM * 0.35 * pow(lambert, 3.0) * t;
        vec3 shade = mix(strata * 0.35, SHADOW * 0.55, 0.55);
        vec3 col = mix(shade, lit, smoothstep(0.05, 0.35, lambert));
        col *= mix(0.55, 1.0, smoothstep(0.0, 0.5, t)); // base occlusion
        // lip highlight
        float lip = smoothstep(0.8, 1.0, t) * (1.0 - smoothstep(0.97, 1.0, t));
        col += RIM * lip * (sunFacing ? 0.55 : 0.12);
        return col;
    }

    // mesa top
    float n = fbm(g, 128.0);
    vec3 col = mix(ROCK_DARK, ROCK_LIGHT, smoothstep(0.2, 0.8, n));
    float crack = abs(fbm(g * 1.3, 32.0) - 0.5);
    col *= 0.75 + 0.25 * smoothstep(0.0, 0.035, crack);
    // sparse desert scrub: small round dark tufts
    vec2 sc = floor(g / 8.0);
    vec2 scY = vec2(sc.x, mod(sc.y, PERIOD / 8.0));
    if (hash(scY) > 0.9) {
        vec2 c = (sc + 0.3 + 0.4 * vec2(hash(scY + 2.3), hash(scY + 5.1))) * 8.0;
        float r = 0.8 + 1.2 * hash(scY + 9.7);
        col = mix(col, vec3(0.16, 0.13, 0.07), 0.7 * (1.0 - smoothstep(r * 0.6, r, length(g - c))));
    }
    col *= 0.72 + 0.25 * fbm(g, 512.0);
    // haze into the distance away from the corridor so the eye stays in the canyon
    float far = smoothstep(faceW + 30.0, faceW + 320.0, e);
    return mix(col, VIOLET, far * 0.55);
}

void main() {
    float x = vWorld.x;
    float y = vWorld.y;
    vec3 w = walls(y);
    vec3 wn = walls(y + 4.0);
    float L = w.x, R = w.y, H = w.z;
    vec2 g = vec2(x, uDist + uViewH - y);

    vec3 col;
    if (x >= L && x <= R) {
        col = floorColor(g, x, L, R);

        // long raking shadow from the west wall, sampled from a row nearer the sun
        vec3 ws = walls(y + 30.0);
        float edge = ws.x + (18.0 + 120.0 * ws.z * ws.z) * uShadowLen;
        edge += (vnoise(vec2(0.0, g.y / 16.0), PERIOD / 16.0) - 0.5) * 12.0;
        float shadow = 1.0 - smoothstep(edge - 7.0, edge + 7.0, x);

        vec3 lit = col * uSun;
        vec3 shaded = col * uShadowTint * 1.35 + vec3(0.05, 0.02, 0.0) * smoothstep(L, R, x); // warm bounce from the lit east wall
        col = mix(lit, shaded, shadow);

        // occlusion at the wall bases
        float ao = smoothstep(0.0, 16.0, x - L) * smoothstep(0.0, 12.0, R - x);
        col *= mix(0.55, 1.0, ao);
    } else if (x < L) {
        vec2 n = normalize(vec2(1.0, -(wn.x - L) / 4.0));
        col = mesaColor(g, L - x, H, n, false) * mix(vec3(1.0), uSun, 0.7);
    } else {
        vec2 n = normalize(vec2(-1.0, (wn.y - R) / 4.0));
        col = mesaColor(g, x - R, H, n, true) * mix(vec3(1.0), uSun, 0.7);
    }

    finalColor = vec4(col, 1.0);
}
