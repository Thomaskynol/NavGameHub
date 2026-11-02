import type { CardType, PowerupType, WeaponType } from './types.js';
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_EVERY_TICKS = TICK_RATE / SNAPSHOT_RATE;
export const INTERP_DELAY_MS = 100;
export const INPUT_QUEUE_LIMIT = 8;
export const MAX_MESSAGES_PER_SECOND = 240;
export const WS_MAX_PAYLOAD = 16 * 1024;

export const ARENA = {
  width: 2400,
  height: 1600,
  inset: 48,
} as const;

export const PLAYER = {
  radius: 15,
  speed: 225,
  accel: 2800,
  decel: 3200,
  maxHealth: 100,
  respawnSeconds: 3,
  spawnProtectionSeconds: 1.5,
  dashSpeed: 900,
  dashDuration: 0.14,
  dashCooldown: 1.6,
} as const;

const PISTOL_BULLET_SPEED = 720;
const PISTOL_BULLET_RANGE = 1500;

export const PISTOL = {
  damage: 25,
  bulletSpeed: PISTOL_BULLET_SPEED,
  fireInterval: 0.28,
  magSize: 10,
  reloadSeconds: 1.35,
  bulletRadius: 3.5,
  bulletRange: PISTOL_BULLET_RANGE,
  muzzleOffset: 28,
  bulletLifetime: PISTOL_BULLET_RANGE / PISTOL_BULLET_SPEED,
} as const;

const GRENADE_SPEED = 520;
const GRENADE_RANGE = 620;

export const GRENADE = {
  damage: 75,
  speed: GRENADE_SPEED,
  range: GRENADE_RANGE,
  projectileRadius: 6,
  explosionRadius: 185,
  cooldown: 15,
  muzzleOffset: 28,
  lifetime: GRENADE_RANGE / GRENADE_SPEED,
} as const;

export const WEAPONS = {
  pistol: {
    name: 'Pistola',
    speed: PLAYER.speed,
    damage: PISTOL.damage,
    fireInterval: PISTOL.fireInterval,
    magSize: PISTOL.magSize,
    reloadSeconds: PISTOL.reloadSeconds,
    bulletSpeed: PISTOL.bulletSpeed,
    bulletRange: PISTOL.bulletRange,
    bulletRadius: PISTOL.bulletRadius,
    muzzleOffset: PISTOL.muzzleOffset,
    pellets: 1,
    spread: 0,
    flameDamagePerSecond: 0,
    flameRange: 0,
    flameAmmoPerSecond: 0,
  },
  flamethrower: {
    name: 'Lança-chamas',
    speed: PLAYER.speed,
    damage: 0,
    fireInterval: 0.12,
    magSize: 60,
    reloadSeconds: 2,
    bulletSpeed: 0,
    bulletRange: 0,
    bulletRadius: 0,
    muzzleOffset: 28,
    pellets: 0,
    spread: 0,
    flameDamagePerSecond: 40,
    flameRange: 360,
    flameAmmoPerSecond: 15,
  },
  shotgun: {
    name: 'Espingarda',
    speed: PLAYER.speed,
    damage: 12,
    fireInterval: 1.1,
    magSize: 6,
    reloadSeconds: 1.8,
    bulletSpeed: 900,
    bulletRange: 900,
    bulletRadius: 3.5,
    muzzleOffset: 28,
    pellets: 6,
    spread: 0.22,
    flameDamagePerSecond: 0,
    flameRange: 0,
    flameAmmoPerSecond: 0,
  },
  minigun: {
    name: 'Minigun',
    speed: 150,
    damage: 12,
    fireInterval: 0.12,
    magSize: 50,
    reloadSeconds: 3,
    bulletSpeed: 720,
    bulletRange: 1500,
    bulletRadius: 3,
    muzzleOffset: 28,
    pellets: 1,
    spread: 0,
    flameDamagePerSecond: 0,
    flameRange: 0,
    flameAmmoPerSecond: 0,
  },
  unarmed: {
    name: 'Desarmado',
    speed: PLAYER.speed,
    damage: 0,
    fireInterval: 999,
    magSize: 0,
    reloadSeconds: 0,
    bulletSpeed: 0,
    bulletRange: 0,
    bulletRadius: 0,
    muzzleOffset: 0,
    pellets: 0,
    spread: 0,
    flameDamagePerSecond: 0,
    flameRange: 0,
    flameAmmoPerSecond: 0,
  },
} as const satisfies Record<WeaponType, unknown>;

export const MATCH = {
  durationSeconds: 300,
  intermissionSeconds: 8,
  maxPlayers: 8,
  roomEmptyTtlMs: 60_000,
} as const;

export const DROP = {
  count: 4,
  intervalSeconds: 20,
  warningSeconds: 5,
  lifetimeSeconds: 30,
  pickupRadius: 28,
} as const;

export const POWERUP = {
  respawnSeconds: 12,
  pickupRadius: 26,
  spawnPoints: [
    { x: 400, y: 400 },
    { x: 2000, y: 400 },
    { x: 400, y: 1200 },
    { x: 2000, y: 1200 },
    // Era (1200, 800): ficava dentro da casa; recuado para o campo ao sul.
    { x: 1200, y: 1120 },
    { x: 700, y: 800 },
    { x: 1700, y: 800 },
  ],
} as const;

// Ringue do Duelo Mortal: região off-map além de 2400x1600 (servidor dá clamp,
// cliente desenha o ringue só com duelo ativo). Spawns do duelo: (2675,800) e (2925,800).
export const DUEL_ARENA = {
  minX: 2600,
  maxX: 3000,
  minY: 625,
  maxY: 975,
} as const;

export const DUEL = {
  countdownSeconds: 5,
  durationSeconds: 20,
} as const;

export const CARD_INFO: Record<CardType, { title: string; description: string }> = {
  homing: { title: 'Balas Teleguiadas', description: 'Balas se curvam levemente em direção ao inimigo mais próximo.' },
  dashShot: { title: 'Disparo de Dash', description: 'Cada dash dispara uma espingarda na direção do dash (+1s cooldown do dash).' },
  weaponCycle: { title: 'Ciclo de Armas', description: 'A cada 10s ganha uma arma aleatória por 7s, depois 3s desarmado.' },
  deathGrenade: { title: 'Granada Póstuma', description: 'Ao matar alguém, uma granada (range +30%) surge onde a pessoa morreu.' },
  powerupDuration: { title: 'Power-ups Estendidos', description: 'Power-ups duram 70% mais tempo.' },
  ricochet: { title: 'Ricochete', description: 'Balas ricocheteiam em paredes/obstáculos 3 vezes.' },
  slowKnockback: { title: 'Balas Pesadas', description: 'Balas mais lentas, mas empurram inimigos ao acertar.' },
  wallBounce: { title: 'Quicada Letal', description: 'Bala bate 1 vez na parede e causa +50% de dano.' },
  chargedShot: { title: 'Tiro Carregado', description: 'Após 2s sem atirar, o próximo tiro causa +20% de dano e é 30% mais rápido.' },
  dashInvis: { title: 'Dash Fantasma', description: 'Fica invisível por 3s ao dar dash.' },
};

export const CARD_TYPES: CardType[] = [
  'homing', 'dashShot', 'weaponCycle', 'deathGrenade', 'powerupDuration', 'ricochet', 'slowKnockback', 'wallBounce', 'chargedShot', 'dashInvis',
];

export const MOVE = {
  up: 1,
  down: 2,
  left: 4,
  right: 8,
} as const;

export const NET = {
  path: '/ws',
  pingIntervalMs: 2000,
} as const;

export const NAME_MAX_LENGTH = 16;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PLAYER_COLORS = [
  '#f4a259',
  '#5aa9e6',
  '#74c69d',
  '#ef7ba8',
  '#f2d06b',
  '#a78bfa',
  '#e76f51',
  '#4dd0c8',
] as const;
