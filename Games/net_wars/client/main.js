// Boot: telas (menu/lobby/partida/resultados/pausa), Hub ?hub=1,
// identidade por aba (sessionStorage) + ajustes (localStorage),
// loop + rede alinhada ao protocolo atual (modos, times, mísseis, power-ups…).
import { createInput } from './input.js';
import { connect, createRetryPolicy, isExplicitClose } from './net.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { initHub, hubParams, shouldAutoEnter } from './hub.js';
import { MISSILE_COOLDOWN_S, LASER_COOLDOWN_S, RESPAWN_S, MISSILE_LOCK_RANGE, MISSILE_LOCK_COS, MAX_PLAYERS, MAX_SPEED, ACCEL, BOOST_MULT, STATION, ASTEROIDS, AIM_EDGE_MARGIN } from '../shared/constants.js';
import { pushOutOfObstacles, freeDistAlongRay } from '../shared/physics.js';
import { forward } from '../shared/orient.js';
import { ballWorld, AIM_MAX_DIST, AIM_MIN_DIST } from '../shared/turn.js';

const $ = (id) => document.getElementById(id);
const hp = hubParams();

// ---- ajustes (localStorage) / identidade (sessionStorage, por aba) ----
const DEFAULTS = { volume: 0.6, mute: false, sensitivity: 1.4, invertY: false, quality: 'high', reduceFx: false, camMode: 'fp' };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('nw-settings') || '{}')); } catch {}
if (settings.camMode !== 'tp' && settings.camMode !== 'fp') settings.camMode = 'fp';
const getSettings = () => settings;
function saveSettings() {
  try { localStorage.setItem('nw-settings', JSON.stringify(settings)); } catch {}
  audio.refresh();
}

const audio = createAudio(getSettings);
const hud = createHud(audio);
initHub();

if (hp.name) sessionStorage.setItem('nw-name', hp.name);
if (hp.room) sessionStorage.setItem('nw-room', hp.room.toLowerCase());
if (hp.color && /^#[0-9a-fA-F]{6}$/.test(hp.color)) sessionStorage.setItem('nw-color', hp.color);

const ui = {
  name: $('m-name'), color: $('m-color'), room: $('m-room'),
  menu: $('screen-menu'), lobby: $('screen-lobby'), over: $('screen-over'), pause: $('screen-pause'),
  help: $('screen-help'), settings: $('screen-settings'),
};
ui.name.value = sessionStorage.getItem('nw-name') || '';
ui.color.value = sessionStorage.getItem('nw-color') || '#44ccff';
ui.room.value = sessionStorage.getItem('nw-room') || hp.room || 'ffa1';

let selMode = 'ffa';
let selTeam = null; // null = auto
if (hp.slot === 'red' || hp.slot === 'blue') selTeam = hp.slot;

function show(which) {
  for (const s of [ui.menu, ui.lobby, ui.over, ui.pause]) s.style.display = 'none';
  if (which) which.style.display = 'flex';
  $('hud').style.display = (which === null) ? 'block' : 'none'; // null = em partida
}

let renderer = null;
let input = null;
let conn = null;
let latest = null;
let myId = null;
let myName = '', myColor = '', myRoom = '';
let names = {};
let inMatch = false;
let waiting = false; // late-join aguardando próxima partida/wave
let lastBoundWarn = 0;
let deathAt = 0;
let countdownDone = false;
let lastMissileAt = 0;
let lastLaserAt = 0; // gate do laser (áudio): variável declarada — método
// onFired NÃO binda o próprio nome, `onFired._laser` era ReferenceError (P0-3)
let lastOver = null;
let lastOverKey = null; // idempotência do fim (snapshot over + evento over duplicam)
// contrato __nw.aim p/ Lane R / E2E (só leitura): { mode, nose, ball, cursor,
// reticle } — pontos ○/raio do nariz (populado em updateAimHud, 60fps)
let aimDbg = null;
const backoff = createRetryPolicy(); // retry 3x backoff 1s/2s/4s (um timer por vez)
let wantConn = false; // intenção de sessão: lobby/partida/fim reconectam; saída explícita cancela

const extra = {
  boost: 1, missileCd: 0, lock: 'none', radar: [], offscreen: [],
  ping: null, connected: true, snapAgeMs: 0, thrust: 0, _warned: false, _wasLock: false,
};

function ensureScene() {
  if (renderer) return;
  renderer = createRenderer(getSettings);
  input = createInput(renderer.canvas, getSettings);
  input.on('unlock', () => audio.unlock());
  input.on('pause', () => { if (inMatch && latest && !latest.over) openPause(); });
  input.on('score', (v) => { if (inMatch) hud.setScoreVisible(v, latest, myId); });
  input.on('mute', () => { settings.mute = !settings.mute; saveSettings(); syncSettingsUI(); });
  input.on('help', () => { ui.help.style.display = ui.help.style.display === 'flex' ? 'none' : 'flex'; });
}

function resumeKey() { return `nw-id-${myRoom}`; }

function hello() {
  const o = { name: myName, room: myRoom, color: myColor, mode: selMode };
  if (selTeam) o.team = selTeam;
  if (hp.htok) o.htok = hp.htok;
  const rid = sessionStorage.getItem(resumeKey());
  if (rid) o.resume = rid;
  const rtok = sessionStorage.getItem(`${resumeKey()}-tok`);
  if (rtok) o.resumeToken = rtok;
  const len = Number(new URLSearchParams(location.search).get('len'));
  if (Number.isFinite(len) && len > 0) o.len = len;
  return o;
}

function me() { return latest?.ships?.find((s) => s.id === myId); }

function startConn(retry = false) {
  if (!retry) backoff.reset(); // manual: zera a conta
  wantConn = true; // lobby, retry e (re)entrada expressam intenção de sessão
  conn?.close();
  conn = connect(`ws://${location.host}`, () => {
    const m = input.sample();
    input.consumeFire();
    return m;
  }, {
    hello: hello(),
    onClose(code, reason) {
      // close() intencional (troca de tela) não agenda: net.js só chama
      // onClose quando o socket morreu sozinho (guard de geração)
      if (isExplicitClose(code, reason)) { // (a)(c) explícito: repetir é inútil/errado
        wantConn = false;
        inMatch = false;
        conn?.close();
        hud.toast(code === 1008 ? 'conexão recusada pelo servidor — verifique nome/sala' : 'sala encerrada pelo servidor — tente de novo', 'bad');
        show(ui.menu);
        return;
      }
      if (wantConn) { hud.toast('desconectado do servidor — reconectando…', 'bad'); scheduleReconnect(); }
    },
    onError() { hud.toast('erro de conexão', 'bad'); },
    onWelcome(m) {
      const hadResume = (() => { try { return !!sessionStorage.getItem(resumeKey()); } catch { return false; } })();
      backoff.reset(); // sucesso SÓ pós-WELCOME (a): close pré-auth conta tentativa
      myId = m.id;
      waiting = !!m.waitNext;
      try {
        sessionStorage.setItem(resumeKey(), m.id);
        if (m.resumeToken) sessionStorage.setItem(`${resumeKey()}-tok`, m.resumeToken);
      } catch {}
      if (m.resumed) hud.toast('sessão retomada ✓', 'bonus');
      else if (hadResume) hud.toast('sessão anterior expirou — começando do zero', ''); // (c) resume sem retomada
      if (m.waitNext) hud.toast('partida em curso — você entra na próxima', '');
    },
    onPing(ms) { extra.ping = ms; },
    onFired(m) {
      const now = performance.now();
      // gate local (cadência): não toca rajada falsa a cada envio de 50ms
      if (m.fire && now - (lastLaserAt || 0) >= LASER_COOLDOWN_S * 1000 * 0.9) {
        lastLaserAt = now;
        audio.laser();
      }
      if (m.w2) { lastMissileAt = now; audio.missile(); }
      if (m.swap) audio.click();
    },
    onSnap(m) {
      latest = m;
      names = {};
      for (const s of m.ships || []) names[s.id] = s.name;
      // autoridade do servidor: espera = flag waitNext da minha nave no snapshot
      // (welcome.waitNext dá só o valor inicial ao entrar)
      waiting = !!(m.ships?.find((x) => x.id === myId)?.waiting);
      if (!m.over) { lastOver = null; lastOverKey = null; }
      else onGameOver(m, lastOver || {});
      hud.update(m, myId, extraLive());
      if (openLobby.t) refreshLobby();
    },
    onEvent(ev) {
      if (ev.kind === 'denied') {
        const msg = ev.reason === 'full' ? 'sala cheia (12/12) — tente outro código'
          : ev.reason === 'CODE_TAKEN' ? 'código com dono (hub) — peça o link certo'
          : ev.reason === 'DUP' ? 'sessão já ativa em outra aba — feche a outra ou aguarde'
          : `entrada recusada${ev.reason ? ` (${ev.reason})` : ''} — tente de novo`;
        hud.toast(msg, 'bad');
        wantConn = false; // explícito: não repete
        conn?.close();
        inMatch = false;
        show(ui.menu);
        return;
      }
      if (ev.kind === 'kill') {
        const v = latest?.ships?.find((s) => s.id === ev.b);
        if (v && renderer) renderer.explode(v.x, v.y, v.z, 1);
        renderer?.flashShip?.(ev.b);
        audio.explosion();
        hud.onKill(ev.a, ev.b, names);
        if (ev.b === myId) { deathAt = performance.now(); audio.hurt(); }
        else if (ev.a === myId) { hud.hitmarker(); audio.hit(); }
        if (latest) hud.update(latest, myId, extraLive());
      } else if (ev.kind === 'respawn') {
        if (ev.b === myId) { hud.toast('de volta à luta!', 'bonus'); audio.start(); }
      } else if (ev.kind === 'pickup') {
        const mine = ev.a === myId;
        const s = latest?.ships?.find((x) => x.id === ev.a);
        if (renderer && s) renderer.explode(s.x, s.y, s.z, 0.4, 0x51ff7a);
        hud.onPickup(ev.b, mine, names[ev.a]);
        if (ev.b === 'repair' && mine) hud.toast('+40 integridade', 'bonus');
        if (ev.b === 'shield' && mine) hud.toast('escudo reforçado', 'bonus');
      } else if (ev.kind === 'lock') {
        if (ev.b === myId) { hud.toast('⚠ míssil travado em você!', 'bad'); audio.lockAlert(); }
      } else if (ev.kind === 'over') {
        lastOver = ev;
        if (latest) { latest.over = true; onGameOver(latest, ev); }
      } else if (ev.kind === 'rematch') {
        hud.resetMatch();
        hud.toast('nova partida!', 'bonus');
        countdownDone = false;
        updateOverlays.t0 = 0;
        lastOver = null; lastOverKey = null;
        inMatch = true; show(null); // TODOS entram na partida, não só quem clicou
      } else if (ev.kind === 'wave') {
        hud.toast(`◈ ONDA ${ev.wave} — bots chegando!`, 'bonus');
        audio.wave();
      }
    },
  });
}

// reconexão limitada (máx 3, backoff 1s/2s/4s, um timer por vez) — vale p/
// lobby, partida e fim de jogo (b); saída explícita cancela via wantConn
function scheduleReconnect() {
  if (!wantConn) return;
  if (!backoff.arm(() => startConn(true))) {
    hud.toast('reconexão falhou após 3 tentativas — volte ao menu', 'bad');
  }
}

function forwardOf(s) {
  const cp = Math.cos(s.pitch);
  return { x: -Math.sin(s.yaw) * cp, y: Math.sin(s.pitch), z: -Math.cos(s.yaw) * cp };
}

// Predição local 60fps da nave própria (mesma convergência do servidor:
// ACCEL/MAX_SPEED/BOOST_MULT). O snapshot (10Hz) só corrige divergência grande,
// teleporte ou respawn — a câmera nunca usa posição de 10Hz direto.
const PRED_SNAP_M = 15;
let pred = null; // {x,y,z,vx,vy,vz} | null

function extraLive() {
  const s = me();
  // lock informativo (mesma regra do servidor: 12°, 140m, sem aliados) — sem assistência
  let lock = 'none';
  if (s && latest && s.alive !== false) {
    const f = forwardOf(s);
    let best = MISSILE_LOCK_COS;
    for (const o of latest.ships || []) {
      if (o.id === myId || o.alive === false) continue;
      if (latest.mode === 'teams' && s.team && o.team === s.team) continue;
      if (latest.mode === 'survival' && !o.bot) continue;
      const dx = o.x - s.x, dy = o.y - s.y, dz = o.z - s.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > MISSILE_LOCK_RANGE || d < 1) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / d;
      if (dot > best) best = dot;
    }
    lock = best > MISSILE_LOCK_COS ? 'on' : 'none';
    if (lock === 'on' && !extra._wasLock) audio.lockOn();
    extra._wasLock = lock === 'on';
  }
  extra.lock = lock;
  extra.boost = 1;
  extra.missileCd = Math.max(0, MISSILE_COOLDOWN_S - (performance.now() - lastMissileAt) / 1000);
  if (!lastMissileAt) extra.missileCd = 0;
  extra.radar = renderer && latest ? renderer.radar(latest, myId) : [];
  extra.offscreen = [];
  if (s && renderer && latest) {
    for (const o of latest.ships || []) {
      if (o.id === myId || o.alive === false) continue;
      if (latest.mode === 'teams' && s.team && o.team === s.team) continue;
      if (latest.mode === 'survival' && !o.bot) continue;
      if (extra.offscreen.length >= 6) break;
      const p = renderer.project(o.x, o.y, o.z);
      if (p.visible) continue;
      extra.offscreen.push({
        x: Math.max(24, Math.min(innerWidth - 24, p.behind ? innerWidth - p.x : p.x)),
        y: Math.max(90, Math.min(innerHeight - 90, p.behind ? innerHeight * 0.5 : p.y)),
        cls: o.bot ? 'bot' : 'foe',
        above: o.y > s.y + 8, below: o.y < s.y - 8,
      });
    }
    // aviso de míssil: autoridade do servidor (ship.warn) + proximidade real
    if (s.warn) {
      if (!extra._missWarned) {
        extra._missWarned = true;
        hud.toast('⚠ míssil se aproximando!', 'bad');
        audio.lockAlert();
        setTimeout(() => { extra._missWarned = false; }, 3500);
      }
    }
    if (renderer.boundWarn(s) && performance.now() - lastBoundWarn > 5000) {
      lastBoundWarn = performance.now();
      hud.toast('⚠ RETORNE À ARENA', 'bad');
      audio.collide();
    }
  }
  extra.connected = !!conn?.state.connected;
  extra.snapAgeMs = conn ? conn.snapAgeMs() : 0;
  return extra;
}

// Colisores do servidor (mesma fonte da colisão real) p/ prender a bolinha
// na superfície (regra "oculto") — sem atravessar rocha.
const COLL = [{ x: STATION.x, y: STATION.y, z: STATION.z, r: STATION.r },
  ...ASTEROIDS.map((a) => ({ x: a.x, y: a.y, z: a.z, r: a.r }))];

// ---- loop ----
let lastT = performance.now();
let wasAlive = false;
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function loop() {
  requestAnimationFrame(loop);
  const t = performance.now();
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  if (!renderer) return;
  const s = me();
  const camTp = settings.camMode === 'tp';
  // FP gira a nave direto por evento; TP persegue o cursor (rate control).
  // Servidor continua autoritativo da posição/física.
  // Gate: input só vira quando em partida, vivo e sem espera (vale p/ FP e TP).
  if (input) input.state.active = inMatch && !!s && s.alive !== false && !s.waiting;
  if (s && input && inMatch && s.alive !== false && !s.waiting) input.update();
  const boosting = inMatch && !!input && (s ? (s.boost ?? 100) > 0 : true) &&
    (input.down('ShiftLeft') || input.down('ShiftRight')) &&
    (camTp ? input.state.thr > 0.05 : (input.down('KeyW') || input.down('KeyS') || input.down('ArrowUp')));
  const thrusting = inMatch && !!input &&
    (camTp ? input.state.thr > 0.05 : (input.down('KeyW') || input.down('KeyS')));
  // Mira local fluida: a rotação aplica no render a 60fps; o servidor continua
  // autoridade da posição/física. Resync brusco só em teleporte/respawn.
  // Posição própria p/ câmera: predição local 60fps (snapshot só corrige
  // divergência grande, teleporte ou respawn) — sem degraus de 10Hz.
  let local = null;
  let rollIn = 0;
  if (s && input && inMatch) {
    const alive = s.alive !== false && !s.waiting;
    rollIn = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    if (!wasAlive && alive) input.snapActual(s.yaw, s.pitch, s.roll || 0);
    else if (Math.abs(wrapAngle(input.state.yaw - s.yaw)) > 2.5 || Math.abs(wrapAngle(input.state.pitch - s.pitch)) > 2.5) {
      input.snapActual(s.yaw, s.pitch, s.roll || 0);
    }
    let snapped = false;
    if (!alive) pred = null;
    else if (!pred || !wasAlive || Math.hypot(s.x - pred.x, s.y - pred.y, s.z - pred.z) > PRED_SNAP_M) {
      pred = { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0 };
      snapped = true;
    } else {
      const cp = Math.cos(input.state.pitch);
      const fx0 = -Math.sin(input.state.yaw) * cp;
      const fy0 = Math.sin(input.state.pitch);
      const fz0 = -Math.cos(input.state.yaw) * cp;
      let want;
      if (camTp) want = MAX_SPEED * Math.max(-0.6, Math.min(1, input.state.thr));
      else {
        const w = (input.down('KeyW') || input.down('ArrowUp')) ? 1 : 0;
        const rv = (input.down('KeyS') || input.down('ArrowDown')) ? 1 : 0;
        want = MAX_SPEED * (w - rv * 0.6);
      }
      if (boosting) want *= BOOST_MULT;
      const k = Math.min(1, ACCEL * dt / Math.max(1, MAX_SPEED));
      pred.vx += (fx0 * want - pred.vx) * k;
      pred.vy += (fy0 * want - pred.vy) * k;
      pred.vz += (fz0 * want - pred.vz) * k;
      pred.x += pred.vx * dt; pred.y += pred.vy * dt; pred.z += pred.vz * dt;
      // mesma colisão do servidor: fora de obstáculo + clamp da arena
      const pv = { x: pred.vx, y: pred.vy, z: pred.vz };
      if (pushOutOfObstacles(pred, pv)) { pred.vx = pv.x; pred.vy = pv.y; pred.vz = pv.z; }
    }
    wasAlive = alive;
    local = pred
      ? { yaw: input.state.yaw, pitch: input.state.pitch, roll: input.state.roll, cx: input.state.cx, cy: input.state.cy, dyaw: input.state.dyaw, dpitch: input.state.dpitch, x: pred.x, y: pred.y, z: pred.z, snap: snapped }
      : { yaw: input.state.yaw, pitch: input.state.pitch, roll: input.state.roll, cx: input.state.cx, cy: input.state.cy, dyaw: input.state.dyaw, dpitch: input.state.dpitch };
  }
  const fx = { dt, thrust: thrusting ? 1 : 0, boost: boosting ? 1 : 0, roll: rollIn };
  if (latest) {
    renderer.render(latest, myId, fx, local);
    if (inMatch) {
      hud.update(latest, myId, extraLive());
      audio.engine(fx.thrust, boosting, s ? s.alive !== false : true);
      updateOverlays(s);
      updateAimHud(local, s);
    }
  } else {
    renderer.render({ ships: [], lasers: [], scores: {} }, null, { dt });
  }
}

// HUD das duas miras (screen-space, nunca somem):
// ✛ central (fixa) = NARIZ = para onde o tiro REALMENTE vai (autoridade do
// servidor atira ao longo do nariz; a câmera olha ao longo dele nas 2 câmeras).
// ○ móvel = DESEJO = para onde você QUER ir (vale FP e TP): segure deslocado
// p/ virar, centralize p/ voar reto. Direita = direita, sempre (screen-relative
// pelo roll). O nariz persegue o desejo com w_max — ○ chega antes, ✛ depois.
// Em FP a câmera é rígida no nariz (cockpit); em TP é chase atrás/acima.
function updateAimHud(local, s) {
  const aimEl = $('aim-cursor');
  const retEl = $('reticle');
  const tp0 = settings.camMode === 'tp';
  const center = () => ({ x: innerWidth / 2, y: innerHeight / 2 });
  if (!aimEl || !retEl) { aimDbg = null; return; }
  const alive = s && s.alive !== false && !s.waiting && local;
  if (!alive) {
    aimEl.style.display = 'none';
    aimDbg = { mode: tp0 ? 'tp' : 'fp', nose: null, ball: null, cursor: null, reticle: center() };
    return;
  }
  // retícula do nariz: sempre o centro exato (câmera olha ao longo do nariz)
  retEl.style.opacity = '1';
  retEl.style.left = '50%';
  retEl.style.top = '50%';
  retEl.style.transform = 'translate(-50%,-50%)';
  const tp = settings.camMode === 'tp';
  const nose = { yaw: local.yaw, pitch: local.pitch };
  // Bolinha ○ = DESEJO no mundo (estável com o mouse parado): ship +
  // dir(desejo)·dist, com regras vazio/oculto/muito-perto (shared/turn.js).
  // Vale FP e TP (mesmo desejo/perseguição w_max); fora-da-tela/atrás prende
  // na borda (nunca some). ✛ central = NARIZ (tiro real).
  if (!input || !Number.isFinite(local.dyaw) || !Number.isFinite(local.dpitch)) {
    aimEl.style.display = 'none';
    aimDbg = { mode: tp ? 'tp' : 'fp', nose, ball: null, cursor: null, reticle: center() };
  }
  else {
    const o = {
      x: local.x !== undefined ? local.x : s.x,
      y: local.y !== undefined ? local.y : s.y,
      z: local.z !== undefined ? local.z : s.z,
    };
    const f = forward(local.dyaw, local.dpitch);
    const free = freeDistAlongRay(o, f, AIM_MAX_DIST, COLL, 0);
    const b = ballWorld(o, local.dyaw, local.dpitch, Math.min(free, AIM_MAX_DIST));
    const p = renderer.project(b.x, b.y, b.z);
    const X = p.behind ? innerWidth - p.x : p.x;
    const Y = p.behind ? innerHeight * 0.5 : p.y;
    aimEl.style.display = 'block';
    aimEl.style.left = `${clampNum(X, AIM_EDGE_MARGIN, innerWidth - AIM_EDGE_MARGIN)}px`;
    aimEl.style.top = `${clampNum(Y, AIM_EDGE_MARGIN, innerHeight - AIM_EDGE_MARGIN)}px`;
    // contrato __nw.aim: ○ no mundo (ball) + ○ em px (cursor) + ✛ (reticle)
    aimDbg = {
      mode: tp ? 'tp' : 'fp', nose,
      ball: { x: b.x, y: b.y, z: b.z },
      cursor: { x: clampNum(X, AIM_EDGE_MARGIN, innerWidth - AIM_EDGE_MARGIN), y: clampNum(Y, AIM_EDGE_MARGIN, innerHeight - AIM_EDGE_MARGIN) },
      reticle: center(),
    };
  }
  // manete TP no HUD
  if (settings.camMode === 'tp' && input) {
    const thr = input.state.thr ?? 0;
    const tv = $('thr-val'), tf = $('thr-fill');
    if (tv) tv.textContent = `${Math.round(thr * 100)}%${thr < 0 ? ' RÉ' : ''}`;
    if (tf) tf.style.width = `${Math.max(0, Math.min(100, Math.abs(thr) * 100))}%`;
  }
}
function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

// overlays de partida: contagem, morte/respawn, espera, fim
function updateOverlays(s) {
  const cd = $('countdown');
  if (!countdownDone && latest && !latest.over) {
    const el = performance.now();
    if (!updateOverlays.t0) updateOverlays.t0 = el;
    const k = Math.floor((el - updateOverlays.t0) / 600);
    if (k < 3) {
      cd.style.display = 'flex';
      const n = String(3 - k);
      if (cd.textContent !== n) { cd.textContent = n; audio.count(3 - k); }
    } else {
      cd.style.display = 'none';
      countdownDone = true;
      updateOverlays.t0 = 0;
      audio.count(0); audio.start();
      hud.toast('VAI! destrua tudo 🚀', 'bonus');
    }
  } else cd.style.display = 'none';

  const dead = $('dead-overlay');
  if (s && s.waiting) {
    dead.style.display = 'flex';
    $('dead-t').textContent = latest.mode === 'survival' ? 'você volta na próxima onda…' : 'partida em curso — você entra na próxima…';
  } else if (s && s.alive === false && !latest.over) {
    dead.style.display = 'flex';
    // morte vinda do servidor (kill event marca deathAt); contagem usa RESPAWN_S
    const left = Math.max(0, RESPAWN_S - Math.floor((performance.now() - deathAt) / 1000));
    $('dead-t').textContent = `renascendo em ${left}s`;
  } else dead.style.display = 'none';
}

// ---- resultados (idempotente por chave do resultado: snapshot over +
// evento over do servidor podem chegar duplicados) ----
function onGameOver(m, ev) {
  const key = JSON.stringify(m.result ?? null) + '|' +
    JSON.stringify(ev ? { w: ev.winner, d: ev.draw, def: ev.defeat, wv: ev.wave } : null);
  if (key === lastOverKey) return;
  lastOverKey = key;
  inMatch = false;
  document.exitPointerLock?.();
  audio.shutdown();
  const scores = m.scores || {};
  const players = scores.players || scores;
  const rows = Object.entries(players)
    .map(([id, e]) => ({ id, name: e.name || '?', kills: e.kills || 0, team: e.team }))
    .sort((a, b) => b.kills - a.kills);
  let title = '🏁 Fim de jogo';
  let iWon = false;
  if (ev.defeat) {
    title = `💥 Derrota na onda ${ev.wave || m.wave || '?'}`;
  } else if (m.mode === 'teams' && scores.teams) {
    const { red, blue } = scores.teams;
    if (ev.draw) title = `🤝 Empate! RED ${red} × ${blue} BLUE`;
    else if (ev.winner === 'red' || ev.winner === 'blue') {
      const w = ev.winner.toUpperCase();
      title = `${ev.winner === 'red' ? '🔴' : '🔵'} ${w} VENCEU ${red} × ${blue}!`;
      const myTeam = me()?.team;
      iWon = myTeam === ev.winner;
    }
  } else if (ev.draw) {
    title = '🤝 Empate no topo!';
  } else if (ev.winner) {
    const champ = players[ev.winner];
    title = champ ? `🏆 ${champ.name} venceu!` : '🏁 Fim de jogo';
    iWon = ev.winner === myId;
  } else if (rows[0]) {
    title = `🏆 ${rows[0].name} venceu!`;
    iWon = rows[0].id === myId;
  }
  audio.gameOver(iWon);
  $('final-title').textContent = title;
  $('final-rows').innerHTML = (m.mode === 'teams' && scores.teams
    ? `<div class="srow"><span>🔴 RED</span><span>${scores.teams.red} abates</span></div>
       <div class="srow"><span>🔵 BLUE</span><span>${scores.teams.blue} abates</span></div><hr>`
    : '') + (rows.map((r, i) =>
      `<div class="srow${r.id === myId ? ' me' : ''}"><span>${i + 1}. ${r.team ? `[${r.team.toUpperCase()}] ` : ''}${escapeHtml(r.name)}${r.id === m.hostId ? ' ♛' : ''}</span><span>${r.kills} abates</span></div>`
    ).join('') || 'sem pontos');
  show(ui.over);
}

// ---- lobby ----
function openLobby() {
  ensureScene();
  show(ui.lobby);
  $('l-code').textContent = myRoom.toUpperCase();
  $('l-link').textContent = `${location.origin}/?room=${encodeURIComponent(myRoom)}`;
  if (hp.expect) $('l-expect').textContent = `aguardando ~${hp.expect} jogadores (hub)`;
  else $('l-expect').textContent = '';
  startConn();
  clearInterval(openLobby.t);
  openLobby.t = setInterval(refreshLobby, 500);
}

const MODE_RULES = {
  ffa: 'LIVRE P/ TODOS · 5min · mais abates vence. Laser (click segurado), míssil teleguiado (E, com lock ◉), boost (Shift+W). Respawn 3s + proteção 2s (atirar quebra).',
  teams: 'EQUIPES RED × BLUE · 5min · soma dos abates vence. Fogo amigo desligado. Late-join espera a próxima partida. Míssil nunca trava aliado.',
  survival: 'SOBREVIVÊNCIA CO-OP · waves infinitas de bots (máx 6 vivos). Humanos não se ferem. Caiu? volta na próxima wave. Sobreviva o máximo!',
};

function refreshLobby() {
  if (!latest) return;
  const mode = latest.mode || selMode;
  const ships = latest.ships || [];
  const humans = ships.filter((s) => !s.bot);
  $('l-mode').textContent = { ffa: 'FFA · 5min', teams: 'EQUIPES RED × BLUE · 5min', survival: 'SOBREVIVÊNCIA · waves' }[mode] || mode;
  $('l-rules').textContent = MODE_RULES[mode] || MODE_RULES.ffa;
  if (mode !== selMode && humans.length > 1) {
    $('l-modenote').textContent = `(sala já é ${mode} — criada pelo primeiro piloto)`;
  } else $('l-modenote').textContent = '';
  const host = latest.hostId;
  const isHost = myId != null && myId === host;
  const myShip = ships.find((s) => s.id === myId);
  // prontidão autoritativa: espelha ship.ready do snapshot (não só o toggle local)
  if (myShip && ready !== !!myShip.ready) {
    ready = !!myShip.ready;
    $('l-ready').textContent = ready ? '✓ PRONTO! (toque p/ cancelar)' : 'Estou pronto';
  }
  $('l-count').textContent = `${humans.length}/${MAX_PLAYERS}`;
  $('l-countbar').style.width = `${Math.min(100, humans.length / MAX_PLAYERS * 100)}%`;
  const state = latest.state || 'lobby';
  $('l-state').textContent = state === 'playing' ? 'em partida — clique VOAR!'
    : state === 'over' ? 'encerrada'
    : waiting ? 'você entra na próxima'
    : humans.length > 1 ? 'pronta p/ voar' : 'aguardando pilotos…';
  $('l-rows').innerHTML = ships.map((s) => {
    const team = s.team ? `<span class="tag ${s.team === 'bots' ? 'bots' : s.team}">${s.team === 'bots' ? 'BOTS' : s.team.toUpperCase()}</span>` : '';
    const flag = s.id === host ? ' ♛ host' : s.bot ? ' • IA' : s.waiting ? ' • aguardando' : '';
    return `<div class="lrow${s.id === myId ? ' me' : ''}">
      <span class="dot" style="background:${escapeHtml(s.color || '#44ccff')}"></span>
      <span>${escapeHtml(s.name || '?')}${flag}</span>${team}
      <span>${s.ready ? 'PRONTO ✓' : s.id === myId ? 'sou eu' : ''}</span>
    </div>`;
  }).join('') || '<div class="lrow">hangar vazio — chame a esquadrilha!</div>';
  $('l-start').textContent = state !== 'lobby' ? '🚀 VOAR!'
    : isHost ? '🚀 INICIAR PARTIDA' : '🚀 VOAR! (host inicia)';
  // shuffle só faz sentido p/ host, em lobby, no modo teams (servidor ignora o resto)
  $('l-shuffle').style.display = (state === 'lobby' && mode === 'teams') ? '' : 'none';
}

// ---- fiação das telas ----
let ready = false;
function wire() {
  ui.room.value = (ui.room.value.trim() || 'ffa1').toLowerCase();
  document.querySelectorAll('#m-modes button').forEach((b) => {
    if (b.dataset.mode === selMode) b.classList.add('on');
    b.onclick = () => {
      audio.click();
      selMode = b.dataset.mode;
      document.querySelectorAll('#m-modes button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  document.querySelectorAll('#m-teams button').forEach((b) => {
    b.onclick = () => {
      audio.click();
      selTeam = b.dataset.team || null;
      document.querySelectorAll('#m-teams button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  document.querySelectorAll('#m-cam button').forEach((b) => {
    b.onclick = () => { audio.click(); setCamMode(b.dataset.cam); };
  });
  document.querySelectorAll('#l-cam button').forEach((b) => {
    b.onclick = () => { audio.click(); setCamMode(b.dataset.cam); refreshLobby(); };
  });
  document.querySelectorAll('#s-cam button').forEach((b) => {
    b.onclick = () => { audio.click(); setCamMode(b.dataset.cam); };
  });
  $('btn-create').onclick = () => {
    audio.unlock(); audio.click();
    if (!ui.name.value.trim()) { ui.name.focus(); return; }
    myName = ui.name.value.trim() || 'piloto';
    myColor = ui.color.value;
    myRoom = randCode();
    persistIdentity();
    openLobby();
  };
  $('btn-join').onclick = () => {
    audio.unlock(); audio.click();
    if (!ui.name.value.trim()) { ui.name.focus(); return; }
    myName = ui.name.value.trim() || 'piloto';
    myColor = ui.color.value;
    myRoom = (ui.room.value.trim() || 'ffa1').toLowerCase();
    persistIdentity();
    openLobby();
  };
  $('btn-settings').onclick = () => { audio.click(); openSettings(); };
  $('btn-help').onclick = () => { audio.click(); ui.help.style.display = 'flex'; };
  $('help-close').onclick = () => { audio.click(); ui.help.style.display = 'none'; };
  $('settings-close').onclick = () => { audio.click(); ui.settings.style.display = 'none'; saveSettings(); };
  $('l-ready').onclick = () => { audio.click(); ready = !ready; conn?.ready(ready); $('l-ready').textContent = ready ? '✓ PRONTO! (toque p/ cancelar)' : 'Estou pronto'; refreshLobby(); };
  $('l-start').onclick = () => {
    audio.unlock(); audio.click();
    // sem snapshot ainda (host clicou <200ms após abrir o lobby): trava com
    // toast até o 1º snapshot — sem isso o START pulava silencioso e o host
    // entrava em playing local sem partida no servidor.
    if (!latest) { hud.toast('sincronizando com o servidor — aguarde o hangar…', 'bad'); return; }
    // host inicia a partida no servidor (lobby → playing); os demais só entram na vista
    if (latest?.state === 'lobby' && myId != null && myId === latest?.hostId) conn?.start();
    enterMatch();
  };
  $('l-copy').onclick = async () => {
    audio.click();
    const link = `${location.origin}/?room=${encodeURIComponent(myRoom)}`;
    try { await navigator.clipboard.writeText(link); $('l-copy').textContent = '✓ link copiado!'; }
    catch { $('l-copy').textContent = link; }
    setTimeout(() => { $('l-copy').textContent = '⧉ copiar link'; }, 1500);
  };
  $('l-shuffle').onclick = () => { audio.click(); conn?.shuffle(); hud.toast('embaralhando equipes RED/BLUE 🌀 (host, lobby, teams)', 'bonus'); refreshLobby(); };
  $('lobby-back').onclick = () => { audio.click(); leaveAndClose(); clearInterval(openLobby.t); show(ui.menu); };
  $('l-settings').onclick = () => { audio.click(); openSettings(); };
  $('btn-rematch').onclick = () => { audio.click(); conn?.rematch(); hud.resetMatch(); lastOver = null; lastOverKey = null; countdownDone = false; inMatch = true; show(null); };
  $('btn-quit-lobby').onclick = () => { leaveAndClose(); inMatch = false; show(ui.menu); };
  $('btn-quit-lobby2').onclick = () => { audio.click(); leaveAndClose(); inMatch = false; lastOver = null; show(ui.menu); };
  $('pause-resume').onclick = () => {
    audio.click(); audio.unlock();
    ui.pause.style.display = 'none';
    try { const r = renderer?.canvas.requestPointerLock(); if (r && r.catch) r.catch((e) => { console.warn('pointer-lock falhou (retry via Esc reabre a pausa):', e?.message || e); }); } catch (e) { console.warn('pointer-lock falhou (retry via Esc reabre a pausa):', e?.message || e); }
  };
  $('pause-settings').onclick = () => { audio.click(); openSettings(); };
  $('pause-quit').onclick = () => { audio.click(); ui.pause.style.display = 'none'; inMatch = false; leaveAndClose(); show(ui.menu); };
  addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) ui.pause.style.display = 'none';
    else if (inMatch && latest && !latest.over && renderer) openPause();
  });
}

function enterMatch() {
  clearInterval(openLobby.t);
  inMatch = true;
  countdownDone = false;
  updateOverlays.t0 = 0;
  show(null); // mostra HUD
  $('hint').style.display = 'block';
  setTimeout(() => { $('hint').style.display = 'none'; }, 9000);
  audio.unlock();
  // sem lock (permissão negada/iframe) o jogo segue jogável em mira livre —
  // mesmo fallback do input.js (P0-5: caminho de permissão auditado)
  const noLock = () => { try { if (input) input.state.freeAim = true; } catch {} };
  try { const r = renderer.canvas.requestPointerLock(); if (r && r.catch) r.catch(noLock); } catch { noLock(); }
}

function openPause() {
  if (!inMatch) return;
  ui.pause.style.display = 'flex';
}

function openSettings() {
  syncSettingsUI();
  ui.settings.style.display = 'flex';
}
function setCamMode(m) {
  settings.camMode = m === 'tp' ? 'tp' : 'fp';
  saveSettings();
  syncCameraUI();
  updateCamLabels();
}
function syncCameraUI() {
  const m = settings.camMode === 'tp' ? 'tp' : 'fp';
  for (const sel of ['#m-cam', '#l-cam', '#s-cam']) {
    document.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
  }
}
function updateCamLabels() {
  const tp = settings.camMode === 'tp';
  const hint = tp
    ? '✈ 3ª PESSOA WT · mouse move o ○ (desejo no mundo) · nariz persegue c/ limite · ✛ = TIRO (nariz) · ◆ = impacto previsto · W/S manete · A/D bank+leme · click rajada · E míssil · F arma · Tab/Esc'
    : '🎥 1ª PESSOA cockpit · mouse move o ○ (desejo no mundo) · nariz persegue c/ limite · ✛ = TIRO (nariz) · ◆ = impacto previsto · W/S empuxo · A/D rolagem · click rajada · E míssil · F arma · Tab/Esc';
  const h = $('hint');
  if (h) h.textContent = hint;
  const cl = $('cam-label');
  if (cl) cl.textContent = tp ? '✈ 3ª PESSOA · ○ vira · ✛ atira' : '🎥 1ª PESSOA · ○ vira · ✛ atira';
  const tr = $('thr-row'), tb = $('thr-bar');
  if (tr) tr.style.display = tp ? 'flex' : 'none';
  if (tb) tb.style.display = tp ? 'block' : 'none';
}
function syncSettingsUI() {
  $('s-vol').value = settings.volume;
  $('s-mute').checked = settings.mute;
  $('s-sens').value = settings.sensitivity;
  $('s-inv').checked = settings.invertY;
  $('s-quality').value = settings.quality;
  $('s-fx').checked = settings.reduceFx;
  syncCameraUI();
  updateCamLabels();
}
function wireSettings() {
  $('s-vol').oninput = (e) => { settings.volume = Number(e.target.value); saveSettings(); };
  $('s-mute').onchange = (e) => { settings.mute = e.target.checked; saveSettings(); };
  $('s-sens').oninput = (e) => { settings.sensitivity = Number(e.target.value); saveSettings(); };
  $('s-inv').onchange = (e) => { settings.invertY = e.target.checked; saveSettings(); };
  $('s-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); };
  $('s-fx').onchange = (e) => { settings.reduceFx = e.target.checked; saveSettings(); };
}

function persistIdentity() {
  sessionStorage.setItem('nw-name', myName);
  sessionStorage.setItem('nw-color', myColor);
  sessionStorage.setItem('nw-room', myRoom);
}
function randCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s.toLowerCase();
}
// saída explícita: LEAVE libera a vaga na hora; close sem LEAVE vira fantasma 30s
function leaveAndClose() {
  backoff.reset(); wantConn = false; // sair cancela reconexão pendente
  try { conn?.leave?.(); } catch {}
  try { sessionStorage.removeItem(resumeKey()); } catch {}
  try { sessionStorage.removeItem(`${resumeKey()}-tok`); } catch {}
  conn?.close();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- boot ----
wire();
wireSettings();
syncSettingsUI();
updateCamLabels();
show(ui.menu);
// gancho p/ verificação automatizada (CDP): leitura de snapshot/id + mira local
// __nw.aim (contrato Lane N→R)
// (Lane F2: FP e TP publicam ○ — mesmo desejo/perseguição w_max): { mode:'fp'|'tp',
//   nose:{yaw,pitch}|null, ball:{x,y,z}|null (○ no mundo, vivo),
//   cursor:{x,y}|null (○ em px, clamp borda), reticle:{x,y} (✛ central = nariz) }
// — FP e TP publicam ○ (mesmo desejo/perseguição w_max); morto/espera →
// tudo null + reticle no centro.
window.__nw = { get snap() { return latest; }, get id() { return myId; }, get room() { return myRoom; }, get camMode() { return settings.camMode; }, get aim() { return aimDbg; }, get local() { return input ? { yaw: input.state.yaw, pitch: input.state.pitch, roll: input.state.roll, cx: input.state.cx, cy: input.state.cy, thr: input.state.thr, dyaw: input.state.dyaw, dpitch: input.state.dpitch } : null; }, get pred() { return pred ? { x: pred.x, y: pred.y, z: pred.z } : null; }, get cam() { return renderer?.camPos ? { x: renderer.camPos.x, y: renderer.camPos.y, z: renderer.camPos.z } : null; }, get camUp() { return renderer?.camUp || null; }, get shipUp() { return renderer?.shipUp || null; } };
if (hp.hub) {
  // Hub: sem pedir de novo — usa name/room/htok da query ou session
  $('hub-note').style.display = 'block';
  if (hp.name) ui.name.value = hp.name;
  if (hp.room) ui.room.value = hp.room.toLowerCase();
  if (hp.mode === 'ffa' || hp.mode === 'teams' || hp.mode === 'survival') {
    selMode = hp.mode;
    document.querySelectorAll('#m-modes button').forEach((x) => x.classList.toggle('on', x.dataset.mode === selMode));
  }
  if (hp.name && hp.room) {
    myName = ui.name.value.trim();
    myColor = ui.color.value;
    myRoom = ui.room.value.trim().toLowerCase();
    persistIdentity();
    openLobby();
    // create=1 (criador) fica no lobby e inicia quando a turma chega;
    // create=0 entra direto; sem create segue expect (link direto legado).
    if (shouldAutoEnter({ create: hp.create, expect: hp.expect })) enterMatch();
  }
}
loop();
