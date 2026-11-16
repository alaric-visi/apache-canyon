import { Geometry, Mesh, Shader, Texture } from 'pixi.js';
import type { Canyon, Corridor } from '../../world/canyon';
import { VIEW_H } from '../../world/canyon';
import vertex from './shaders/terrain.vert?raw';
import fragment from './shaders/terrain.frag?raw';

const ROW_STEP = 4;
const MARGIN = 72;
const RANGE_MIN = -512;
const RANGE = 2048;
/** Ground noise repeats every PERIOD world units (must match the shader). */
const PERIOD = 4096;

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The canyon floor, cliffs and mesa tops as one full-view quad. Wall edges are
 * sampled on the CPU from the Canyon (the single source of truth) and uploaded
 * each frame as a tiny data texture; the shader does all the shading.
 */
export class Terrain {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly data: HTMLCanvasElement;
  private readonly dctx: CanvasRenderingContext2D;
  private img: ImageData;
  private readonly tex: Texture;
  private rows = 0;
  private readonly uniforms: Record<string, unknown>;
  private readonly c: Corridor = { left: 0, right: 0 };

  constructor() {
    this.data = document.createElement('canvas');
    this.data.width = 2;
    this.data.height = 1;
    this.dctx = this.data.getContext('2d', { willReadFrequently: true })!;
    this.img = this.dctx.createImageData(2, 1);
    this.tex = Texture.from(this.data);

    const geometry = new Geometry({
      attributes: { aPosition: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const shader = Shader.from({
      gl: { vertex, fragment, name: 'terrain' },
      resources: {
        terrainUniforms: {
          uRect: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
          uRowTop: { value: 0, type: 'f32' },
          uRowStep: { value: ROW_STEP, type: 'f32' },
          uRows: { value: 1, type: 'f32' },
          uDist: { value: 0, type: 'f32' },
          uViewH: { value: VIEW_H, type: 'f32' },
          uSun: { value: new Float32Array([1.08, 1, 0.92]), type: 'vec3<f32>' },
          uShadowTint: { value: new Float32Array([0.29, 0.215, 0.42]), type: 'vec3<f32>' },
          uShadowLen: { value: 1, type: 'f32' },
        },
        uData: this.tex.source,
      },
    });
    this.uniforms = (shader.resources.terrainUniforms as { uniforms: Record<string, unknown> }).uniforms;
    this.mesh = new Mesh({ geometry, shader });
  }

  /** Sector lighting for the ground. */
  setLight(sun: readonly number[], shadow: readonly number[], shadowLen: number): void {
    (this.uniforms.uSun as Float32Array).set(sun);
    (this.uniforms.uShadowTint as Float32Array).set(shadow);
    this.uniforms.uShadowLen = shadowLen;
  }

  /** Re-sample walls for the visible rect at ground distance `dist`. Call every frame. */
  update(canyon: Canyon, dist: number, view: WorldRect): void {
    const x = view.x - MARGIN, y = view.y - MARGIN, w = view.w + MARGIN * 2, h = view.h + MARGIN * 2;
    this.mesh.position.set(x, y);
    this.mesh.scale.set(w, h);
    const rect = this.uniforms.uRect as Float32Array;
    rect[0] = x; rect[1] = y; rect[2] = w; rect[3] = h;

    // rows extend past the quad so the shader's shadow look-ups stay in range
    const rowTop = y - 48;
    const rows = Math.ceil((h + 96) / ROW_STEP) + 2;
    if (rows !== this.rows) {
      this.rows = rows;
      this.data.height = rows;
      this.tex.source.resize(2, rows); // before drawing: resizing a canvas clears it
      this.img = this.dctx.createImageData(2, rows);
    }
    const px = this.img.data;
    for (let i = 0; i < rows; i++) {
      const wy = rowTop + (i + 0.5) * ROW_STEP;
      const d = dist + (VIEW_H - wy);
      canyon.at(d, this.c);
      const l = enc(this.c.left), r = enc(this.c.right);
      const o = i * 8;
      px[o] = l >> 8; px[o + 1] = l & 255; px[o + 2] = Math.round(canyon.height(d) * 255); px[o + 3] = 255;
      px[o + 4] = r >> 8; px[o + 5] = r & 255; px[o + 6] = 0; px[o + 7] = 255;
    }
    this.dctx.putImageData(this.img, 0, 0);
    this.tex.source.update();

    this.uniforms.uRowTop = rowTop;
    this.uniforms.uRows = rows;
    this.uniforms.uDist = ((dist % PERIOD) + PERIOD) % PERIOD;
  }
}

function enc(x: number): number {
  return Math.max(0, Math.min(65535, Math.round(((x - RANGE_MIN) / RANGE) * 65535)));
}
