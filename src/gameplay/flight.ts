/**
 * Shared geometry constants with no imports, so any module can use them
 * without creating import cycles (sim ↔ course ↔ bosses).
 */
import { VIEW_H } from '../world/canyon';

export const PLAYER_Y = VIEW_H * 0.7;
/** Vertical flight band the player can move within. */
export const PLAYER_Y_MIN = 250;
export const PLAYER_Y_MAX = 530;

/** Pseudo-sector index for boss arenas: a wide, gentle stretch of canyon to fight in. */
export const ARENA = 99;
/** Arena canyon begins this far past the top of the screen. */
export const ARENA_LEAD = 120;
/** Arenas blend in faster than sector changes, so the approach stays short. */
export const ARENA_BLEND = 500;
