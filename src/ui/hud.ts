import type { Sim } from '../engine/sim';
import { SECTORS } from '../content/sectors/sectors';

const LOW_GRAD = 'linear-gradient(to right, #6b2f1a, #d9502f)';
const OK_GRAD = 'linear-gradient(to right, #d9502f, #f0a44c)';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** DOM HUD that only touches the DOM when a displayed value actually changes. */
export class Hud {
  private cache = new Map<string, string>();
  private els = {
    score: $('score'), hiscore: $('hiscore'), lives: $('lives'), missiles: $('missiles'),
    time: $('time'), speed: $('speed'),
    fuelBar: $('fuelBar'), fuelValue: $('fuelValue'),
    shieldsBar: $('shieldsBar'), shieldsValue: $('shieldsValue'),
    container: $('gameContainer'), message: $('message'), mute: $('muteStatus'), quality: $('qualityStatus'),
    mult: $('mult'), flares: $('flares'), empBar: $('empBar'), empValue: $('empValue'), empItem: $('empItem'),
    boss: $('boss'), bossFill: $('bossFill'), bossName: $('bossName'), bossBanner: $('bossBanner'), hint: $('hint'),
    progress: $('progress'), progressFill: $('progressFill'), progressLabel: $('progressLabel'), card: $('sectorCard'),
  };

  constructor() {
    // overlays (progress strip, boss bar, hints) sit just under the HUD, which wraps on narrow screens
    const measure = () => document.documentElement.style.setProperty('--hud-h', `${$('hud').offsetHeight}px`);
    measure();
    window.addEventListener('resize', measure);
    new ResizeObserver(measure).observe($('hud'));
  }

  private set(key: string, value: string, apply: (v: string) => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply(value);
  }

  private text(el: HTMLElement, key: string, value: string) {
    this.set(key, value, (v) => (el.textContent = v));
  }

  update(sim: Sim, hiscore: number, playing: boolean): void {
    const e = this.els;
    this.text(e.score, 'score', String(sim.score).padStart(6, '0'));
    this.text(e.hiscore, 'hiscore', String(hiscore).padStart(6, '0'));
    this.text(e.lives, 'lives', String(sim.lives).padStart(2, '0'));
    this.text(e.missiles, 'missiles', String(sim.missiles).padStart(2, '0'));
    this.text(e.time, 'time', String(sim.timeSeconds).padStart(3, '0'));
    this.text(e.speed, 'speed', sim.scrollSpeed.toFixed(1));
    this.bar('fuel', sim.fuel, e.fuelBar, e.fuelValue);
    this.text(e.mult, 'mult', `×${sim.combo.mult.toFixed(1)}`);
    this.set('multHot', String(sim.combo.mult >= 2), (v) => e.mult.classList.toggle('hot', v === 'true'));
    this.text(e.flares, 'flares', String(sim.flares));
    const emp = Math.floor(sim.emp);
    this.set('empW', String(emp), (v) => (e.empBar.style.width = v + '%'));
    this.text(e.empValue, 'empL', emp >= 100 ? 'READY' : emp + '%');
    this.set('empReady', String(emp >= 100), (v) => e.empItem.classList.toggle('ready', v === 'true'));
    const bb = sim.bossBar;
    this.set('boss', String(!!bb && playing), (v) => (e.boss.style.display = v === 'true' ? 'block' : 'none'));
    if (bb) {
      this.text(e.bossName, 'bossName', bb.shielded ? `${bb.name} · SHIELDED` : bb.name);
      this.set('bossW', String(Math.ceil((bb.hp / bb.maxHp) * 100)), (v) => (e.bossFill.style.width = v + '%'));
    }
    // sector progress strip (boss marker at the end)
    const c = sim.course;
    const prog = c.phase === 'run' ? Math.min(1, (sim.dist - c.sectorStartDist) / SECTORS[c.sector].length) : 1;
    this.set('progW', String(Math.floor(prog * 100)), (v) => (e.progressFill.style.width = v + '%'));
    this.text(e.progressLabel, 'progL', c.phase === 'run' ? `S${c.sector + 1} ▸ BOSS` : c.phase === 'boss' ? `S${c.sector + 1} ▸ BOSS ENGAGED` : `S${c.sector + 1} ▸ CLEAR`);
    this.bar('shields', (sim.shields / sim.maxShields) * 100, e.shieldsBar, e.shieldsValue);
    const critical = playing && (sim.fuel < 25 || sim.shields < sim.maxShields * 0.25);
    this.set('critical', String(critical), (v) => e.container.classList.toggle('critical', v === 'true'));
  }

  private bar(key: string, value: number, bar: HTMLElement, label: HTMLElement) {
    const v = Math.max(0, Math.floor(value));
    this.set(key + 'W', String(v), (s) => (bar.style.width = s + '%'));
    this.text(label, key + 'L', v + '%');
    const low = value < 30;
    this.set(key + 'Low', String(low), () => {
      bar.style.background = low ? LOW_GRAD : OK_GRAD;
      label.style.color = low ? '#ffb454' : '#ffc36b';
    });
  }

  private hintTimer = 0;
  private hintQueue: string[] = [];
  /** One-line teaching hint above the controls bar; queued so they never overlap. */
  showHint(text: string): void {
    this.hintQueue.push(text);
    if (this.hintQueue.length === 1) this.nextHint();
  }
  private nextHint(): void {
    const text = this.hintQueue[0];
    const el = this.els.hint;
    if (!text) { el.classList.remove('on'); return; }
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      el.classList.remove('on');
      this.hintQueue.shift();
      this.hintTimer = window.setTimeout(() => this.nextHint(), 400);
    }, 4800);
  }

  private captionTimes = new Map<string, number>();
  /** Show a sound caption (throttled per key). */
  caption(key: string, text: string): void {
    const now = performance.now();
    if ((this.captionTimes.get(key) ?? 0) > now - 1200) return;
    this.captionTimes.set(key, now);
    const box = document.getElementById('captions');
    if (!box) return;
    const d = document.createElement('div');
    d.textContent = text;
    box.append(d);
    while (box.children.length > 4) box.firstElementChild?.remove();
    window.setTimeout(() => d.remove(), 2600);
  }

  private bannerTimer = 0;
  /** Flash the boss warning banner for a few seconds. */
  bossBanner(on: boolean, name = 'HOSTILE GUNSHIP'): void {
    clearTimeout(this.bannerTimer);
    this.els.bossBanner.style.display = on ? 'block' : 'none';
    if (on) this.els.bossBanner.textContent = `⚠ ${name} ⚠`;
    if (on) this.bannerTimer = window.setTimeout(() => this.bossBanner(false), 2800);
  }

  private cardTimer = 0;
  /** Big centred title card (sector start, boss down, shields down). */
  sectorCard(title: string, sub: string): void {
    const el = this.els.card;
    (el.querySelector('.sc-title') as HTMLElement).textContent = title;
    (el.querySelector('.sc-sub') as HTMLElement).textContent = sub;
    el.classList.add('on');
    clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => el.classList.remove('on'), 2800);
  }

  /** Show the in-run chrome (progress strip) only while a run is live. */
  setPlaying(on: boolean): void {
    this.els.progress.classList.toggle('on', on);
    if (!on) {
      this.hintQueue.length = 0;
      clearTimeout(this.hintTimer);
      this.els.hint.classList.remove('on');
      this.els.boss.style.display = 'none';
      this.cache.delete('boss');
      this.els.container.classList.remove('critical');
      this.cache.delete('critical');
    }
  }

  setMuted(muted: boolean): void {
    this.els.mute.textContent = `[M]: MUTE (${muted ? 'ON' : 'OFF'})`;
  }

  setQuality(q: string): void {
    this.els.quality.textContent = `[Q] QUALITY: ${q.toUpperCase()}`;
  }

  showMessage(lines: { text: string; cls?: string }[]): void {
    const m = this.els.message;
    m.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'title-screen';
    for (const l of lines) {
      const d = document.createElement('div');
      if (l.cls) d.className = l.cls;
      d.textContent = l.text;
      wrap.append(d);
    }
    m.append(wrap);
    m.style.display = 'block';
  }

  hideMessage(): void {
    this.els.message.style.display = 'none';
  }
}
