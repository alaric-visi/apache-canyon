import type { RunStats, SimStatus } from '../engine/sim';
import type { RunMode } from '../systems/course';

/** Medals: awarded from a finished run's stats; each pays salvage once per run. */
export interface Medal {
  id: string;
  name: string;
  blurb: string;
  earned: (s: RunStats, r: { status: SimStatus; mode: RunMode; livesLost: number }) => boolean;
}

export const MEDALS: Medal[] = [
  { id: 'sharpshooter', name: 'SHARPSHOOTER', blurb: '55% accuracy over 200+ rounds', earned: (s) => s.shotsFired >= 200 && s.shotsHit / s.shotsFired >= 0.55 },
  { id: 'wallHugger', name: 'WALL HUGGER', blurb: '30 s of grazing in one run', earned: (s) => s.grazeTicks >= 1800 },
  { id: 'closeCall', name: 'CLOSE CALLS', blurb: '25 near misses', earned: (s) => s.nearMisses >= 25 },
  { id: 'untouchable', name: 'UNTOUCHABLE', blurb: 'Clear a sector without a scratch', earned: (s) => s.untouchedSectors >= 1 },
  { id: 'bridgeRunner', name: 'BRIDGE RUNNER', blurb: 'Fly under 5 bridges', earned: (s) => s.bridges >= 5 },
  { id: 'bossHunter', name: 'BOSS HUNTER', blurb: 'Destroy 3 bosses in one run', earned: (s) => s.bossesDefeated >= 3 },
  { id: 'dawnPatrol', name: 'DAWN PATROL', blurb: 'Complete the campaign', earned: (_s, r) => r.mode === 'campaign' && r.status === 'complete' },
  { id: 'ironWill', name: 'IRON WILL', blurb: 'Complete the campaign without losing a life', earned: (_s, r) => r.mode === 'campaign' && r.status === 'complete' && r.livesLost === 0 },
];
