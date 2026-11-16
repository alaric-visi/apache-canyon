import { newInput, type SimInput } from '../entities/types';

/** Held actions read by the simulation every tick. */
export type HeldAction = keyof SimInput;
/** One-shot actions handled by the game shell on press. */
export type PressAction = 'start' | 'pause' | 'mute' | 'debug' | 'quality';
export type Action = HeldAction | PressAction;

/** Bindings by KeyboardEvent.code (physical key), so they work on any layout. */
export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft', 'KeyA', 'Comma'],
  right: ['ArrowRight', 'KeyD', 'Period'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  fire: ['KeyZ', 'KeyJ'],
  missile: ['KeyX', 'KeyK'],
  flare: ['KeyC', 'KeyL'],
  emp: ['KeyV', 'Semicolon'],
  boost: ['ShiftLeft', 'ShiftRight'],
  start: ['Space', 'Enter'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
  debug: ['Backquote'],
  quality: ['KeyQ'],
};

// Standard-mapping gamepad buttons
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, l3: 10, up: 12, down: 13, left: 14, right: 15 };
const STICK_DEADZONE = 0.35;

export class Input {
  private down = new Set<string>();
  /** Rebinding: the next key-down goes here instead of to the game. */
  private capture: ((code: string) => void) | null = null;
  private tapped = new Set<string>();
  private byCode = new Map<string, Action[]>();
  private padPrev: boolean[] = [];
  private readonly state: SimInput = newInput();

  constructor(
    bindings: Bindings,
    /** Fired on every key-down / button-down edge, for any action (menus use the held ones too). */
    private readonly onPress: (a: Action) => void,
  ) {
    this.setBindings(bindings);
    window.addEventListener('keydown', this.handleDown);
    window.addEventListener('keyup', this.handleUp);
    // Losing focus means we'll never see the keyup: drop everything (fixes stuck keys)
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.clear);
  }

  setBindings(b: Bindings): void {
    this.byCode.clear();
    for (const [action, codes] of Object.entries(b) as [Action, string[]][])
      for (const code of codes) this.byCode.set(code, [...(this.byCode.get(code) ?? []), action]);
  }

  captureNext(cb: ((code: string) => void) | null): void {
    this.capture = cb;
  }

  private handleDown = (e: KeyboardEvent) => {
    if (this.capture) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    const actions = this.byCode.get(e.code);
    if (!actions) return;
    e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    // latch so a tap shorter than a tick (or a slow frame) still registers once
    this.tapped.add(e.code);
    for (const a of actions) this.onPress(a);
  };

  private handleUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  clear = () => {
    this.down.clear();
    this.tapped.clear();
  };

  private held(a: HeldAction): boolean {
    for (const code of this.down) if (this.byCode.get(code)?.includes(a)) return true;
    for (const code of this.tapped) if (this.byCode.get(code)?.includes(a)) return true;
    return false;
  }

  /** Poll keyboard + gamepads. Call once per tick. Edge-triggered pad buttons fire onPress here. */
  sample(): SimInput {
    const s = this.state;
    s.left = this.held('left');
    s.right = this.held('right');
    s.fire = this.held('fire');
    s.missile = this.held('missile');
    s.up = this.held('up');
    s.down = this.held('down');
    s.flare = this.held('flare');
    s.emp = this.held('emp');
    s.boost = this.held('boost');
    this.tapped.clear();

    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0;
      s.left ||= btn(PAD.left) || ax < -STICK_DEADZONE;
      s.right ||= btn(PAD.right) || ax > STICK_DEADZONE;
      const ay = pad.axes[1] ?? 0;
      s.up ||= btn(PAD.up) || ay < -STICK_DEADZONE;
      s.down ||= btn(PAD.down) || ay > STICK_DEADZONE;
      s.fire ||= btn(PAD.a) || btn(PAD.rt);
      s.missile ||= btn(PAD.x) || btn(PAD.rb);
      s.flare ||= btn(PAD.y) || btn(PAD.lb);
      s.emp ||= btn(PAD.b);
      s.boost ||= btn(PAD.lt) || btn(PAD.l3);
      const edges: [number, Action][] = [
        [PAD.start, 'start'], [PAD.select, 'pause'], [PAD.a, 'fire'], [PAD.b, 'emp'],
        [PAD.up, 'up'], [PAD.down, 'down'], [PAD.left, 'left'], [PAD.right, 'right'],
      ];
      for (const [i, action] of edges) {
        const key = pad.index * 32 + i;
        const now = btn(i);
        if (now && !this.padPrev[key]) this.onPress(action);
        this.padPrev[key] = now;
      }
    }
    return s;
  }
}

export function isPress(a: Action): a is PressAction {
  return a === 'start' || a === 'pause' || a === 'mute' || a === 'debug' || a === 'quality';
}
