/**
 * Teaching text. First-encounter hints name each threat and its counter the
 * first time the player meets it (persisted, so they only show once), and
 * `causeLabel` turns a damage cause into the "DOWNED BY" line on game over.
 */
export const HINTS: Record<string, string> = {
  drone: 'SCOUT DRONE · a red eye flare means a shot is coming: sidestep',
  uav: 'UAV · it rams you. Shoot it before it commits to your line',
  mine: 'MINE · arms when you get close. Shoot it, or leave the red ring',
  gunner: 'GUNNER · red glint, then a 3-round burst. Strafe during the glint',
  gate: 'GATE · shoot the bracketed node, or slip through when the beam drops',
  turret: 'WALL TURRET · its laser blinks when it locks. Move off the line',
  flak: 'FLAK · get out of the red circle before the fuse ring closes',
  sam: 'SAM SITE · lock tone means FLARES [C], or shoot the missile down',
  tank: 'TANK · slow, heavy shells. Hold [X] to lock missiles on it',
  gunship: 'RIVAL GUNSHIP · nose glow before every volley; fan lines show the spread',
  overheat: 'GUN OVERHEAT · let go of [Z] while the heat bar is in the blue window to cool fast',
  emp: 'EMP READY · press [V] to wipe enemy fire off the screen',
  graze: 'GRAZE · flying close to the rock without touching it keeps your chain alive',
};

const WHO: Record<string, string> = {
  drone: 'SCOUT DRONE', uav: 'UAV', mine: 'MINE', gunner: 'GUNNER', turret: 'WALL TURRET',
  flak: 'FLAK', sam: 'SAM', tank: 'TANK', gunship: 'RIVAL GUNSHIP', gate: 'GATE BEAM',
};

/** 'shot:bullet:gunner' → 'GUNNER FIRE', 'contact:uav' → 'UAV RAM', 'flak' → 'FLAK AIRBURST'. */
export function causeLabel(cause: string): string {
  const p = cause.split(':');
  if (p[0] === 'shot') return `${WHO[p[2]] ?? p[2].toUpperCase()} ${p[1] === 'sam' ? 'MISSILE' : p[1] === 'rocket' ? 'ROCKETS' : p[1] === 'shell' ? 'SHELL' : 'FIRE'}`;
  if (p[0] === 'contact') return `${WHO[p[1]] ?? p[1].toUpperCase()} RAM`;
  if (cause === 'flak') return 'FLAK AIRBURST';
  if (cause === 'mine') return 'MINE BLAST';
  if (cause === 'gate') return 'GATE BEAM';
  if (cause === 'scrape') return 'CANYON WALL';
  if (cause === 'fuel') return 'EMPTY TANK';
  return cause.toUpperCase();
}
