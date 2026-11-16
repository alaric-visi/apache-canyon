import { DEFAULT_BINDINGS, type Bindings } from '../input/input';
import type { Quality } from '../render/renderer';
import { DEFAULT_VOLUMES, type Volumes } from '../audio/mixer';
import { DEFAULT_LOADOUT, AIRFRAMES, PERKS, PERK_SLOTS, type AirframeId, type Loadout, type PerkId } from '../content/hangar';

const KEY = 'apache-canyon:save';
/**
 * v2: settings.quality
 * v3: seen (first-encounter hints)
 * v4: salvage, unlocks, loadout, medals, per-mode bests, sectors reached, daily op
 * v5: settings.volumes (master / music / sfx / ambience)
 * v6: settings.access (accessibility), settings.touch, 'balanced' quality
 */
export const SAVE_VERSION = 6;

export interface AccessSettings {
  shake: number;
  flash: number;
  reducedMotion: boolean;
  contrast: boolean;
  captions: boolean;
  assist: boolean;
}

export interface TouchSettings {
  autoFire: boolean;
  haptics: boolean;
}

/** Respect the OS "reduce motion" preference on a fresh save. */
const prefersReducedMotion = (): boolean => {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const defaultAccess = (): AccessSettings => ({ shake: 1, flash: 1, reducedMotion: prefersReducedMotion(), contrast: false, captions: false, assist: false });

export type ModeId = 'campaign' | 'endless' | 'daily' | 'practice';

export interface SaveData {
  version: number;
  /** Best score in any mode (shown on the title). */
  hiscore: number;
  best: Record<ModeId, number>;
  /** Hint ids already shown (first-encounter tutorial). */
  seen: string[];
  salvage: number;
  unlocked: { airframes: AirframeId[]; perks: PerkId[] };
  loadout: Loadout;
  medals: string[];
  /** Sector indices the player has reached (practice can start at any of them). */
  reached: number[];
  campaignCleared: boolean;
  daily: { date: string; played: boolean; score: number };
  runs: number;
  settings: {
    muted: boolean;
    quality: Quality;
    volumes: Volumes;
    access: AccessSettings;
    touch: TouchSettings;
    bindings: Bindings;
  };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION, hiscore: 0, best: { campaign: 0, endless: 0, daily: 0, practice: 0 }, seen: [],
    salvage: 0, unlocked: { airframes: ['apache'], perks: [] }, loadout: structuredClone(DEFAULT_LOADOUT),
    medals: [], reached: [0], campaignCleared: false, daily: { date: '', played: false, score: 0 }, runs: 0,
    settings: { muted: false, quality: 'high', volumes: { ...DEFAULT_VOLUMES }, access: defaultAccess(), touch: { autoFire: true, haptics: true }, bindings: structuredClone(DEFAULT_BINDINGS) },
  };
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/**
 * Bring any older (or partial / corrupted) save up to the current schema.
 * Every field is validated individually; never drop the player's progress.
 */
export function migrate(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData>;
  const hiscore = Math.max(0, Math.floor(num(r.hiscore)));
  const airframes = strings(r.unlocked?.airframes).filter((a): a is AirframeId => a in AIRFRAMES);
  const perks = strings(r.unlocked?.perks).filter((p): p is PerkId => p in PERKS);
  const unlocked = { airframes: Array.from(new Set<AirframeId>(['apache', ...airframes])), perks: Array.from(new Set(perks)) };
  const lo = r.loadout;
  const loadout: Loadout = {
    airframe: lo && unlocked.airframes.includes(lo.airframe) ? lo.airframe : 'apache',
    perks: strings(lo?.perks).filter((p): p is PerkId => unlocked.perks.includes(p as PerkId)).slice(0, PERK_SLOTS),
  };
  const best = { ...base.best };
  for (const k of Object.keys(best) as ModeId[]) best[k] = Math.max(0, Math.floor(num(r.best?.[k])));
  // pre-v4 saves only had one high score, and it came from an endless run
  if (num(r.version) < 4) best.endless = Math.max(best.endless, hiscore);
  const reachedRaw = Array.isArray(r.reached) ? r.reached.filter((n) => Number.isInteger(n) && n >= 0 && n < 6) : [];
  const reached = Array.from(new Set([0, ...reachedRaw])).sort((a, b) => a - b);
  return {
    version: SAVE_VERSION,
    hiscore,
    best,
    seen: strings(r.seen),
    salvage: Math.max(0, Math.floor(num(r.salvage))),
    unlocked,
    loadout,
    medals: strings(r.medals),
    reached,
    campaignCleared: r.campaignCleared === true,
    daily: { date: typeof r.daily?.date === 'string' ? r.daily.date : '', played: r.daily?.played === true, score: Math.max(0, num(r.daily?.score)) },
    runs: Math.max(0, Math.floor(num(r.runs))),
    settings: {
      muted: typeof r.settings?.muted === 'boolean' ? r.settings.muted : base.settings.muted,
      quality: r.settings?.quality === 'performance' || r.settings?.quality === 'balanced' ? r.settings.quality : 'high',
      volumes: Object.fromEntries((Object.keys(DEFAULT_VOLUMES) as (keyof Volumes)[]).map((k) => {
        const v = r.settings?.volumes?.[k];
        return [k, typeof v === 'number' && v >= 0 && v <= 1 ? v : DEFAULT_VOLUMES[k]];
      })) as unknown as Volumes,
      access: (() => {
        const a = r.settings?.access, d = base.settings.access;
        const unit = (v: unknown, dv: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : dv);
        const bool = (v: unknown, dv: boolean) => (typeof v === 'boolean' ? v : dv);
        return { shake: unit(a?.shake, d.shake), flash: unit(a?.flash, d.flash), reducedMotion: bool(a?.reducedMotion, d.reducedMotion), contrast: bool(a?.contrast, d.contrast), captions: bool(a?.captions, d.captions), assist: bool(a?.assist, d.assist) };
      })(),
      touch: { autoFire: r.settings?.touch?.autoFire !== false, haptics: r.settings?.touch?.haptics !== false },
      bindings: { ...base.settings.bindings, ...(r.settings?.bindings ?? {}) },
    },
  };
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSave(store: Storage | null = storage()): SaveData {
  try {
    const text = store?.getItem(KEY);
    return migrate(text ? JSON.parse(text) : null);
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, store: Storage | null = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota: play on without persistence */
  }
}

/** Today's Daily Op key (local date). */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Everyone gets the same canyon on the same day. */
export function dailySeed(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) h = Math.imul(h ^ date.charCodeAt(i), 16777619);
  return h >>> 0;
}
