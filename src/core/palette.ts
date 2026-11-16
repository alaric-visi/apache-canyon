export const PAL = {
  skyTop: '#1e1330',
  skyMid: '#7a2f3d',
  skyHorizon: '#e8763a',
  sunCore: '#ffe9b8',
  sunGlow: '#ffb454',
  sandShadow: '#3a1c10',
  sandDark: '#6b2f1a',
  sandMid: '#9c4a26',
  sandLight: '#d98a4f',
  rim: '#ffcf8a',
  amber: '#f0a44c',
  amberBright: '#ffc36b',
  rust: '#d9502f',
  dust: '#c9a67a',
  hot: '#fff5e0',
} as const;

export type RGB = readonly [number, number, number];
export const RGB_FIRE: RGB = [255, 140, 40];
export const RGB_DAMAGE: RGB = [217, 80, 47];
export const RGB_PICKUP: RGB = [255, 195, 107];
export const RGB_SPARK: RGB = [255, 210, 130];
export const RGB_DUST: RGB = [201, 166, 122];
