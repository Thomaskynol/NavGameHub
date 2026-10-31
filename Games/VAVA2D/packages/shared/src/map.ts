import type { Obstacle, Vec2 } from './types.js';

const obstacleData = [
  { kind: 'rock', x: 620, y: 360, radius: 54 },
  { kind: 'tree', x: 980, y: 520, radius: 38 },
  { kind: 'rock', x: 1500, y: 300, radius: 46 },
  { kind: 'tree', x: 1900, y: 460, radius: 40 },
  { kind: 'rock', x: 2050, y: 900, radius: 56 },
  { kind: 'tree', x: 1750, y: 1080, radius: 38 },
  { kind: 'rock', x: 1400, y: 760, radius: 64 },
  { kind: 'tree', x: 760, y: 950, radius: 36 },
  { kind: 'rock', x: 500, y: 1250, radius: 48 },
  { kind: 'tree', x: 1050, y: 1280, radius: 40 },
  { kind: 'rock', x: 2250, y: 1300, radius: 40 },
  { kind: 'tree', x: 300, y: 620, radius: 34 },
] as const;

export const OBSTACLES: readonly Obstacle[] = obstacleData.map((obstacle, id) => ({
  ...obstacle,
  id,
}));

export const SPAWN_POINTS: readonly Vec2[] = [
  { x: 150, y: 150 },
  { x: 2250, y: 150 },
  { x: 150, y: 1450 },
  { x: 2250, y: 1450 },
  { x: 1200, y: 170 },
  { x: 1200, y: 1430 },
  { x: 150, y: 800 },
  { x: 2250, y: 800 },
  { x: 700, y: 800 },
  { x: 1700, y: 800 },
];
