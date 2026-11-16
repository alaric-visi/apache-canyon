import { Filter, GlProgram } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import fragment from './shaders/grade.frag?raw';
import type { LightPreset } from '../../content/sectors/sectors';

const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

export interface HazeSource {
  /** Screen uv (0..1). */
  x: number;
  y: number;
  radius: number;
  strength: number;
}

export class GradeFilter extends Filter {
  private readonly u: Record<string, unknown>;

  constructor() {
    super({
      glProgram: GlProgram.from({ vertex, fragment, name: 'dusk-grade' }),
      resources: {
        gradeUniforms: {
          uTime: { value: 0, type: 'f32' },
          uHurt: { value: 0, type: 'f32' },
          uCritical: { value: 0, type: 'f32' },
          uHaze: { value: new Float32Array(16), type: 'vec4<f32>', size: 4 },
          uExposure: { value: 1, type: 'f32' },
          uLow: { value: new Float32Array([0.1, 0.04, 0.16]), type: 'vec3<f32>' },
          uHigh: { value: new Float32Array([1.06, 0.98, 0.86]), type: 'vec3<f32>' },
          uGlow: { value: new Float32Array([1, 0.62, 0.28]), type: 'vec3<f32>' },
          uGlowStrength: { value: 0.22, type: 'f32' },
          uNight: { value: 0, type: 'f32' },
          uNvg: { value: 0, type: 'f32' },
          uDust: { value: 0, type: 'f32' },
          uPlayer: { value: new Float32Array([0.5, 0.7]), type: 'vec2<f32>' },
        },
      },
    });
    this.u = (this.resources.gradeUniforms as { uniforms: Record<string, unknown> }).uniforms;
  }

  setLight(l: LightPreset, playerU: number, playerV: number): void {
    const u = this.u;
    u.uExposure = l.exposure;
    (u.uLow as Float32Array).set(l.gradeLow);
    (u.uHigh as Float32Array).set(l.gradeHigh);
    (u.uGlow as Float32Array).set(l.glow);
    u.uGlowStrength = l.glowStrength;
    u.uNight = l.night;
    u.uNvg = l.nvg;
    u.uDust = l.dust;
    const p = u.uPlayer as Float32Array;
    p[0] = playerU; p[1] = playerV;
  }

  set(time: number, hurt: number, critical: number, haze: readonly HazeSource[]): void {
    this.u.uTime = time;
    this.u.uHurt = hurt;
    this.u.uCritical = critical;
    const h = this.u.uHaze as Float32Array;
    h.fill(0);
    for (let i = 0; i < Math.min(4, haze.length); i++) {
      h[i * 4] = haze[i].x; h[i * 4 + 1] = haze[i].y; h[i * 4 + 2] = haze[i].radius; h[i * 4 + 3] = haze[i].strength;
    }
  }
}

export function makeBloom(): AdvancedBloomFilter {
  return new AdvancedBloomFilter({ threshold: 0.74, bloomScale: 0.9, brightness: 1, blur: 5, quality: 5 });
}
