import type { SimInput } from '../entities/types';
import type { Sim } from '../engine/sim';

/**
 * Touch controls.
 *  - Steering is drag-relative: put a finger down anywhere on the left/centre
 *    of the screen and the gunship follows the finger's *movement* (not its
 *    position), so your thumb never covers the gunship.
 *  - Auto-fire (default) fires while you steer; otherwise use the FIRE button.
 *  - Right-hand buttons: MISSILE (hold to paint locks), FLARE, EMP, BOOST (hold).
 */

type Btn = 'fire' | 'missile' | 'flare' | 'emp' | 'boost';

export class TouchControls {
  private readonly root: HTMLElement;
  private steerId: number | null = null;
  private fingerStart = { x: 0, y: 0 };
  private finger = { x: 0, y: 0 };
  private worldStart: { x: number; y: number } | null = null;
  private readonly held: Record<Btn, boolean> = { fire: false, missile: false, flare: false, emp: false, boost: false };
  /** Taps shorter than a tick still count once (latched until the next apply). */
  private readonly tapped: Record<Btn, boolean> = { fire: false, missile: false, flare: false, emp: false, boost: false };
  private readonly fireBtn: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly opts: () => { autoFire: boolean },
    private readonly onPause: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-zone"></div>
      <div class="t-buttons">
        <button data-b="missile">MSL<small>hold</small></button>
        <button data-b="flare">FLR</button>
        <button data-b="emp">EMP</button>
        <button data-b="boost">BST<small>hold</small></button>
      </div>
      <button class="t-fire" data-b="fire">FIRE</button>
      <button class="t-pause" aria-label="Pause">❚❚</button>`;
    parent.append(this.root);
    this.fireBtn = this.root.querySelector('.t-fire')!;

    const zone = this.root.querySelector('.t-zone') as HTMLElement;
    zone.addEventListener('touchstart', this.onStart, { passive: false });
    zone.addEventListener('touchmove', this.onMove, { passive: false });
    zone.addEventListener('touchend', this.onEnd);
    zone.addEventListener('touchcancel', this.onEnd);

    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('[data-b]'))) {
      const b = el.dataset.b as Btn;
      const down = (e: Event) => { e.preventDefault(); this.held[b] = true; this.tapped[b] = true; el.classList.add('on'); };
      const up = (e: Event) => { e.preventDefault(); this.held[b] = false; el.classList.remove('on'); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
    }
    this.root.querySelector('.t-pause')!.addEventListener('touchstart', (e) => { e.preventDefault(); this.onPause(); }, { passive: false });
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
    this.fireBtn.style.display = this.opts().autoFire ? 'none' : '';
    if (!on) this.release();
  }

  private release(): void {
    this.steerId = null;
    this.worldStart = null;
    for (const k of Object.keys(this.held) as Btn[]) this.held[k] = false;
    this.root.querySelectorAll('.on').forEach((e) => e.classList.remove('on'));
  }

  private onStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.steerId !== null) return;
    const t = e.changedTouches[0];
    this.steerId = t.identifier;
    this.fingerStart = { x: t.clientX, y: t.clientY };
    this.finger = { ...this.fingerStart };
    this.worldStart = null; // captured on the next apply(), from the gunship's position
  };

  private onMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) if (t.identifier === this.steerId) this.finger = { x: t.clientX, y: t.clientY };
  };

  private onEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === this.steerId) { this.steerId = null; this.worldStart = null; }
  };

  /** Merge touch state into this tick's input. `scale` is world units → CSS px. */
  apply(input: SimInput, sim: Sim, scale: number): void {
    const p = sim.player;
    if (this.steerId !== null) {
      if (!this.worldStart) this.worldStart = { x: p.x, y: p.y };
      const tx = this.worldStart.x + (this.finger.x - this.fingerStart.x) / scale;
      const ty = this.worldStart.y + (this.finger.y - this.fingerStart.y) / scale;
      const dead = 3;
      input.left ||= p.x > tx + dead;
      input.right ||= p.x < tx - dead;
      input.up ||= p.y > ty + dead;
      input.down ||= p.y < ty - dead;
      if (this.opts().autoFire) input.fire = true;
    }
    for (const b of Object.keys(this.held) as Btn[]) {
      input[b] ||= this.held[b] || this.tapped[b];
      this.tapped[b] = false;
    }
  }
}
