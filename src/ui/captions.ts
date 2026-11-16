import type { Sim } from '../engine/sim';
import type { SimEvent } from '../entities/types';

/**
 * Sound captions: subtitle-style text for audio cues that carry gameplay
 * information, with a direction arrow relative to the gunship. Each caption
 * key is throttled so a burst of fire doesn't flood the list.
 */

const NAMES: Record<string, string> = {
  drone: 'Scout drone', gunner: 'Gunner', turret: 'Turret', traincar: 'Train turret', tank: 'Tank', engine: 'Locomotive',
  mine: 'Mine', gunship: 'Gunship', dish: 'Radar', sam: 'SAM site',
};

/** ← ↖ ↑ ↗ → relative to the gunship. */
export function direction(sim: Sim, x: number, y: number): string {
  const p = sim.player;
  const dx = x - (p.x + p.w / 2), dy = y - (p.y + p.h / 2);
  if (Math.abs(dx) < 40) return dy < 0 ? '↑' : '↓';
  if (dy < -60) return dx < 0 ? '↖' : '↗';
  return dx < 0 ? '←' : '→';
}

/** Caption text and a throttle key for an event, or null if it isn't worth a caption. */
export function captionFor(e: SimEvent, sim: Sim): { key: string; text: string } | null {
  switch (e.type) {
    case 'telegraph': {
      const n = NAMES[e.kind];
      if (!n) return null;
      const verb = e.kind === 'mine' ? 'arming' : e.kind === 'dish' ? 'calling drones' : 'charging';
      return { key: `tel-${e.kind}`, text: `[${n} ${verb} ${direction(sim, e.x, e.y)}]` };
    }
    case 'enemyShot': return e.kind === 'shell' ? { key: 'shell', text: `[Shell fired ${direction(sim, e.x, e.y)}]` } : null;
    case 'lockStart': return { key: 'lock', text: '[Missile lock tone]' };
    case 'samLaunch': return { key: 'sam', text: `[Missile launch ${direction(sim, e.x, e.y)}: use flares]` };
    case 'flakMark': return { key: 'flak', text: `[Flak shell incoming ${direction(sim, e.x, e.y)}]` };
    case 'overheat': return { key: 'heat', text: '[Gun overheating]' };
    case 'alarm': return { key: 'alarm', text: sim.fuel < 25 ? '[Low fuel alarm]' : '[Low shields alarm]' };
    case 'bossEnter': return { key: 'boss', text: `[Alarm: ${e.name ?? 'boss'} inbound]` };
    case 'shieldDown': return { key: 'shield', text: '[Shield generator collapses]' };
    case 'comboBreak': return { key: 'chain', text: '[Chain lost]' };
    case 'emp': return { key: 'emp', text: '[EMP discharge]' };
    default: return null;
  }
}
