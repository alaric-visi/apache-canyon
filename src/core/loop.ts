export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
/** Never simulate more than this many ticks per frame (avoids the spiral of death after a stall). */
const MAX_TICKS_PER_FRAME = 5;

export interface LoopCallbacks {
  /** Advance the simulation by exactly one fixed tick. */
  tick(): void;
  /** Draw; `alpha` in [0,1) is how far we are between the previous and current tick. */
  render(alpha: number, frameMs: number): void;
}

/**
 * Fixed-timestep accumulator. Pure and clock-agnostic so it can be tested
 * without requestAnimationFrame: feed it timestamps via `frame(now)`.
 */
export class FixedStepper {
  private accumulator = 0;
  private last: number | null = null;
  ticks = 0;

  constructor(private readonly cb: LoopCallbacks) {}

  frame(now: number): void {
    if (this.last === null) this.last = now;
    const frameMs = Math.min(now - this.last, 250);
    this.last = now;
    this.accumulator += frameMs;

    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < MAX_TICKS_PER_FRAME) {
      this.cb.tick();
      this.ticks++;
      this.accumulator -= TICK_MS;
      steps++;
    }
    if (steps === MAX_TICKS_PER_FRAME) this.accumulator = Math.min(this.accumulator, TICK_MS);

    this.cb.render(this.accumulator / TICK_MS, frameMs);
  }

  /** Forget the last timestamp, e.g. after the tab was hidden. */
  resetClock(): void {
    this.last = null;
    this.accumulator = 0;
  }
}

export function startLoop(stepper: FixedStepper): () => void {
  let handle = 0;
  const run = (now: number) => {
    stepper.frame(now);
    handle = requestAnimationFrame(run);
  };
  handle = requestAnimationFrame(run);
  return () => cancelAnimationFrame(handle);
}
