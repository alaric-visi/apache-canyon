import './style.css';
import { Game } from './engine/game';
import { Canvas2DRenderer } from './render/canvas2d';
import type { Renderer } from './render/renderer';

async function createRenderer(canvas: HTMLCanvasElement): Promise<[Renderer, string]> {
  const forceCanvas = new URLSearchParams(location.search).has('canvas2d');
  if (!forceCanvas) {
    try {
      const { PixiRenderer } = await import('./render/pixi/pixiRenderer');
      return [await PixiRenderer.create(canvas), 'webgl'];
    } catch (err) {
      console.warn('WebGL renderer unavailable, falling back to Canvas2D', err);
    }
  }
  return [new Canvas2DRenderer(canvas), 'canvas2d'];
}

async function boot(): Promise<void> {
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  await (document.fonts?.ready ?? Promise.resolve()).catch(() => undefined);

  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  const [renderer, name] = await createRenderer(canvas);

  // Resizing only re-lays out the view; the world and the run are untouched
  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => renderer.resize());
  }).observe(canvas.parentElement ?? canvas);

  // ?seed=1234 replays a specific run (handy for bug reports and the future Daily Op)
  const seedParam = new URLSearchParams(location.search).get('seed');
  const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) >>> 0 : null;

  const game = new Game(renderer, seed, name);
  game.start();
  // dev-only handle for inspecting/stepping from the console
  if (import.meta.env.DEV) (window as unknown as { __dusk: Game }).__dusk = game;
}

void boot();

// offline play / installable app (production builds only: the dev server must never be cached)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
document.addEventListener('contextmenu', (e) => e.preventDefault());
