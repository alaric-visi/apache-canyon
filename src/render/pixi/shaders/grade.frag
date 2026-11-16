// Final grade: heat haze → chromatic aberration → split-tone grade →
// low-sun glow → vignette (+ red critical pulse) → film grain.

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// shared with the vertex stage, which is highp: precisions must match to link
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec4 uInputClamp;

uniform float uTime;
uniform float uHurt;       // 0..1 recent damage
uniform float uCritical;   // 0..1 low fuel/shields
uniform vec4 uHaze[4];     // screen uv xy, radius (uv), strength
// sector light (blended between sectors by the renderer)
uniform float uExposure;
uniform vec3 uLow;         // added to dark tones
uniform vec3 uHigh;        // multiplied into bright tones
uniform vec3 uGlow;        // low-sun corner glow colour
uniform float uGlowStrength;
uniform float uNight;      // 0..1 darkness; the gunship's searchlight pools light
uniform float uNvg;        // 0..1 green night vision
uniform float uDust;       // 0..1 blowing sand
uniform vec2 uPlayer;      // player position, screen uv

float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
    // 0..1 across the output frame
    vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
    vec2 toTex = uOutputFrame.zw * uInputSize.zw;

    // heat shimmer: gentle everywhere near the bottom, strong over fresh explosions
    float shimmer = 0.0006 * smoothstep(0.55, 1.0, uv.y);
    for (int i = 0; i < 4; i++) {
        vec4 h = uHaze[i];
        float d = length((uv - h.xy) * vec2(uOutputFrame.z / uOutputFrame.w, 1.0));
        shimmer += h.w * 0.006 * (1.0 - smoothstep(0.0, h.z, d));
    }
    vec2 wob = vec2(sin(uv.y * 90.0 + uTime * 6.0), cos(uv.x * 70.0 + uTime * 5.0)) * shimmer;

    // chromatic aberration grows with damage and toward the edges
    vec2 fromC = uv - 0.5;
    float ca = (0.0008 + 0.006 * uHurt) * dot(fromC, fromC) * 4.0;
    vec2 base = (uv + wob) * toTex;
    vec2 off = fromC * ca * toTex;
    vec3 col;
    col.r = texture(uTexture, clamp(base + off, uInputClamp.xy, uInputClamp.zw)).r;
    col.g = texture(uTexture, clamp(base, uInputClamp.xy, uInputClamp.zw)).g;
    col.b = texture(uTexture, clamp(base - off, uInputClamp.xy, uInputClamp.zw)).b;

    col *= uExposure;
    // split-tone grade: sector-tinted shadows and highlights, slight S-curve
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col + uLow * (1.0 - smoothstep(0.0, 0.35, luma)) * 0.6, col * uHigh, smoothstep(0.35, 0.9, luma));
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);

    // night: everything falls dark except the searchlight pool and anything bright enough to glow
    vec2 asp = vec2(uOutputFrame.z / uOutputFrame.w, 1.0);
    if (uNight > 0.0) {
        float dp = length((uv - uPlayer) * asp);
        float pool = 1.0 - smoothstep(0.04, 0.3, dp);
        vec2 cone = (uv - (uPlayer + vec2(0.0, -0.2))) * asp / vec2(0.13, 0.22);
        float beam = (1.0 - smoothstep(0.6, 1.0, length(cone))) * 0.9;
        float light = max(pool, beam);
        float keep = smoothstep(0.62, 0.95, luma);
        col *= mix(1.0, mix(0.16 + light * 0.95, 1.0, keep), uNight);
    }
    if (uNvg > 0.0) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 nv = vec3(0.32, 1.0, 0.42) * (l * 1.5 + 0.035);
        nv *= 0.92 + 0.08 * sin(uv.y * uInputSize.y * 1.4);
        col = mix(col, nv, uNvg);
    }
    // blowing sand: streaky haze that thickens away from the gunship
    if (uDust > 0.0) {
        // wind-stretched smooth noise: long streaks racing across the screen
        vec2 q = vec2(uv.x * 3.0 - uTime * 1.6, uv.y * 26.0);
        float streak = vnoise(q) * 0.65 + vnoise(q * 2.3 + 7.0) * 0.35;
        float far = smoothstep(0.08, 0.55, length((uv - uPlayer) * asp));
        float amt = uDust * (0.14 + 0.36 * far) * (0.7 + 0.6 * streak);
        col = mix(col, vec3(0.74, 0.54, 0.34) * (0.88 + 0.2 * streak), clamp(amt, 0.0, 0.8));
    }

    // low sun glow from the lower-left corner
    float sun = 1.0 - smoothstep(0.0, 0.85, length((uv - vec2(-0.05, 1.08)) * vec2(1.2, 1.0)));
    col += uGlow * sun * sun * uGlowStrength;

    // vignette, pulsing red when critical or freshly hit
    float vig = smoothstep(0.95, 0.35, length(fromC * vec2(1.1, 1.0)));
    col *= mix(0.55, 1.0, vig);
    float pulse = max(uCritical * (0.5 + 0.5 * sin(uTime * 11.0)), uHurt);
    col = mix(col, vec3(0.85, 0.18, 0.1), (1.0 - vig) * pulse * 0.55);

    // grain
    float n = hash(uv * uInputSize.xy + fract(uTime * 13.7) * 100.0) - 0.5;
    col += n * 0.035;

    finalColor = vec4(col, 1.0);
}
