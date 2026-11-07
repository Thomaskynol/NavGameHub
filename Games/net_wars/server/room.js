import {
  MAX_SPEED, ACCEL, ROLL_SPEED, LASER_SPEED, LASER_LIFE, LASER_DAMAGE,
  LASER_COOLDOWN_S, CADENCE_MULT, OVERLOAD_MULT, TRIPLE_SPREAD, TRIPLE_SIDE_MULT,
  MISSILE_DAMAGE, MISSILE_COOLDOWN_S, MISSILE_SPEED, MISSILE_TURN, MISSILE_LIFE,
  MISSILE_LOCK_RANGE, MISSILE_LOCK_COS,
  BOOST_MAX, BOOST_DRAIN, BOOST_REGEN, PROPULSION_REGEN_MULT, BOOST_MULT,
  STATION, ASTEROIDS, IMPACT_MIN, IMPACT_MAX, IMPACT_COOLDOWN_S, WORLD_BOUND,
  SHIP_HP, SHIP_RADIUS, SHIP_RADIUS as _R, RESPAWN_S, PROTECT_S, RECONNECT_S,
  POWERUP_SPOTS, POWERUP_RADIUS, POWERUP_RESPAWN_S, EFFECT_LEN_S,
  REPAIR_AMOUNT, SHIELD_MAX, WAVE_GAP_S, MAX_BOTS_ALIVE, BOT_AIM_ERR,
  BOT_FIRE_RANGE, MAX_PLAYERS, TEAMS, INPUT_STALE_MS,
  TP_YAW_RATE, TP_PITCH_RATE,
} from '../shared/constants.js';
import { randomBytes } from 'node:crypto';
import { validHtok } from '../shared/protocol.js';
import { forward, wrapPi, normalizeAngles } from '../shared/orient.js';
import { stepNose } from '../shared/turn.js';
import { segSphereT, segHitsSphere, pushOutOfObstacles, obstacles } from '../shared/physics.js';

void _R;

export { forward }; // compat: quem importava forward() de room.js continua válido

let seq = 0;
const rnd = (n) => (Math.random() * 2 - 1) * n;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const OBSTACLES = () => obstacles();
function losBlocked(ax, ay, az, bx, by, bz) {
  for (const o of OBSTACLES()) {
    if (segHitsSphere(ax, ay, az, bx, by, bz, o.x, o.y, o.z, o.r)) return true;
  }
  return false;
}

const hasEff = (s, key, now) => !!s.effects[key] && s.effects[key] > now;

// Dano/cadência efetivos do laser p/ efeitos ativos (base do teste ~2x combinado).
export function laserStats(effects, now = Infinity) {
  const fake = { effects };
  const over = hasEff(fake, 'overload', now) ? OVERLOAD_MULT : 1;
  const cd = (hasEff(fake, 'cadence', now) ? CADENCE_MULT : 1) * LASER_COOLDOWN_S;
  return { damage: LASER_DAMAGE * over, cooldown: cd };
}

export class Room {
  constructor(name, matchLenS, opts = {}) {
    this.name = name;
    this.mode = opts.mode || 'ffa'; // ffa | teams | survival
    this.matchLenS = matchLenS;
    this.reconnectS = opts.reconnectS || RECONNECT_S; // override p/ teste
    this.ships = new Map(); // id -> ship (inclui bots, fantasmas p/ reconnect, waiting)
    this.lasers = [];
    this.missiles = [];
    this.inputs = new Map(); // id -> último input (só humanos conectados)
    this.powerups = POWERUP_SPOTS.map((p) => ({ ...p, active: true, respawnAt: 0 }));
    // Lobby autoritativo: a sala nasce no hangar; o timer/on só começam em
    // start() (pedido do host). Sem "partida fantasma" enquanto ninguém voa.
    this.state = 'lobby'; // lobby | playing | over
    this.endsAt = null; // definido em start() (survival fica null)
    this.over = false;
    this.overSent = false;
    this.result = null; // {winner, draw, defeat}
    this.hubOwner = null; // id do criador (dono via Hub)
    this.htok = null; // token opcional do dono (CODE_TAKEN se divergir)
    this.wave = 0;
    this.waveAt = 0; // próxima wave (após gap)
    this.joinSeq = 0;
    this.leftScores = new Map(); // id -> {name,kills,deaths,team} de quem saiu
  }

  // Spawn válido: dentro da arena, fora dos obstáculos e separado das demais
  // naves. Tentativas aleatórias + busca determinística finita (fallback).
  spawnPos(cx = 0, cy = 0, cz = 0, spread = 30, minSep = SHIP_RADIUS * 2 + 1) {
    const ok = (x, y, z) => {
      if (Math.abs(x) > WORLD_BOUND - 8 || Math.abs(y) > WORLD_BOUND - 8 || Math.abs(z) > WORLD_BOUND - 8) return false;
      for (const o of OBSTACLES()) {
        if (Math.hypot(x - o.x, y - o.y, z - o.z) < o.r + SHIP_RADIUS + 2) return false;
      }
      for (const s of this.ships.values()) {
        if (s.goneAt || !s.alive) continue;
        if (Math.hypot(x - s.x, y - s.y, z - s.z) < minSep) return false;
      }
      return true;
    };
    for (let i = 0; i < 48; i++) {
      const x = cx + rnd(spread), y = cy + rnd(spread), z = cz + rnd(spread);
      if (ok(x, y, z)) return { x, y, z };
    }
    // fallback determinístico (espiral em grade) — sempre acha posição finita
    for (let ring = 1; ring <= 64; ring++) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = cx + Math.cos(a) * ring * 6, z = cz + Math.sin(a) * ring * 6;
        for (const dy of [0, 12, -12, 24, -24]) {
          const y = cy + dy;
          if (ok(x, y, z)) return { x, y, z };
        }
      }
    }
    return { x: clamp(cx, -WORLD_BOUND + 8, WORLD_BOUND - 8), y: clamp(cy, -WORLD_BOUND + 8, WORLD_BOUND - 8), z: clamp(cz, -WORLD_BOUND + 8, WORLD_BOUND - 8) };
  }

  humans() {
    return [...this.ships.values()].filter((s) => !s.bot);
  }

  activeHumans() {
    return this.humans().filter((s) => !s.goneAt && !s.waitNext);
  }

  get hostId() {
    let best = null;
    for (const s of this.ships.values()) {
      if (s.bot || s.goneAt) continue;
      if (!best || s.joinSeq < best.joinSeq) best = s;
    }
    return best ? best.id : null;
  }

  // token imprevisível de resume (server-side, nunca vai ao snapshot)
  // crypto.randomBytes: Math.random não é imprevisível p/ segredo de sessão.
  mkResumeToken() {
    return randomBytes(24).toString('base64url');
  }

  allies(a, b) {
    if (this.mode === 'teams') return !!a.team && a.team === b.team;
    if (this.mode === 'survival') return !a.bot && !b.bot; // coop: humano não fere humano
    return false; // ffa: todos inimigos
  }

  join(id, name, color, opts = {}) {
    // Reconexão 30s: retoma fantasma sem duplicar (kills/placar preservados).
    // IDs sequenciais (pN) não autorizam: exige token imprevisível de resume;
    // se a sala tem dono via Hub (htok), exige htok igual também.
    if (opts.resume && this.ships.has(opts.resume)) {
      const g = this.ships.get(opts.resume);
      if (g.goneAt && !g.bot) {
        if (this.htok && opts.htok !== this.htok) return { error: 'CODE_TAKEN' };
        if (!g.resumeToken || opts.resumeToken !== g.resumeToken) return { error: 'DUP' };
        this.ships.delete(opts.resume);
        g.id = id;
        g.goneAt = 0;
        g.name = name || g.name;
        this.ships.set(id, g);
        if (this.hubOwner === opts.resume) this.hubOwner = id;
        return { ok: true, resumed: true, resumeToken: g.resumeToken };
      }
      return { error: 'DUP' };
    }
    if (this.htok && opts.htok !== this.htok) return { error: 'CODE_TAKEN' };
    const humans = this.humans().length;
    if (humans >= MAX_PLAYERS) return { error: 'FULL' }; // 13ª rejeitada
    const now = Date.now();
    const team = this.mode === 'teams' ? this.pickTeam(opts.team) : null;
    // Late-join: teams/survival com partida em curso esperam próxima partida/wave.
    // FFA spawna direto. Pré-partida (<2 ativos) spawna direto em qualquer modo.
    const waitNext =
      this.state === 'playing' && !this.over && this.mode !== 'ffa' && this.activeHumans().length >= 2;
    const sp = this.spawnPos(0, 0, 0, 30);
    const ship = {
      id, name, color, team, bot: false,
      x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, roll: 0,
      hp: SHIP_HP, shield: 0, alive: !waitNext, waitNext,
      respawnAt: 0, protectUntil: 0, kills: 0, deaths: 0, ready: false,
      boost: BOOST_MAX, weapon: 1,
      lastShotAt: 0, missileReadyAt: 0, lastImpactAt: 0,
      effects: {}, goneAt: 0, warn: false,
      joinSeq: ++this.joinSeq,
      resumeToken: '',
    };
    ship.resumeToken = this.mkResumeToken();
    this.ships.set(id, ship);
    if (!this.hubOwner) {
      this.hubOwner = id;
      // dono opaco do Hub: só formato válido vira dono (resto = sem dono)
      if (validHtok(opts.htok)) this.htok = opts.htok;
    }
    if (!waitNext && this.mode !== 'survival') {
      ship.protectUntil = now + PROTECT_S * 1000;
    }
    return { ok: true, waitNext, resumeToken: ship.resumeToken };
  }

  pickTeam(hint) {
    const count = (t) => [...this.ships.values()].filter((s) => !s.bot && s.team === t && !s.goneAt).length;
    if (hint && (hint === 'red' || hint === 'blue') && this.activeHumans().length < 2) return hint;
    return count('red') <= count('blue') ? 'red' : 'blue';
  }

  // Início autoritativo da partida (só a partir do lobby; chamado pelo host via
  // MSG.START). Liga o timer PvP, dá proteção inicial e zera a contagem de waves.
  start(now = Date.now()) {
    if (this.state !== 'lobby') return false;
    this.state = 'playing';
    this.over = false;
    this.overSent = false;
    this.result = null;
    this.wave = 0;
    this.waveAt = 0;
    this.endsAt = this.mode === 'survival' ? null : now + this.matchLenS * 1000;
    if (this.mode !== 'survival') {
      for (const s of this.ships.values()) {
        if (!s.bot && !s.goneAt && !s.waitNext && s.alive) s.protectUntil = now + PROTECT_S * 1000;
      }
    }
    return true;
  }

  setReady(id, v) {
    const s = this.ships.get(id);
    if (!s || s.bot || s.goneAt || this.state !== 'lobby') return false;
    s.ready = !!v;
    return true;
  }

  // 🌀 do lobby: redistribui os humanos em RED/BLUE com equilíbrio (|Δ| ≤ 1).
  // Só host + só lobby + só teams (checado também no main). Ordem sorteada p/
  // não favorecer sempre os mesmos; capacidade respeitada (times até 6v6=12).
  shuffleTeams() {
    if (this.mode !== 'teams' || this.state !== 'lobby') return false;
    const hs = this.humans().filter((s) => !s.goneAt);
    if (hs.length < 2) return false;
    for (let i = hs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [hs[i], hs[j]] = [hs[j], hs[i]];
    }
    hs.forEach((s, i) => { s.team = i % 2 === 0 ? 'red' : 'blue'; });
    return true;
  }

  // Saída explícita (abandono): remove na hora, mas o placar da partida fica
  // registrado (leftScores) — sair não muda abates já conquistados nem o vencedor.
  leave(id) {
    const s = this.ships.get(id);
    if (s && !s.bot && (s.kills > 0 || s.deaths > 0)) {
      this.leftScores.set(id, { name: s.name, kills: s.kills, deaths: s.deaths, team: s.team || undefined });
    }
    this.ships.delete(id);
    this.inputs.delete(id);
    this.lasers = this.lasers.filter((l) => l.owner !== id);
    this.missiles = this.missiles.filter((m) => m.owner !== id && m.target !== id);
    if (this.hubOwner === id) this.hubOwner = this.hostId;
  }

  // Queda de socket: vira fantasma p/ reconexão (sala vazia encerra no main).
  // Projéteis do dono são removidos na hora (fantasma não mata).
  disconnect(id, now = Date.now()) {
    const s = this.ships.get(id);
    if (s && !s.bot) {
      s.goneAt = now;
      this.inputs.delete(id);
      this.lasers = this.lasers.filter((l) => l.owner !== id);
      this.missiles = this.missiles.filter((m) => m.owner !== id && m.target !== id);
    } else {
      this.leave(id);
    }
  }

  purge(now = Date.now()) {
    for (const [id, s] of this.ships) {
      if (s.goneAt && now - s.goneAt > this.reconnectS * 1000) this.leave(id);
    }
  }

  reset() {
    this.lasers = [];
    this.missiles = [];
    this.inputs.clear(); // recorte 8: sem input/lock herdado da partida anterior
    this.leftScores.clear(); // revanche: placar novo
    const now = Date.now();
    for (const [id, s] of [...this.ships]) {
      if (s.bot) { this.ships.delete(id); continue; } // bots saem no reset
      // fantasma (goneAt) zera junto — rematch é placar novo; goneAt e
      // resumeToken são preservados (fora do Object.assign) p/ o resume.
      Object.assign(s, {
        vx: 0, vy: 0, vz: 0,
        yaw: 0, pitch: 0, roll: 0, hp: SHIP_HP, shield: 0, alive: true,
        waitNext: false, respawnAt: 0, kills: 0, deaths: 0, ready: false,
        boost: BOOST_MAX,
        weapon: 1, effects: {}, warn: false,
        lastShotAt: 0, missileReadyAt: 0, lastImpactAt: 0,
        protectUntil: this.mode === 'survival' ? 0 : now + PROTECT_S * 1000,
      });
    }
    // spawns válidos (fora de obstáculos, separados) após todos zerados
    for (const s of this.ships.values()) {
      const sp = this.spawnPos(0, 0, 0, 30);
      s.x = sp.x; s.y = sp.y; s.z = sp.z;
    }
    this.powerups = POWERUP_SPOTS.map((p) => ({ ...p, active: true, respawnAt: 0 }));
    // Revanche recomeça a partida na hora (todos já estão na sala).
    this.state = 'playing';
    this.endsAt = this.mode === 'survival' ? null : now + this.matchLenS * 1000;
    this.over = false;
    this.overSent = false;
    this.result = null;
    this.wave = 0;
    this.waveAt = 0;
  }

  damage(victim, amount, killerId, now, events) {
    if (!victim.alive || victim.goneAt || victim.waitNext) return;
    if (now < victim.protectUntil) return; // proteção pós-respawn
    let rest = amount;
    if (victim.shield > 0) {
      const absorbed = Math.min(victim.shield, rest);
      victim.shield -= absorbed;
      rest -= absorbed;
    }
    victim.hp -= rest;
    if (victim.hp <= 0) {
      victim.alive = false;
      victim.hp = 0;
      victim.shield = 0;
      victim.deaths = (victim.deaths || 0) + 1; // mortes rastreadas p/ placar/HUD
      victim.effects = {}; // power-up removido ao morrer
      victim.warn = false;
      const killer = killerId && this.ships.get(killerId);
      if (killer && killer.id !== victim.id) killer.kills += 1; // kills únicos
      if (this.mode === 'survival' && !victim.bot) {
        victim.waitNext = true; // coop: volta na próxima wave
      } else if (!victim.bot) {
        victim.respawnAt = now + RESPAWN_S * 1000;
      }
      events.push({ t: 'event', kind: 'kill', a: killerId || null, b: victim.id, scores: this.scores() });
    }
  }

  fireLaser(s, now, events) {
    const { damage, cooldown } = laserStats(s.effects, now);
    if (now - s.lastShotAt < cooldown * 1000) return;
    s.lastShotAt = now;
    s.protectUntil = 0; // atirar encerra a proteção
    const f = forward(s.yaw, s.pitch);
    const mk = (dx, dy, dz, mult) => ({
      id: ++seq, owner: s.id, dmgMult: mult,
      x: s.x + f.x * 3, y: s.y + f.y * 3, z: s.z + f.z * 3,
      dx, dy, dz, life: LASER_LIFE, base: damage,
    });
    this.lasers.push(mk(f.x, f.y, f.z, 1));
    if (hasEff(s, 'triple', now)) {
      const c = Math.cos(TRIPLE_SPREAD), si = Math.sin(TRIPLE_SPREAD);
      // laterais: rotação yaw ±spread (20% do dano cada)
      for (const sgn of [1, -1]) {
        const dx = f.x * c + sgn * -f.z * si;
        const dz = f.z * c + sgn * f.x * si;
        this.lasers.push(mk(dx, f.y, dz, TRIPLE_SIDE_MULT));
      }
    }
    void events;
  }

  acquireLock(s) {
    const f = forward(s.yaw, s.pitch);
    let best = null, bestScore = -2;
    for (const o of this.ships.values()) {
      if (o.id === s.id || !o.alive || o.goneAt || o.waitNext) continue;
      if (this.allies(s, o)) continue; // nunca trava aliado
      const dx = o.x - s.x, dy = o.y - s.y, dz = o.z - s.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > MISSILE_LOCK_RANGE || dist < 1) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / dist;
      if (dot < MISSILE_LOCK_COS) continue; // fora da mira: sem lock
      if (losBlocked(s.x, s.y, s.z, o.x, o.y, o.z)) continue;
      if (dot > bestScore) { bestScore = dot; best = o; }
    }
    return best ? best.id : null;
  }

  fireMissile(s, now, events) {
    if (now < s.missileReadyAt) return false; // recarga 9s (trocar arma não altera)
    s.missileReadyAt = now + MISSILE_COOLDOWN_S * 1000;
    s.protectUntil = 0;
    const f = forward(s.yaw, s.pitch);
    const target = this.acquireLock(s);
    this.missiles.push({
      id: ++seq, owner: s.id, target,
      x: s.x + f.x * 3, y: s.y + f.y * 3, z: s.z + f.z * 3,
      dx: f.x, dy: f.y, dz: f.z, life: MISSILE_LIFE,
    });
    if (target) events.push({ t: 'event', kind: 'lock', a: s.id, b: target }); // aviso ao alvo
    return true;
  }

  spawnWave(now) {
    this.wave += 1;
    // limpa bots mortos de waves anteriores (evita crescimento sem fim do mapa)
    for (const [id, s] of [...this.ships]) {
      if (s.bot && !s.alive) this.ships.delete(id);
    }
    const n = Math.min(MAX_BOTS_ALIVE, 1 + this.wave);
    for (let i = 0; i < n; i++) {
      const id = `bot-w${this.wave}-${i}`;
      const sp = this.spawnPos(0, 0, 60, 90);
      this.ships.set(id, {
        id, name: `bot${i + 1}`, color: '#ff4444', team: 'bots', bot: true,
        x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0,
        yaw: 0, pitch: 0, roll: 0, hp: 40 + this.wave * 5, shield: 0,
        alive: true, waitNext: false, respawnAt: 0, protectUntil: 0, kills: 0, deaths: 0,
        boost: BOOST_MAX, weapon: 1, lastShotAt: 0, missileReadyAt: 0,
        lastImpactAt: 0, effects: {}, goneAt: 0, warn: false, joinSeq: 1e9,
      });
    }
    // quem caiu volta na próxima wave
    for (const s of this.ships.values()) {
      if (!s.bot && !s.goneAt && s.waitNext) {
        const sp = this.spawnPos(0, 0, 0, 30);
        Object.assign(s, {
          waitNext: false, alive: true, hp: SHIP_HP, shield: 0,
          x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0,
        });
      }
    }
  }

  botsAlive() {
    let n = 0;
    for (const s of this.ships.values()) if (s.bot && s.alive) n++;
    return n;
  }

  tick(dt, now = Date.now()) {
    const events = [];
    if (this.over) return events;
    // Lobby autoritativo: sem simulação (nada de timer/waves/tiro) até o host
    // dar start. Evita survival iniciando waves enquanto o piloto está no hangar.
    if (this.state !== 'playing') return events;

    // Fim PvP: timer server-side (survival ignora timer; só derrota encerra).
    if (this.mode !== 'survival' && now >= this.endsAt) {
      return this.finish(events);
    }

    if (this.mode === 'survival') this.tickSurvival(dt, now, events);

    for (const s of this.ships.values()) {
      if (s.bot) this.tickBot(s, dt, now, events);
      else this.tickShip(s, dt, now, events);
    }

    this.tickProjectiles(dt, now, events);
    this.tickCollisions(dt, now, events);
    this.tickPowerups(now, events);

    // aviso ao alvo: míssil com lock ativo
    for (const s of this.ships.values()) s.warn = false;
    for (const m of this.missiles) {
      const t = this.ships.get(m.target);
      if (t && t.alive) t.warn = true;
    }

    if (this.mode === 'survival') {
      const alive = this.activeHumans().filter((s) => s.alive);
      if (this.wave >= 1 && alive.length === 0) {
        this.over = true;
        this.state = 'over'; // recorte 12: derrota encerra como as demais
        this.result = { defeat: true, wave: this.wave };
        if (!this.overSent) {
          this.overSent = true;
          events.push({ t: 'event', kind: 'over', defeat: true, wave: this.wave, scores: this.scores() });
        }
      }
    }
    return events;
  }

  finish(events) {
    this.over = true;
    this.state = 'over';
    if (!this.overSent) {
      this.overSent = true;
      const scores = this.scores();
      let winner = null, draw = false;
      if (this.mode === 'teams') {
        const { red, blue } = scores.teams;
        winner = red === blue ? null : red > blue ? 'red' : 'blue';
        draw = red === blue;
      } else {
        let top = -1;
        for (const [id, p] of Object.entries(scores.players ?? scores)) {
          if (p.kills > top) { top = p.kills; winner = id; draw = false; }
          else if (p.kills === top) draw = true;
        }
        if (draw) winner = null;
      }
      this.result = { winner, draw };
      events.push({ t: 'event', kind: 'over', scores, winner, draw }); // empate explícito
    }
    return events;
  }

  tickSurvival(dt, now, events) {
    void dt;
    if (this.wave === 0 && this.activeHumans().some((s) => s.alive)) {
      this.spawnWave(now);
      events.push({ t: 'event', kind: 'wave', wave: this.wave });
    } else if (this.wave >= 1 && this.botsAlive() === 0) {
      if (!this.waveAt) this.waveAt = now + WAVE_GAP_S * 1000;
      if (now >= this.waveAt) {
        this.waveAt = 0;
        this.spawnWave(now);
        events.push({ t: 'event', kind: 'wave', wave: this.wave });
      }
    }
  }

  tickShip(s, dt, now, events) {
    if (s.goneAt || s.waitNext) return; // fantasma / esperando próxima partida
    if (!s.alive) {
      if (!this.over && now >= s.respawnAt) {
        const sp = this.spawnPos(0, 0, 0, 30); // respawn fora de obstáculos/naves
        Object.assign(s, {
          x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0,
          hp: SHIP_HP, shield: 0, alive: true, boost: s.boost, // boost não restaura
          protectUntil: now + PROTECT_S * 1000,
        });
        events.push({ t: 'event', kind: 'respawn', b: s.id });
      }
      return;
    }
    const raw = this.inputs.get(s.id);
    // P1-11: input obsoleto (aba congelada sem close) é neutralizado — sem
    // empuxo/tiro; a nave deriva. Sem carimbo (testes legados) vale sempre.
    const inp = raw && (raw._at === undefined || now - raw._at <= INPUT_STALE_MS) ? raw : null;
    let boosting = false;
    if (inp) {
      // TP (instructor): o mouse dita o DESEJO (dyaw/dpitch = bolinha ○);
      // o nariz PERSEGUE com w_max autoritativo (shared/turn.js) — a
      // orientação instantânea enviada (yaw/pitch) é IGNORADA neste modo
      // (nunca teleporte). Sem desejo = FP: cópia direta (inalterada).
      const na = normalizeAngles(inp.yaw, inp.pitch, inp.roll);
      if (Number.isFinite(inp.dyaw) && Number.isFinite(inp.dpitch)) {
        const des = normalizeAngles(inp.dyaw, inp.dpitch, 0);
        const stp = stepNose(s.yaw, s.pitch, des.yaw, des.pitch, dt, TP_YAW_RATE, TP_PITCH_RATE);
        s.yaw = stp.yaw;
        s.pitch = stp.pitch;
      } else {
        // Orientação enviada é normalizada (período 2π) e validada no protocolo:
        // números extremos não entram; roll não muda o nariz (forward ignora roll).
        s.yaw = na.yaw;
        s.pitch = na.pitch;
      }
      // Roll absoluto (mouse bank-to-turn) tem prioridade; sem ele, integra A/D.
      if (Number.isFinite(inp.roll)) s.roll = na.roll;
      else s.roll = wrapPi(s.roll + ((inp.a ? 1 : 0) - (inp.d ? 1 : 0)) * ROLL_SPEED * dt);
      if (inp.swap) { inp.swap = 0; s.weapon = s.weapon === 1 ? 2 : 1; } // troca preserva recargas
      // Manete analógica (modo TP) tem prioridade; sem ela, W/S momentâneo (modo FP).
      let want, wantBoost;
      if (Number.isFinite(inp.thr)) {
        const thr = Math.max(-0.6, Math.min(1, inp.thr));
        wantBoost = !!inp.boost && thr > 0.05 && s.boost > 0;
        boosting = wantBoost;
        want = MAX_SPEED * thr;
        if (wantBoost) {
          want *= BOOST_MULT;
          s.boost = Math.max(0, s.boost - BOOST_DRAIN * dt);
        }
      } else {
        wantBoost = !!inp.boost && (inp.w || inp.s) && s.boost > 0;
        boosting = wantBoost;
        want = MAX_SPEED * ((inp.w ? 1 : 0) - (inp.s ? 0.6 : 0));
        if (wantBoost) {
          want *= BOOST_MULT;
          s.boost = Math.max(0, s.boost - BOOST_DRAIN * dt);
        }
      }
      const f = forward(s.yaw, s.pitch);
      const k = Math.min(1, ACCEL * dt / Math.max(1, MAX_SPEED));
      s.vx += (f.x * want - s.vx) * k;
      s.vy += (f.y * want - s.vy) * k;
      s.vz += (f.z * want - s.vz) * k;
      if (inp.fire) {
        inp.fire = 0;
        if (s.weapon === 1) this.fireLaser(s, now, events);
        else this.fireMissile(s, now, events);
      }
      if (inp.w2) { inp.w2 = 0; this.fireMissile(s, now, events); }
    }
    if (!boosting) {
      const mult = hasEff(s, 'propulsion', now) ? PROPULSION_REGEN_MULT : 1;
      s.boost = Math.min(BOOST_MAX, s.boost + BOOST_REGEN * mult * dt);
    }
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    for (const ax of ['x', 'y', 'z']) {
      if (Math.abs(s[ax]) > WORLD_BOUND) s[ax] = Math.sign(s[ax]) * WORLD_BOUND;
    }
  }

  // IA simples server-side: persegue o humano mais próximo com erro plausível,
  // evita obstáculos por repulsão, atira laser quando alinhado e perto.
  tickBot(s, dt, now, events) {
    void events;
    if (!s.alive) return;
    let prey = null, best = Infinity;
    for (const o of this.ships.values()) {
      if (o.bot || !o.alive || o.goneAt || o.waitNext) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y, o.z - s.z);
      if (d < best) { best = d; prey = o; }
    }
    if (!prey) return;
    let dx = prey.x - s.x, dy = prey.y - s.y, dz = prey.z - s.z;
    for (const o of OBSTACLES()) { // repulsão de obstáculo
      const ox = s.x - o.x, oy = s.y - o.y, oz = s.z - o.z;
      const d = Math.hypot(ox, oy, oz);
      if (d < o.r + 40 && d > 0.01) {
        const push = (o.r + 40 - d) * 2;
        dx += (ox / d) * push; dy += (oy / d) * push; dz += (oz / d) * push;
      }
    }
    const dist = Math.hypot(dx, dy, dz) || 1;
    const wantYaw = Math.atan2(-dx / dist, -dz / dist) + rnd(BOT_AIM_ERR);
    const wantPitch = clamp(Math.asin(clamp(dy / dist, -1, 1)) + rnd(BOT_AIM_ERR), -1.2, 1.2);
    s.yaw = wantYaw; s.pitch = wantPitch;
    const f = forward(s.yaw, s.pitch);
    const k = Math.min(1, ACCEL * dt / Math.max(1, MAX_SPEED));
    const want = MAX_SPEED * 0.9;
    s.vx += (f.x * want - s.vx) * k;
    s.vy += (f.y * want - s.vy) * k;
    s.vz += (f.z * want - s.vz) * k;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    for (const ax of ['x', 'y', 'z']) {
      if (Math.abs(s[ax]) > WORLD_BOUND) s[ax] = Math.sign(s[ax]) * WORLD_BOUND;
    }
    const aimDot = (dx * f.x + dy * f.y + dz * f.z) / dist;
    if (best < BOT_FIRE_RANGE && aimDot > 0.995) this.fireLaser(s, now, events);
  }

  hitShip(l, s, dmg, now, events) {
    const owner = this.ships.get(l.owner);
    if (!owner || owner.goneAt || s.goneAt) return false; // fantasma não mata nem morre
    if (this.allies(owner, s)) return false; // FF off
    this.damage(s, dmg, l.owner, now, events);
    return true;
  }

  // Primeiro impacto real ao longo do segmento (obstáculo ou nave), ignorando
  // t <= lastT (permite continuar atravessando aliados com FF off e ainda
  // acertar quem está atrás no MESMO trecho — nada de "ordem de iteração").
  firstImpactAfter(px, py, pz, nx, ny, nz, lastT, shipR, ownerId, now) {
    let bestT = Infinity, best = null;
    for (const o of OBSTACLES()) {
      const t = segSphereT(px, py, pz, nx, ny, nz, o.x, o.y, o.z, o.r);
      if (t !== null && t > lastT && t < bestT) { bestT = t; best = { kind: 'obstacle', t }; }
    }
    for (const s of this.ships.values()) {
      if (!s.alive || s.goneAt || s.waitNext || s.id === ownerId) continue;
      if (now < s.protectUntil) continue; // protegido: tiro atravessa (como antes)
      const t = segSphereT(px, py, pz, nx, ny, nz, s.x, s.y, s.z, shipR);
      if (t !== null && t > lastT && t < bestT) { bestT = t; best = { kind: 'ship', t, s }; }
    }
    return best;
  }

  tickProjectiles(dt, now, events) {
    // projéteis de quem saiu/fantasma não existem (fantasma não mata)
    this.lasers = this.lasers.filter((l) => {
      const o = this.ships.get(l.owner);
      return o && !o.goneAt;
    });
    this.missiles = this.missiles.filter((m) => {
      const o = this.ships.get(m.owner);
      return o && !o.goneAt;
    });

    for (const l of this.lasers) {
      const px = l.x, py = l.y, pz = l.z;
      l.x += l.dx * LASER_SPEED * dt;
      l.y += l.dy * LASER_SPEED * dt;
      l.z += l.dz * LASER_SPEED * dt;
      l.life -= dt;
      if (l.life <= 0) continue;
      const dmg = l.base * (l.dmgMult || 1);
      let lastT = -1e-6;
      for (;;) {
        const hit = this.firstImpactAfter(px, py, pz, l.x, l.y, l.z, lastT, SHIP_RADIUS, l.owner, now);
        if (!hit) break;
        if (hit.kind === 'obstacle') { l.life = 0; break; } // cenário bloqueia
        if (this.hitShip(l, hit.s, dmg, now, events)) { l.life = 0; break; }
        lastT = hit.t + 1e-6; // aliado (FF off) ou sem dano: atravessa e segue
      }
    }
    this.lasers = this.lasers.filter((l) => l.life > 0);

    for (const m of this.missiles) {
      const tgt = m.target && this.ships.get(m.target);
      const locked = tgt && tgt.alive && !tgt.goneAt &&
        !losBlocked(m.x, m.y, m.z, tgt.x, tgt.y, tgt.z); // perde alvo com obstrução
      if (!locked) m.target = null;
      if (locked) {
        const dx = tgt.x - m.x, dy = tgt.y - m.y, dz = tgt.z - m.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const cur = { x: m.dx, y: m.dy, z: m.dz };
        const want = { x: dx / d, y: dy / d, z: dz / d };
        const dot = clamp(cur.x * want.x + cur.y * want.y + cur.z * want.z, -1, 1);
        const maxTurn = MISSILE_TURN * dt;
        let nx, ny, nz;
        if (Math.acos(dot) <= maxTurn || dot >= 1) ({ x: nx, y: ny, z: nz } = want);
        else {
          const t = maxTurn / Math.acos(dot);
          nx = cur.x + (want.x - cur.x) * t;
          ny = cur.y + (want.y - cur.y) * t;
          nz = cur.z + (want.z - cur.z) * t;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
        }
        m.dx = nx; m.dy = ny; m.dz = nz;
      }
      const px = m.x, py = m.y, pz = m.z;
      m.x += m.dx * MISSILE_SPEED * dt;
      m.y += m.dy * MISSILE_SPEED * dt;
      m.z += m.dz * MISSILE_SPEED * dt;
      m.life -= dt;
      if (m.life <= 0) continue;
      // ordenado por primeiro impacto: obstáculo no meio do caminho conta
      // (antes só testava a posição final) e nave errada não "rouba" o impacto
      let lastT = -1e-6;
      for (;;) {
        const hit = this.firstImpactAfter(px, py, pz, m.x, m.y, m.z, lastT, SHIP_RADIUS + 0.6, m.owner, now);
        if (!hit) break;
        if (hit.kind === 'obstacle') { m.life = 0; break; }
        if (this.hitShip(m, hit.s, MISSILE_DAMAGE, now, events)) { m.life = 0; break; }
        lastT = hit.t + 1e-6; // aliado: atravessa (FF off)
      }
    }
    this.missiles = this.missiles.filter((m) => m.life > 0);
  }

  tickCollisions(dt, now, events) {
    void dt;
    const list = [...this.ships.values()].filter((s) => s.alive && !s.goneAt && !s.waitNext);
    // cenário: empurra p/ fora (sem atravessar mesmo em boost) + dano 2-5 com cooldown
    for (const s of list) {
      const spd = Math.hypot(s.vx, s.vy, s.vz);
      for (const o of OBSTACLES()) {
        const dx = s.x - o.x, dy = s.y - o.y, dz = s.z - o.z;
        const d = Math.hypot(dx, dy, dz);
        const minD = o.r + SHIP_RADIUS * 0.4;
        if (d < minD) {
          // d exatamente zero (spawn/caso-limite): normal determinística finita
          const nx = d > 0.001 ? dx / d : 0;
          const ny = d > 0.001 ? dy / d : 1;
          const nz = d > 0.001 ? dz / d : 0;
          s.x = o.x + nx * minD; s.y = o.y + ny * minD; s.z = o.z + nz * minD;
          const vn = s.vx * nx + s.vy * ny + s.vz * nz;
          if (vn < 0) { s.vx -= vn * nx; s.vy -= vn * ny; s.vz -= vn * nz; }
          if (now - s.lastImpactAt >= IMPACT_COOLDOWN_S * 1000) {
            s.lastImpactAt = now;
            const dmg = IMPACT_MIN + Math.min(3, Math.floor(spd / 12)); // 2–5
            this.damage(s, Math.min(IMPACT_MAX, dmg), null, now, events);
          }
        }
      }
    }
    // nave×nave: só afasta, sem dano
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        const minD = SHIP_RADIUS * 2;
        if (d < minD) {
          // sobreposição exata (d=0): eixo fixo p/ separar sempre
          const nx = d > 0.001 ? dx / d : 1;
          const ny = d > 0.001 ? dy / d : 0;
          const nz = d > 0.001 ? dz / d : 0;
          const push = d > 0.001 ? (minD - d) / 2 : minD / 2;
          a.x -= nx * push; a.y -= ny * push; a.z -= nz * push;
          b.x += nx * push; b.y += ny * push; b.z += nz * push;
        }
      }
    }
  }

  tickPowerups(now, events) {
    for (const p of this.powerups) {
      if (!p.active && now >= p.respawnAt) { p.active = true; }
      if (!p.active) continue;
      for (const s of this.ships.values()) {
        if (s.bot || !s.alive || s.goneAt || s.waitNext) continue;
        if (Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) > POWERUP_RADIUS) continue;
        p.active = false; // coleta única: um beneficiário
        p.respawnAt = now + POWERUP_RESPAWN_S * 1000;
        if (p.type === 'repair') s.hp = Math.min(SHIP_HP, s.hp + REPAIR_AMOUNT);
        else if (p.type === 'shield') s.shield = Math.min(SHIELD_MAX, s.shield + REPAIR_AMOUNT);
        else s.effects[p.type] = now + EFFECT_LEN_S * 1000; // renova 15s, sem acúmulo
        events.push({ t: 'event', kind: 'pickup', a: s.id, b: p.type });
        break;
      }
    }
  }

  // Placar autoritativo: inclui mortes (desempate) e quem saiu (leftScores)
  // para que sair não apague pontos nem "vire" a partida; fantasmas (goneAt)
  // continuam fora do radar/snapshot mas seus kills valem (vão ao placar).
  scores() {
    const players = {};
    for (const s of this.ships.values()) {
      if (s.bot) continue;
      players[s.id] = {
        name: s.name, kills: s.kills, deaths: s.deaths || 0,
        team: s.team || undefined,
      };
    }
    for (const [id, s] of this.leftScores) {
      if (!players[id]) {
        players[id] = {
          name: s.name, kills: s.kills, deaths: s.deaths || 0,
          team: s.team || undefined, left: true,
        };
      }
    }
    if (this.mode === 'teams') {
      const teams = { red: 0, blue: 0 };
      for (const p of Object.values(players)) {
        if (!p.team) continue;
        teams[p.team] += p.kills; // placar do time = soma dos kills
      }
      return { teams, players };
    }
    return players;
  }

  snapshot(now = Date.now()) {
    return {
      t: 'snapshot',
      room: this.name,
      mode: this.mode,
      state: this.state,
      over: this.over,
      wave: this.wave,
      hostId: this.hostId,
      hubOwner: this.hubOwner,
      result: this.result,
      endsInS: this.endsAt == null ? 0 : Math.max(0, Math.ceil((this.endsAt - now) / 1000)),
      // fantasmas (goneAt) fora do snapshot: não contam no lobby nem no radar
      ships: [...this.ships.values()].filter((s) => !s.goneAt).map((s) => ({
        id: s.id, name: s.name, color: s.color, team: s.team || undefined,
        bot: s.bot || undefined, waiting: s.waitNext || undefined,
        x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, roll: s.roll,
        hp: s.hp, alive: s.alive, shield: s.shield, boost: Math.round(s.boost),
        weapon: s.weapon, warn: s.warn || undefined, ready: !!s.ready || undefined,
        effects: Object.keys(s.effects).filter((k) => s.effects[k] > now),
      })),
      lasers: this.lasers.map((l) => ({ id: l.id, x: l.x, y: l.y, z: l.z, dx: l.dx, dy: l.dy, dz: l.dz })),
      missiles: this.missiles.map((m) => ({ id: m.id, x: m.x, y: m.y, z: m.z, target: m.target })),
      powerups: this.powerups.map((p) => ({ type: p.type, x: p.x, y: p.y, z: p.z, active: p.active })),
      obstacles: { station: STATION, asteroids: ASTEROIDS },
      scores: this.scores(),
    };
  }
}
