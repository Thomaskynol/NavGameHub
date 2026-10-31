// public/js/main.js — orquestrador único de "Asfalto Vivo" (ARCHITECTURE §6–§8).
// Roteia UI ↔ net ↔ engine ↔ audio; guarda av.session; reconstrói corrida na
// reconexão; monta HUD/minimapa; relógio do servidor; limpeza total entre corridas.
//
// TODO centralizado (lane gfx em paralelo): ./game/engine.js e ./input.js podem
// ainda não existir no disco; são importados de forma DINÂMICA e a integração
// degrada com toast (nunca tela travada). Contratos: ARCHITECTURE §6 + extensões
// engine.load(trackId,{grid,roster,you,laps}) / getHudPayload / start({mode}).

import { initUI, show, updateRoom, setConn, toast, hud } from './ui/index.js';
import * as net from './net.js';
import * as audioMod from './audio.js';
import { loadSettings, saveSettings, loadRecords, saveRecord } from './store.js';
import { TRACKS } from '/shared/tracks.js';
import { createSampler } from '/shared/trackMath.js';
import { PHYSICS, STATE_HZ, STORAGE } from '/shared/constants.js';
import { parseHubParams } from './hub.js';

// ---------------------------------------------------------------- traduções

const ERR_PT = {
  NOT_FOUND: 'Sala não encontrada.',
  FULL: 'Sala cheia.',
  BAD_NAME: 'Apelido inválido (vazio ou longo demais).',
  BAD_COLOR: 'Cor inválida ou já ocupada nesta sala.',
  NOT_HOST: 'Somente o organizador pode fazer isso.',
  NOT_READY: 'Nem todos os pilotos estão prontos.',
  RACING: 'A corrida já está em andamento.',
  INVALID: 'Ação inválida.',
  RATE: 'Muitas atualizações por segundo.',
  RECONNECT_EXPIRED: 'Sua sessão expirou. Entre novamente.',
  CODE_TAKEN: 'O código da sala já está em uso.',
};
const REASON_PT = {
  finished: 'Corrida concluída.',
  deadline: 'Tempo esgotado.',
  abandoned: 'Corrida abandonada.',
  cancel: 'Corrida cancelada.',
};

// ---------------------------------------------------------------- estado

let uiApi = null;
let engine = null;            // engine ativo (mp ou tt) — SEMPRE um só
let inputMod = null;          // módulo input.js (false = indisponível; null = não testado)
let engineFactory = null;     // createEngine cacheado

let mode = 'home';            // 'home'|'busy'|'lobby'|'wait'|'race'|'results'|'tt'
let paused = false;
let raceStarted = false;      // engine.start já chamado nesta corrida
let finished = false;         // já cruzei a chegada (mp)
let selfId = null;
let roomCode = '';
let session = null;           // {room,id,token,name,color} (av.session)
let pending = null;           // tentativa em voo {kind,code?}
let lastState = null;         // último msg state

let raceInfo = null;          // {trackId,laps,sampler,roster,startAtSrv,deadlineAt,total,minimapPoly}
let lastSn = null;            // último sn
let ttTrack = null;           // {trackId,name,color} do TT atual

const timers = { st: null, hud: null, audio: null, dd: null, ttCd: null };
let reconnecting = false;     // viu 'reconnecting' (dispara resume ao voltar 'online')

let engineMount = null;
let prepareSeq = 0;             // token: cancela prepare obsoleto (cancel/bye/results durante o load)
let hubMode = null;             // {room,name,create,expect,slot,color,hubUrl} quando ?hub=1

// ---------------------------------------------------------------- helpers

function safe(fn) {
  try { return fn(); } catch { return null; }
}

function fmtMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const t = Math.floor(ms / 1000);
  const m = Math.floor(t / 60);
  const s = t % 60;
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function urlRoomCode() {
  try {
    return (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  } catch { return ''; }
}

// Modo Hub: ?hub=1&room=&name=&create=1|0&expect=&slot=&color=&hubUrl=
// (parsing puro em ./hub.js; aqui só lê o search atual).
function readHubParams() {
  try {
    return parseHubParams(location.search);
  } catch { return null; }
}

// Erro no modo Hub: sem home/overlay de entrada; fica na tela de carga
// com o caminho de volta à sala do Hub.
function failHub(title, text) {
  pending = null;
  mode = 'busy';
  show('loading', { title, text: text || '', hubUrl: hubMode?.hubUrl || '' });
  if (text) toast(text, 'err');
}

// --- sessão (sessionStorage — §9)

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE.session) || 'null'); } catch { return null; }
}
function persistSession() {
  if (!session) return;
  try { sessionStorage.setItem(STORAGE.session, JSON.stringify(session)); } catch { /* ok */ }
}
function clearSession() {
  session = null;
  try { sessionStorage.removeItem(STORAGE.session); } catch { /* ok */ }
}

// --- mount do canvas 3D (o UI não expõe um; fica entre body e #av-ui — base.css)

function ensureMount() {
  if (!engineMount) {
    engineMount = document.createElement('div');
    engineMount.id = 'av-canvas';
    Object.assign(engineMount.style, {
      position: 'fixed', inset: '0', zIndex: '5', pointerEvents: 'auto', display: 'none',
    });
    document.body.append(engineMount);
  }
  engineMount.replaceChildren(); // garante mount limpo p/ novo engine
  engineMount.style.display = 'block';
  return engineMount;
}
function hideMount() {
  if (engineMount) engineMount.style.display = 'none';
}

// --- módulos gfx (dinâmicos: podem ainda não existir no disco)

async function getCreateEngine() {
  if (engineFactory) return engineFactory;
  const mod = await import('./game/engine.js');
  engineFactory = mod.createEngine;
  if (typeof engineFactory !== 'function') throw new Error('engine.js sem createEngine');
  return engineFactory;
}

async function getInput() {
  if (inputMod !== null) return inputMod || null;
  try { inputMod = await import('./input.js'); } catch { inputMod = false; }
  return inputMod || null;
}

function inputSetActive(on) {
  const m = inputMod;
  if (m && typeof m.setActive === 'function') safe(() => m.setActive(!!on));
}

// ---------------------------------------------------------------- engine

function wireEngineEvents(eng) {
  eng.on('notice', (p) => {
    const text = typeof p === 'string' ? p : p?.text;
    const kind = p && p.kind === 'warn' ? 'warn' : 'info';
    if (text) hud.notice(String(text), kind);
  });
  eng.on('wrongway', (on) => {
    if (on) { hud.notice('Contramão! Volte para a pista.', 'warn'); audioMod.sfx('wrongway'); }
  });
  eng.on('nitro', (on) => { if (on) audioMod.sfx('nitro'); });
  eng.on('collision', () => audioMod.sfx('collide'));
  eng.on('wall', () => audioMod.sfx('wall'));          // defensivo: gfx pode emitir
  eng.on('recover', () => audioMod.sfx('recover'));    // defensivo: gfx pode emitir
  eng.on('invalid_lap', () => {
    hud.setInvalidLap(true);
    if (mode === 'tt') hud.notice('Volta inválida (recuperação)', 'warn');
  });
  eng.on('lap', (p) => {
    if (mode !== 'tt') return; // mp: servidor é a autoridade (msg 'lap')
    if (!p || p.valid === false) {
      hud.setInvalidLap(true);
      hud.notice('Volta inválida (recuperação)', 'warn');
      return;
    }
    hud.setInvalidLap(false);
    if (typeof p.timeMs === 'number' && ttTrack && saveRecord(ttTrack.trackId, p.timeMs)) {
      hud.notice(`Novo recorde: ${fmtMs(p.timeMs)}!`, 'ok', 4000);
    }
    audioMod.sfx('lap');
  });
  eng.on('finish', () => { if (mode === 'tt') audioMod.sfx('finish'); });
}

/** Cria engine + sampler para a pista; substitui QUALQUER engine anterior. */
async function setupEngine(trackId, { grid = null, roster = null, laps = null, you = null } = {}) {
  disposeEngine();
  const track = TRACKS[trackId];
  if (!track) throw new Error(`pista desconhecida: ${trackId}`);
  const sampler = createSampler(track); // falha rápida p/ traçado inválido
  const createEngine = await getCreateEngine();
  const eng = createEngine({ mount: ensureMount(), getSettings: loadSettings, audio: audioMod });
  engine = eng;
  raceInfo = {
    trackId,
    laps,
    sampler,
    minimapPoly: null,
    roster: new Map((roster || []).map((p) => [p.id, p])),
    startAtSrv: null,
    deadlineAt: null,
    total: (roster || []).length || 1,
    you,
  };
  lastSn = null;
  raceStarted = false;
  finished = false;
  paused = false;
  wireEngineEvents(eng);
  await eng.load(trackId, { grid, roster, you, laps });
  await getInput(); // best-effort: input.js junto do engine
  globalThis.__av = { // hook de smoke/debug (tools/smoke_e2e.mjs)
    engine: () => engine,
    sampler: () => raceInfo?.sampler || null,
    info: () => raceInfo,
    lastSn: () => lastSn,
  };
  return eng;
}

function disposeEngine() {
  stopLoops();
  if (engine) { safe(() => engine.dispose()); }
  engine = null;
  lastSn = null;
  raceInfo = null;
  raceStarted = false;
  finished = false;
  paused = false;
  inputSetActive(false);
  safe(() => audioMod.engine.stop());
  safe(() => audioMod.nitroSfx(false));
  safe(() => audioMod.skidSfx(0));
  hud.countdown(null);
  hud.setInvalidLap(false);
  hideMount();
}

// ---------------------------------------------------------------- loops

function stopLoops() {
  for (const k of ['st', 'hud', 'audio', 'dd', 'ttCd']) {
    if (timers[k]) { clearInterval(timers[k]); timers[k] = null; }
  }
}

function startLoops({ mp }) {
  stopLoops();
  const hz = Math.max(10, Math.round(1000 / STATE_HZ));
  if (mp) timers.st = setInterval(tickSt, hz);
  timers.hud = setInterval(tickHud, hz);
  timers.audio = setInterval(tickAudio, 100);
}

function tickSt() {
  if (!engine || paused) return;
  const st = safe(() => engine.getLocalState?.());
  if (st) net.send({ t: 'st', ...st });
}

function tickHud() {
  if (!engine || (mode !== 'race' && mode !== 'tt')) return;
  const payload = buildHudPayload();
  if (payload) hud.update(payload);
}

function tickAudio() {
  if (!engine) return;
  const h = safe(() => engine.getHudPayload?.()) || {};
  const st = safe(() => engine.getLocalState?.()) || null;
  const v = Math.abs(Number(st?.v) || 0);
  const rpm01 = Math.min(1, v / PHYSICS.maxSpeed);
  const load01 = h.nitroActive ? 1 : rpm01; // st.nit é 0..100 (não flag); nitroActive vem do HUD
  safe(() => audioMod.engine.update(rpm01, load01, v > 1));
  safe(() => audioMod.nitroSfx(!!h.nitroActive));
  safe(() => audioMod.skidSfx(Number(st?.dr) || 0));
}

function startDeadlineTicker() {
  if (timers.dd) return;
  timers.dd = setInterval(() => {
    if (mode !== 'race' || raceInfo?.deadlineAt == null || lastSn?.raceNow == null) return;
    const rem = raceInfo.deadlineAt - lastSn.raceNow;
    if (rem > 0) hud.notice(`Encerrando em ${Math.ceil(rem / 1000)}s`, 'info', 1200);
  }, 1000);
}

// ---------------------------------------------------------------- HUD payload

function buildMinimap(positions, youPos) {
  if (!raceInfo?.sampler) return null;
  if (!raceInfo.minimapPoly) raceInfo.minimapPoly = raceInfo.sampler.polyline(200);
  const poly = raceInfo.minimapPoly;
  let minX = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    polyline: poly,
    bounds: { minX, minZ, maxX, maxZ },
    you: youPos ? { x: youPos.x, z: youPos.z, heading: youPos.heading || 0 } : null,
    others: positions.filter((p) => !p.isYou).map((p) => ({ x: p.x, z: p.z, color: p.color })),
  };
}

function buildHudPayload() {
  const h = safe(() => engine.getHudPayload?.()) || {};
  const positions = safe(() => engine.getCarPositions?.()) || [];
  const youPos = positions.find((p) => p.isYou) || positions[0] || null;
  const minimap = buildMinimap(positions, youPos);
  const youColor = raceInfo?.roster?.get(selfId)?.color || loadSettings().color;

  if (mode === 'tt') {
    const tt = h.tt || {};
    const lapsDone = Array.isArray(tt.lapTimes) ? tt.lapTimes.length : 0;
    const cur = Number(tt.currentLapMs) || 0;
    const done = Array.isArray(tt.lapTimes)
      ? tt.lapTimes.reduce((a, b) => a + (Number(b) || 0), 0)
      : 0;
    const best = tt.bestLapMs ?? (ttTrack ? loadRecords()[ttTrack.trackId]?.bestLapMs ?? null : null);
    return {
      speedKmh: h.speedKmh ?? 0,
      nitro: h.nitro01 ?? 0,             // HUD usa `nitro`; getHudPayload devolve `nitro01`
      nitroActive: !!h.nitroActive,
      place: 1, total: 1,
      lap: lapsDone + 1, laps: '∞',
      raceTimeMs: done + cur,
      lapTimeMs: cur,
      bestLapMs: best ?? null,
      youColor,
      standings: [{
        id: 'me',
        dname: loadSettings().nickname || 'Você',
        color: youColor,
        place: 1, lap: lapsDone + 1, fin: 0, dnf: false,
      }],
      minimap,
    };
  }

  // multiplayer
  const me = lastSn?.cars?.find((c) => c.id === selfId) || null;
  const laps = raceInfo?.laps ?? null;
  const total = lastSn?.cars?.length ?? raceInfo?.total ?? 1;
  const standings = (lastSn?.cars || [])
    .slice()
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || (a.id < b.id ? -1 : 1))
    .map((c) => {
      const r = raceInfo?.roster?.get(c.id);
      return {
        id: c.id,
        dname: r?.dname,
        color: r?.color,
        place: c.place,
        lap: c.fin ? c.lap : (c.lap ?? 0) + 1, // servidor é 0-based
        fin: !!c.fin,
        dnf: false,
      };
    });
  return {
    speedKmh: h.speedKmh ?? 0,
    nitro: h.nitro01 ?? 0,
    nitroActive: !!h.nitroActive,
    place: me?.place ?? null,
    total,
    lap: me ? (me.fin ? (laps ?? me.lap) : (me.lap ?? 0) + 1) : null,
    laps,
    raceTimeMs: lastSn?.raceNow ?? 0,
    lapTimeMs: me?.le ?? 0,
    bestLapMs: me?.bl ?? null,
    youColor,
    standings,
    minimap,
  };
}

// ---------------------------------------------------------------- rede: mensagens

function onNetMessage(msg) {
  switch (msg.t) {
    case 'welcome':
    case 'pong':
      break; // offset tratado dentro de net.js
    case 'joined': onJoined(msg); break;
    case 'err': onErr(msg); break;
    case 'state': onState(msg); break;
    case 'prepare': onPrepare(msg); break;
    case 'cd': onCd(msg); break;
    case 'sn': onSn(msg); break;
    case 'snap_self': {
      if (engine) safe(() => engine.applyCorrection?.({ x: msg.x, z: msg.z, hd: msg.hd, v: msg.v }));
      break;
    }
    case 'lap': onServerLap(msg); break;
    case 'fin': onFin(msg); break;
    case 'deadline': {
      if (raceInfo) { raceInfo.deadlineAt = msg.at; startDeadlineTicker(); }
      break;
    }
    case 'results': onResults(msg); break;
    case 'back_lobby': onBackToLobby(); break;
    case 'cancel': onCancel(msg); break;
    case 'collide': {
      if (msg.a === selfId || msg.b === selfId) audioMod.sfx('collide');
      break;
    }
    case 'notice': onNotice(msg); break;
    case 'bye': onBye(msg); break;
    default: break;
  }
}

function onJoined(msg) {
  pending = null;
  selfId = msg.you;
  roomCode = msg.room;
  const s = loadSettings();
  session = { room: msg.room, id: msg.you, token: msg.token, name: s.nickname, color: s.color };
  persistSession();
  safe(() => uiApi.setSelf?.(selfId));
  safe(() => uiApi.setRoomCode?.(roomCode));
  lastState = msg.state || null;
  audioMod.sfx('join');

  if (msg.mode === 'race' && msg.state?.race) {
    rebuildRaceFromState(msg.state).catch((err) => {
      console.error('reconexão em corrida falhou:', err);
      toast('Não foi possível retomar a corrida.', 'err');
      leaveToHome(true);
    });
    return;
  }
  if (msg.mode === 'waiting') {
    mode = 'wait';
    show('wait');
    updateRoom(msg.state);
    return;
  }
  mode = 'lobby';
  show('lobby', { room: msg.room, you: msg.you });
  updateRoom(msg.state);
}

/** Reconexão com mode:'race' — reconstrói a partir de state.race (§3 joined). */
async function rebuildRaceFromState(state) {
  const r = state.race;
  const trackId = typeof r.track === 'string' ? r.track : r.track?.id;
  const carIds = new Set((r.cars || []).map((c) => c.id));
  mode = 'race';
  show('loading', { title: 'Reconectando à corrida…' });
  await setupEngine(trackId, {
    grid: (r.cars || []).map((c) => ({ id: c.id, x: c.x, z: c.z, heading: c.hd })),
    // só quem CORREU (ids de r.cars): players inclui quem está na tela de espera
    roster: (state.players || [])
      .filter((p) => carIds.has(p.id))
      .map((p) => ({ id: p.id, dname: p.dname, color: p.color })),
    laps: r.laps ?? null,
    you: selfId,
  });
  raceInfo.deadlineAt = r.deadlineAt ?? null;
  raceInfo.total = (r.cars || []).length || raceInfo.total;
  const snap = { seq: 0, raceNow: r.raceNow ?? 0, cars: r.cars || [] };
  lastSn = snap;
  safe(() => engine.applySnapshot(snap));
  show('race');
  inputSetActive(true);
  if (r.raceNow != null) {
    // corrida já rodando: retoma sem countdown
    raceInfo.startAtSrv = net.serverNow() - r.raceNow;
    net.noteServerNow(raceInfo.startAtSrv); // amostra de raceStart p/ offset
    safe(() => engine.start({ startAtServerTime: raceInfo.startAtSrv, now: net.serverNow, mode: 'mp' }));
    raceStarted = true;
    const me = (r.cars || []).find((c) => c.id === selfId);
    if (me?.fin) { finished = true; safe(() => engine.pause(true)); }
    safe(() => audioMod.engine.start());
    startLoops({ mp: true });
    startDeadlineTicker();
  }
  // raceNow == null (prepare/countdown): aguarda cd p/ start
}

function onErr(msg) {
  const pt = ERR_PT[msg.code] || msg.msg || 'Erro no servidor.';
  audioMod.sfx('error');
  if (hubMode) {
    if (msg.code === 'CODE_TAKEN' && pending?.kind === 'create' && hubMode.room) {
      // Sala já existe (tentativa repetida): entra nela em vez de falhar.
      startJoin(hubMode.room, hubMode.color, { autoColor: true });
      return;
    }
    if (msg.code === 'RECONNECT_EXPIRED') clearSession();
    failHub('Não foi possível entrar na partida.', pt);
    return;
  }
  toast(pt, 'err');
  if (msg.code === 'RECONNECT_EXPIRED') {
    clearSession();
    leaveToHome(true);
    return;
  }
  if (pending) {
    const p = pending;
    pending = null;
    mode = 'home';
    if (p.kind === 'join') show('join', { code: p.code, error: pt });
    else show('home');
  }
}

function onState(msg) {
  lastState = msg;
  if (mode === 'lobby' || mode === 'wait') {
    if (mode === 'wait' && msg.status === 'lobby') {
      mode = 'lobby';
      show('lobby', { room: roomCode, you: selfId });
    }
    updateRoom(msg);
    return;
  }
  // alguém já voltou ao lobby antes do back_lobby chegar a nós
  if (mode === 'results' && msg.status === 'lobby') onBackToLobby();
}

async function onPrepare(msg) {
  const trackId = typeof msg.track === 'string' ? msg.track : msg.track?.id;
  pending = null;
  mode = 'race';
  const prep = ++prepareSeq;
  show('loading');
  let eng = null;
  try {
    eng = await setupEngine(trackId, {
      grid: msg.grid || null,
      roster: msg.roster || null,
      laps: msg.laps ?? null,
      you: selfId,
    });
  } catch (err) {
    if (prepareSeq !== prep || mode !== 'race') {
      // prepare obsoleto (cancel/bye/results/no meio do load): só limpa o engine
      // que ainda for o deste prepare — um prepare mais novo já assumiu o atual
      if (engine && engine === eng) disposeEngine();
      return;
    }
    console.error('prepare: falha ao carregar a cena:', err);
    audioMod.sfx('error');
    toast('Não foi possível carregar a pista.', 'err');
    net.send({ t: 'leave' });
    clearSession();
    disposeEngine();
    mode = 'home';
    show('home');
    return;
  }
  if (prepareSeq !== prep || mode !== 'race') {
    // tela mudou durante o await: não envia ready_load nem deixa o rAF vivo
    if (engine && engine === eng) disposeEngine();
    return;
  }
  raceInfo.total = (msg.roster || []).length || raceInfo.total;
  net.send({ t: 'ready_load' });
}

function onCd(msg) {
  if (mode !== 'race' || !engine) return;
  const n = Number(msg.n);
  show('race'); // cobre reconexão no meio da contagem
  if (n > 0) { hud.countdown(n); audioMod.sfx('countdown'); return; }
  hud.countdown(0);
  audioMod.sfx('go');
  net.noteServerNow(msg.at); // n=0: at == raceStart (serverNow do GO)
  if (raceInfo) raceInfo.startAtSrv = msg.at;
  if (!raceStarted) {
    raceStarted = true;
    safe(() => engine.start({ startAtServerTime: msg.at, now: net.serverNow, mode: 'mp' }));
    safe(() => audioMod.engine.start());
    startLoops({ mp: true });
    inputSetActive(true);
    startDeadlineTicker();
  }
}

function onSn(msg) {
  lastSn = msg;
  if (raceInfo?.startAtSrv != null && typeof msg.raceNow === 'number') {
    net.noteServerNow(raceInfo.startAtSrv + msg.raceNow); // §8: amostra por snapshot
  }
  if (engine && !paused) safe(() => engine.applySnapshot(msg));
}

function onServerLap(msg) {
  if (msg.id !== selfId) return; // adversários: só standings/HUD
  if (msg.valid) {
    hud.setInvalidLap(false);
    hud.notice(`Volta ${msg.lap}: ${fmtMs(msg.timeMs)}`, 'ok');
    audioMod.sfx('lap');
  } else {
    hud.setInvalidLap(true);
    hud.notice('Volta inválida', 'warn');
  }
}

function onFin(msg) {
  if (msg.id === selfId) {
    if (finished) return;
    finished = true;
    audioMod.sfx('finish');
    hud.notice('Você terminou! Aguardando os demais…', 'ok', 8000);
    // câmera livre: pause(true) em mp zera input (§6) — continua simulando
    if (engine) safe(() => engine.pause(true));
  } else {
    audioMod.sfx('click'); // discreto
  }
}

function onResults(msg) {
  stopLoops();
  raceStarted = false;
  mode = 'results';
  safe(() => engine?.pause?.(true));
  hideMount(); // tela de resultados sem canvas por baixo
  show('results', {
    rows: msg.rows || [],
    reason: REASON_PT[msg.reason] || 'Corrida encerrada.',
    hubUrl: hubMode?.hubUrl || '',
  });
  audioMod.sfx('finish');
}

function onBackToLobby() {
  disposeEngine();
  mode = 'lobby';
  show('lobby', { room: roomCode, you: selfId });
  if (lastState) updateRoom(lastState); // o state real logo em seguida re-renderiza
}

function onCancel(msg) {
  audioMod.sfx('error');
  toast(msg?.msg || 'Contagem cancelada.', 'warn');
  disposeEngine();
  mode = 'lobby';
  show('lobby', { room: roomCode, you: selfId });
  if (lastState) updateRoom(lastState);
}

function onNotice(msg) {
  const text = msg?.msg || '';
  if (!text) return;
  if (mode === 'race' || mode === 'tt') hud.notice(text, msg.kind === 'warn' ? 'warn' : 'info');
  else toast(text, msg.kind === 'err' ? 'err' : 'warn');
}

function onBye(msg) {
  const text = msg?.reason === 'replaced'
    ? 'Sua sessão foi substituída por outra conexão nesta sala.'
    : 'A sala foi encerrada.';
  if (hubMode) {
    clearSession();
    disposeEngine();
    failHub('A partida foi encerrada.', text);
    return;
  }
  toast(text, 'warn');
  clearSession();
  disposeEngine();
  mode = 'home';
  show('home');
}

// ---------------------------------------------------------------- rede: status

function onNetStatus(s) {
  setConn(s);
  if (s === 'reconnecting') { reconnecting = true; return; }
  if (s === 'online') {
    if (reconnecting) {
      reconnecting = false;
      if (session?.room && session?.token) resumeJoin();
    }
    return;
  }
  if (s === 'offline') toast('Sem conexão com o servidor.', 'err');
}

function resumeJoin() {
  if (!session?.room || !session?.token) return;
  pending = { kind: 'resume' };
  net.send({
    t: 'join',
    room: session.room,
    name: session.name,
    color: session.color,
    resume: session.token,
  });
}

async function ensureConnected() {
  if (net.status() === 'online') return true;
  return Promise.race([
    net.connect().then(() => true).catch(() => false),
    new Promise((resolve) => setTimeout(() => resolve(net.status() === 'online'), 12000)),
  ]);
}

// ---------------------------------------------------------------- navegação

function leaveToHome(sendLeave) {
  if (sendLeave && roomCode) net.send({ t: 'leave' });
  clearSession();
  disposeEngine();
  lastState = null;
  roomCode = '';
  selfId = null;
  pending = null;
  mode = 'home';
  show('home');
}

function leaveEverything() {
  leaveToHome(true);
}

async function startCreate(a) {
  const name = String(a?.name || '').trim();
  const color = a?.color || loadSettings().color;
  if (!name) {
    audioMod.sfx('error');
    if (hubMode) failHub('Não foi possível criar a partida.', 'Apelido ausente no convite do Hub.');
    else toast('Informe um apelido para entrar.', 'warn');
    return;
  }
  saveSettings({ nickname: name, color });
  pending = { kind: 'create' };
  mode = 'busy';
  show('loading', { title: 'Criando a sala…' });
  const ok = await ensureConnected();
  if (!ok) {
    if (hubMode) failHub('Sem conexão com o servidor.', 'Não foi possível abrir a partida.');
    else { pending = null; mode = 'home'; show('home'); toast('Sem conexão com o servidor.', 'err'); }
    return;
  }
  net.send({ t: 'create', name, color, ...(a?.room ? { room: a.room } : {}) });
}

async function startJoin(code, color, opts = {}) {
  const s = loadSettings();
  const name = String(s.nickname || '').trim();
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!name) {
    audioMod.sfx('error');
    if (hubMode) failHub('Não foi possível entrar na partida.', 'Apelido ausente no convite do Hub.');
    else { toast('Informe um apelido para entrar.', 'warn'); show('home'); }
    return;
  }
  if (clean.length !== 6) {
    audioMod.sfx('error');
    if (hubMode) failHub('Código de sala inválido.', 'O Hub não informou um código de 6 caracteres.');
    else toast('O código da sala tem 6 caracteres.', 'warn');
    return;
  }
  pending = { kind: 'join', code: clean };
  mode = 'busy';
  show('loading', { title: 'Entrando na sala…' });
  const ok = await ensureConnected();
  if (!ok) {
    if (hubMode) { failHub('Sem conexão com o servidor.', 'Não foi possível entrar na partida.'); return; }
    pending = null; mode = 'home';
    show('join', { code: clean, error: 'Sem conexão com o servidor.' });
    return;
  }
  // No Hub, sem cor na URL: omite a cor e o servidor escolhe uma livre.
  const chosen = color || (opts.autoColor ? null : s.color);
  net.send({ t: 'join', room: clean, name, ...(chosen ? { color: chosen } : {}) });
}

// ---------------------------------------------------------------- time trial

async function startTT(a) {
  const trackId = a?.trackId;
  if (!TRACKS[trackId]) { audioMod.sfx('error'); toast('Pista inválida.', 'err'); return; }
  const s = loadSettings();
  ttTrack = { trackId, name: a?.name || s.nickname, color: a?.color || s.color };
  mode = 'tt';
  show('loading', { title: 'Preparando o circuito…' });
  try {
    await setupEngine(trackId, { you: 'me', laps: null });
  } catch (err) {
    console.error('tt: falha ao carregar a cena:', err);
    audioMod.sfx('error');
    toast('Não foi possível carregar a pista.', 'err');
    ttTrack = null;
    mode = 'home';
    show('home');
    return;
  }
  show('race');
  inputSetActive(true);
  startLoops({ mp: false }); // hud + áudio; sem st (sem servidor)
  runLocalCountdown();
}

function runLocalCountdown() {
  if (timers.ttCd) { clearTimeout(timers.ttCd); timers.ttCd = null; }
  let n = 3;
  const step = () => {
    hud.countdown(n);
    if (n === 0) {
      audioMod.sfx('go');
      timers.ttCd = setTimeout(() => hud.countdown(null), 900);
      safe(() => engine?.start?.({ startAtServerTime: null, now: () => performance.now(), mode: 'tt' }));
      safe(() => audioMod.engine.start());
      return;
    }
    audioMod.sfx('countdown');
    n -= 1;
    timers.ttCd = setTimeout(step, 1000);
  };
  step();
}

function restartTT() {
  if (!ttTrack) return;
  const t = ttTrack;
  disposeEngine();
  startTT({ trackId: t.trackId, name: t.name, color: t.color });
}

// ---------------------------------------------------------------- pausa

function doPause() {
  if (mode !== 'race' && mode !== 'tt') return;
  if (paused) return;
  paused = true;
  if (engine) safe(() => engine.pause(true));
  inputSetActive(false);
  safe(() => audioMod.engine.stop());
  safe(() => audioMod.nitroSfx(false));
  safe(() => audioMod.skidSfx(0));
  show('pause'); // overlay; corrida segue visível por baixo
  audioMod.sfx('menu_open');
}

function doResume() {
  if (!paused) return;
  paused = false;
  if (engine) safe(() => engine.pause(false));
  if (mode === 'race' || mode === 'tt') {
    inputSetActive(true);
    if (raceStarted || mode === 'tt') safe(() => audioMod.engine.start());
  }
}

function onEsc() {
  if (mode !== 'race' && mode !== 'tt') return;
  if (paused) {
    safe(() => uiApi?.closePause?.());
    doResume();
  } else {
    doPause();
  }
}

// ---------------------------------------------------------------- settings

function applyRuntime(patch) {
  const s = loadSettings(); // UI já persistiu o patch
  if (patch && ('volume' in patch || 'muted' in patch)) {
    audioMod.setAudioVolume(s.volume, s.muted);
  }
  // steerSensitivity/fxIntensity: engine lê via getSettings() a cada passo.
  // quality: vale no próximo setupEngine() (não reinicia renderer no meio).
}

// ---------------------------------------------------------------- ações UI

function onAction(a) {
  switch (a?.type) {
    case 'create': startCreate(a); break;
    case 'join': startJoin(a.code, a.color); break;       // contrato §6
    case 'join_submit': startJoin(a.code, null); break;   // UI real
    case 'join_url': startJoin(urlRoomCode(), a.color); break;
    case 'tt_start': startTT(a); break;
    case 'open_settings':
    case 'open_help': audioMod.sfx('menu_open'); break;
    case 'back_home': onBackHome(); break;
    case 'lobby_copy': audioMod.sfx('click'); break; // UI já copia o link
    case 'lobby_color':
      saveSettings({ color: a.color });
      net.send({ t: 'set', color: a.color });
      break;
    case 'lobby_ready': net.send({ t: 'set', ready: !!a.ready }); audioMod.sfx('click'); break;
    case 'lobby_track': net.send({ t: 'set', track: a.trackId }); break;
    case 'lobby_laps': net.send({ t: 'set', laps: a.laps }); break;
    case 'lobby_start': net.send({ t: 'start' }); audioMod.sfx('click'); break;
    case 'lobby_leave': leaveEverything(); break;
    case 'results_lobby': net.send({ t: 'back_lobby' }); break; // C2S (rooms.handleBackLobby)
    case 'results_leave': leaveEverything(); break;
    case 'pause_resume': doResume(); break;
    case 'pause_help': break; // UI abre help; engine segue pausado; voltar reabre pause
    case 'pause_quit': leaveEverything(); break;
    case 'tt_restart': restartTT(); break;
    case 'tt_change_track': disposeEngine(); ttTrack = null; mode = 'home'; show('tt_select'); break;
    case 'tt_quit': disposeEngine(); ttTrack = null; mode = 'home'; show('home'); break;
    case 'settings_change': applyRuntime(a.patch); break;
    case 'settings_back':
    case 'join_back':
    case 'help_back':
      break; // UI já cuidou do retorno de tela
    default: break;
  }
}

function onBackHome() {
  // vindo de tt_select/settings/help (UI já mostrou home); garante limpeza
  if (engine) { disposeEngine(); ttTrack = null; }
  if (mode !== 'lobby' && mode !== 'wait') mode = 'home';
}

// ---------------------------------------------------------------- boot

function boot() {
  audioMod.initAudio();
  const s = loadSettings();
  audioMod.setAudioVolume(s.volume, s.muted);

  uiApi = initUI({ onAction });
  net.onMessage(onNetMessage);
  net.onStatus(onNetStatus);

  // Modo Hub (?hub=1): pula a home e cria/entra direto na sala pedida pelo Hub.
  hubMode = readHubParams();
  if (hubMode) { bootHub(hubMode); return; }

  // Esc próprio (um único listener; input.js não é duplicado aqui)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.repeat) onEsc();
  });

  // Retomada automática: ?room= igual ao av.session da aba (§9)
  const urlCode = urlRoomCode();
  const sess = readSession();
  if (urlCode && sess?.room === urlCode && sess?.token) autoResume(sess);
}

async function bootHub(hub) {
  // O Hub já escolheu apelido/cor/sala: persiste p/ o fluxo normal e entra
  // direto, sem home. create=1 honra o código pedido; create=0 entra nele.
  if (hub.name) saveSettings({ nickname: hub.name });
  if (hub.color) saveSettings({ color: hub.color });
  if (hub.create) {
    startCreate({ name: hub.name, color: hub.color || loadSettings().color, room: hub.room });
  } else {
    startJoin(hub.room, hub.color, { autoColor: true });
  }
}

async function autoResume(sess) {
  session = sess;
  selfId = sess.id || null;
  roomCode = sess.room;
  mode = 'busy';
  show('loading', { title: 'Reconectando…' });
  const ok = await ensureConnected();
  if (!ok) { mode = 'home'; show('home', { roomCode: sess.room }); return; }
  resumeJoin();
}

boot();
