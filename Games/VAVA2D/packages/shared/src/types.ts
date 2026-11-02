export interface Vec2 {
  x: number;
  y: number;
}

export type Phase = 'waiting' | 'playing' | 'ended' | 'cardSelection';

export type WeaponType = 'pistol' | 'flamethrower' | 'shotgun' | 'minigun' | 'unarmed';

export type CardType = 'homing' | 'dashShot' | 'weaponCycle' | 'deathGrenade' | 'powerupDuration' | 'ricochet' | 'slowKnockback' | 'wallBounce' | 'chargedShot' | 'dashInvis';

export type PowerupType = 'speed' | 'heal' | 'shield' | 'damage' | 'cooldown' | 'grenade' | 'duel' | 'giant' | 'lifesteal';

export type ObstacleKind = 'rock' | 'tree';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  radius: number;
}

export interface PlayerInput {
  seq: number;
  move: number;
  aim: number;
  shoot: boolean;
  reload: boolean;
  dash: boolean;
  grenade: boolean;
}

export interface PlayerPhysics {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  dashTime: number;
  dashCooldown: number;
}

export interface NetPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  aim: number;
  weapon: WeaponType;
  shooting: boolean;
  scale: number;
  invincible: boolean;
  invisible: boolean;
  duel: boolean;
  health: number;
  alive: boolean;
  protected: boolean;
  kills: number;
  deaths: number;
  score: number;
}

export interface NetBullet {
  id: number;
  owner: string;
  x: number;
  y: number;
  angle: number;
}

export interface NetDrop {
  id: number;
  x: number;
  y: number;
}

export interface NetPowerup {
  id: number;
  x: number;
  y: number;
  type: PowerupType;
}

export interface NetGrenade {
  id: number;
  owner: string;
  x: number;
  y: number;
}

export interface SelfState {
  id: string;
  ack: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  dashTime: number;
  dashCooldown: number;
  health: number;
  alive: boolean;
  ammo: number;
  reloading: number;
  weapon: WeaponType;
  shooting: boolean;
  scale: number;
  invisible: boolean;
  cards: CardType[];
  grenadeCooldown: number;
  speedBoost: number;
  invincible: number;
  damageBoost: number;
  cooldownBoost: number;
  infiniteAmmo: number;
  grenadeBoost: number;
  giant: number;
  lifesteal: number;
  duel: number;
  respawnIn: number;
  protected: boolean;
  kills: number;
  deaths: number;
  score: number;
}

export interface Snapshot {
  tick: number;
  serverTime: number;
  phase: Phase;
  timeLeft: number;
  winnerId: string | null;
  players: NetPlayer[];
  bullets: NetBullet[];
  grenades: NetGrenade[];
  drops: NetDrop[];
  powerups: NetPowerup[];
  you: SelfState;
  cardProgress?: { chose: number; total: number; remaining: number };
}

export type GameEvent =
  | { type: 'shot'; playerId: string; x: number; y: number; aim: number }
  | { type: 'hit'; by: string; targetId: string; damage: number; x: number; y: number }
  | {
      type: 'kill';
      killerId: string;
      victimId: string;
      killerName: string;
      victimName: string;
      x: number;
      y: number;
    }
  | { type: 'explosion'; playerId: string; x: number; y: number; radius: number }
  | { type: 'dropWarning'; x: number; y: number }
  | { type: 'dropPickup'; playerId: string; weapon: WeaponType; x: number; y: number }
  | { type: 'dropExpired'; x: number; y: number }
  | { type: 'powerupPickup'; playerId: string; powerup: PowerupType; x: number; y: number }
  | { type: 'join'; name: string }
  | { type: 'leave'; name: string }
  | { type: 'matchStart' }
  | { type: 'matchEnd'; winnerName: string | null }
  | { type: 'duelStart'; a: string; b: string; aName: string; bName: string; seconds: number }
  | { type: 'duelEnd'; winnerId: string | null; winnerName: string | null; reason: 'kill' | 'timeout' | 'leave' };
