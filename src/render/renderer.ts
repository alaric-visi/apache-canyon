import type { Sim } from '../engine/sim';
import type { Fx } from './fx/fx';

export type ScreenState = 'title' | 'playing' | 'paused' | 'over';
export type Quality = 'high' | 'balanced' | 'performance';

/** Accessibility options the renderer honours. */
export interface Access {
  /** 0..1 camera shake strength. */
  shake: number;
  /** 0..1 strength of flashes (hit flashes, damage pulse, chromatic aberration). */
  flash: number;
  /** No shake, rotation, zoom, hit-stop or flicker; fewer particles. */
  reducedMotion: boolean;
  /** Threats get shape-coded, high-contrast outlines and dashed white telegraphs. */
  contrast: boolean;
}

export const DEFAULT_ACCESS: Access = { shake: 1, flash: 1, reducedMotion: false, contrast: false };

export interface RenderView {
  sim: Sim;
  fx: Fx;
  /** Interpolation factor between the previous and current sim tick. */
  alpha: number;
  screen: ScreenState;
  /** Monotonic frame counter for idle animations. */
  idle: number;
  /** Draw hitboxes. */
  debug: boolean;
}

/** The only surface gameplay code sees. WebGL (Pixi) is primary; Canvas2D is the fallback. */
export interface Renderer {
  resize(): void;
  render(view: RenderView): void;
  setQuality?(q: Quality): void;
  setAccess?(a: Access): void;
  /** World units → CSS px at the current camera (touch steering needs it). */
  worldScale?(): number;
}
