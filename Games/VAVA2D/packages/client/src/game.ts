import {
  TICK_DT,
  WEAPONS,
  CARD_INFO,
  lerp,
  lerpAngle,
} from '@vava/shared';
import type {
  GameEvent,
  ServerMessage,
  Snapshot,
} from '@vava/shared';
import { Camera } from './camera.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { InputManager } from './input.js';
import { SnapshotInterpolator } from './interpolation.js';
import { Connection } from './net.js';
import { playExplosion } from './audio.js';
import { Predictor } from './predictor.js';
import { Renderer } from './renderer.js';
import type { RenderBullet, RenderDrop, RenderGrenade, RenderPlayer, RenderPowerup } from './renderer.js';

type JoinRequest =
  | { t: 'create'; name: string; code?: string; htok?: string | null }
  | { t: 'join'; code: string; name: string; htok?: string | null };

export interface HubParams {
  room: string;
  name: string;
  create: boolean;
  hubUrl: string;
  htok: string | null;
}

export class Game {
  private readonly renderer: Renderer;
  private readonly input: InputManager;
  private readonly predictor = new Predictor();
  private readonly interpolator = new SnapshotInterpolator();
  private readonly camera = new Camera();
  private readonly effects = new Effects();

  private connection: Connection | null = null;
  private playerId: string | null = null;
  private playerName = 'Jogador';
  private joined = false;
  private connecting = false;
  private hadError = false;
  private latest: Snapshot | null = null;
  private hub: HubParams | null = null;

  private seq = 0;
  private accumulator = 0;
  private lastFrame = performance.now();
  private pingAccumulator = 0;
  private cameraPrimed = false;

  private hitMarkerUntil = 0;
  private hitMarkerKind: 'hit' | 'kill' = 'hit';
  private deathKiller = 'Abatido';
  private cardTimerHandle: number | null = null;
  private duelTimerHandle: number | null = null;
  private cardChosen = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly hud: Hud,
  ) {
    this.renderer = new Renderer(canvas);
    this.input = new InputManager(canvas);
    this.hud.bindMenu({
      create: (name) => this.connect({ t: 'create', name }),
      join: (code, name) => this.connect({ t: 'join', code, name }),
      leave: () => this.leaveSession(),
      reload: () => window.location.reload(),
    });

    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape' || !this.joined) return;
      event.preventDefault();
      this.leaveSession();
    });
  }

  /** Modo Hub (?hub=1): pula o menu e cria/entra na sala indicada. */
  startHub(hub: HubParams): void {
    this.hub = hub;
    this.hud.enterHubMode(hub.hubUrl);
    if (hub.create) {
      void this.connect({ t: 'create', name: hub.name, code: hub.room, htok: hub.htok });
    } else {
      // create=0 (demais membros): leva o htok do launch para o servidor
      // validar a identidade da partida (mesmo dono entra; outro é recusado).
      void this.connect({ t: 'join', code: hub.room, name: hub.name, htok: hub.htok });
    }
  }

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.loop);
  }

  private async connect(request: JoinRequest): Promise<void> {
    if (this.connecting || this.joined) return;
    this.connecting = true;
    this.hadError = false;
    this.playerName = request.name;

    const connection = new Connection();
    connection.onMessage = (message) => this.handleMessage(message);
    connection.onClose = () => this.handleClose(connection);

    try {
      await connection.connect();
      if (this.connection !== null) connection.close();
      this.connection = connection;
      connection.send(request);
    } catch (error) {
      this.connecting = false;
      connection.close();
      const message =
        error instanceof Error ? error.message : 'Não foi possível conectar no servidor.';
      this.hud.showMenuError(message);
    }
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'joined':
        this.playerId = message.playerId;
        this.joined = true;
        this.connecting = false;
        this.hadError = false;
        this.input.setEnabled(true);
        this.hud.showGame(this.playerName, message.roomCode);
        this.setRoomUrl(message.roomCode);
        break;

      case 'snapshot':
        this.onSnapshot(message.snap);
        break;

      case 'event':
        this.onEvent(message.e);
        break;

      case 'cardSelection':
        this.showCardSelection(message.cards, message.seconds);
        break;

      case 'error':
        this.hadError = true;
        this.connecting = false;
        if (this.hub) {
          // Retentativa legítima do mesmo launch nunca recebe CODE_TAKEN (o
          // servidor entra/resume direto pelo htok); CODE_TAKEN aqui é colisão
          // real com outra partida → erro honesto, SEM join cego (R2).
          this.hud.showHubError(message.message);
          this.connection?.close();
          this.connection = null;
          return;
        }
        this.hud.showMenuError(message.message);
        this.connection?.close();
        this.connection = null;
        break;

      default:
        break;
    }
  }

  private handleClose(connection: Connection): void {
    if (this.connection !== connection) return;
    this.connection = null;

    if (this.hub) {
      this.connecting = false;
      if (!this.hadError) {
        this.hud.showHubError(
          this.joined
            ? 'Conexão com a partida perdida.'
            : 'Conexão encerrada antes de entrar na partida.',
        );
      }
      this.joined = false;
      this.input.setEnabled(false);
      document.body.classList.remove('in-game');
      return;
    }

    if (this.joined) {
      this.input.setEnabled(false);
      this.hud.showConnectionLost();
      document.body.classList.remove('in-game');
      return;
    }

    this.connecting = false;
    if (!this.hadError) {
      this.hud.showMenuError(
        'Conexão encerrada. Verifique se o servidor está rodando e tente novamente.',
      );
    }
    this.hud.setMenuBusy(false);
  }

  private setRoomUrl(roomCode: string): void {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('sala', roomCode);
      window.history.replaceState(null, '', url);
    } catch {
      // ambiente sem URL normal
    }
  }

  private leaveSession(): void {
    if (!this.joined) return;

    const connection = this.connection;
    this.connection = null;
    connection?.close();

    this.joined = false;
    this.connecting = false;
    this.hadError = false;
    this.playerId = null;
    this.latest = null;
    this.seq = 0;
    this.accumulator = 0;
    this.pingAccumulator = 0;
    this.cameraPrimed = false;
    this.hitMarkerUntil = 0;

    this.input.setEnabled(false);
    this.predictor.reset();
    this.interpolator.reset();
    this.effects.clear();
    if (this.hub) {
      this.hud.showHubReturn();
      return;
    }
    this.hud.showMenu();

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('sala');
      window.history.replaceState(null, '', url);
    } catch {
      // ambiente sem URL normal
    }
  }

  private showCardSelection(cards: string[], seconds: number): void {
    const overlay = document.getElementById('card-overlay');
    const optionsEl = document.getElementById('card-options');
    const timerEl = document.getElementById('card-timer');
    if (!overlay || !optionsEl || !timerEl) return;

    optionsEl.replaceChildren();
    for (const card of cards) {
      const info = (CARD_INFO as any)[card];
      const option = document.createElement('div');
      option.className = 'card-option';
      const title = document.createElement('h3');
      title.textContent = info?.title ?? card;
      const desc = document.createElement('p');
      desc.textContent = info?.description ?? '';
      option.append(title, desc);
      option.addEventListener('click', () => {
        this.connection?.send({ t: 'chooseCard', card } as any);
        overlay.classList.add('hidden');
        if (this.cardTimerHandle !== null) {
          window.clearInterval(this.cardTimerHandle);
          this.cardTimerHandle = null;
        }
      });
      optionsEl.append(option);
    }

    overlay.classList.remove('hidden');
    let remaining = seconds;
    timerEl.textContent = String(Math.ceil(remaining));
    if (this.cardTimerHandle !== null) window.clearInterval(this.cardTimerHandle);
    this.cardTimerHandle = window.setInterval(() => {
      remaining -= 1;
      timerEl.textContent = String(Math.max(0, Math.ceil(remaining)));
      if (remaining <= 0) {
        if (this.cardTimerHandle !== null) {
          window.clearInterval(this.cardTimerHandle);
          this.cardTimerHandle = null;
        }
        overlay.classList.add('hidden');
      }
    }, 1000);
  }

  private onSnapshot(snapshot: Snapshot): void {
    const previous = this.latest;
    const snapCamera =
      !this.cameraPrimed ||
      (previous !== null &&
        ((previous.phase !== 'playing' && snapshot.phase === 'playing') ||
          (!previous.you.alive && snapshot.you.alive)));

    this.latest = snapshot;
    this.interpolator.push(snapshot, performance.now());
    this.predictor.applyServerState(snapshot.you);

    if (snapCamera) {
      const position = this.predictor.renderPosition();
      if (position) {
        this.camera.snapTo(
          position.x,
          position.y,
          snapshot.you.aim,
          this.renderer.width,
          this.renderer.height,
        );
        this.cameraPrimed = true;
      }
    }

    if (this.playerId) this.hud.update(snapshot, this.playerId);
  }

  private onEvent(event: GameEvent): void {
    switch (event.type) {
      case 'shot': {
        this.effects.spawnShot(event.x, event.y, event.aim);
        if (event.playerId === this.playerId) {
          const weapon = (WEAPONS as any)[this.latest?.you.weapon ?? 'pistol'];
          if (this.latest?.you.weapon === 'shotgun' && weapon) {
            const pellets = weapon.pellets ?? 6;
            const spread = weapon.spread ?? 0.22;
            for (let i = 0; i < pellets; i += 1) {
              const angle = event.aim + (i - (pellets - 1) / 2) * spread;
              this.effects.spawnTracer(event.x, event.y, angle);
            }
          } else {
            this.effects.spawnTracer(event.x, event.y, event.aim);
          }
          this.effects.addShake(0.1);
        }
        break;
      }

      case 'hit': {
        this.effects.spawnHit(event.x, event.y);
        if (event.by === this.playerId) {
          this.effects.spawnDamageNumber(event.x, event.y, event.damage);
          this.hitMarkerUntil = performance.now() + 170;
          this.hitMarkerKind = 'hit';
          this.effects.addShake(0.1);
        }
        if (event.targetId === this.playerId) {
          this.hud.flashDamage();
          this.effects.addShake(0.3);
        }
        break;
      }

      case 'kill': {
        const victim = this.latest?.players.find((player) => player.id === event.victimId);
        this.effects.spawnKill(event.x, event.y, victim?.color ?? '#e7b787');
        this.hud.addKill(
          event.killerName,
          event.victimName,
          event.killerId === this.playerId,
          event.victimId === this.playerId,
        );
        if (event.victimId === this.playerId) {
          this.deathKiller = event.killerName;
          this.hud.setDeathKiller(event.killerName);
          this.effects.addShake(0.55);
        }
        if (event.killerId === this.playerId) {
          this.hitMarkerUntil = performance.now() + 280;
          this.hitMarkerKind = 'kill';
          this.effects.addShake(0.22);
        }
        break;
      }

      case 'explosion': {
        this.effects.spawnExplosion(event.x, event.y, event.radius);
        this.effects.addShake(0.85);
        playExplosion();
        break;
      }

      case 'dropWarning': {
        this.effects.spawnDropWarning(event.x, event.y);
        this.hud.addSystem('Drop chegando em 5s');
        break;
      }

      case 'dropPickup': {
        const player = this.latest?.players.find((p) => p.id === event.playerId);
        const name = (WEAPONS as any)[event.weapon]?.name ?? event.weapon;
        this.hud.addSystem(`${player?.name ?? 'Alguém'} pegou ${name}`);
        this.effects.spawnHit(event.x, event.y);
        break;
      }

      case 'dropExpired': {
        this.hud.addSystem('Drop expirou');
        break;
      }

      case 'powerupPickup': {
        const player = this.latest?.players.find((p) => p.id === event.playerId);
        this.hud.addSystem(`${player?.name ?? 'Alguém'} pegou powerup`);
        this.effects.spawnHit(event.x, event.y);
        break;
      }

      case 'join':
        this.hud.addSystem(`${event.name} entrou na sala`);
        break;

      case 'leave':
        this.hud.addSystem(`${event.name} saiu da sala`);
        break;

      case 'matchStart':
        this.hud.resetFeed();
        this.effects.clear();
        this.hitMarkerUntil = 0;
        break;

      case 'matchEnd':
        break;

      case 'duelStart': {
        const opponent = event.a === this.playerId ? event.bName : event.aName;
        this.hud.addSystem(`Duelo até a morte: ${event.aName} × ${event.bName}`);
        this.showDuelBanner(opponent, event.seconds);
        break;
      }

      case 'duelEnd': {
        this.hideDuelBanner();
        if (event.reason === 'kill' && event.winnerName) {
          this.hud.addSystem(`${event.winnerName} venceu o duelo`);
        } else if (event.reason === 'timeout') {
          this.hud.addSystem('Duelo empatado — tempo esgotado');
        } else {
          this.hud.addSystem('Duelo cancelado');
        }
        break;
      }

      default:
        break;
    }
  }

  private showDuelBanner(opponent: string, seconds: number): void {
    if (this.duelTimerHandle !== null) window.clearInterval(this.duelTimerHandle);
    let remaining = seconds;
    this.hud.showDuel(`Duelo até a morte com ${opponent} — ${remaining}s`);
    this.duelTimerHandle = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.hud.showDuel(`Duelo até a morte com ${opponent} — LUTE!`);
        if (this.duelTimerHandle !== null) {
          window.clearInterval(this.duelTimerHandle);
          this.duelTimerHandle = null;
        }
      } else {
        this.hud.showDuel(`Duelo até a morte com ${opponent} — ${remaining}s`);
      }
    }, 1000);
  }

  private hideDuelBanner(): void {
    if (this.duelTimerHandle !== null) {
      window.clearInterval(this.duelTimerHandle);
      this.duelTimerHandle = null;
    }
    this.hud.hideDuel();
  }

  private loop = (now: number): void => {
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    if (this.joined) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= TICK_DT && steps < 5) {
        this.fixedUpdate();
        this.accumulator -= TICK_DT;
        steps += 1;
      }
      if (steps === 5) this.accumulator = 0;
    }

    this.effects.update(dt);
    this.predictor.update(dt);
    this.interpolator.advance(dt * 1000);

    this.pingAccumulator += dt;
    if (this.pingAccumulator > 0.3) {
      this.pingAccumulator = 0;
      if (this.connection) this.hud.setPing(this.connection.latency);
    }

    this.updateCamera(dt, now);
    this.render(now, dt);
    requestAnimationFrame(this.loop);
  };

  private fixedUpdate(): void {
    if (!this.connection || !this.latest) return;
    const state = this.predictor.state;
    if (!state) return;

    const aim = this.aimFromMouse();
    const input = this.input.sample(++this.seq, aim);
    if (this.latest.you.alive) this.predictor.step(input);
    this.connection.sendInput(input);
  }

  private aimFromMouse(): number {
    const state = this.predictor.state;
    if (!state) return 0;
    const mouse = this.input.getMouse();
    const worldX =
      this.camera.x + (mouse.x - this.renderer.width / 2) / this.camera.scale;
    const worldY =
      this.camera.y + (mouse.y - this.renderer.height / 2) / this.camera.scale;
    return Math.atan2(worldY - state.y, worldX - state.x);
  }

  private updateCamera(dt: number, now: number): void {
    const position = this.predictor.renderPosition();
    const aim = this.predictor.state?.aim ?? 0;
    if (this.joined && position) {
      this.camera.follow(dt, position.x, position.y, aim, this.renderer.width, this.renderer.height);
    } else {
      this.camera.idle(now, this.renderer.width, this.renderer.height);
    }
  }

  private render(now: number, dt: number): void {
    const pair = this.interpolator.sample();
    const players = new Map<string, RenderPlayer>();
    const bullets: RenderBullet[] = [];
    const grenades: RenderGrenade[] = [];
    const drops: RenderDrop[] = [];
    const powerups: RenderPowerup[] = [];
    const dropTargets: { x: number; y: number }[] = [];

    if (pair) {
      for (const player of pair.after.players) {
        const before = pair.before.players.find((candidate) => candidate.id === player.id);
        const canInterpolate = Boolean(before && before.alive && player.alive);
        players.set(player.id, {
          id: player.id,
          name: player.name,
          color: player.color,
          x: canInterpolate ? lerp(before!.x, player.x, pair.t) : player.x,
          y: canInterpolate ? lerp(before!.y, player.y, pair.t) : player.y,
          aim:
            canInterpolate && before
              ? lerpAngle(before.aim, player.aim, pair.t)
              : player.aim,
          health: player.health,
          alive: player.alive,
          protected: player.protected,
          weapon: player.weapon,
          shooting: player.shooting,
          scale: player.scale,
          invincible: player.invincible,
          invisible: player.invisible,
          isSelf: player.id === this.playerId,
          duel: player.duel,
        });
      }

      for (const bullet of pair.after.bullets) {
        const before = pair.before.bullets.find((candidate) => candidate.id === bullet.id);
        bullets.push({
          id: bullet.id,
          x: before ? lerp(before.x, bullet.x, pair.t) : bullet.x,
          y: before ? lerp(before.y, bullet.y, pair.t) : bullet.y,
          angle: bullet.angle,
        });
      }

      for (const grenade of pair.after.grenades) {
        const before = pair.before.grenades.find((candidate) => candidate.id === grenade.id);
        grenades.push({
          id: grenade.id,
          x: before ? lerp(before.x, grenade.x, pair.t) : grenade.x,
          y: before ? lerp(before.y, grenade.y, pair.t) : grenade.y,
        });
      }

      for (const drop of pair.after.drops) {
        drops.push({ id: drop.id, x: drop.x, y: drop.y });
        dropTargets.push({ x: drop.x, y: drop.y });
      }

      for (const powerup of pair.after.powerups) {
        powerups.push({ id: powerup.id, x: powerup.x, y: powerup.y, type: powerup.type });
      }
    }

    const selfPosition = this.predictor.renderPosition();
    if (this.latest && this.playerId && selfPosition) {
      const self = players.get(this.playerId);
      const aim = this.aimFromMouse();
      if (self) {
        self.x = selfPosition.x;
        self.y = selfPosition.y;
        self.aim = aim;
        self.health = this.latest.you.health;
        self.alive = this.latest.you.alive;
        self.protected = this.latest.you.protected;
        self.weapon = this.latest.you.weapon;
        self.shooting = this.latest.you.shooting;
        self.scale = this.latest.you.scale;
        self.invincible = this.latest.you.invincible > 0;
        self.invisible = this.latest.you.invisible;
      } else {
        const roster = this.latest.players.find((player) => player.id === this.playerId);
        if (roster) {
          players.set(this.playerId, {
            ...roster,
            x: selfPosition.x,
            y: selfPosition.y,
            aim,
            health: this.latest.you.health,
            alive: this.latest.you.alive,
            protected: this.latest.you.protected,
            weapon: this.latest.you.weapon,
            shooting: this.latest.you.shooting,
            scale: this.latest.you.scale,
            invincible: this.latest.you.invincible > 0,
            invisible: this.latest.you.invisible,
            isSelf: true,
            duel: roster.duel,
          });
        }
      }
    }

    for (const marker of this.effects.getDropMarkers()) dropTargets.push(marker);

    const alive = this.latest?.you.alive === true;

    const duelActive = pair !== null && pair.after.players.some((player) => player.duel);    const showCrosshair = this.joined && alive && this.latest?.phase !== 'ended';
    const hitMarker = now < this.hitMarkerUntil ? this.hitMarkerKind : null;

    this.renderer.render(
      {
        dt,
        now,
        camera: { x: this.camera.x, y: this.camera.y, scale: this.camera.scale },
        players: [...players.values()],
        bullets,
        grenades,
        drops,
        powerups,
        dropTargets,
        selfId: this.playerId,
        mouse: this.input.getMouse(),
        hitMarker,
        showCrosshair,
        duelActive,
      },
      this.effects,
    );
  }
}
