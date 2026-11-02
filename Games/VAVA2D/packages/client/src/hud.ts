import { GRENADE, PISTOL, PLAYER, WEAPONS } from '@vava/shared';
import type { Snapshot } from '@vava/shared';

interface MenuHandlers {
  create: (name: string) => void;
  join: (code: string, name: string) => void;
  leave: () => void;
  reload: () => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} não encontrado.`);
  return element as T;
}

export class Hud {
  private readonly menuScreen = byId('menu-screen');
  private readonly hud = byId('hud');
  private readonly nameInput = byId<HTMLInputElement>('name-input');
  private readonly codeInput = byId<HTMLInputElement>('room-code-input');
  private readonly createButton = byId<HTMLButtonElement>('create-room');
  private readonly joinButton = byId<HTMLButtonElement>('join-room');
  private readonly menuError = byId('menu-error');
  private readonly roomCode = byId('hud-room-code');
  private readonly timer = byId('hud-timer');
  private readonly ping = byId('hud-ping');
  private readonly healthFill = byId('health-fill');
  private readonly healthValue = byId('health-value');
  private readonly dashFill = byId('dash-fill');
  private readonly buffs = byId('buffs');
  private readonly grenadeFill = byId('grenade-fill');
  private readonly grenadeValue = byId('grenade-value');
  private readonly ammoPips = byId('ammo-pips');
  private readonly weaponName = byId('weapon-name');
  private readonly ammoValue = byId('ammo-value');
  private readonly ammoMax = byId('ammo-max');
  private readonly reloadRow = byId('reload-row');
  private readonly reloadFill = byId('reload-fill');
  private readonly reloadHint = byId('reload-hint');
  private readonly selfName = byId('self-name');
  private readonly selfColor = byId('self-color');
  private readonly leaderboardList = byId<HTMLOListElement>('leaderboard-list');
  private readonly killfeed = byId('killfeed');
  private readonly waitingBanner = byId('waiting-banner');
  private readonly waitingCount = byId('waiting-count');
  private readonly copyHint = byId('copy-hint');
  private readonly deathOverlay = byId('death-overlay');
  private readonly deathKiller = byId('death-killer');
  private readonly respawnCount = byId('respawn-count');
  private readonly matchEndOverlay = byId('match-end-overlay');
  private readonly matchWinner = byId('match-winner');
  private readonly finalScores = byId<HTMLOListElement>('final-scores');
  private readonly nextMatchCount = byId('next-match-count');
  private readonly connectionLost = byId('connection-lost');
  private readonly damageFlash = byId('damage-flash');
  private readonly duelBanner = byId('duel-banner');
  private readonly duelText = byId('duel-text');
  private readonly cardBanner = byId('card-banner');
  private readonly cardBannerText = byId('card-banner-text');

  private currentRoomCode = '';
  private lastLeaderboard = '';
  private lastFinalScores = '';
  private lastAmmo = -1;
  private lastWeapon: string = 'pistol';
  private lastPing = -1;
  private lastKiller = 'Abatido';
  private damageTimeout: number | null = null;
  private feedEntries: HTMLElement[] = [];
  private readonly lanLinks = byId('lan-links');

  private hubUrl: string | null = null;
  private hubOverlay: HTMLElement | null = null;
  private hubOverlayMessage: HTMLElement | null = null;
  private hubReturnBound = false;

  private handlers: MenuHandlers | null = null;

  constructor() {
    this.ammoMax.textContent = String(PISTOL.magSize);
    this.buildPips(PISTOL.magSize);
    this.bindSelfControls();
    void this.loadLanLinks();
  }

  bindMenu(handlers: MenuHandlers): void {
    this.handlers = handlers;
    const savedName = localStorage.getItem('vava2d.name') ?? '';
    this.nameInput.value = savedName;

    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.createRoom();
    });
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value
        .toUpperCase()
        .replace(/[^A-HJ-NP-Z2-9]/g, '')
        .slice(0, 4);
    });
    this.codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.joinRoom();
    });

    this.createButton.addEventListener('click', () => this.createRoom());
    this.joinButton.addEventListener('click', () => this.joinRoom());
    byId<HTMLButtonElement>('leave-room').addEventListener('click', handlers.leave);
    byId<HTMLButtonElement>('reload-page').addEventListener('click', handlers.reload);
  }

  prefillRoom(code: string | null): void {
    if (!code) return;
    const clean = code.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
    if (clean.length > 0) {
      this.codeInput.value = clean;
      this.codeInput.focus();
    }
  }

  setMenuBusy(busy: boolean): void {
    this.createButton.disabled = busy;
    this.joinButton.disabled = busy;
    this.nameInput.disabled = busy;
    this.codeInput.disabled = busy;
    this.createButton.textContent = busy ? 'Conectando…' : 'Criar sala';
  }

  showMenuError(message: string): void {
    this.menuError.textContent = message;
    this.setMenuBusy(false);
  }

  clearMenuError(): void {
    this.menuError.textContent = '';
  }

  showGame(name: string, roomCode: string): void {
    this.hideHubStatus();
    this.currentRoomCode = roomCode;
    this.roomCode.textContent = roomCode;
    this.selfName.textContent = name;    this.menuScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.connectionLost.classList.add('hidden');
    document.body.classList.add('in-game');
    document.title = `VAVA2D — sala ${roomCode}`;
    this.clearMenuError();
    this.setMenuBusy(false);
    this.resetFeed();
    this.lastLeaderboard = '';
    this.lastFinalScores = '';
    this.lastAmmo = -1;
    this.lastWeapon = 'pistol';
    this.lastPing = -1;
    this.showDeath(false);
    this.matchEndOverlay.classList.add('hidden');
    this.waitingBanner.classList.add('hidden');
  }

  showMenu(): void {
    this.hud.classList.add('hidden');
    this.menuScreen.classList.remove('hidden');
    this.connectionLost.classList.add('hidden');
    this.deathOverlay.classList.add('hidden');
    this.matchEndOverlay.classList.add('hidden');
    this.waitingBanner.classList.add('hidden');
    document.body.classList.remove('in-game');
    document.title = 'VAVA2D — arena top-down';
    this.codeInput.value = this.currentRoomCode;
    this.setMenuBusy(false);
    this.clearMenuError();
    this.nameInput.focus();
  }

  showConnectionLost(): void {
    this.connectionLost.classList.remove('hidden');
    document.body.classList.remove('in-game');
  }

  /** Modo Hub (?hub=1): esconde o menu (sem pedir apelido) e mostra status. */
  enterHubMode(hubUrl: string): void {
    this.hubUrl = hubUrl || null;
    this.menuScreen.classList.add('hidden');
    this.clearMenuError();
    this.setMenuBusy(false);
    document.title = 'VAVA2D — partida do Hub';
    this.showHubStatus('Conectando à partida…');
  }

  showHubStatus(message: string): void {
    const { overlay, messageEl } = this.ensureHubOverlay();
    messageEl.textContent = message;
    overlay.querySelector('.hub-return')?.remove();
    overlay.classList.remove('hidden');
  }

  showHubError(message: string): void {
    const { overlay, messageEl } = this.ensureHubOverlay();
    messageEl.textContent = message;
    this.attachHubReturn(overlay);
    overlay.classList.remove('hidden');
  }

  /** Caminho de volta ao Hub (fim de partida ou saída): sem menu/apelido. */
  showHubReturn(message = 'Volte à sala do Hub para continuar.'): void {
    const { overlay, messageEl } = this.ensureHubOverlay();
    messageEl.textContent = message;
    this.attachHubReturn(overlay);
    overlay.classList.remove('hidden');
  }

  hideHubStatus(): void {
    this.hubOverlay?.classList.add('hidden');
  }

  private ensureHubOverlay(): { overlay: HTMLElement; messageEl: HTMLElement } {
    if (this.hubOverlay && this.hubOverlayMessage) {
      return { overlay: this.hubOverlay, messageEl: this.hubOverlayMessage };
    }
    const overlay = document.createElement('div');
    overlay.id = 'hub-overlay';
    overlay.className = 'center-overlay';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'MODO HUB';
    const title = document.createElement('h2');
    title.textContent = 'VAVA2D';
    const messageEl = document.createElement('p');
    messageEl.className = 'muted';
    panel.append(eyebrow, title, messageEl);
    overlay.append(panel);
    overlay.classList.add('hidden');
    document.getElementById('app')?.append(overlay);
    this.hubOverlay = overlay;
    this.hubOverlayMessage = messageEl;
    return { overlay, messageEl };
  }

  private attachHubReturn(overlay: HTMLElement): void {
    overlay.querySelector('.hub-return')?.remove();
    if (!this.hubUrl) return;
    const link = document.createElement('a');
    link.className = 'btn primary hub-return';
    link.href = this.hubUrl;
    link.target = '_top';
    link.rel = 'noopener';
    link.textContent = 'Voltar à sala';
    link.style.marginTop = '12px';
    overlay.querySelector('.panel')?.append(link);
  }

  private ensureMatchEndReturn(): void {
    if (!this.hubUrl || this.hubReturnBound) return;
    this.hubReturnBound = true;
    const link = document.createElement('a');
    link.className = 'btn primary';
    link.href = this.hubUrl;
    link.target = '_top';
    link.rel = 'noopener';
    link.textContent = 'Voltar à sala';
    link.style.marginTop = '12px';
    this.matchEndOverlay.querySelector('.panel')?.append(link);
  }

  update(snapshot: Snapshot, playerId: string): void {
    const self = snapshot.players.find((player) => player.id === playerId);
    if (self) {
      this.selfName.textContent = self.name;
      this.selfColor.style.background = self.color;
      this.selfColor.style.color = self.color;
    }

    const you = snapshot.you;
    const healthPercent = Math.max(0, Math.min(100, you.health));
    this.healthFill.style.width = `${healthPercent}%`;
    this.healthFill.style.background =
      healthPercent > 55
        ? 'linear-gradient(90deg, #69b95f, #9ade86)'
        : healthPercent > 28
          ? 'linear-gradient(90deg, #d6a24b, #f0c56b)'
          : 'linear-gradient(90deg, #c54b43, #ef7c6f)';
    this.healthValue.textContent = String(Math.round(you.health));

    const dashReady = Math.max(
      0,
      Math.min(1, 1 - you.dashCooldown / PLAYER.dashCooldown),
    );
    this.dashFill.style.width = `${dashReady * 100}%`;
    this.dashFill.classList.toggle('cooling', dashReady < 0.999);

    const grenadeReady = Math.max(
      0,
      Math.min(1, 1 - you.grenadeCooldown / GRENADE.cooldown),
    );
    this.grenadeFill.style.width = `${grenadeReady * 100}%`;
    this.grenadeFill.classList.toggle('cooling', grenadeReady < 0.999);
    this.grenadeValue.textContent =
      you.grenadeCooldown > 0 ? `${Math.ceil(you.grenadeCooldown)}s` : 'PRONTO';
    this.grenadeValue.classList.toggle('ready', you.grenadeCooldown <= 0);

    if (you.weapon !== this.lastWeapon) {
      this.lastWeapon = you.weapon;
      const weapon = (WEAPONS as any)[you.weapon];
      const magSize = weapon?.magSize ?? PISTOL.magSize;
      this.ammoMax.textContent = String(magSize);
      this.buildPips(magSize);
      this.weaponName.textContent = weapon?.name ?? you.weapon;
      this.lastAmmo = -1;
    }

    if (you.ammo !== this.lastAmmo) {
      this.lastAmmo = you.ammo;
      this.ammoValue.textContent = String(you.ammo);
      this.ammoValue.classList.toggle('low', you.ammo <= 3);
      this.updatePips(you.ammo);
    }

    const reloading = you.reloading > 0;
    this.reloadRow.classList.toggle('hidden', !reloading);
    if (reloading) {
      const progress = Math.max(0, Math.min(1, 1 - you.reloading / PISTOL.reloadSeconds));
      this.reloadFill.style.width = `${progress * 100}%`;
    }
    this.reloadHint.classList.toggle(
      'hidden',
      reloading || you.ammo >= PISTOL.magSize || !you.alive,
    );

    this.updateTimer(snapshot);
    this.updateLeaderboard(snapshot, playerId);
    this.updateWaiting(snapshot);
    this.updateDeath(snapshot, you.alive);
    this.updateMatchEnd(snapshot);
    this.updateBuffs(snapshot.you);
  }

  setPing(latency: number): void {
    const rounded = Math.round(latency);
    if (rounded === this.lastPing) return;
    this.lastPing = rounded;
    this.ping.textContent = String(rounded);
  }

  setDeathKiller(name: string): void {
    this.lastKiller = name;
    this.deathKiller.textContent = name;
  }

  showDuel(text: string): void {
    this.duelText.textContent = text;
    this.duelBanner.classList.remove('hidden');
  }

  hideDuel(): void {
    this.duelBanner.classList.add('hidden');
  }

  addKill(
    killerName: string,
    victimName: string,
    selfKiller: boolean,
    selfVictim: boolean,
  ): void {
    const entry = document.createElement('div');
    entry.className = `feed-entry${selfKiller || selfVictim ? ' self' : ''}`;

    const killer = document.createElement('b');
    killer.textContent = killerName;
    const victim = document.createElement('b');
    victim.textContent = victimName;

    entry.append(killer, document.createTextNode(' eliminou '), victim);
    this.pushFeed(entry);
  }

  addSystem(text: string): void {
    const entry = document.createElement('div');
    entry.className = 'feed-entry system';
    entry.textContent = text;
    this.pushFeed(entry);
  }

  resetFeed(): void {
    this.killfeed.replaceChildren();
    this.feedEntries = [];
    this.lastKiller = 'Abatido';
    this.deathKiller.textContent = 'Abatido';
  }

  flashDamage(): void {
    this.damageFlash.classList.add('active');
    if (this.damageTimeout !== null) window.clearTimeout(this.damageTimeout);
    this.damageTimeout = window.setTimeout(() => {
      this.damageFlash.classList.remove('active');
      this.damageTimeout = null;
    }, 120);
  }

  private createRoom(): void {
    if (!this.handlers) return;
    const name = this.resolvedName();
    localStorage.setItem('vava2d.name', name);
    this.clearMenuError();
    this.setMenuBusy(true);
    this.handlers.create(name);
  }

  private joinRoom(): void {
    if (!this.handlers) return;
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      this.showMenuError('Digite o código de 4 letras da sala.');
      return;
    }
    const name = this.resolvedName();
    localStorage.setItem('vava2d.name', name);
    this.clearMenuError();
    this.setMenuBusy(true);
    this.handlers.join(code, name);
  }

  private resolvedName(): string {
    const value = this.nameInput.value.trim().slice(0, 16);
    return value.length > 0 ? value : 'Jogador';
  }

  private bindSelfControls(): void {
    byId<HTMLButtonElement>('copy-link').addEventListener('click', () => {
      const link = `${window.location.origin}${window.location.pathname}?sala=${this.currentRoomCode}`;
      const done = (): void => {
        this.copyHint.textContent = 'Link copiado!';
        window.setTimeout(() => {
          this.copyHint.textContent = '';
        }, 2200);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).then(done).catch(() => {
          this.copyHint.textContent = 'Copie a URL da página.';
        });
      } else {
        this.copyHint.textContent = 'Copie a URL da página.';
      }
    });
  }

  private buildPips(count: number): void {
    this.ammoPips.replaceChildren();
    for (let i = 0; i < count; i += 1) {
      const pip = document.createElement('span');
      pip.className = 'pip';
      this.ammoPips.append(pip);
    }
  }

  private updatePips(ammo: number): void {
    const pips = this.ammoPips.children;
    for (let i = 0; i < pips.length; i += 1) {
      pips[i]?.classList.toggle('empty', i >= ammo);
    }
  }

  private updateTimer(snapshot: Snapshot): void {
    if (snapshot.phase === 'ended') {
      this.timer.textContent = 'FIM';
      this.timer.classList.remove('urgent');
      return;
    }
    if (snapshot.phase === 'waiting') {
      this.timer.textContent = '--:--';
      this.timer.classList.remove('urgent');
      return;
    }
    const total = Math.max(0, Math.ceil(snapshot.timeLeft));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    this.timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    this.timer.classList.toggle('urgent', total <= 30);
  }

  private updateLeaderboard(snapshot: Snapshot, playerId: string): void {
    const sorted = [...snapshot.players].sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name),
    );
    const signature = sorted
      .map((player) => `${player.id}:${player.kills}:${player.deaths}:${player.name}`)
      .join('|');
    if (signature === this.lastLeaderboard) return;
    this.lastLeaderboard = signature;

    this.leaderboardList.replaceChildren();
    sorted.forEach((player, index) => {
      const item = document.createElement('li');
      if (player.id === playerId) item.classList.add('self');

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = String(index + 1);

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = player.color;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = player.name;

      const kills = document.createElement('span');
      kills.className = 'kills';
      kills.textContent = String(player.kills);

      item.append(rank, dot, name, kills);
      this.leaderboardList.append(item);
    });
  }

  private updateWaiting(snapshot: Snapshot): void {
    const waiting = snapshot.phase === 'waiting';
    this.waitingBanner.classList.toggle('hidden', !waiting);
    if (waiting) {
      this.waitingCount.textContent = `${snapshot.players.length}/8`;
    }
  }

  private updateDeath(snapshot: Snapshot, alive: boolean): void {
    const show = !alive && snapshot.phase !== 'ended';
    this.showDeath(show);
    if (show) {
      this.respawnCount.textContent = Math.max(0, snapshot.you.respawnIn)
        .toFixed(1)
        .replace('.', ',');
    }
  }

  private showDeath(show: boolean): void {
    this.deathOverlay.classList.toggle('hidden', !show);
    if (show) this.deathKiller.textContent = this.lastKiller;
  }

  private updateMatchEnd(snapshot: Snapshot): void {
    const ended = snapshot.phase === 'ended';
    this.matchEndOverlay.classList.toggle('hidden', !ended);
    if (!ended) return;
    this.ensureMatchEndReturn();

    this.nextMatchCount.textContent = String(Math.max(0, Math.ceil(snapshot.timeLeft)));
    const winner = snapshot.winnerId
      ? snapshot.players.find((player) => player.id === snapshot.winnerId)
      : null;
    this.matchWinner.textContent = winner ? `${winner.name} venceu` : 'Empate';

    const sorted = [...snapshot.players].sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name),
    );
    const signature = sorted
      .map((player) => `${player.id}:${player.kills}:${player.deaths}`)
      .join('|');
    if (signature === this.lastFinalScores) return;
    this.lastFinalScores = signature;

    this.finalScores.replaceChildren();
    sorted.forEach((player, index) => {
      const item = document.createElement('li');
      if (player.id === snapshot.winnerId) item.classList.add('winner');

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `${index + 1}º`;

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = player.color;

      const name = document.createElement('span');
      name.textContent = player.name;

      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `${player.kills} abates`;

      item.append(rank, dot, name, score);
      this.finalScores.append(item);
    });
  }

  private async loadLanLinks(): Promise<void> {
    try {
      const response = await fetch('/lan');
      if (!response.ok) throw new Error('falha');
      const data = (await response.json()) as { addresses?: string[] };
      const addresses = data.addresses ?? [];
      if (addresses.length === 0) {
        this.lanLinks.textContent = 'Nenhum IP de rede detectado.';
        return;
      }
      const port = window.location.port;
      const links = addresses.map((ip) => {
        const anchor = document.createElement('a');
        anchor.href = `${window.location.protocol}//${ip}${port ? `:${port}` : ''}${window.location.pathname}`;
        anchor.textContent = anchor.href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        return anchor;
      });
      this.lanLinks.replaceChildren();
      for (const link of links) {
        const line = document.createElement('div');
        line.append(link);
        this.lanLinks.append(line);
      }
    } catch {
      this.lanLinks.textContent = 'Não foi possível obter o IP da rede.';
    }
  }

  private updateBuffs(you: Snapshot['you']): void {
    const active: string[] = [];
    if (you.speedBoost > 0) active.push(`Vel ${you.speedBoost.toFixed(1)}s`);
    if (you.invincible > 0) active.push(`Escudo ${you.invincible.toFixed(1)}s`);
    if (you.damageBoost > 0) active.push(`Dano ${you.damageBoost.toFixed(1)}s`);
    if (you.cooldownBoost > 0) active.push(`CD ${you.cooldownBoost.toFixed(1)}s`);
    if (you.infiniteAmmo > 0) active.push(`Munição ∞ ${you.infiniteAmmo.toFixed(1)}s`);
    if (you.grenadeBoost > 0) active.push(`Granada ∞ ${you.grenadeBoost.toFixed(1)}s`);
    if (you.giant > 0) active.push(`Gigante ${you.giant.toFixed(1)}s`);
    if (you.lifesteal > 0) active.push(`Lifesteal ${you.lifesteal.toFixed(1)}s`);
    if (you.duel > 0) active.push('Duelo');
    this.buffs.textContent = active.join(' · ');
    this.buffs.classList.toggle('hidden', active.length === 0);
  }

  private pushFeed(entry: HTMLElement): void {
    this.feedEntries.push(entry);
    this.killfeed.append(entry);
    while (this.feedEntries.length > 5) {
      const oldest = this.feedEntries.shift();
      oldest?.remove();
    }
    window.setTimeout(() => {
      entry.remove();
      this.feedEntries = this.feedEntries.filter((item) => item !== entry);
    }, 6000);
  }
}
