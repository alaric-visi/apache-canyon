/**
 * Meta-progression. Salvage earned per run buys airframes (trade-offs, not
 * upgrades) and loadout perks (small conveniences). Nothing here makes the
 * early sectors trivial: the strongest perk is worth roughly one pickup.
 */

export type AirframeId = 'apache' | 'kestrel' | 'warthog';
export type PerkId = 'flarePack' | 'missileRack' | 'coolant' | 'reserveTank' | 'magnet';

export interface Airframe {
  id: AirframeId;
  name: string;
  blurb: string;
  cost: number;
  /** Lateral speed multiplier. */
  agility: number;
  maxShields: number;
  missiles: number;
  /** Chain-gun heat per shot multiplier. */
  heat: number;
}

export const AIRFRAMES: Record<AirframeId, Airframe> = {
  apache: { id: 'apache', name: 'AH-D "DUSK"', blurb: 'Balanced attack gunship.', cost: 0, agility: 1, maxShields: 100, missiles: 10, heat: 1 },
  kestrel: { id: 'kestrel', name: 'LH-7 "KESTREL"', blurb: 'Light scout: quicker and cooler-running, but thin armour.', cost: 400, agility: 1.2, maxShields: 75, missiles: 8, heat: 0.8 },
  warthog: { id: 'warthog', name: 'HG-2 "WARTHOG"', blurb: 'Heavy gunship: armoured, extra missiles, sluggish.', cost: 400, agility: 0.85, maxShields: 135, missiles: 14, heat: 1.15 },
};

export interface Perk {
  id: PerkId;
  name: string;
  blurb: string;
  cost: number;
}

export const PERKS: Record<PerkId, Perk> = {
  flarePack: { id: 'flarePack', name: 'FLARE PACK', blurb: '+2 flares at launch.', cost: 150 },
  missileRack: { id: 'missileRack', name: 'MISSILE RACK', blurb: '+5 missiles at launch.', cost: 150 },
  coolant: { id: 'coolant', name: 'COOLANT LOOP', blurb: 'Active-cooling window 10 heat wider.', cost: 200 },
  reserveTank: { id: 'reserveTank', name: 'RESERVE TANK', blurb: 'Burns 12% less fuel.', cost: 250 },
  magnet: { id: 'magnet', name: 'TOW HOOK', blurb: 'Pickups drift toward you from further away.', cost: 250 },
};

export const PERK_SLOTS = 2;

export interface Loadout {
  airframe: AirframeId;
  perks: PerkId[];
}

export const DEFAULT_LOADOUT: Loadout = { airframe: 'apache', perks: [] };

/** Salvage for a finished run. Rewards progress more than raw score. */
export function salvageFor(r: { score: number; sectorsCleared: number; bossesDefeated: number; medals: number }): number {
  return Math.floor(r.score / 400) + r.sectorsCleared * 25 + r.bossesDefeated * 60 + r.medals * 30;
}
