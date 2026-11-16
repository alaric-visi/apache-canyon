import type { Action } from '../input/input';

export interface MenuItem {
  label: string;
  /** Secondary text on the right (best score, cost, status). */
  detail?: string;
  /** Small tag before the label (EQUIPPED, NEW, LOCKED…). */
  tag?: string;
  disabled?: boolean;
  /** Visual emphasis: gold (earned/owned) or dim (not yet). */
  tone?: 'gold' | 'dim';
  onSelect?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
}

/**
 * A vertical DOM menu driven by actions (keyboard, gamepad d-pad) or the mouse.
 * Up/down move, fire/start select, pause backs out, left/right adjust.
 */
export class Menu {
  private items: MenuItem[] = [];
  private index = 0;
  onBack: (() => void) | null = null;

  constructor(private readonly el: HTMLElement) {}

  set(items: MenuItem[], keepIndex = false): void {
    this.items = items;
    if (!keepIndex) this.index = items.findIndex((i) => !i.disabled);
    this.index = Math.max(0, Math.min(items.length - 1, this.index));
    this.render();
  }

  private render(): void {
    this.el.replaceChildren();
    this.items.forEach((it, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'menu-item' + (i === this.index ? ' sel' : '') + (it.disabled ? ' off' : '') + (it.tone ? ` ${it.tone}` : '');
      if (it.tag) {
        const t = document.createElement('span');
        t.className = 'menu-tag';
        t.textContent = it.tag;
        row.append(t);
      }
      const l = document.createElement('span');
      l.className = 'menu-label';
      l.textContent = it.label;
      row.append(l);
      if (it.detail) {
        const d = document.createElement('span');
        d.className = 'menu-detail';
        d.textContent = it.detail;
        row.append(d);
      }
      row.addEventListener('mouseenter', () => { if (!it.disabled) { this.index = i; this.highlight(); } });
      row.addEventListener('click', () => { if (!it.disabled) { this.index = i; it.onSelect?.(); } });
      this.el.append(row);
    });
  }

  private highlight(): void {
    Array.from(this.el.children).forEach((c, i) => c.classList.toggle('sel', i === this.index));
  }

  private move(dir: number): void {
    if (!this.items.length) return;
    let i = this.index;
    for (let n = 0; n < this.items.length; n++) {
      i = (i + dir + this.items.length) % this.items.length;
      if (!this.items[i].disabled) break;
    }
    this.index = i;
    this.highlight();
  }

  /** Returns true if the action was consumed. */
  nav(a: Action): boolean {
    const it = this.items[this.index];
    switch (a) {
      case 'up': this.move(-1); return true;
      case 'down': this.move(1); return true;
      case 'left': it?.onLeft?.(); return true;
      case 'right': it?.onRight?.(); return true;
      case 'fire':
      case 'start':
        if (it && !it.disabled) it.onSelect?.();
        return true;
      case 'pause':
      case 'emp':
        this.onBack?.();
        return true;
    }
    return false;
  }
}
