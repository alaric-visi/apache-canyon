import { FixedStepper, startLoop } from '../core/loop';
import { randomSeed } from '../core/rng';
import { Sim } from './sim';
import { AudioEngine } from '../audio/audio';
import { Input, isPress, type Action } from '../input/input';
import { Hud } from '../ui/hud';
import { Menu, type MenuItem } from '../ui/menu';
import { Fx } from '../render/fx/fx';
import type { Renderer, ScreenState } from '../render/renderer';
import { dailySeed, loadSave, todayKey, writeSave, type ModeId, type SaveData } from '../save/save';
import { newInput, type HostileKind, type SimEvent, type SimInput } from '../entities/types';
import { autopilot } from '../debug/autopilot';
import { HINTS, causeLabel } from '../ui/hints';
import { captionFor } from '../ui/captions';
import { DEFAULT_BINDINGS, type Bindings } from '../input/input';
import { TouchControls } from '../input/touch';
import { Recorder, type Replay } from '../debug/replay';
import { SECTORS } from '../content/sectors/sectors';
import { AIRFRAMES, PERKS, PERK_SLOTS, salvageFor, type AirframeId, type PerkId } from '../content/hangar';
import { MEDALS } from '../content/medals';
import { sectorProgress } from '../systems/course';

type Screen = 'menu' | 'practice' | 'hangar' | 'medals' | 'options' | 'access' | 'controls' | 'playing' | 'paused' | 'debrief';

const KIND_NAMES: Partial<Record<HostileKind, string>> = {
  drone: 'scouts', uav: 'UAVs', mine: 'mines', gunner: 'gunners', turret: 'turrets', flak: 'flak guns', sam: 'SAM sites',
  tank: 'tanks', gate: 'gate nodes', depot: 'depots', gunship: 'gunships', sluice: 'sluices', traincar: 'train cars', shieldgen: 'generators',
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/**
 * The game shell: menus (title, practice, hangar), the run (playing ⇄ paused),
 * and the debrief. Routes sim events to audio/FX/HUD and owns the save.
 * All gameplay lives in Sim.
 */
export class Game {
  private screen: Screen = 'menu';
  private sim: Sim;
  private readonly fx = new Fx();
  private readonly audio: AudioEngine;
  private readonly hud = new Hud();
  private readonly input: Input;
  private readonly save: SaveData;
  private readonly stepper: FixedStepper;
  private readonly attractInput: SimInput = newInput();
  private readonly menu = new Menu($('menu'));
  private readonly panelMenu = new Menu($('panelMenu'));
  private mode: ModeId = 'endless';
  private practiceSector = 0;
  private idle = 0;
  /** True once the player has touched the screen (touch controls are live). */
  private touchActive = false;
  private readonly touch: TouchControls;
  /** Records the player's inputs each run, so any run can be exported as a replay. */
  private readonly recorder = new Recorder();
  /** Cause of the last life lost, for the debrief. */
  private lastCause = 'scrape';
  private hitThisTick: string | null = null;
  private livesLost = 0;
  private debugOn = false;
  private readonly stats = { fps: 0, frameMs: 16.7, tickMs: 0 };

  constructor(
    private readonly renderer: Renderer,
    private readonly fixedSeed: number | null,
    private readonly rendererName: string,
  ) {
    this.save = loadSave();
    this.audio = new AudioEngine(this.save.settings.muted, this.save.settings.volumes);
    this.hud.setMuted(this.save.settings.muted);
    this.hud.setQuality(this.save.settings.quality);
    this.renderer.setQuality?.(this.save.settings.quality);
    this.input = new Input(this.save.settings.bindings, (a) => this.onAction(a));
    this.applyAccess();
    this.touch = new TouchControls($('gameContainer'), () => this.save.settings.touch, () => { if (this.screen === 'playing') this.pause(); });
    // the first touch anywhere switches on touch controls (and unlocks audio)
    window.addEventListener('touchstart', () => {
      if (!this.touchActive) { this.touchActive = true; document.body.classList.add('touch'); }
      this.audio.init();
    }, { passive: true });
    window.addEventListener('pointerdown', () => this.audio.init());
    this.sim = this.newAttractSim();
    this.stepper = new FixedStepper({
      tick: () => this.tick(),
      render: (alpha, frameMs) => this.render(alpha, frameMs),
    });
    this.panelMenu.onBack = () => this.backFromPanel();

    const autoPause = () => {
      if (this.screen === 'playing') this.pause();
      this.stepper.resetClock();
    };
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => document.hidden && autoPause());
  }

  start(): void {
    this.showMenu();
    startLoop(this.stepper);
  }

  /** The attract run behind the menus flies a random sector, so the menus show off each light. */
  private newAttractSim(): Sim {
    const sim = new Sim(randomSeed(), { mode: 'endless', startSector: Math.floor(Math.random() * SECTORS.length) });
    sim.missiles = 99;
    return sim;
  }

  // ------------------------------------------------------------------ input

  private onAction(a: Action): void {
    // global toggles
    if (a === 'mute') {
      this.save.settings.muted = !this.save.settings.muted;
      this.audio.setMuted(this.save.settings.muted);
      this.hud.setMuted(this.save.settings.muted);
      writeSave(this.save);
      return;
    }
    if (a === 'quality') {
      const order = ['high', 'balanced', 'performance'] as const;
      this.save.settings.quality = order[(order.indexOf(this.save.settings.quality) + 1) % order.length];
      this.renderer.setQuality?.(this.save.settings.quality);
      this.hud.setQuality(this.save.settings.quality);
      writeSave(this.save);
      return;
    }
    if (a === 'debug') {
      this.debugOn = !this.debugOn;
      $('debug').style.display = this.debugOn ? 'block' : 'none';
      return;
    }
    this.audio.init();
    switch (this.screen) {
      case 'menu':
        if (this.menu.nav(a)) this.menuSound(a);
        break;
      case 'practice':
      case 'hangar':
      case 'medals':
      case 'options':
      case 'access':
      case 'controls':
      case 'paused':
      case 'debrief':
        if (this.panelMenu.nav(a)) this.menuSound(a);
        break;
      case 'playing':
        if (isPress(a) && (a === 'start' || a === 'pause')) this.pause();
        break;
    }
  }

  private isMenu(): boolean {
    return this.screen === 'menu' || this.screen === 'practice' || this.screen === 'hangar' || this.screen === 'medals' || this.screen === 'options' || this.screen === 'access' || this.screen === 'controls';
  }

  private menuSound(a: Action): void {
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') this.audio.ui('move');
    else if (a === 'pause' || a === 'emp') this.audio.ui('back');
    else this.audio.ui('select');
  }

  private backFromPanel(): void {
    if (this.screen === 'access' || this.screen === 'controls') return this.showOptions();
    if (this.screen === 'paused') this.resume();
    else if (this.screen === 'debrief') this.showMenu();
    else this.showMenu();
  }

  // ------------------------------------------------------------------ screens

  private setPanel(show: boolean, title = '', body: (string | HTMLElement)[] = []): void {
    $('panel').style.display = show ? 'flex' : 'none';
    $('panelTitle').textContent = title;
    $('panelBody').replaceChildren(...body.map((b) => {
      if (typeof b !== 'string') return b;
      const d = document.createElement('div');
      d.textContent = b;
      return d;
    }));
  }

  private showMenu(): void {
    this.screen = 'menu';
    this.setPanel(false);
    this.hud.hideMessage();
    this.hud.setPlaying(false);
    $('title').style.display = 'flex';
    const s = this.save;
    const today = todayKey();
    const dailyDone = s.daily.date === today && s.daily.played;
    const fmt = (n: number) => String(n).padStart(6, '0');
    this.menu.set([
      { label: 'CAMPAIGN', detail: s.campaignCleared ? `cleared · best ${fmt(s.best.campaign)}` : '6 sectors, dusk to dawn', onSelect: () => this.startRun('campaign') },
      { label: 'ENDLESS', detail: `best ${fmt(s.best.endless)}`, onSelect: () => this.startRun('endless') },
      { label: 'DAILY OP', detail: dailyDone ? `flown today · ${fmt(s.daily.score)}` : `${today} · one attempt`, disabled: dailyDone, onSelect: () => this.startRun('daily') },
      { label: 'PRACTICE', detail: `${s.reached.length}/6 sectors`, onSelect: () => this.showPractice() },
      { label: 'HANGAR', detail: `${s.salvage} salvage`, onSelect: () => this.showHangar() },
      { label: 'MEDALS', detail: `${MEDALS.filter((m) => s.medals.includes(m.id)).length}/${MEDALS.length} earned`, onSelect: () => this.showMedals() },
      { label: 'OPTIONS', detail: 'audio · quality', onSelect: () => this.showOptions() },
    ], true);
    const hi = $('title').querySelector('[data-hiscore]');
    if (hi) hi.textContent = fmt(s.hiscore);
  }

  private showPractice(): void {
    this.screen = 'practice';
    $('title').style.display = 'none';
    this.setPanel(true, 'PRACTICE', ['Fly one sector and its boss. Reach sectors in Campaign or Endless to unlock them.']);
    this.panelMenu.set([
      ...SECTORS.map((sec, i): MenuItem => {
        const open = this.save.reached.includes(i);
        return { tag: String(i + 1), label: open ? sec.name : '— LOCKED —', detail: open ? sec.subtitle : '', disabled: !open, onSelect: () => { this.practiceSector = i; this.startRun('practice'); } };
      }),
      { label: 'BACK', onSelect: () => this.showMenu() },
    ]);
  }

  /** The medal case: every medal, whether it's earned, and how to earn the rest. */
  private showMedals(): void {
    this.screen = 'medals';
    $('title').style.display = 'none';
    const earned = MEDALS.filter((m) => this.save.medals.includes(m.id)).length;
    this.setPanel(true, 'MEDALS', [`${earned} of ${MEDALS.length} earned · each pays salvage when you earn it in a run`]);
    this.panelMenu.set([
      ...MEDALS.map((m): MenuItem => {
        const has = this.save.medals.includes(m.id);
        return { tag: has ? '★ EARNED' : '☆', label: m.name, detail: m.blurb, tone: has ? 'gold' : 'dim', onSelect: () => undefined };
      }),
      { label: 'BACK', onSelect: () => this.showMenu() },
    ], false);
  }

  private showHangar(keep = false): void {
    this.screen = 'hangar';
    $('title').style.display = 'none';
    const s = this.save;
    const lo = s.loadout;
    this.setPanel(true, 'HANGAR', [`SALVAGE  ${s.salvage}`, `Perk slots: ${lo.perks.length}/${PERK_SLOTS}`]);
    const items: MenuItem[] = [];
    for (const af of Object.values(AIRFRAMES)) {
      const owned = s.unlocked.airframes.includes(af.id);
      const on = lo.airframe === af.id;
      items.push({
        tag: on ? 'FLYING' : owned ? 'OWNED' : `${af.cost}`,
        label: af.name,
        detail: af.blurb,
        disabled: !owned && s.salvage < af.cost,
        onSelect: () => this.hangarAirframe(af.id),
      });
    }
    for (const pk of Object.values(PERKS)) {
      const owned = s.unlocked.perks.includes(pk.id);
      const on = lo.perks.includes(pk.id);
      items.push({
        tag: on ? 'ON' : owned ? 'OFF' : `${pk.cost}`,
        label: pk.name,
        detail: pk.blurb,
        disabled: !owned && s.salvage < pk.cost,
        onSelect: () => this.hangarPerk(pk.id),
      });
    }
    items.push({ label: 'BACK', onSelect: () => this.showMenu() });
    this.panelMenu.set(items, keep);
  }

  private showOptions(keep = false): void {
    this.screen = 'options';
    $('title').style.display = 'none';
    this.setPanel(true, 'OPTIONS', ['←/→ to adjust']);
    const v = this.save.settings.volumes;
    const bar = (x: number) => '▮'.repeat(Math.round(x * 10)) + '▯'.repeat(10 - Math.round(x * 10)) + `  ${Math.round(x * 100)}%`;
    const vol = (key: keyof typeof v, label: string): MenuItem => {
      const step = (d: number) => {
        v[key] = Math.round(Math.max(0, Math.min(1, v[key] + d)) * 10) / 10;
        this.audio.setVolumes(v);
        writeSave(this.save);
        this.showOptions(true);
        if (key !== 'music' && key !== 'ambience') this.audio.ui('select');
      };
      return { label, detail: bar(v[key]), onLeft: () => step(-0.1), onRight: () => step(0.1), onSelect: () => step(v[key] >= 1 ? -1 : 0.1) };
    };
    this.panelMenu.set([
      vol('master', 'MASTER'),
      vol('music', 'MUSIC'),
      vol('sfx', 'EFFECTS'),
      vol('ambience', 'AMBIENCE'),
      { label: 'MUTE', detail: this.save.settings.muted ? 'ON' : 'OFF', onSelect: () => { this.onAction('mute'); this.showOptions(true); } },
      { label: 'QUALITY', detail: this.save.settings.quality.toUpperCase(), onSelect: () => { this.onAction('quality'); this.showOptions(true); } },
      { label: 'ACCESSIBILITY ▸', detail: 'motion · flashes · contrast · captions · assist', onSelect: () => this.showAccess() },
      { label: 'CONTROLS ▸', detail: 'rebind keys', onSelect: () => this.showControls() },
      { label: 'BACK', onSelect: () => this.showMenu() },
    ], keep);
  }

  /** Push accessibility settings to the renderer, FX and page. */
  private applyAccess(): void {
    const a = this.save.settings.access;
    this.renderer.setAccess?.({ shake: a.shake, flash: a.flash, reducedMotion: a.reducedMotion, contrast: a.contrast });
    this.fx.shakeScale = a.shake;
    this.fx.reducedMotion = a.reducedMotion;
    document.body.classList.toggle('reduced-motion', a.reducedMotion);
  }

  private showAccess(keep = false): void {
    this.screen = 'access';
    $('title').style.display = 'none';
    const a = this.save.settings.access;
    const t = this.save.settings.touch;
    this.setPanel(true, 'ACCESSIBILITY', ['←/→ to adjust · fire/space to toggle']);
    const bar = (x: number) => '▮'.repeat(Math.round(x * 10)) + '▯'.repeat(10 - Math.round(x * 10)) + `  ${Math.round(x * 100)}%`;
    const commit = () => { writeSave(this.save); this.applyAccess(); this.showAccess(true); };
    const slider = (key: 'shake' | 'flash', label: string, blurb: string): MenuItem => {
      const step = (d: number) => { a[key] = Math.round(Math.max(0, Math.min(1, a[key] + d)) * 10) / 10; commit(); };
      return { label, detail: `${bar(a[key])} · ${blurb}`, onLeft: () => step(-0.1), onRight: () => step(0.1), onSelect: () => step(a[key] >= 1 ? -1 : 0.1) };
    };
    const toggle = (get: () => boolean, set: (v: boolean) => void, label: string, blurb: string): MenuItem => ({
      label, detail: `${get() ? 'ON' : 'OFF'} · ${blurb}`, onSelect: () => { set(!get()); commit(); }, onLeft: () => { set(false); commit(); }, onRight: () => { set(true); commit(); },
    });
    this.panelMenu.set([
      slider('shake', 'SCREEN SHAKE', 'camera shake strength'),
      slider('flash', 'FLASHES', 'hit flashes and damage pulse'),
      toggle(() => a.reducedMotion, (v) => (a.reducedMotion = v), 'REDUCED MOTION', 'no shake, freeze-frames or flicker'),
      toggle(() => a.contrast, (v) => (a.contrast = v), 'HIGH-CONTRAST THREATS', 'shape-coded shots, dashed white aim lines'),
      toggle(() => a.captions, (v) => (a.captions = v), 'SOUND CAPTIONS', 'subtitles for warning sounds'),
      toggle(() => a.assist, (v) => (a.assist = v), 'ASSIST MODE', 'slower, no wall damage, +1 life (no best scores)'),
      toggle(() => t.autoFire, (v) => (t.autoFire = v), 'TOUCH AUTO-FIRE', 'gun fires while you steer'),
      toggle(() => t.haptics, (v) => (t.haptics = v), 'HAPTICS', 'vibrate on hits (touch devices)'),
      { label: 'BACK', onSelect: () => this.showOptions() },
    ], keep);
  }

  private showControls(keep = false, waitingFor: string | null = null): void {
    this.screen = 'controls';
    $('title').style.display = 'none';
    const b = this.save.settings.bindings;
    const pretty = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '').replace('Left', '←').replace('Right', '→').replace('Up', '↑').replace('Down', '↓').replace('Shift', 'SHIFT ').replace('Backquote', '`').replace('Semicolon', ';').replace('Comma', ',').replace('Period', '.').toUpperCase();
    const actions: [keyof Bindings, string][] = [
      ['left', 'LEFT'], ['right', 'RIGHT'], ['up', 'UP'], ['down', 'DOWN'], ['fire', 'FIRE'], ['missile', 'MISSILE'],
      ['flare', 'FLARE'], ['emp', 'EMP'], ['boost', 'BOOST'], ['pause', 'PAUSE'], ['mute', 'MUTE'], ['quality', 'QUALITY'],
    ];
    this.setPanel(true, 'CONTROLS', [waitingFor ? `Press a key for ${waitingFor} (Esc cancels)` : 'Select an action, then press the new key. Gamepads use the standard layout.']);
    this.panelMenu.set([
      ...actions.map(([act, label]): MenuItem => ({
        label,
        detail: b[act].map(pretty).join('  /  '),
        onSelect: () => {
          this.showControls(true, label);
          this.input.captureNext((code) => {
            if (code !== 'Escape') {
              // the new key becomes primary for this action and is removed from any other
              for (const k of Object.keys(b) as (keyof Bindings)[]) b[k] = b[k].filter((c) => c !== code);
              b[act] = [code, ...b[act]].slice(0, 3);
              this.input.setBindings(b);
              writeSave(this.save);
            }
            this.showControls(true);
          });
        },
      })),
      { label: 'RESET DEFAULTS', onSelect: () => { this.save.settings.bindings = structuredClone(DEFAULT_BINDINGS); this.input.setBindings(this.save.settings.bindings); writeSave(this.save); this.showControls(true); } },
      { label: 'BACK', onSelect: () => this.showOptions() },
    ], keep);
  }

  private hangarAirframe(id: AirframeId): void {
    const s = this.save;
    if (!s.unlocked.airframes.includes(id)) {
      if (s.salvage < AIRFRAMES[id].cost) return;
      s.salvage -= AIRFRAMES[id].cost;
      s.unlocked.airframes.push(id);
      this.audio.ui('buy');
    }
    s.loadout.airframe = id;
    writeSave(s);
    this.showHangar(true);
  }

  private hangarPerk(id: PerkId): void {
    const s = this.save;
    if (!s.unlocked.perks.includes(id)) {
      if (s.salvage < PERKS[id].cost) return;
      s.salvage -= PERKS[id].cost;
      s.unlocked.perks.push(id);
      this.audio.ui('buy');
    }
    const on = s.loadout.perks.includes(id);
    if (on) s.loadout.perks = s.loadout.perks.filter((p) => p !== id);
    else if (s.loadout.perks.length < PERK_SLOTS) s.loadout.perks.push(id);
    else { s.loadout.perks.shift(); s.loadout.perks.push(id); }
    writeSave(s);
    this.showHangar(true);
  }

  // ------------------------------------------------------------------ run lifecycle

  private startRun(mode: ModeId): void {
    const today = todayKey();
    if (mode === 'daily') {
      if (this.save.daily.date === today && this.save.daily.played) return;
      // the attempt counts the moment you launch: no restarting a bad daily
      this.save.daily = { date: today, played: true, score: 0 };
      writeSave(this.save);
    }
    this.mode = mode;
    const seed = mode === 'daily' ? dailySeed(today) : this.fixedSeed ?? randomSeed();
    this.sim = new Sim(seed, {
      mode: mode === 'daily' ? 'endless' : mode,
      startSector: mode === 'practice' ? this.practiceSector : 0,
      loadout: this.save.loadout,
      assist: this.save.settings.access.assist,
    });
    this.lastCause = 'scrape';
    this.livesLost = 0;
    this.recorder.reset();
    this.fx.reset();
    this.audio.ui('start');
    this.hud.hideMessage();
    this.setPanel(false);
    $('title').style.display = 'none';
    this.hud.setPlaying(true);
    this.screen = 'playing';
    for (const e of this.sim.events) this.onEvent(e); // the opening sector card
    this.sim.events.length = 0;
  }

  private pause(): void {
    this.screen = 'paused';
    this.input.clear();
    this.setPanel(true, 'PAUSED', [`${SECTORS[this.sim.course.sector].name} · ${Math.round(sectorProgress(this.sim) * 100)}%`]);
    this.panelMenu.set([
      { label: 'RESUME', onSelect: () => this.resume() },
      { label: 'ABANDON RUN', detail: 'go to debrief', onSelect: () => this.finishRun() },
    ]);
  }

  private resume(): void {
    this.screen = 'playing';
    this.setPanel(false);
  }

  /** Score the run, award medals and salvage, persist, and show the debrief. */
  private finishRun(): void {
    const sim = this.sim;
    const s = this.save;
    const complete = sim.status === 'complete';
    this.audio.runEnd(sim.status === 'over' ? 'over' : complete ? 'complete' : 'abandon');

    const earned = MEDALS.filter((m) => m.earned(sim.stats, { status: sim.status, mode: sim.course.mode, livesLost: this.livesLost }));
    const newMedals = earned.filter((m) => !s.medals.includes(m.id));
    const salvage = salvageFor({ score: sim.score, sectorsCleared: sim.stats.sectorsCleared, bossesDefeated: sim.stats.bossesDefeated, medals: earned.length });
    // assist runs earn salvage and medals but don't set best scores
    const assist = sim.options.assist;
    const newBest = !assist && sim.score > s.best[this.mode];
    if (!assist) {
      s.best[this.mode] = Math.max(s.best[this.mode], sim.score);
      s.hiscore = Math.max(s.hiscore, sim.score);
    }
    s.salvage += salvage;
    s.medals.push(...newMedals.map((m) => m.id));
    for (const r of sim.course.reached) if (!s.reached.includes(r)) s.reached.push(r);
    s.reached.sort((a, b) => a - b);
    if (this.mode === 'campaign' && complete) s.campaignCleared = true;
    if (this.mode === 'daily') s.daily.score = sim.score;
    s.runs++;
    writeSave(s);

    const st = sim.stats;
    const acc = st.shotsFired ? Math.round((st.shotsHit / st.shotsFired) * 100) : 0;
    const kills = Object.entries(st.kills).sort((a, b) => b[1] - a[1]);
    const totalKills = kills.reduce((a, [, n]) => a + n, 0);
    const mins = Math.floor(sim.tick / 3600), secs = Math.floor((sim.tick / 60) % 60);
    const line = (k: string, v: string, cls = '') => {
      const d = document.createElement('div');
      d.className = 'deb-row ' + cls;
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('span'); b.textContent = v;
      d.append(a, b);
      return d;
    };
    const body: (string | HTMLElement)[] = [
      sim.status === 'over'
        ? line('DOWNED BY', causeLabel(this.lastCause), 'warn')
        : line('RESULT', complete ? (this.mode === 'campaign' ? 'CAMPAIGN COMPLETE' : 'SECTOR CLEARED') : 'RUN ABANDONED', complete ? 'gold' : 'warn'),
      line('MODE', this.mode.toUpperCase() + (sim.course.lap ? ` · LAP ${sim.course.lap + 1}` : '') + (assist ? ' · ASSIST' : '')),
      line('REACHED', `${sim.course.sector + 1} · ${SECTORS[sim.course.sector].name}`),
      line('SCORE', `${String(sim.score).padStart(6, '0')}${newBest ? '  NEW BEST' : ''}`, newBest ? 'gold' : ''),
      line('TIME', `${mins}:${String(secs).padStart(2, '0')}`),
      line('BOSSES', `${st.bossesDefeated} destroyed · ${st.sectorsCleared} sectors cleared`),
      line('KILLS', `${totalKills}${kills.length ? ' · ' + kills.slice(0, 3).map(([k, n]) => `${n} ${KIND_NAMES[k as HostileKind] ?? k}`).join(', ') : ''}`),
      line('ACCURACY', `${acc}% · ${st.missilesFired} missiles`),
      line('STYLE', `${(st.grazeTicks / 60).toFixed(0)}s grazing · ${st.nearMisses} near misses · ${st.bridges} bridges`),
      line('MEDALS', earned.length ? earned.map((m) => (newMedals.includes(m) ? `★ ${m.name}` : m.name)).join(', ') : '—', newMedals.length ? 'gold' : ''),
      line('SALVAGE', `+${salvage}  (total ${s.salvage})`, 'gold'),
    ];
    this.screen = 'debrief';
    this.hud.setPlaying(false);
    this.setPanel(true, complete ? 'MISSION DEBRIEF' : sim.status === 'over' ? 'SYSTEM FAILURE' : 'RUN ENDED', body);
    this.panelMenu.set([
      { label: 'CONTINUE', onSelect: () => this.showMenu() },
      { label: 'FLY AGAIN', disabled: this.mode === 'daily', onSelect: () => this.startRun(this.mode) },
      { label: 'HANGAR', onSelect: () => this.showHangar() },
    ]);
  }

  /**
   * The current (or last) run as a replay (dev console: copy(__dusk.exportReplay('name'))).
   * Save it into tests/replays/ to turn a bug report into a regression test.
   */
  exportReplay(name = 'recorded'): Replay {
    const s = this.sim;
    return { name, seed: s.seed, options: s.options, inputs: this.recorder.inputs, expect: { tick: s.tick, score: s.score, fingerprint: s.fingerprint(), status: s.status } };
  }

  /** Show a first-encounter hint once per save. */
  private hint(id: string): void {
    if (this.save.seen.includes(id) || !HINTS[id]) return;
    this.save.seen.push(id);
    writeSave(this.save);
    this.hud.showHint(HINTS[id]);
  }

  // ------------------------------------------------------------------ loop

  private tick(): void {
    const input = this.input.sample();

    if (this.isMenu()) {
      // attract mode: the autopilot flies a throwaway run behind the menus
      this.audio.update(this.sim, 'menu');
      this.sim.step(autopilot(this.sim, this.attractInput));
      this.sim.fuel = Math.max(this.sim.fuel, 60);
      this.sim.shields = Math.max(this.sim.shields, 60);
      for (const e of this.sim.events) this.fx.handle(e, this.sim);
      this.sim.events.length = 0;
      if (this.sim.status !== 'running') this.sim = this.newAttractSim();
      this.fx.tick(this.sim, true);
      return;
    }

    const playing = this.screen === 'playing';
    if (playing) {
      if (this.fx.hitStop > 0) {
        this.fx.hitStop--; // freeze-frame: hold the sim, keep FX alive
      } else {
        if (this.touchActive) this.touch.apply(input, this.sim, this.renderer.worldScale?.() ?? 1);
        this.recorder.push(input);
        const t0 = performance.now();
        this.sim.step(input);
        this.stats.tickMs = performance.now() - t0;
        this.hitThisTick = null;
        for (const e of this.sim.events) this.onEvent(e);
        this.sim.events.length = 0;
        for (const h of this.sim.hostiles) if (h.y > -10 && h.group === 0 && !this.save.seen.includes(h.kind)) this.hint(h.kind);
        if (this.sim.emp >= 100) this.hint('emp');
        if (this.sim.grazeTicks === 30) this.hint('graze');
        if (this.sim.status !== 'running') this.finishRun();
      }
    }
    this.audio.update(this.sim, this.screen === 'playing' ? 'run' : this.screen === 'paused' ? 'paused' : 'menu');
    if (this.screen !== 'paused') this.fx.tick(this.sim, playing);
    if (this.screen === 'playing' || this.screen === 'paused') this.hud.update(this.sim, Math.max(this.save.hiscore, this.sim.score), this.screen === 'playing');
  }

  private onEvent(e: SimEvent): void {
    this.fx.handle(e, this.sim);
    if (e.type === 'playerHit') this.hitThisTick = e.cause;
    // a life lost without a hit this tick was the canyon wall or an empty tank
    if (e.type === 'lifeLost') {
      this.lastCause = this.hitThisTick ?? (this.sim.fuel <= 0 ? 'fuel' : 'scrape');
      this.livesLost++;
    }
    if (e.type === 'overheat') this.hint('overheat');
    this.audio.handle(e, this.sim);
    if (this.save.settings.access.captions) {
      const c = captionFor(e, this.sim);
      if (c) this.hud.caption(c.key, c.text);
    }
    if (this.save.settings.touch.haptics && this.touchActive && navigator.vibrate) {
      if (e.type === 'playerHit') navigator.vibrate(30);
      else if (e.type === 'lifeLost') navigator.vibrate(140);
      else if (e.type === 'bossEnter') navigator.vibrate([60, 40, 60]);
    }
    switch (e.type) {
      case 'bossEnter': this.hud.bossBanner(true, e.name); break;
      case 'bossDown': this.hud.sectorCard(e.escaped ? 'TARGET ESCAPED' : 'TARGET DESTROYED', e.name ?? ''); break;
      case 'sectorStart':
        this.hud.sectorCard(`SECTOR ${e.index + 1} · ${e.name}`, e.subtitle);
        // unlock it for Practice right away, so closing the tab mid-run doesn't lose it
        if (!this.save.reached.includes(e.index)) {
          this.save.reached.push(e.index);
          this.save.reached.sort((a, b) => a - b);
          writeSave(this.save);
        }
        break;
      case 'shieldDown': this.hud.sectorCard('SHIELDS DOWN', 'hit the core'); break;
    }
  }

  private render(alpha: number, frameMs: number): void {
    this.idle++;
    this.touch.setVisible(this.touchActive && this.screen === 'playing');
    if (frameMs > 0) {
      this.stats.frameMs = this.stats.frameMs * 0.92 + frameMs * 0.08;
      this.stats.fps = 1000 / this.stats.frameMs;
    }
    const menuish = this.isMenu();
    const screen: ScreenState = menuish ? 'title' : this.screen === 'debrief' ? 'over' : (this.screen as 'playing' | 'paused');
    const live = this.screen === 'playing' || menuish;
    const t0 = performance.now();
    this.renderer.render({
      sim: this.sim,
      fx: this.fx,
      alpha: live && this.fx.hitStop === 0 ? alpha : 1,
      screen,
      idle: this.idle,
      debug: this.debugOn,
    });
    if (this.debugOn && this.idle % 6 === 0) {
      const s = this.sim;
      $('debug').textContent = [
        `${this.rendererName} · ${(this.renderer as { resolutionInfo?: string }).resolutionInfo ?? this.save.settings.quality} · FPS ${this.stats.fps.toFixed(0)} · frame ${this.stats.frameMs.toFixed(1)}ms`,
        `render ${(performance.now() - t0).toFixed(2)}ms · sim ${this.stats.tickMs.toFixed(2)}ms`,
        `sector ${s.course.sector + 1} ${s.course.phase} ${(sectorProgress(s) * 100).toFixed(0)}% · lap ${s.course.lap} · speed ${s.scrollSpeed.toFixed(1)}`,
        `hostiles ${s.hostiles.length} · bullets ${s.bullets.length} · shots ${s.enemyShots.length} · pickups ${s.pickups.length}`,
        `particles ${this.fx.particles.length} · trauma ${this.fx.camera.trauma.toFixed(2)} · music intensity ${this.audio.debugIntensity.toFixed(2)}`,
        `seed ${s.seed}`,
      ].join('\n');
    }
  }
}
