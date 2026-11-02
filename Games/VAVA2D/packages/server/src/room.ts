import {
  ARENA,
  DUEL,
  DUEL_ARENA,
  INPUT_QUEUE_LIMIT,
  MATCH,
  OBSTACLES,
  PISTOL,
  GRENADE,
  WEAPONS,
  DROP,
  POWERUP,
  CARD_TYPES,
  PLAYER,
  PLAYER_COLORS,
  SNAPSHOT_EVERY_TICKS,
  SPAWN_POINTS,
  TICK_DT,
  createPlayerPhysics,
  distanceSq,
  segmentCircleHit,
  normalizeAngle,
  pointBlockedByObstacle,
  stepPlayerPhysics,
} from '@vava/shared';
import type {
  GameEvent,
  NetBullet,
  NetGrenade,
  NetDrop,
  NetPowerup,
  NetPlayer,
  Phase,
  PlayerInput,
  PlayerPhysics,
  WeaponType,
  PowerupType,
  CardType,
  SelfState,
  ServerMessage,
  Snapshot,
} from '@vava/shared';

export interface RoomClient {
  send(message: ServerMessage): void;
}

export interface ServerPlayer {
  id: string;
  name: string;
  colorIndex: number;
  color: string;
  client: RoomClient;
  physics: PlayerPhysics;
  alive: boolean;
  health: number;
  ammo: number;
  reloading: number;
  fireCooldown: number;
  grenadeCooldown: number;
  weapon: WeaponType;
  shooting: boolean;
  flameTick: number;
  scale: number;
  speedBoost: number;
  invincible: number;
  damageBoost: number;
  cooldownBoost: number;
  infiniteAmmo: number;
  grenadeBoost: number;
  giant: number;
  lifesteal: number;
  duel: number;
  duelPartner: string | null;
  duelOrigin: { x: number; y: number } | null;
  inDuel: boolean;
  invisible: number;
  cards: CardType[];
  pendingCardOptions: CardType[];
  chosenCard: CardType | null;
  timeSinceLastShot: number;
  card3Timer: number;
  card3ArmedTimer: number;
  card3UnarmedTimer: number;
  spawnProtect: number;
  respawnTimer: number;
  kills: number;
  deaths: number;
  inputQueue: PlayerInput[];
  lastReceivedSeq: number;
  ack: number;
}

interface Bullet {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  life: number;
  ricochets: number;
  wallBounce: boolean;
  slow: boolean;
  damage: number;
  damageMult: number;
  homing: boolean;
  decorated: boolean;
}

interface Grenade {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  explosionRadius?: number;
}

function idleInput(aim: number): PlayerInput {
  return {
    seq: 0,
    move: 0,
    aim,
    shoot: false,
    reload: false,
    dash: false,
    grenade: false,
  };
}

export class Room {
  readonly code: string;
  /** Dono da partida no modo Hub (contrato htok, R2): opaco, só comparado
   *  por igualdade exata. null = sala manual/legada (sem dono). */
  hubOwner: string | null = null;
  phase: Phase = 'waiting';
  timeLeft: number = MATCH.durationSeconds;
  winnerId: string | null = null;
  tick = 0;
  emptySince: number | null = Date.now();

  private readonly players = new Map<string, ServerPlayer>();
  private bullets: Bullet[] = [];
  private grenades: Grenade[] = [];
  private drops: { id: number; x: number; y: number; weapon: WeaponType; remaining: number }[] = [];
  private nextPlayerId = 1;
  private nextBulletId = 1;
  private nextGrenadeId = 1;
  private nextDropId = 1;
  private dropTimer = DROP.intervalSeconds;
  private dropWarningSent = false;
  private pendingDrops: { x: number; y: number; weapon: WeaponType }[] = [];
  private cardRoundTimer = 60;
  private cardSelectionTimer = 0;
  private pendingDuels: { a: string; b: string; timer: number }[] = [];
  private powerupSpawns: { id: number; x: number; y: number; type: PowerupType; active: boolean; respawnTimer: number }[] = [];
  private nextPowerupId = 1;
  private started = false;
  private pendingEvents: GameEvent[] = [];

  constructor(code: string) {
    this.code = code;
    for (const point of POWERUP.spawnPoints) {
      this.powerupSpawns.push({
        id: this.nextPowerupId++,
        x: point.x,
        y: point.y,
        type: this.randomPowerupType(false),
        active: true,
        respawnTimer: 0,
      });
    }
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= MATCH.maxPlayers;
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  /** Força o fim imediato da partida (hook de teste do Hub): ranqueia por
   *  abates/mortes/nome como no fim normal. Idempotente. */
  forceEnd(): void {
    if (this.phase === 'ended') return;
    this.endMatch();
  }

  addPlayer(client: RoomClient, name: string): ServerPlayer | null {
    if (this.isFull) return null;

    const usedColors = new Set<number>();
    for (const player of this.players.values()) usedColors.add(player.colorIndex);
    let colorIndex = 0;
    while (usedColors.has(colorIndex)) colorIndex += 1;

    const player: ServerPlayer = {
      id: `p_${this.code}_${this.nextPlayerId++}`,
      name,
      colorIndex,
      color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? '#ffffff',
      client,
      physics: createPlayerPhysics(0, 0, 0),
      alive: true,
      health: PLAYER.maxHealth,
      ammo: PISTOL.magSize,
      reloading: 0,
      fireCooldown: 0,
      grenadeCooldown: 0,
      weapon: 'pistol',
      shooting: false,
      flameTick: 0,
      scale: 1,
      speedBoost: 0,
      invincible: 0,
      damageBoost: 0,
      cooldownBoost: 0,
      infiniteAmmo: 0,
      grenadeBoost: 0,
      giant: 0,
      lifesteal: 0,
      duel: 0,
      duelPartner: null,
      duelOrigin: null,
      inDuel: false,
      invisible: 0,
      cards: [],
      pendingCardOptions: [],
      chosenCard: null,
      timeSinceLastShot: 999,
      card3Timer: 10,
      card3ArmedTimer: 0,
      card3UnarmedTimer: 0,
      spawnProtect: 0,
      respawnTimer: 0,
      kills: 0,
      deaths: 0,
      inputQueue: [],
      lastReceivedSeq: 0,
      ack: 0,
    };

    this.players.set(player.id, player);
    this.emptySince = null;
    this.spawnPlayer(player);
    this.emit({ type: 'join', name: player.name });

    return player;
  }

  removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    this.players.delete(playerId);
    this.bullets = this.bullets.filter((bullet) => bullet.owner !== playerId);
    this.grenades = this.grenades.filter((grenade) => grenade.owner !== playerId);
    // Duelo em andamento: sobrevivente volta à origem (vitória por W.O.).
    for (const other of this.players.values()) {
      if (other.duelPartner === playerId) {
        this.sendDuelHome(other);
        this.emit({ type: 'duelEnd', winnerId: other.id, winnerName: other.name, reason: 'leave' });
      }
    }
    // Countdown pendente com o desistente: cancela e limpa origens.
    if (this.pendingDuels.some((duel) => duel.a === playerId || duel.b === playerId)) {
      for (const duel of this.pendingDuels) {
        const survivor =
          duel.a === playerId
            ? this.players.get(duel.b)
            : duel.b === playerId
              ? this.players.get(duel.a)
              : undefined;
        if (survivor) survivor.duelOrigin = null;
      }
      this.pendingDuels = this.pendingDuels.filter(
        (duel) => duel.a !== playerId && duel.b !== playerId,
      );
      this.emit({ type: 'duelEnd', winnerId: null, winnerName: null, reason: 'leave' });
    }
    this.emit({ type: 'leave', name: player.name });

    if (this.players.size === 0) {
      this.emptySince = Date.now();
      this.phase = 'waiting';
      this.timeLeft = MATCH.durationSeconds;
      this.winnerId = null;
      this.started = false;
      this.bullets = [];
      this.grenades = [];
      this.drops = [];
      this.pendingDuels = [];
      this.dropTimer = DROP.intervalSeconds;
      this.dropWarningSent = false;
      this.pendingDrops = [];
      for (const spawn of this.powerupSpawns) {
        spawn.active = true;
        spawn.respawnTimer = 0;
        spawn.type = this.randomPowerupType(false);
      }
    }
    if (this.players.size < 2 && this.phase === 'playing') {
      this.phase = 'waiting';
    }
  }

  handleInput(playerId: string, input: PlayerInput): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (!Number.isInteger(input.seq) || input.seq <= player.lastReceivedSeq) return;

    if (player.inputQueue.length >= INPUT_QUEUE_LIMIT) {
      const dropped = player.inputQueue.shift();
      if (dropped) player.ack = Math.max(player.ack, dropped.seq);
    }

    player.lastReceivedSeq = input.seq;
    player.inputQueue.push(input);
  }

  sendSnapshotTo(player: ServerPlayer): void {
    player.client.send({ t: 'snapshot', snap: this.buildSnapshot(player) });
  }

  update(dt: number = TICK_DT): void {
    this.tick += 1;
    this.updatePhase(dt);

    if (this.phase === 'cardSelection') {
      this.flushEvents();
      if (this.tick % SNAPSHOT_EVERY_TICKS === 0) {
        this.broadcastSnapshots();
      }
      return;
    }

    for (const player of this.players.values()) {
      this.updatePlayer(player, dt);
    }

    this.updateDuels(dt);
    this.updateBullets(dt);
    this.updateGrenades(dt);
    this.updateDropTimer(dt);
    this.updateDrops(dt);
    this.updatePowerups(dt);
    this.flushEvents();

    if (this.tick % SNAPSHOT_EVERY_TICKS === 0) {
      this.broadcastSnapshots();
    }
  }

  private updatePhase(dt: number): void {
    if (this.phase === 'cardSelection') {
      this.cardSelectionTimer -= dt;
      if (this.cardSelectionTimer <= 0) {
        this.finishCardSelection();
      }
      return;
    }

    if (this.phase === 'waiting') {
      if (this.players.size >= 2) {
        if (!this.started) {
          this.beginMatch();
        } else {
          this.phase = 'playing';
        }
      }
      return;
    }

    if (this.phase === 'playing') {
      if (this.players.size < 2) {
        this.phase = 'waiting';
        return;
      }
      this.cardRoundTimer -= dt;
      if (this.cardRoundTimer <= 0) {
        this.startCardSelection();
        return;
      }
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this.endMatch();
      return;
    }

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      if (this.players.size >= 2) {
        this.beginMatch();
      } else {
        this.phase = 'waiting';
        this.started = false;
        this.timeLeft = MATCH.durationSeconds;
        this.winnerId = null;
        this.bullets = [];
      }
    }
  }

  private beginMatch(): void {
    this.pendingDuels = [];
    for (const player of this.players.values()) {
      player.kills = 0;
      player.deaths = 0;
      player.inputQueue = [];
      player.ack = player.lastReceivedSeq;
      player.inDuel = false;
      player.duelPartner = null;
      player.duelOrigin = null;
      player.duel = 0;
      this.spawnPlayer(player);
    }
    this.bullets = [];
    this.grenades = [];
    this.drops = [];
    this.dropTimer = DROP.intervalSeconds;
    this.dropWarningSent = false;
    this.pendingDrops = [];
    this.cardRoundTimer = 60;
    this.cardSelectionTimer = 0;
    for (const spawn of this.powerupSpawns) {
      spawn.active = true;
      spawn.respawnTimer = 0;
      spawn.type = this.randomPowerupType(false);
    }
    this.phase = 'playing';
    this.timeLeft = MATCH.durationSeconds;
    this.winnerId = null;
    this.started = true;
    this.emit({ type: 'matchStart' });
  }

  private endMatch(): void {
    const ranked = [...this.players.values()].sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name),
    );
    const top = ranked[0];
    const tied = ranked.length > 1 && ranked[1]?.kills === top?.kills;
    this.phase = 'ended';
    this.timeLeft = MATCH.intermissionSeconds;
    this.winnerId = top && !tied ? top.id : null;
    this.bullets = [];
    this.grenades = [];
    this.emit({ type: 'matchEnd', winnerName: top && !tied ? top.name : null });
  }

  private spawnPlayer(player: ServerPlayer): void {
    const spawn = this.pickSpawn(player.id);
    player.physics = createPlayerPhysics(
      spawn.x,
      spawn.y,
      Math.atan2(ARENA.height / 2 - spawn.y, ARENA.width / 2 - spawn.x),
    );
    player.alive = true;
    player.health = PLAYER.maxHealth;
    player.weapon = 'pistol';
    player.shooting = false;
    player.ammo = PISTOL.magSize;
    player.reloading = 0;
    player.fireCooldown = 0;
    player.grenadeCooldown = 0;
    player.flameTick = 0;
    player.invisible = 0;
    player.spawnProtect = PLAYER.spawnProtectionSeconds;
    player.respawnTimer = 0;
  }

  private pickSpawn(playerId: string): { x: number; y: number } {
    let best = SPAWN_POINTS[0] ?? { x: 150, y: 150 };
    let bestScore = -1;

    for (const point of SPAWN_POINTS) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of this.players.values()) {
        if (other.id === playerId || !other.alive) continue;
        nearest = Math.min(
          nearest,
          distanceSq(point.x, point.y, other.physics.x, other.physics.y),
        );
      }
      if (nearest === Number.POSITIVE_INFINITY) nearest = Math.random() * 1_000_000;
      if (nearest > bestScore) {
        bestScore = nearest;
        best = point;
      }
    }

    return best;
  }

  private updatePlayer(player: ServerPlayer, dt: number): void {
    player.spawnProtect = Math.max(0, player.spawnProtect - dt);
    const cdMult = player.cooldownBoost > 0 ? 2 : 1;
    player.fireCooldown = Math.max(0, player.fireCooldown - dt * cdMult);
    player.grenadeCooldown = Math.max(0, player.grenadeCooldown - dt * cdMult);
    player.shooting = false;

    player.speedBoost = Math.max(0, player.speedBoost - dt);
    player.invincible = Math.max(0, player.invincible - dt);
    player.damageBoost = Math.max(0, player.damageBoost - dt);
    player.cooldownBoost = Math.max(0, player.cooldownBoost - dt);
    player.invisible = Math.max(0, player.invisible - dt);
    player.infiniteAmmo = Math.max(0, player.infiniteAmmo - dt);
    player.grenadeBoost = Math.max(0, player.grenadeBoost - dt);
    player.giant = Math.max(0, player.giant - dt);
    player.lifesteal = Math.max(0, player.lifesteal - dt);
    player.duel = Math.max(0, player.duel - dt);
    if (player.inDuel && player.duel <= 0) {
      // Timeout do duelo: ambos voltam às origens, sem buff.
      const partner = player.duelPartner ? this.players.get(player.duelPartner) : undefined;
      this.sendDuelHome(player);
      if (partner && partner.inDuel && partner.duelPartner === player.id) {
        this.sendDuelHome(partner);
      }
      this.emit({ type: 'duelEnd', winnerId: null, winnerName: null, reason: 'timeout' });
    }

    if (player.giant <= 0 && player.scale !== 1) {
      player.scale = 1;
      if (player.health > PLAYER.maxHealth) player.health = PLAYER.maxHealth;
    }

    const queued = player.inputQueue.shift();
    if (queued) player.ack = queued.seq;

    if (!player.alive) {
      player.respawnTimer = Math.max(0, player.respawnTimer - dt);
      if (player.respawnTimer <= 0) this.spawnPlayer(player);
      return;
    }

    if (player.reloading > 0) {
      player.reloading = Math.max(0, player.reloading - dt);
      if (player.reloading === 0) player.ammo = WEAPONS[player.weapon].magSize;
    }

    const input = queued ?? idleInput(player.physics.aim);
    const baseSpeed = WEAPONS[player.weapon].speed;
    const speed = baseSpeed * (player.speedBoost > 0 ? 1.5 : 1) * (player.giant > 0 ? 0.9 : 1);
    const obstacles = player.inDuel ? [] : OBSTACLES;
    const bounds = player.inDuel ? undefined : undefined;
    stepPlayerPhysics(player.physics, input, dt, obstacles, speed);
    if (player.inDuel) {
      // clamp ao ringue (sem obstáculos lá dentro)
      if (player.physics.x < DUEL_ARENA.minX) { player.physics.x = DUEL_ARENA.minX; if (player.physics.vx < 0) player.physics.vx = 0; }
      if (player.physics.x > DUEL_ARENA.maxX) { player.physics.x = DUEL_ARENA.maxX; if (player.physics.vx > 0) player.physics.vx = 0; }
      if (player.physics.y < DUEL_ARENA.minY) { player.physics.y = DUEL_ARENA.minY; if (player.physics.vy < 0) player.physics.vy = 0; }
      if (player.physics.y > DUEL_ARENA.maxY) { player.physics.y = DUEL_ARENA.maxY; if (player.physics.vy > 0) player.physics.vy = 0; }
    }
    if (input.shoot && player.reloading <= 0 && player.ammo > 0) {
      player.shooting = true;
      player.timeSinceLastShot = 0;
    } else {
      player.timeSinceLastShot += dt;
    }

    if (this.phase === 'ended') return;

    if (player.infiniteAmmo <= 0 && input.reload && player.reloading <= 0 && player.ammo < WEAPONS[player.weapon].magSize) {
      player.reloading = WEAPONS[player.weapon].reloadSeconds;
    }

    if (player.cards.includes('weaponCycle')) {
      player.card3Timer -= dt;
      if (player.card3Timer <= 0) {
        // grant random drop weapon
        const weapons: WeaponType[] = ['flamethrower', 'shotgun', 'minigun'];
        player.weapon = weapons[Math.floor(Math.random() * weapons.length)] ?? 'shotgun';
        player.ammo = WEAPONS[player.weapon].magSize;
        player.reloading = 0;
        player.fireCooldown = 0;
        player.card3ArmedTimer = 7;
        player.card3UnarmedTimer = 0;
        player.card3Timer = 10;
      }
      if (player.card3ArmedTimer > 0) {
        player.card3ArmedTimer -= dt;
        if (player.card3ArmedTimer <= 0) {
          player.weapon = 'unarmed';
          player.ammo = 0;
          player.card3UnarmedTimer = 3;
        }
      } else if (player.card3UnarmedTimer > 0) {
        player.card3UnarmedTimer -= dt;
        if (player.card3UnarmedTimer <= 0) {
          player.weapon = 'pistol';
          player.ammo = PISTOL.magSize;
          player.reloading = 0;
        }
      }
    }

    if (player.weapon === 'flamethrower') {
      if (input.shoot && player.reloading <= 0 && player.ammo > 0) {
        player.shooting = true;
        const weapon = WEAPONS.flamethrower;
        if (player.infiniteAmmo <= 0) player.ammo = Math.max(0, player.ammo - weapon.flameAmmoPerSecond * dt);
        player.flameTick += dt;
        if (player.flameTick >= 0.25) {
          player.flameTick -= 0.25;
          this.applyFlame(player);
        }
        if (player.infiniteAmmo <= 0 && player.ammo <= 0) {
          player.reloading = weapon.reloadSeconds;
        }
      } else {
        player.flameTick = 0;
    player.invisible = 0;
      }
    } else if (
      input.shoot &&
      player.reloading <= 0 &&
      player.fireCooldown <= 0 &&
      player.ammo > 0
    ) {
      if (player.weapon === 'shotgun') {
        this.fireShotgun(player);
      } else if (player.weapon === 'minigun') {
        this.fireMinigun(player);
      } else {
        this.firePistol(player);
      }
    }

    if (input.grenade && player.grenadeCooldown <= 0) {
      this.throwGrenade(player);
    }
  }

  private firePistol(player: ServerPlayer): void {
    if (player.infiniteAmmo <= 0) player.ammo -= 1;
    player.fireCooldown = PISTOL.fireInterval;

    const angle = player.physics.aim;
    const x = player.physics.x + Math.cos(angle) * PISTOL.muzzleOffset;
    const y = player.physics.y + Math.sin(angle) * PISTOL.muzzleOffset;

    this.bullets.push({
      id: this.nextBulletId++,
      owner: player.id,
      x,
      y,
      vx: Math.cos(angle) * PISTOL.bulletSpeed,
      vy: Math.sin(angle) * PISTOL.bulletSpeed,
      angle,
      life: PISTOL.bulletLifetime,
      damage: PISTOL.damage,
      ricochets: 0,
      wallBounce: false,
      slow: false,
      damageMult: 1,
      homing: false,
      decorated: false,
    });

    this.emit({
      type: 'shot',
      playerId: player.id,
      x,
      y,
      aim: angle,
    });

    if (player.infiniteAmmo <= 0 && player.ammo === 0) {
      player.reloading = PISTOL.reloadSeconds;
    }
  }

  private fireShotgun(player: ServerPlayer): void {
    const weapon = WEAPONS.shotgun;
    if (player.infiniteAmmo <= 0) player.ammo -= 1;
    player.fireCooldown = weapon.fireInterval;

    const angle = player.physics.aim;
    const x = player.physics.x + Math.cos(angle) * weapon.muzzleOffset;
    const y = player.physics.y + Math.sin(angle) * weapon.muzzleOffset;

    const count = weapon.pellets;
    for (let i = 0; i < count; i += 1) {
      const spread = (i - (count - 1) / 2) * weapon.spread;
      const pelletAngle = angle + spread;
      this.bullets.push({
        id: this.nextBulletId++,
        owner: player.id,
        x,
        y,
        vx: Math.cos(pelletAngle) * weapon.bulletSpeed,
        vy: Math.sin(pelletAngle) * weapon.bulletSpeed,
        angle: pelletAngle,
        life: weapon.bulletRange / weapon.bulletSpeed,
        damage: weapon.damage,
        ricochets: 0,
        wallBounce: false,
        slow: false,
        damageMult: 1,
        homing: false,
        decorated: false,
      });
    }

    this.emit({
      type: 'shot',
      playerId: player.id,
      x,
      y,
      aim: angle,
    });

    if (player.infiniteAmmo <= 0 && player.ammo === 0) {
      player.reloading = weapon.reloadSeconds;
    }
  }

  private fireShotgunAt(player: ServerPlayer, angle: number): void {
    const weapon = WEAPONS.shotgun;
    if (player.infiniteAmmo <= 0) player.ammo = Math.max(0, player.ammo - 1);
    player.fireCooldown = weapon.fireInterval;

    const x = player.physics.x + Math.cos(angle) * weapon.muzzleOffset;
    const y = player.physics.y + Math.sin(angle) * weapon.muzzleOffset;

    const count = weapon.pellets;
    for (let i = 0; i < count; i += 1) {
      const spread = (i - (count - 1) / 2) * weapon.spread;
      const pelletAngle = angle + spread;
      this.bullets.push({
        id: this.nextBulletId++,
        owner: player.id,
        x,
        y,
        vx: Math.cos(pelletAngle) * weapon.bulletSpeed,
        vy: Math.sin(pelletAngle) * weapon.bulletSpeed,
        angle: pelletAngle,
        life: weapon.bulletRange / weapon.bulletSpeed,
        damage: weapon.damage,
        ricochets: 0,
        wallBounce: false,
        slow: false,
        damageMult: 1,
        homing: false,
        decorated: false,
      });
    }

    this.emit({ type: 'shot', playerId: player.id, x, y, aim: angle });
  }

  private fireMinigun(player: ServerPlayer): void {
    const weapon = WEAPONS.minigun;
    if (player.infiniteAmmo <= 0) player.ammo -= 1;
    player.fireCooldown = weapon.fireInterval;

    const angle = player.physics.aim;
    const x = player.physics.x + Math.cos(angle) * weapon.muzzleOffset;
    const y = player.physics.y + Math.sin(angle) * weapon.muzzleOffset;

    this.bullets.push({
      id: this.nextBulletId++,
      owner: player.id,
      x,
      y,
      vx: Math.cos(angle) * weapon.bulletSpeed,
      vy: Math.sin(angle) * weapon.bulletSpeed,
      angle,
      life: weapon.bulletRange / weapon.bulletSpeed,
      damage: weapon.damage,
      ricochets: 0,
      wallBounce: false,
      slow: false,
      damageMult: 1,
      homing: false,
      decorated: false,
    });

    this.emit({
      type: 'shot',
      playerId: player.id,
      x,
      y,
      aim: angle,
    });

    if (player.infiniteAmmo <= 0 && player.ammo === 0) {
      player.reloading = weapon.reloadSeconds;
    }
  }

  private applyFlame(shooter: ServerPlayer): void {
    const weapon = WEAPONS.flamethrower;
    const angle = shooter.physics.aim;
    const originX = shooter.physics.x + Math.cos(angle) * weapon.muzzleOffset;
    const originY = shooter.physics.y + Math.sin(angle) * weapon.muzzleOffset;
    const baseDamage = weapon.flameDamagePerSecond * 0.25;
    const damage = shooter.damageBoost > 0 ? baseDamage * 1.5 : baseDamage;

    for (const target of this.players.values()) {
      if (target.id === shooter.id || !target.alive || target.spawnProtect > 0) continue;
      if (target.invincible > 0) continue;
      if ((shooter.inDuel || target.inDuel) && shooter.id !== target.duelPartner) continue;
      const dx = target.physics.x - originX;
      const dy = target.physics.y - originY;
      const dist = Math.hypot(dx, dy);
      if (dist > weapon.flameRange || dist < 0.001) continue;
      const targetAngle = Math.atan2(dy, dx);
      const diff = Math.abs(normalizeAngle(targetAngle - angle));
      if (diff > 0.55) continue;

      target.health = Math.max(0, target.health - damage);

      if (shooter.lifesteal > 0) {
        shooter.health = Math.min(this.playerMaxHealth(shooter), shooter.health + damage);
      }

      this.emit({
        type: 'hit',
        by: shooter.id,
        targetId: target.id,
        damage: Math.round(damage),
        x: target.physics.x,
        y: target.physics.y,
      });

      if (target.health <= 0) {
        const killer = this.players.get(shooter.id);
        if (killer && target.id !== shooter.id) {
          this.killPlayer(target, killer);
        } else {
          target.alive = false;
          target.health = 0;
          target.deaths += 1;
          target.respawnTimer = PLAYER.respawnSeconds;
          target.reloading = 0;
          target.ammo = 0;
          target.physics.vx = 0;
          target.physics.vy = 0;
          target.physics.dashTime = 0;
          target.physics.dashCooldown = 0;
          this.emit({
            type: 'kill',
            killerId: shooter.id,
            victimId: target.id,
            killerName: shooter.name,
            victimName: target.name,
            x: target.physics.x,
            y: target.physics.y,
          });
        }
      }
    }
  }

  private throwGrenade(player: ServerPlayer): void {
    if (player.grenadeBoost <= 0) player.grenadeCooldown = GRENADE.cooldown;

    const angle = player.physics.aim;
    const x = player.physics.x + Math.cos(angle) * GRENADE.muzzleOffset;
    const y = player.physics.y + Math.sin(angle) * GRENADE.muzzleOffset;

    this.grenades.push({
      id: this.nextGrenadeId++,
      owner: player.id,
      x,
      y,
      vx: Math.cos(angle) * GRENADE.speed,
      vy: Math.sin(angle) * GRENADE.speed,
      life: GRENADE.lifetime,
    });
  }

  private updateGrenades(dt: number): void {
    const survivors: Grenade[] = [];

    for (const grenade of this.grenades) {
      const startX = grenade.x;
      const startY = grenade.y;
      grenade.x += grenade.vx * dt;
      grenade.y += grenade.vy * dt;
      grenade.life -= dt;

      let explode = false;

      if (
        grenade.x < ARENA.inset ||
        grenade.y < ARENA.inset ||
        grenade.x > ARENA.width - ARENA.inset ||
        grenade.y > ARENA.height - ARENA.inset
      ) {
        explode = true;
      }

      if (!explode) {
        for (const obstacle of OBSTACLES) {
          const t = segmentCircleHit(
            startX,
            startY,
            grenade.x,
            grenade.y,
            obstacle.x,
            obstacle.y,
            obstacle.radius + GRENADE.projectileRadius,
          );
          if (t !== null) {
            explode = true;
            break;
          }
        }
      }

      if (!explode) {
        for (const player of this.players.values()) {
          if (player.id === grenade.owner || !player.alive || player.spawnProtect > 0) continue;
          const t = segmentCircleHit(
            startX,
            startY,
            grenade.x,
            grenade.y,
            player.physics.x,
            player.physics.y,
            PLAYER.radius + GRENADE.projectileRadius,
          );
          if (t !== null) {
            explode = true;
            break;
          }
        }
      }

      if (grenade.life <= 0) explode = true;

      if (explode) {
        this.explodeGrenade(grenade);
      } else {
        survivors.push(grenade);
      }
    }

    this.grenades = survivors;
  }

  private explodeGrenade(grenade: Grenade): void {
    const radius = GRENADE.explosionRadius;
    const radiusSq = radius * radius;
    const shooter = this.players.get(grenade.owner);

    for (const player of this.players.values()) {
      if (!player.alive || player.spawnProtect > 0) continue;
      if (player.invincible > 0) continue;
      if ((shooter?.inDuel || player.inDuel) && shooter?.id !== player.duelPartner) continue;
      const dx = player.physics.x - grenade.x;
      const dy = player.physics.y - grenade.y;
      if (dx * dx + dy * dy > radiusSq) continue;

      const damage = Math.round(GRENADE.damage * (shooter?.damageBoost && shooter.damageBoost > 0 ? 1.5 : 1));
      player.health = Math.max(0, player.health - damage);

      if (shooter && shooter.lifesteal > 0) {
        shooter.health = Math.min(this.playerMaxHealth(shooter), shooter.health + damage);
      }

      this.emit({
        type: 'hit',
        by: grenade.owner,
        targetId: player.id,
        damage,
        x: player.physics.x,
        y: player.physics.y,
      });

      if (player.health <= 0) {
        if (player.id !== grenade.owner && shooter) {
          this.killPlayer(player, shooter);
        } else {
          player.alive = false;
          player.health = 0;
          player.deaths += 1;
          player.respawnTimer = PLAYER.respawnSeconds;
          player.reloading = 0;
          player.ammo = 0;
          player.physics.vx = 0;
          player.physics.vy = 0;
          player.physics.dashTime = 0;
          player.physics.dashCooldown = 0;
          this.emit({
            type: 'kill',
            killerId: grenade.owner,
            victimId: player.id,
            killerName: 'Granada',
            victimName: player.name,
            x: player.physics.x,
            y: player.physics.y,
          });
        }
      }
    }

    this.emit({
      type: 'explosion',
      playerId: grenade.owner,
      x: grenade.x,
      y: grenade.y,
      radius,
    });
  }

  private updateDropTimer(dt: number): void {
    this.dropTimer -= dt;

    if (!this.dropWarningSent && this.dropTimer <= DROP.warningSeconds) {
      this.pendingDrops = [];
      for (let i = 0; i < DROP.count; i += 1) {
        const location = this.pickDropLocation();
        const weapon = this.randomDropWeapon();
        this.pendingDrops.push({ x: location.x, y: location.y, weapon });
        this.emit({ type: 'dropWarning', x: location.x, y: location.y });
      }
      this.dropWarningSent = true;
    }

    if (this.dropTimer <= 0) {
      for (const pending of this.pendingDrops) {
        this.drops.push({
          id: this.nextDropId++,
          x: pending.x,
          y: pending.y,
          weapon: pending.weapon,
          remaining: DROP.lifetimeSeconds,
        });
      }
      this.dropTimer = DROP.intervalSeconds;
      this.dropWarningSent = false;
      this.pendingDrops = [];
      for (const spawn of this.powerupSpawns) {
        spawn.active = true;
        spawn.respawnTimer = 0;
        spawn.type = this.randomPowerupType(false);
      }
    }
  }

  private updateDrops(dt: number): void {
    const survivors: typeof this.drops = [];

    for (const drop of this.drops) {
      drop.remaining -= dt;

      let collected = false;
      for (const player of this.players.values()) {
        if (!player.alive || player.spawnProtect > 0) continue;
        const dx = player.physics.x - drop.x;
        const dy = player.physics.y - drop.y;
        if (dx * dx + dy * dy > DROP.pickupRadius * DROP.pickupRadius) continue;

        player.weapon = drop.weapon;
        player.ammo = WEAPONS[drop.weapon].magSize;
        player.reloading = 0;
        player.fireCooldown = 0;
        player.flameTick = 0;
    player.invisible = 0;

        this.emit({
          type: 'dropPickup',
          playerId: player.id,
          weapon: drop.weapon,
          x: drop.x,
          y: drop.y,
        });

        collected = true;
        break;
      }

      if (collected) continue;
      if (drop.remaining <= 0) {
        this.emit({ type: 'dropExpired', x: drop.x, y: drop.y });
        continue;
      }
      survivors.push(drop);
    }

    this.drops = survivors;
  }

  private pickDropLocation(): { x: number; y: number } {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const x = ARENA.inset + 60 + Math.random() * (ARENA.width - 2 * ARENA.inset - 120);
      const y = ARENA.inset + 60 + Math.random() * (ARENA.height - 2 * ARENA.inset - 120);
      if (pointBlockedByObstacle(x, y, PLAYER.radius + 8)) continue;
      return { x, y };
    }
    return { x: ARENA.width / 2, y: ARENA.height / 2 };
  }

  private randomDropWeapon(): WeaponType {
    const options: WeaponType[] = ['flamethrower', 'shotgun', 'minigun'];
    return options[Math.floor(Math.random() * options.length)] ?? 'shotgun';
  }

  private updatePowerups(dt: number): void {
    for (const spawn of this.powerupSpawns) {
      if (!spawn.active) {
        spawn.respawnTimer -= dt;
        if (spawn.respawnTimer <= 0) {
          spawn.active = true;
          spawn.type = this.randomPowerupType(false);
        }
        continue;
      }

      // collection check
      for (const player of this.players.values()) {
        if (!player.alive || player.spawnProtect > 0) continue;
        const dx = player.physics.x - spawn.x;
        const dy = player.physics.y - spawn.y;
        if (dx * dx + dy * dy > POWERUP.pickupRadius * POWERUP.pickupRadius) continue;

        this.applyPowerup(player, spawn.type, spawn.x, spawn.y);
        spawn.active = false;
        spawn.respawnTimer = POWERUP.respawnSeconds;
        break;
      }
    }
  }

  private applyPowerup(player: ServerPlayer, type: PowerupType, x: number, y: number): void {
    switch (type) {
      case 'speed':
        player.speedBoost = 5 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        break;
      case 'heal':
        player.health = this.playerMaxHealth(player);
        break;
      case 'shield':
        player.invincible = 8 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        break;
      case 'damage':
        player.damageBoost = 10 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        break;
      case 'cooldown':
        player.cooldownBoost = 10 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        player.infiniteAmmo = 10 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        break;
      case 'grenade':
        player.grenadeBoost = 5 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        break;
      case 'giant':
        player.giant = 15 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        player.scale = 3;
        player.health = 500;
        break;
      case 'lifesteal':
        player.lifesteal = 15 * (player.cards.includes('powerupDuration') ? 1.7 : 1);
        break;
      case 'duel': {
        if (player.inDuel) break;
        const busy = new Set<string>();
        for (const duel of this.pendingDuels) {
          busy.add(duel.a);
          busy.add(duel.b);
        }
        const candidates = [...this.players.values()].filter(
          (p) => p.id !== player.id && p.alive && !p.inDuel && !busy.has(p.id),
        );
        if (candidates.length === 0) break;
        const opponent = candidates[Math.floor(Math.random() * candidates.length)]!;
        // Salva origens, avisa e teleporta só após o countdown.
        player.duelOrigin = { x: player.physics.x, y: player.physics.y };
        opponent.duelOrigin = { x: opponent.physics.x, y: opponent.physics.y };
        this.pendingDuels.push({ a: player.id, b: opponent.id, timer: DUEL.countdownSeconds });
        this.emit({
          type: 'duelStart',
          a: player.id,
          b: opponent.id,
          aName: player.name,
          bName: opponent.name,
          seconds: DUEL.countdownSeconds,
        });
        break;
      }
    }

    this.emit({ type: 'powerupPickup', playerId: player.id, powerup: type, x, y } as any);
  }

  private playerMaxHealth(player: ServerPlayer): number {
    return player.giant > 0 ? 500 : PLAYER.maxHealth;
  }

  /** Devolve o duelista à posição de origem e limpa o estado do duelo. */
  private sendDuelHome(player: ServerPlayer): void {
    if (player.duelOrigin) {
      player.physics.x = player.duelOrigin.x;
      player.physics.y = player.duelOrigin.y;
      player.duelOrigin = null;
    }
    player.physics.vx = 0;
    player.physics.vy = 0;
    player.inDuel = false;
    player.duelPartner = null;
    player.duel = 0;
  }

  private updateDuels(dt: number): void {
    if (this.pendingDuels.length === 0) return;
    const ready: { a: string; b: string }[] = [];
    for (const pending of this.pendingDuels) {
      pending.timer -= dt;
      if (pending.timer <= 0) ready.push(pending);
    }
    if (ready.length === 0) return;
    const done = new Set(ready);
    this.pendingDuels = this.pendingDuels.filter((pending) => !done.has(pending));
    for (const pending of ready) this.beginDuel(pending.a, pending.b);
  }

  private beginDuel(aId: string, bId: string): void {
    const a = this.players.get(aId);
    const b = this.players.get(bId);
    if (!a || !b || !a.alive || !b.alive || a.inDuel || b.inDuel) {
      if (a) a.duelOrigin = null;
      if (b) b.duelOrigin = null;
      this.emit({ type: 'duelEnd', winnerId: null, winnerName: null, reason: 'leave' });
      return;
    }
    const midY = (DUEL_ARENA.minY + DUEL_ARENA.maxY) / 2;
    a.physics.x = DUEL_ARENA.minX + 75;
    a.physics.y = midY;
    a.physics.vx = 0;
    a.physics.vy = 0;
    b.physics.x = DUEL_ARENA.maxX - 75;
    b.physics.y = midY;
    b.physics.vx = 0;
    b.physics.vy = 0;
    a.inDuel = true;
    b.inDuel = true;
    a.duelPartner = b.id;
    b.duelPartner = a.id;
    a.duel = DUEL.durationSeconds;
    b.duel = DUEL.durationSeconds;
    a.health = this.playerMaxHealth(a);
    b.health = this.playerMaxHealth(b);
  }

  private randomPowerupType(specialOnly: boolean): PowerupType {
    const mini: PowerupType[] = ['speed', 'heal', 'shield', 'damage', 'cooldown', 'grenade'];
    const special: PowerupType[] = ['duel', 'giant', 'lifesteal'];
    // 20% special
    if (!specialOnly && Math.random() < 0.8) {
      return mini[Math.floor(Math.random() * mini.length)] ?? 'speed';
    }
    return special[Math.floor(Math.random() * special.length)] ?? 'giant';
  }

  private startCardSelection(): void {
    this.phase = 'cardSelection';
    this.cardSelectionTimer = 10;

    for (const player of this.players.values()) {
      const available = CARD_TYPES.filter((card) => !player.cards.includes(card));
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      player.pendingCardOptions = shuffled.slice(0, 3);
      player.chosenCard = null;
      player.client.send({ t: 'cardSelection', cards: player.pendingCardOptions, seconds: 10 } as any);
    }
  }

  private finishCardSelection(): void {
    for (const player of this.players.values()) {
      if (!player.chosenCard && player.pendingCardOptions.length > 0) {
        player.chosenCard = player.pendingCardOptions[Math.floor(Math.random() * player.pendingCardOptions.length)] ?? null;
      }
      if (player.chosenCard) {
        this.applyCard(player, player.chosenCard);
      }
      player.pendingCardOptions = [];
      player.chosenCard = null;
      // Descarta inputs enfileirados no congelamento (evita rubber-band).
      player.inputQueue = [];
      player.ack = player.lastReceivedSeq;
    }
    this.phase = 'playing';
    this.cardRoundTimer = 60;
  }

  handleChooseCard(playerId: string, card: string): void {
    if (this.phase !== 'cardSelection') return;
    const player = this.players.get(playerId);
    if (!player) return;
    if (!player.pendingCardOptions.includes(card as CardType)) return;
    player.chosenCard = card as CardType;
    // Termina cedo quando todos já escolheram.
    for (const other of this.players.values()) {
      if (!other.chosenCard) return;
    }
    this.finishCardSelection();
  }

  private applyCard(player: ServerPlayer, card: CardType): void {
    if (player.cards.length >= 3) {
      player.cards.shift();
    }
    player.cards.push(card);
  }

  private decorateBullet(bullet: Bullet, shooter: ServerPlayer): void {
    const cards = shooter.cards;
    if (cards.includes('homing')) {
      bullet.homing = true;
    }
    if (cards.includes('ricochet')) {
      bullet.ricochets = 3;
    }
    if (cards.includes('wallBounce')) {
      bullet.wallBounce = true;
      bullet.ricochets = Math.max(bullet.ricochets, 1);
      bullet.damageMult *= 1.5;
    }
    if (cards.includes('slowKnockback')) {
      bullet.slow = true;
      bullet.vx *= 0.7;
      bullet.vy *= 0.7;
    }
    if (cards.includes('chargedShot') && shooter.timeSinceLastShot >= 2) {
      bullet.damageMult *= 1.2;
      bullet.vx *= 1.3;
      bullet.vy *= 1.3;
    }
  }

  private updateBullets(dt: number): void {
    const survivors: Bullet[] = [];

    for (const bullet of this.bullets) {
      if (!bullet.decorated) {
        const shooter = this.players.get(bullet.owner);
        if (shooter) this.decorateBullet(bullet, shooter);
        bullet.decorated = true;
      }
      const startX = bullet.x;
      const startY = bullet.y;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;

      if (bullet.homing) {
        // steer toward nearest enemy
        let nearest: ServerPlayer | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;
        for (const target of this.players.values()) {
          if (target.id === bullet.owner || !target.alive) continue;
          const d = (target.physics.x - bullet.x) ** 2 + (target.physics.y - bullet.y) ** 2;
          if (d < nearestDist) {
            nearestDist = d;
            nearest = target;
          }
        }
        if (nearest && nearestDist <= 160_000) {
          // Homing leve: só curva de perto (~400px) e devagar (0.8 rad/s).
          const desiredAngle = Math.atan2(nearest.physics.y - bullet.y, nearest.physics.x - bullet.x);
          const currentAngle = Math.atan2(bullet.vy, bullet.vx);
          const turn = 0.8 * dt;
          const diff = normalizeAngle(desiredAngle - currentAngle);
          const newAngle = currentAngle + Math.max(-turn, Math.min(turn, diff));
          const speed = Math.hypot(bullet.vx, bullet.vy);
          bullet.vx = Math.cos(newAngle) * speed;
          bullet.vy = Math.sin(newAngle) * speed;
          bullet.angle = newAngle;
        }
      }

      let hitT = 1;
      let hitPlayer: ServerPlayer | null = null;
      let hitObstacle: { x: number; y: number } | null = null;

      for (const obstacle of OBSTACLES) {
        const t = segmentCircleHit(
          startX,
          startY,
          bullet.x,
          bullet.y,
          obstacle.x,
          obstacle.y,
          obstacle.radius + PISTOL.bulletRadius,
        );
        if (t !== null && t < hitT) {
          hitT = t;
          hitPlayer = null;
          hitObstacle = obstacle;
        }
      }

      for (const player of this.players.values()) {
        if (player.id === bullet.owner || !player.alive || player.spawnProtect > 0) continue;
        if (player.invincible > 0) continue;
        const shooter = this.players.get(bullet.owner);
        if (shooter && (shooter.inDuel || player.inDuel) && shooter.id !== player.duelPartner) continue;
        const t = segmentCircleHit(
          startX,
          startY,
          bullet.x,
          bullet.y,
          player.physics.x,
          player.physics.y,
          PLAYER.radius + PISTOL.bulletRadius,
        );
        if (t !== null && t < hitT) {
          hitT = t;
          hitPlayer = player;
        }
      }

      if (hitPlayer) {
        bullet.x = startX + (bullet.x - startX) * hitT;
        bullet.y = startY + (bullet.y - startY) * hitT;
        this.hitPlayer(hitPlayer, bullet);
        continue;
      }

      if (hitT < 1 && bullet.ricochets > 0 && hitObstacle) {
        const hx = startX + (bullet.x - startX) * hitT;
        const hy = startY + (bullet.y - startY) * hitT;
        bullet.x = hx;
        bullet.y = hy;
        const nx = hx - hitObstacle.x;
        const ny = hy - hitObstacle.y;
        const nlen = Math.hypot(nx, ny) || 1;
        const nnx = nx / nlen;
        const nny = ny / nlen;
        const dot = bullet.vx * nnx + bullet.vy * nny;
        bullet.vx = bullet.vx - 2 * dot * nnx;
        bullet.vy = bullet.vy - 2 * dot * nny;
        bullet.angle = Math.atan2(bullet.vy, bullet.vx);
        bullet.ricochets -= 1;
        // small push out
        bullet.x += nnx * 2;
        bullet.y += nny * 2;
        if (bullet.life > 0) survivors.push(bullet);
        continue;
      }

      if (hitT < 1) continue;
      if (bullet.life <= 0) continue;
      if (bullet.x < 0 || bullet.x > ARENA.width) {
        if (bullet.ricochets > 0) {
          bullet.vx *= -1;
          bullet.angle = Math.atan2(bullet.vy, bullet.vx);
          bullet.ricochets -= 1;
          bullet.x = bullet.x < 0 ? 0 : ARENA.width;
          if (bullet.life > 0) survivors.push(bullet);
          continue;
        }
        continue;
      }
      if (bullet.y < 0 || bullet.y > ARENA.height) {
        if (bullet.ricochets > 0) {
          bullet.vy *= -1;
          bullet.angle = Math.atan2(bullet.vy, bullet.vx);
          bullet.ricochets -= 1;
          bullet.y = bullet.y < 0 ? 0 : ARENA.height;
          if (bullet.life > 0) survivors.push(bullet);
          continue;
        }
        continue;
      }

      survivors.push(bullet);
    }

    this.bullets = survivors;
  }

  private hitPlayer(target: ServerPlayer, bullet: Bullet): void {
    const shooter = this.players.get(bullet.owner);
    if (!shooter) return;
    if (target.invincible > 0) return;
    if ((shooter.inDuel || target.inDuel) && shooter.id !== target.duelPartner) return;

    const damage = Math.round(bullet.damage * (shooter.damageBoost > 0 ? 1.5 : 1) * (bullet.damageMult || 1));
    target.health = Math.max(0, target.health - damage);

    if (shooter.lifesteal > 0) {
      shooter.health = Math.min(this.playerMaxHealth(shooter), shooter.health + damage);
    }

    if (bullet.slow) {
      // Impulso 500: desloca ~40px antes do decel zerar (~9 ticks), sem canal novo.
      const kx = Math.cos(bullet.angle) * 500;
      const ky = Math.sin(bullet.angle) * 500;
      target.physics.vx += kx;
      target.physics.vy += ky;
    }

    this.emit({
      type: 'hit',
      by: shooter.id,
      targetId: target.id,
      damage,
      x: bullet.x,
      y: bullet.y,
    });

    if (target.health <= 0) {
      this.killPlayer(target, shooter);
    }
  }

  private killPlayer(victim: ServerPlayer, killer: ServerPlayer): void {
    victim.alive = false;
    victim.health = 0;
    victim.deaths += 1;
    victim.respawnTimer = PLAYER.respawnSeconds;
    victim.reloading = 0;
    victim.ammo = 0;
    victim.physics.vx = 0;
    victim.physics.vy = 0;
    victim.physics.dashTime = 0;
    victim.physics.dashCooldown = 0;

    killer.kills += 1;
    if (killer.cards.includes('deathGrenade')) {
      this.grenades.push({
        id: this.nextGrenadeId++,
        owner: killer.id,
        x: victim.physics.x,
        y: victim.physics.y,
        vx: 0,
        vy: 0,
        life: GRENADE.lifetime * 1.3,
        explosionRadius: GRENADE.explosionRadius * 1.3,
      });
    }
    if (victim.inDuel && victim.duelPartner === killer.id) {
      killer.kills += 2;
      // Vencedor volta à origem com buff; vítima limpa (respawn cuida do resto).
      this.sendDuelHome(killer);
      victim.duelOrigin = null;
      victim.inDuel = false;
      victim.duelPartner = null;
      victim.duel = 0;
      killer.damageBoost = Math.max(killer.damageBoost, 10);
      killer.speedBoost = Math.max(killer.speedBoost, 5);
      this.emit({
        type: 'duelEnd',
        winnerId: killer.id,
        winnerName: killer.name,
        reason: 'kill',
      });
    }

    this.emit({
      type: 'kill',
      killerId: killer.id,
      victimId: victim.id,
      killerName: killer.name,
      victimName: victim.name,
      x: victim.physics.x,
      y: victim.physics.y,
    });
  }

  private buildSnapshot(you: ServerPlayer): Snapshot {
    const players: NetPlayer[] = [];

    for (const player of this.players.values()) {
      players.push({
        id: player.id,
        name: player.name,
        color: player.color,
        x: round(player.physics.x),
        y: round(player.physics.y),
        aim: round(player.physics.aim),
        weapon: player.weapon,
        shooting: player.shooting,
        scale: player.scale,
        invincible: player.invincible > 0,
        invisible: player.invisible > 0,
        duel: player.inDuel,
        health: player.health,
        alive: player.alive,
        protected: player.spawnProtect > 0,
        kills: player.kills,
        deaths: player.deaths,
        score: player.kills,
      });
    }

    const bullets: NetBullet[] = this.bullets.map((bullet) => ({
      id: bullet.id,
      owner: bullet.owner,
      x: round(bullet.x),
      y: round(bullet.y),
      angle: round(bullet.angle),
    }));

    const grenades: NetGrenade[] = this.grenades.map((grenade) => ({
      id: grenade.id,
      owner: grenade.owner,
      x: round(grenade.x),
      y: round(grenade.y),
    }));

    const drops: NetDrop[] = this.drops.map((drop) => ({
      id: drop.id,
      x: round(drop.x),
      y: round(drop.y),
    }));

    const powerups: NetPowerup[] = this.powerupSpawns
      .filter((spawn) => spawn.active)
      .map((spawn) => ({
        id: spawn.id,
        x: round(spawn.x),
        y: round(spawn.y),
        type: spawn.type,
      }));

    const self: SelfState = {
      id: you.id,
      ack: you.ack,
      x: round(you.physics.x),
      y: round(you.physics.y),
      vx: round(you.physics.vx),
      vy: round(you.physics.vy),
      aim: round(you.physics.aim),
      dashTime: round(you.physics.dashTime),
      dashCooldown: round(you.physics.dashCooldown),
      health: you.health,
      alive: you.alive,
      ammo: you.ammo,
      reloading: round(you.reloading),
      weapon: you.weapon,
      shooting: you.shooting,
      scale: you.scale,
      invisible: you.invisible > 0,
      cards: you.cards,
      speedBoost: round(you.speedBoost),
      invincible: round(you.invincible),
      damageBoost: round(you.damageBoost),
      cooldownBoost: round(you.cooldownBoost),
      infiniteAmmo: round(you.infiniteAmmo),
      grenadeBoost: round(you.grenadeBoost),
      giant: round(you.giant),
      lifesteal: round(you.lifesteal),
      duel: round(you.duel),
      grenadeCooldown: round(you.grenadeCooldown),
      respawnIn: round(you.respawnTimer),
      protected: you.spawnProtect > 0,
      kills: you.kills,
      deaths: you.deaths,
      score: you.kills,
    };

    return {
      tick: this.tick,
      serverTime: Date.now(),
      phase: this.phase,
      timeLeft: round(this.timeLeft),
      winnerId: this.winnerId,
      players,
      bullets,
      grenades,
      drops,
      powerups,
      you: self,
      ...(this.phase === 'cardSelection'
        ? {
            cardProgress: {
              chose: [...this.players.values()].filter((player) => player.chosenCard).length,
              total: this.players.size,
              remaining: Math.max(0, Math.ceil(this.cardSelectionTimer)),
            },
          }
        : {}),
    };
  }

  private broadcastSnapshots(): void {
    for (const player of this.players.values()) {
      player.client.send({ t: 'snapshot', snap: this.buildSnapshot(player) });
    }
  }

  private emit(event: GameEvent): void {
    this.pendingEvents.push(event);
  }

  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;
    for (const event of this.pendingEvents) {
      for (const player of this.players.values()) {
        player.client.send({ t: 'event', e: event });
      }
    }
    this.pendingEvents = [];
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
