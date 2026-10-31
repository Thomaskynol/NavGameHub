'use strict';

/* Game Hub — cliente WebSocket e interface. Sem dependências externas. */

const STORAGE_TOKEN = 'gamehub:token';
const STORAGE_NICK = 'gamehub:nick';
const NICK_MIN = 2;
const NICK_MAX = 16;
const NICK_RE = /^[\p{L}\p{M}\p{Nd} _-]+$/u;
const RECONNECT_BASE = 900;
const RECONNECT_MAX = 10000;
const PING_INTERVAL = 20000;
const GRACE_MS = { vava: 6000, arcade: 15000, catan: 15000 };
const GRACE_DEFAULT = 15000;
const PHASES = ['lobby', 'launching', 'playing', 'finished'];
const PHASE_LABEL = {
  lobby: 'AGUARDANDO',
  launching: 'PREPARANDO',
  playing: 'EM PARTIDA',
  finished: 'RESULTADOS'
};

const state = {
  ws: null,
  connected: false,
  helloOk: false,
  needNick: false,
  everConnected: false,
  hadDisconnect: false,
  you: null,
  room: null,
  catalog: { games: [], rooms: [] },
  play: null,
  leftMatch: false,
  returningToRoom: false,
  launchFailed: false,
  finishedAt: 0,
  countdownTimer: null,
  pendingAction: null,
  pendingJoinCode: null,
  reconnectAttempt: 0,
  reconnectTimer: null,
  pingTimer: null,
  screen: 'boot',
  focusRoomOnRender: false,
  focusHomeOnRender: false,
  matchShown: false,
  launchShown: false
};

const dom = {
  main: document.getElementById('main'),
  connectionPill: document.getElementById('connection-pill'),
  connectionText: document.getElementById('connection-text'),
  connectionBanner: document.getElementById('connection-banner'),
  nickChip: document.getElementById('nick-chip'),

  bootStatus: document.getElementById('boot-status'),
  bootRetry: document.getElementById('boot-retry'),

  identityForm: document.getElementById('identity-form'),
  nickInput: document.getElementById('nick-input'),
  identityError: document.getElementById('identity-error'),
  identitySubmit: document.getElementById('identity-submit'),
  identityConn: document.getElementById('identity-conn'),

  heroOnline: document.getElementById('hero-online'),
  statGames: document.getElementById('stat-games'),
  statRooms: document.getElementById('stat-rooms'),
  gameGrid: document.getElementById('game-grid'),
  catalogCount: document.getElementById('catalog-count'),
  catalogEmpty: document.getElementById('catalog-empty'),
  joinForm: document.getElementById('join-form'),
  joinCode: document.getElementById('join-code'),
  joinSubmit: document.getElementById('join-submit'),
  joinError: document.getElementById('join-error'),
  roomList: document.getElementById('room-list'),
  roomsCount: document.getElementById('rooms-count'),
  roomsEmpty: document.getElementById('rooms-empty'),

  roomTitle: document.getElementById('room-title'),
  roomCode: document.getElementById('room-code'),
  roomPhaseEyebrow: document.getElementById('room-phase-eyebrow'),
  roomPhaseTag: document.getElementById('room-phase-tag'),
  roomGameName: document.getElementById('room-game-name'),
  roomHost: document.getElementById('room-host'),
  copyCode: document.getElementById('copy-code'),
  leaveRoom: document.getElementById('leave-room'),
  leaveRoomLabel: document.getElementById('leave-room-label'),
  phaseSteps: document.getElementById('phase-steps'),
  roomAlert: document.getElementById('room-alert'),
  readyPanel: document.getElementById('ready-panel'),
  readyTitle: document.getElementById('ready-title'),
  startHint: document.getElementById('start-hint'),
  minWarning: document.getElementById('min-warning'),
  readyCount: document.getElementById('ready-count'),
  readyBtn: document.getElementById('ready-btn'),
  infoCapacity: document.getElementById('info-capacity'),
  infoOccupancy: document.getElementById('info-occupancy'),
  infoPlayers: document.getElementById('info-players'),
  infoPlayersNote: document.getElementById('info-players-note'),
  infoSlots: document.getElementById('info-slots'),
  waitingPanel: document.getElementById('waiting-panel'),
  waitingTitle: document.getElementById('waiting-title'),
  waitingText: document.getElementById('waiting-text'),
  roomLeaveMatch: document.getElementById('room-leave-match'),
  roomGame: document.getElementById('room-game'),
  roomGameHint: document.getElementById('room-game-hint'),
  roomCapacity: document.getElementById('room-capacity'),
  roomCapMinus: document.getElementById('room-cap-minus'),
  roomCapPlus: document.getElementById('room-cap-plus'),
  roomCapHint: document.getElementById('room-cap-hint'),
  settingsLock: document.getElementById('settings-lock'),
  settingsError: document.getElementById('settings-error'),
  memberList: document.getElementById('member-list'),
  membersCount: document.getElementById('members-count'),

  matchView: document.getElementById('view-match'),
  matchCode: document.getElementById('match-code'),
  matchGame: document.getElementById('match-game'),
  matchStatus: document.getElementById('match-status'),
  matchStatusText: document.getElementById('match-status-text'),
  graceTrack: document.getElementById('grace-track'),
  leaveMatch: document.getElementById('leave-match'),
  matchFrameWrap: document.getElementById('match-frame-wrap'),

  launchOverlay: document.getElementById('launch-overlay'),
  launchCode: document.getElementById('launch-code'),
  launchGame: document.getElementById('launch-game'),

  createDialog: document.getElementById('create-dialog'),
  createForm: document.getElementById('create-form'),
  createGame: document.getElementById('create-game'),
  createGameMeta: document.getElementById('create-game-meta'),
  createCapacity: document.getElementById('create-capacity'),
  createCapMinus: document.getElementById('create-cap-minus'),
  createCapPlus: document.getElementById('create-cap-plus'),
  createCapHint: document.getElementById('create-cap-hint'),
  createMinWarning: document.getElementById('create-min-warning'),
  createError: document.getElementById('create-error'),
  createSubmit: document.getElementById('create-submit'),
  createCancel: document.getElementById('create-cancel'),
  createClose: document.getElementById('create-close'),

  toastPolite: document.getElementById('toast-polite'),
  toastAssertive: document.getElementById('toast-assertive')
};

const tpl = {
  game: document.getElementById('tpl-game'),
  room: document.getElementById('tpl-room-row'),
  member: document.getElementById('tpl-member'),
  toast: document.getElementById('tpl-toast')
};

/* ---------- utilidades ---------- */
function setText(el, value) {
  if (el) el.textContent = value == null ? '' : String(value);
}

function setHidden(el, hidden) {
  if (el) el.hidden = !!hidden;
}

function cloneTemplate(template) {
  return template.content.firstElementChild.cloneNode(true);
}

function normalizeNick(raw) {
  return String(raw || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function nickLength(nick) {
  return Array.from(nick).length;
}

function validateNick(nick) {
  const len = nickLength(nick);
  if (len < NICK_MIN || len > NICK_MAX) {
    return `O apelido precisa ter de ${NICK_MIN} a ${NICK_MAX} caracteres.`;
  }
  if (!NICK_RE.test(nick)) {
    return 'Use apenas letras, números, espaço, _ ou -.';
  }
  return '';
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

function safeAccent(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : '#00e5ff';
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function gameById(id) {
  return state.catalog.games.find((game) => game && game.id === id) || null;
}

function roomOccupancy(room) {
  return Array.isArray(room && room.members) ? room.members.length : 0;
}

function isRoomHost(room) {
  if (!room) return false;
  const myId = (room.you && room.you.id) || (state.you && state.you.id);
  return !!myId && room.hostId === myId;
}

function phaseLabel(phase) {
  return PHASE_LABEL[phase] || '—';
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* armazenamento indisponível: segue sem persistir */ }
}

function focusElement(el, options) {
  if (el && typeof el.focus === 'function') {
    try { el.focus({ preventScroll: true, ...options }); } catch { el.focus(); }
  }
}

function withFocusPreserved(renderFn) {
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.focusKey : null;
  renderFn();
  if (key) {
    const next = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    if (next) focusElement(next);
  }
}

function clearChildren(el) {
  if (el) el.replaceChildren();
}

/* ---------- conexão ---------- */
function websocketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

function connect() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  let ws;
  try {
    ws = new WebSocket(websocketUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  state.ws = ws;

  ws.addEventListener('open', () => {
    if (state.ws !== ws) return;
    state.connected = true;
    state.everConnected = true;
    renderTopbar();
    renderConnectionBanner();
    renderBoot();

    const hello = { t: 'hello' };
    const token = storageGet(STORAGE_TOKEN);
    const nick = storageGet(STORAGE_NICK);
    if (token) hello.token = token;
    if (nick) hello.nick = nick;
    try { ws.send(JSON.stringify(hello)); } catch { /* o close trata a queda */ }
    startPing();
  });

  ws.addEventListener('message', onSocketMessage);

  ws.addEventListener('close', () => {
    if (state.ws !== ws) return;
    state.ws = null;
    const wasOnline = state.connected && state.helloOk;
    state.connected = false;
    state.pendingAction = null;
    state.pendingJoinCode = null;
    stopPing();
    if (wasOnline) {
      state.hadDisconnect = true;
      toast('Conexão com o Hub perdida. Tentando reconectar…', 'error');
    }
    scheduleReconnect();
    render();
  });

  ws.addEventListener('error', () => {
    /* o evento close logo em seguida agenda a reconexão */
  });
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  const attempt = state.reconnectAttempt;
  state.reconnectAttempt += 1;
  const delay = Math.min(RECONNECT_BASE * (2 ** attempt), RECONNECT_MAX) + Math.round(Math.random() * 350);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
  renderBoot();
  renderTopbar();
}

function startPing() {
  stopPing();
  state.pingTimer = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      try { state.ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch { /* ignora */ }
    }
  }, PING_INTERVAL);
}

function stopPing() {
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
}

function send(message, options) {
  const silent = !!(options && options.silent);
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    if (!silent) toast('Sem conexão com o Hub. Aguarde a reconexão.', 'error');
    return false;
  }
  try {
    state.ws.send(JSON.stringify(message));
    return true;
  } catch {
    if (!silent) toast('Não foi possível enviar a mensagem ao Hub.', 'error');
    return false;
  }
}

/* ---------- mensagens do servidor ---------- */
function onSocketMessage(event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') return;

  switch (message.t) {
    case 'hello_ok': handleHelloOk(message); break;
    case 'need_nick': handleNeedNick(); break;
    case 'catalog': handleCatalog(message); break;
    case 'room': handleRoomMessage(message); break;
    case 'play': handlePlay(message); break;
    case 'left': handleLeft(); break;
    case 'error': handleServerError(message); break;
    case 'notice': handleNotice(message); break;
    case 'pong': break;
    default: break;
  }
}

function handleHelloOk(message) {
  const wasBoot = state.screen === 'boot' || state.screen === 'identity';
  if (typeof message.token === 'string' && message.token) storageSet(STORAGE_TOKEN, message.token);

  const you = message.you && typeof message.you === 'object' ? message.you : null;
  if (you) {
    state.you = { id: you.id, nick: typeof you.nick === 'string' ? you.nick : '' };
    if (state.you.nick) {
      storageSet(STORAGE_NICK, state.you.nick);
      dom.nickInput.value = state.you.nick;
    }
  }

  state.helloOk = true;
  state.needNick = false;
  state.pendingAction = null;
  state.pendingJoinCode = null;
  state.reconnectAttempt = 0;
  state.everConnected = true;
  clearIdentityError();
  clearJoinError();
  clearCreateError();

  if (message.room && typeof message.room === 'object') {
    setRoom(message.room);
    closeCreateDialog(true);
  } else {
    clearRoomState();
    clearPlayAndFrame();
    state.leftMatch = false;
    state.returningToRoom = false;
    state.launchFailed = false;
  }

  if (state.hadDisconnect) {
    state.hadDisconnect = false;
    toast('Conexão restabelecida.', 'success');
  }

  render();
  if (wasBoot) focusScreenHeading();
}

function handleNeedNick() {
  state.helloOk = false;
  state.needNick = true;
  state.you = null;
  state.pendingAction = null;
  state.pendingJoinCode = null;
  state.room = null;
  state.play = null;
  state.leftMatch = false;
  state.returningToRoom = false;
  state.launchFailed = false;
  state.finishedAt = 0;
  stopCountdown();
  destroyFrame();
  storageSet(STORAGE_TOKEN, null);
  render();
  const saved = storageGet(STORAGE_NICK);
  if (saved) dom.nickInput.value = saved;
  window.setTimeout(() => {
    focusElement(dom.nickInput);
    if (dom.nickInput.value) dom.nickInput.select();
  }, 0);
}

function handleCatalog(message) {
  const games = Array.isArray(message.games) ? message.games.filter((game) => game && typeof game.id === 'string') : [];
  const rooms = Array.isArray(message.rooms) ? message.rooms.filter((room) => room && typeof room.code === 'string') : [];
  state.catalog = { games, rooms };
  if (state.screen === 'home') renderHome();
  if (state.room) renderRoom();
}

function handleRoomMessage(message) {
  if (!message.room || typeof message.room !== 'object') {
    clearRoomState();
    clearPlayAndFrame();
    state.leftMatch = false;
    state.returningToRoom = false;
    render();
    return;
  }
  const hadRoom = !!state.room;
  setRoom(message.room);
  state.pendingAction = null;
  state.pendingJoinCode = null;
  dom.joinCode.value = '';
  clearJoinError();
  clearCreateError();
  clearRoomErrors();
  closeCreateDialog(true);
  if (!hadRoom) state.focusRoomOnRender = true;
  render();
}

function handlePlay(message) {
  const url = validatePlayUrl(message.url);
  if (!url) {
    toast('O Hub enviou um endereço de partida inválido.', 'error');
    return;
  }
  state.play = {
    gameId: typeof message.gameId === 'string' ? message.gameId : '',
    url
  };
  state.leftMatch = false;
  state.returningToRoom = false;
  state.launchFailed = false;
  state.pendingAction = null;
  render();
}

function handleLeft() {
  state.room = null;
  state.play = null;
  state.leftMatch = false;
  state.returningToRoom = false;
  state.launchFailed = false;
  state.pendingAction = null;
  state.pendingJoinCode = null;
  state.finishedAt = 0;
  stopCountdown();
  destroyFrame();
  clearRoomErrors();
  render();
  focusHomeHeading();
  toast('Você saiu da sala.', 'info');
}

function handleNotice(message) {
  if (typeof message.message === 'string' && message.message.trim()) {
    toast(message.message.trim(), 'info');
  }
}

function validatePlayUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw, location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/* ---------- estado da sala ---------- */
function setRoom(rawRoom) {
  if (!rawRoom || typeof rawRoom !== 'object') {
    clearRoomState();
    return;
  }
  const prev = state.room;
  const prevPhase = prev ? prev.phase : null;
  const phase = PHASES.includes(rawRoom.phase) ? rawRoom.phase : 'lobby';

  state.room = {
    ...rawRoom,
    phase,
    code: typeof rawRoom.code === 'string' ? rawRoom.code : '',
    gameId: typeof rawRoom.gameId === 'string' ? rawRoom.gameId : '',
    gameName: typeof rawRoom.gameName === 'string' ? rawRoom.gameName : '',
    capacity: Number(rawRoom.capacity) || 1,
    minPlayers: Number(rawRoom.minPlayers) || 1,
    maxPlayers: Number(rawRoom.maxPlayers) || 1,
    midMatchJoin: !!rawRoom.midMatchJoin,
    hostId: rawRoom.hostId,
    you: rawRoom.you && typeof rawRoom.you === 'object' ? rawRoom.you : null,
    members: Array.isArray(rawRoom.members) ? rawRoom.members : [],
    match: rawRoom.match && typeof rawRoom.match === 'object' ? rawRoom.match : null,
    canStart: !!rawRoom.canStart,
    startHint: typeof rawRoom.startHint === 'string' ? rawRoom.startHint : ''
  };
  if (state.room.you && state.room.you.id) {
    state.you = {
      id: state.room.you.id,
      nick: typeof state.room.you.nick === 'string' ? state.room.you.nick : (state.you ? state.you.nick : '')
    };
  }
  state.returningToRoom = false;

  if (phase === 'lobby') {
    state.leftMatch = false;
    state.launchFailed = false;
    state.finishedAt = 0;
    stopCountdown();
    clearPlayAndFrame();
    if (prevPhase === 'playing' || prevPhase === 'finished') state.focusRoomOnRender = true;
  } else if (phase === 'launching') {
    if (prevPhase !== 'launching') state.launchFailed = false;
    state.finishedAt = 0;
    stopCountdown();
  } else if (phase === 'playing') {
    if (prevPhase !== 'playing') {
      state.finishedAt = 0;
      stopCountdown();
    }
    state.launchFailed = false;
  } else if (phase === 'finished') {
    if (prevPhase !== 'finished') {
      state.finishedAt = Date.now();
      startCountdown();
      toast('Partida encerrada. Voltando para a sala em instantes.', 'info');
    }
  }

  if (state.room.you && state.room.you.role === 'waiting' && (phase === 'playing' || phase === 'finished')) {
    state.leftMatch = true;
    clearPlayAndFrame();
  }

  if (!prev) state.focusRoomOnRender = true;
}

function clearRoomState() {
  state.room = null;
  state.finishedAt = 0;
  stopCountdown();
  hideGraceTrack();
}

function clearPlayAndFrame() {
  state.play = null;
  state.matchShown = false;
  destroyFrame();
  hideGraceTrack();
}

function destroyFrame() {
  const frame = dom.matchFrameWrap ? dom.matchFrameWrap.querySelector('iframe') : null;
  if (frame) {
    try { frame.src = 'about:blank'; } catch { /* ignora */ }
    frame.remove();
  }
}

function graceMsFor(gameId) {
  return GRACE_MS[gameId] || GRACE_DEFAULT;
}

function startCountdown() {
  stopCountdown();
  if (!state.finishedAt) state.finishedAt = Date.now();
  updateCountdown();
  state.countdownTimer = setInterval(updateCountdown, 500);
}

function stopCountdown() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function hideGraceTrack() {
  if (dom.graceTrack) dom.graceTrack.hidden = true;
}

function updateCountdown() {
  const room = state.room;
  if (!room || room.phase !== 'finished') {
    stopCountdown();
    return;
  }
  const total = graceMsFor(room.gameId);
  const remain = Math.max(0, Math.ceil((total - (Date.now() - state.finishedAt)) / 1000));
  const finishedText = remain > 0 ? `PARTIDA ENCERRADA — VOLTANDO EM ~${remain}S` : 'PARTIDA ENCERRADA — VOLTANDO…';
  setText(dom.matchStatusText, finishedText);
  if (room.you && room.you.role === 'waiting') {
    setText(dom.waitingText, remain > 0
      ? `Os resultados ficam na tela do jogo por ~${remain}s. Você entra na próxima partida.`
      : 'Voltando para a sala…');
  }
}

/* ---------- erros ---------- */
const ERROR_MESSAGES = {
  BAD_NICK: 'Apelido inválido. Use de 2 a 16 caracteres.',
  NICK_TAKEN: 'Esse apelido já está em uso. Escolha outro.',
  BAD_GAME: 'Jogo inválido.',
  GAME_OFFLINE: 'Esse jogo está offline no momento.',
  BAD_CAPACITY: 'Capacidade inválida.',
  CAPACITY_GT_MAX: 'A capacidade passa do máximo do jogo.',
  CAPACITY_LT_OCCUPANCY: 'A capacidade não pode ficar abaixo do número de pessoas na sala.',
  ROOM_NOT_FOUND: 'Sala não encontrada. Confira o código.',
  ROOM_FULL: 'A sala está cheia.',
  ALREADY_IN_MATCH: 'Você já está em uma sala. Saia dela antes de entrar em outra.',
  NOT_HOST: 'Somente o anfitrião pode fazer isso.',
  NOT_IN_ROOM: 'Você não está em uma sala.',
  NOT_READY: 'Ainda não é possível iniciar: falta alguém ficar pronto.',
  LAUNCHING: 'A partida está sendo preparada. Aguarde.',
  BAD_PHASE: 'Essa ação não é possível nesta fase da sala.',
  LAUNCH_FAILED: 'Não foi possível iniciar a partida. Tente novamente.',
  GAME_FAILED: 'A partida foi interrompida: o servidor do jogo parou de responder. A sala voltou ao lobby.',
  RATE: 'Muitas ações em pouco tempo. Aguarde um instante.',
  INVALID: 'Não foi possível concluir a ação.'
};

function handleServerError(message) {
  const code = typeof message.code === 'string' ? message.code : 'INVALID';
  const text = typeof message.message === 'string' && message.message.trim()
    ? message.message.trim()
    : (ERROR_MESSAGES[code] || ERROR_MESSAGES.INVALID);
  const action = state.pendingAction;
  state.pendingAction = null;
  state.pendingJoinCode = null;

  if (action === 'hello' || (!state.helloOk && (code === 'NICK_TAKEN' || code === 'BAD_NICK'))) {
    if (code === 'NICK_TAKEN' || code === 'BAD_NICK') {
      state.needNick = true;
      state.helloOk = false;
      storageSet(STORAGE_TOKEN, null);
      setIdentityError(text);
      render();
      window.setTimeout(() => {
        focusElement(dom.nickInput);
        dom.nickInput.select();
      }, 0);
    } else {
      toast(text, 'error');
      render();
    }
    return;
  }

  if (action === 'create') {
    if (dom.createDialog.open) {
      setCreateError(text);
      renderCreate();
    } else {
      toast(text, 'error');
      render();
    }
    return;
  }

  if (action === 'join') {
    setJoinError(text);
    renderHome();
    focusElement(dom.joinCode);
    return;
  }

  if (action === 'settings') {
    setSettingsError(text);
    renderRoom(true);
    return;
  }

  if (code === 'LAUNCH_FAILED' || code === 'GAME_FAILED') {
    state.launchFailed = true;
    toast(text, 'error');
    render();
    return;
  }

  if (action === 'ready' || action === 'leave' || action === 'leave_match') {
    if (state.room && !isMatchActive()) setRoomAlert(text);
    else toast(text, 'error');
    render();
    return;
  }

  toast(text, 'error');
  render();
}

function setIdentityError(text) {
  setText(dom.identityError, text || '');
  setHidden(dom.identityError, !text);
}

function clearIdentityError() {
  setIdentityError('');
}

function setJoinError(text) {
  setText(dom.joinError, text || '');
  setHidden(dom.joinError, !text);
}

function clearJoinError() {
  setJoinError('');
}

function setCreateError(text) {
  setText(dom.createError, text || '');
  setHidden(dom.createError, !text);
}

function clearCreateError() {
  setCreateError('');
}

function setSettingsError(text) {
  setText(dom.settingsError, text || '');
  setHidden(dom.settingsError, !text);
}

function clearSettingsError() {
  setSettingsError('');
}

function setRoomAlert(text) {
  setText(dom.roomAlert, text || '');
  setHidden(dom.roomAlert, !text);
}

function clearRoomErrors() {
  setRoomAlert('');
  clearSettingsError();
}

/* ---------- diálogo de criação ---------- */
function createOptionsSignature() {
  return state.catalog.games
    .map((game) => `${game.id}|${game.name}|${game.minPlayers}|${game.maxPlayers}|${game.status}|${game.midMatchJoin}`)
    .join('~');
}

function syncCreateOptions() {
  if (!dom.createGame) return;
  const signature = createOptionsSignature();
  if (dom.createGame.dataset.sig === signature && dom.createGame.options.length) return;

  const selected = dom.createGame.value;
  const frag = document.createDocumentFragment();
  for (const game of state.catalog.games) {
    const option = document.createElement('option');
    option.value = game.id;
    const min = Number(game.minPlayers) || 1;
    const max = Number(game.maxPlayers) || 1;
    const offline = game.status !== 'online';
    option.textContent = `${game.name || game.id} · ${min}–${max} jogadores${offline ? ' · offline' : ''}`;
    option.disabled = offline;
    frag.append(option);
  }
  if (!frag.childNodes.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Nenhum jogo disponível';
    option.disabled = true;
    frag.append(option);
  }
  dom.createGame.replaceChildren(frag);
  dom.createGame.dataset.sig = signature;

  if (selected && dom.createGame.querySelector(`option[value="${CSS.escape(selected)}"]`)) {
    dom.createGame.value = selected;
  }
  if (!dom.createGame.value) {
    const firstOnline = state.catalog.games.find((game) => game.status === 'online');
    if (firstOnline) dom.createGame.value = firstOnline.id;
  }
}

function selectedCreateGame() {
  return gameById(dom.createGame ? dom.createGame.value : '');
}

function updateCreateUI() {
  const game = selectedCreateGame();
  if (!game) {
    setText(dom.createGameMeta, 'Nenhum jogo online disponível.');
    setHidden(dom.createMinWarning, true);
    return;
  }
  const min = Number(game.minPlayers) || 1;
  const max = Number(game.maxPlayers) || 1;
  const raw = Number(dom.createCapacity.value);
  const capacity = Number.isFinite(raw) ? Math.min(max, Math.max(1, Math.trunc(raw))) : max;
  dom.createCapacity.value = String(capacity);
  dom.createCapacity.min = '1';
  dom.createCapacity.max = String(max);

  setText(dom.createGameMeta, `${min}–${max} jogadores · ${game.midMatchJoin ? 'entrada no meio da partida' : 'entrada só na próxima partida'}`);
  setText(dom.createCapHint, `De 1 a ${max}. Mínimo para iniciar: ${min}.`);
  setText(dom.createMinWarning, `Capacidade abaixo do mínimo (${min}). A sala pode existir, mas a partida não começa até ajustar.`);
  setHidden(dom.createMinWarning, capacity >= min);
  dom.createCapMinus.disabled = capacity <= 1;
  dom.createCapPlus.disabled = capacity >= max;
}

function renderCreate() {
  if (!dom.createDialog.open) return;
  const pending = state.pendingAction === 'create';
  const game = selectedCreateGame();
  dom.createSubmit.disabled = pending || !game;
  setText(dom.createSubmit, pending ? 'CRIANDO…' : 'CRIAR SALA');
  dom.createClose.disabled = pending;
  dom.createCancel.disabled = pending;
  dom.createGame.disabled = pending;
  dom.createCapacity.disabled = pending;
  dom.createCapMinus.disabled = pending || !game || Number(dom.createCapacity.value) <= 1;
  dom.createCapPlus.disabled = pending || !game || Number(dom.createCapacity.value) >= (Number(game.maxPlayers) || 1);
}

function openCreateDialog(gameId) {
  if (state.pendingAction === 'create') return;
  if (!state.helloOk || !state.connected) {
    toast('Conecte-se ao Hub para criar uma sala.', 'error');
    return;
  }
  const online = state.catalog.games.filter((game) => game.status === 'online');
  if (!online.length) {
    toast('Nenhum jogo online para criar uma sala agora.', 'error');
    return;
  }
  clearCreateError();
  syncCreateOptions();
  const preferred = online.find((game) => game.id === gameId) || online[0];
  dom.createGame.value = preferred.id;
  const max = Number(preferred.maxPlayers) || 1;
  dom.createCapacity.value = String(max);
  updateCreateUI();
  if (typeof dom.createDialog.showModal === 'function') dom.createDialog.showModal();
  else dom.createDialog.setAttribute('open', '');
  renderCreate();
  window.setTimeout(() => focusElement(dom.createGame), 0);
}

function closeCreateDialog(force) {
  if (!dom.createDialog.open) return;
  if (state.pendingAction === 'create' && !force) return;
  dom.createDialog.close();
  if (!force && state.pendingAction === 'create') state.pendingAction = null;
  clearCreateError();
}

function submitCreate(event) {
  event.preventDefault();
  if (state.pendingAction === 'create') return;
  const game = selectedCreateGame();
  if (!game) {
    setCreateError('Escolha um jogo disponível.');
    return;
  }
  if (game.status !== 'online') {
    setCreateError('Esse jogo está offline no momento.');
    return;
  }
  const capacity = clampNumber(dom.createCapacity.value, 1, Number(game.maxPlayers) || 1);
  dom.createCapacity.value = String(capacity);
  if (!state.connected) {
    setCreateError('Sem conexão com o Hub. Aguarde a reconexão.');
    return;
  }
  clearCreateError();
  state.pendingAction = 'create';
  renderCreate();
  if (!send({ t: 'create_room', gameId: game.id, capacity }, { silent: true })) {
    state.pendingAction = null;
    setCreateError('Sem conexão com o Hub. Aguarde a reconexão.');
    renderCreate();
  }
}

/* ---------- entrar, pronto, sair ---------- */
function joinRoom(code) {
  const roomCode = normalizeCode(code);
  if (!roomCode) {
    setJoinError('Digite o código da sala.');
    focusElement(dom.joinCode);
    return;
  }
  if (state.pendingAction) return;
  if (!state.connected) {
    setJoinError('Sem conexão com o Hub. Aguarde a reconexão.');
    return;
  }
  clearJoinError();
  dom.joinCode.value = roomCode;
  state.pendingAction = 'join';
  state.pendingJoinCode = roomCode;
  renderHome();
  if (!send({ t: 'join_room', code: roomCode }, { silent: true })) {
    state.pendingAction = null;
    state.pendingJoinCode = null;
    setJoinError('Sem conexão com o Hub. Aguarde a reconexão.');
    renderHome();
  }
}

function submitJoin(event) {
  event.preventDefault();
  joinRoom(dom.joinCode.value);
}

function toggleReady() {
  const room = state.room;
  if (!room || state.pendingAction) return;
  if (!state.connected) {
    toast('Sem conexão com o Hub. Aguarde a reconexão.', 'error');
    return;
  }
  if (room.phase !== 'lobby' || !room.you || room.you.role === 'waiting') return;
  const nextReady = !room.you.ready;
  state.pendingAction = 'ready';
  renderRoom();
  if (!send({ t: 'set_ready', ready: nextReady }, { silent: true })) {
    state.pendingAction = null;
    toast('Sem conexão com o Hub. Aguarde a reconexão.', 'error');
    renderRoom();
  }
}

function leaveRoom() {
  if (!state.room || state.pendingAction === 'leave') return;
  if (!state.connected) {
    toast('Sem conexão com o Hub. Aguarde a reconexão.', 'error');
    return;
  }
  state.pendingAction = 'leave';
  renderRoom();
  if (!send({ t: 'leave_room' }, { silent: true })) {
    state.pendingAction = null;
    toast('Sem conexão com o Hub. Aguarde a reconexão.', 'error');
    renderRoom();
  }
}

function leaveMatch() {
  if (!state.play && !state.room) return;
  state.leftMatch = true;
  state.returningToRoom = true;
  state.pendingAction = 'leave_match';
  clearPlayAndFrame();
  render();
  state.focusRoomOnRender = false;
  if (state.room && dom.launchOverlay.hidden) focusRoomHeading();
  if (!send({ t: 'leave_match' }, { silent: true })) {
    toast('Sem conexão com o Hub. A partida foi fechada nesta tela.', 'error');
  }
}

async function copyRoomCode() {
  const room = state.room;
  if (!room || !room.code) return;
  const code = room.code;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(code);
      toast('Código copiado.', 'success');
      return;
    }
    throw new Error('clipboard indisponível');
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = code;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (copied) toast('Código copiado.', 'success');
      else toast(`Copie manualmente: ${code}`, 'info');
    } catch {
      toast(`Copie manualmente: ${code}`, 'info');
    }
  }
}

/* ---------- home ---------- */
function renderHome() {
  if (state.screen !== 'home') return;
  const games = state.catalog.games;
  const rooms = state.catalog.rooms;
  const onlineCount = games.filter((game) => game.status === 'online').length;

  setText(dom.heroOnline, String(onlineCount));
  setText(dom.statGames, String(games.length));
  setText(dom.statRooms, String(rooms.length));
  setText(dom.catalogCount, String(games.length));
  setText(dom.roomsCount, String(rooms.length));

  const joining = state.pendingAction === 'join';
  dom.joinSubmit.disabled = joining || !state.connected;
  setText(dom.joinSubmit, joining ? 'ENTRANDO…' : 'ENTRAR');

  withFocusPreserved(() => {
    const gameFrag = document.createDocumentFragment();
    games.forEach((game, index) => gameFrag.append(buildGameCard(game, index)));
    dom.gameGrid.replaceChildren(gameFrag);
    setHidden(dom.catalogEmpty, games.length > 0);

    const roomFrag = document.createDocumentFragment();
    rooms.forEach((room) => roomFrag.append(buildRoomRow(room, joining)));
    dom.roomList.replaceChildren(roomFrag);
    setHidden(dom.roomsEmpty, rooms.length > 0);
  });
}

function buildGameCard(game, index) {
  const node = cloneTemplate(tpl.game);
  const accent = safeAccent(game.accent);
  const offline = game.status !== 'online';
  const min = Number(game.minPlayers) || 1;
  const max = Number(game.maxPlayers) || 1;
  const name = game.name || game.id;

  node.style.setProperty('--accent', accent);
  node.classList.toggle('is-offline', offline);
  node.setAttribute('aria-label', name);

  setText(node.querySelector('.game-index'), String(index + 1).padStart(2, '0'));
  const status = node.querySelector('.game-status');
  status.classList.add(offline ? 'offline' : 'online');
  setText(status.querySelector('.status-text'), offline ? 'OFFLINE' : 'ONLINE');
  setText(node.querySelector('.game-tagline'), game.tagline || '');
  setText(node.querySelector('.game-name'), name);
  setText(node.querySelector('.game-desc'), game.description || '');
  setText(node.querySelector('.players'), `${min}–${max} jogadores`);
  setText(node.querySelector('.game-midjoin'), game.midMatchJoin ? 'Entrada no meio' : 'Só na próxima');

  const tags = node.querySelector('.game-tags');
  const list = Array.isArray(game.tags) ? game.tags : [];
  for (const tag of list) {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = String(tag);
    tags.append(span);
  }

  const button = node.querySelector('.create-game-btn');
  const label = button.querySelector('.btn-label');
  button.disabled = offline || !state.connected;
  button.dataset.focusKey = `game:${game.id}:create`;
  setText(label, offline ? 'INDISPONÍVEL' : 'CRIAR SALA');
  button.setAttribute('aria-label', offline ? `${name} está offline` : `Criar sala de ${name}`);
  button.title = offline
    ? 'Este jogo está offline no momento.'
    : !state.connected
      ? 'Sem conexão com o Hub.'
      : `Criar uma sala de ${name}`;
  button.addEventListener('click', () => openCreateDialog(game.id));
  return node;
}

function buildRoomRow(room, joining) {
  const node = cloneTemplate(tpl.room);
  const game = gameById(room.gameId);
  const accent = safeAccent(game ? game.accent : '#00e5ff');
  const name = room.gameName || (game && game.name) || room.gameId || 'Jogo';
  const occupancy = Number(room.occupancy) || 0;
  const capacity = Number(room.capacity) || 0;
  const phase = PHASES.includes(room.phase) ? room.phase : 'lobby';
  const full = capacity > 0 && occupancy >= capacity;
  const gameOffline = !!game && game.status !== 'online';
  const launching = phase === 'launching';
  const pendingThis = joining && state.pendingJoinCode === room.code;

  node.style.setProperty('--accent', accent);
  setText(node.querySelector('.room-code-chip'), room.code);
  setText(node.querySelector('.room-game'), name);
  setText(node.querySelector('.room-host'), `Anfitrião: ${room.hostNick || '—'}`);

  const occ = node.querySelector('.room-occupancy');
  setText(occ, `${occupancy}/${capacity}`);
  occ.setAttribute('aria-label', `${occupancy} de ${capacity} jogadores`);

  const phaseTag = node.querySelector('.room-phase');
  phaseTag.classList.add(phase);
  setText(phaseTag, phaseLabel(phase));

  const button = node.querySelector('.join-room-btn');
  button.dataset.focusKey = `room:${room.code}:join`;
  let disabled = full || launching || !state.connected || joining || gameOffline;
  let label = 'ENTRAR';
  let reason = `Entrar na sala ${room.code}`;
  if (pendingThis) { label = 'ENTRANDO…'; reason = `Entrando na sala ${room.code}`; }
  else if (gameOffline) { label = 'OFFLINE'; reason = 'O jogo desta sala está offline.'; }
  else if (full) { label = 'CHEIA'; reason = 'A sala está cheia.'; }
  else if (launching) { label = 'PREPARANDO'; reason = 'A sala está preparando a partida.'; }
  else if (!state.connected) { label = 'SEM CONEXÃO'; reason = 'Sem conexão com o Hub.'; }
  else if (joining) { reason = 'Aguarde a entrada em andamento.'; }
  button.disabled = disabled;
  button.title = reason;
  button.setAttribute('aria-label', reason);
  setText(button, label);
  button.addEventListener('click', () => joinRoom(room.code));
  return node;
}

/* ---------- sala ---------- */
function renderRoom(force) {
  if (state.screen !== 'room' || !state.room) return;
  const room = state.room;
  const members = room.members;
  const occupancy = members.length;
  const connectedMembers = members.filter((member) => member.connected !== false);
  const readyCount = connectedMembers.filter((member) => member.ready).length;
  const hostMember = members.find((member) => member.isHost || member.id === room.hostId);
  const hostNick = (hostMember && hostMember.nick) || (room.you && room.hostId === room.you.id ? room.you.nick : '') || '—';
  const waiting = !!(room.you && room.you.role === 'waiting');

  setText(dom.roomCode, room.code || '----');
  setText(dom.roomPhaseEyebrow, phaseLabel(room.phase));
  setText(dom.roomGameName, room.gameName || (gameById(room.gameId) || {}).name || room.gameId || '—');
  setText(dom.roomHost, `Anfitrião: ${hostNick}`);

  dom.roomPhaseTag.className = `phase-tag ${room.phase}`;
  setText(dom.roomPhaseTag, phaseLabel(room.phase));

  const activeIndex = Math.max(0, PHASES.indexOf(room.phase));
  Array.from(dom.phaseSteps.children).forEach((step, index) => {
    const isActive = index === activeIndex;
    step.classList.toggle('is-active', isActive);
    step.classList.toggle('is-done', index < activeIndex);
    if (isActive) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });

  dom.leaveRoom.disabled = state.pendingAction === 'leave' || !state.connected;
  setText(dom.leaveRoomLabel, state.pendingAction === 'leave' ? 'SAINDO…' : 'SAIR DA SALA');

  setText(dom.infoCapacity, String(room.capacity));
  setText(dom.infoOccupancy, String(occupancy));
  setText(dom.infoPlayers, `${room.minPlayers}–${room.maxPlayers}`);
  setText(dom.infoPlayersNote, `mín. ${room.minPlayers} para iniciar`);
  setText(dom.infoSlots, String(Math.max(0, room.capacity - occupancy)));

  setText(dom.readyCount, `${readyCount}/${connectedMembers.length}`);
  const allReady = room.canStart;
  dom.readyPanel.classList.toggle('is-all-ready', allReady);
  setHidden(dom.readyPanel, room.phase !== 'lobby' || waiting);

  if (room.phase === 'lobby') {
    setText(dom.readyTitle, allReady ? 'Todos prontos.' : 'Aguardando o grupo.');
  } else {
    setText(dom.readyTitle, room.phase === 'launching' ? 'Preparando a partida.' : room.phase === 'playing' ? 'Partida em andamento.' : 'Resultados da partida.');
  }
  const fallbackHint = room.phase === 'lobby'
    ? `Marque pronto quando estiver tudo certo. Mínimo de ${room.minPlayers} jogadores.`
    : room.phase === 'launching'
      ? 'Abrindo o jogo para todos os jogadores conectados.'
      : room.phase === 'playing'
        ? 'Quem está no jogo volta para esta sala no final.'
        : 'Os resultados ficam na tela do jogo por alguns instantes.';
  setText(dom.startHint, room.startHint || fallbackHint);

  const capacityBelowMin = room.capacity < room.minPlayers;
  setText(dom.minWarning, `A capacidade configurada (${room.capacity}) é menor que o mínimo do jogo (${room.minPlayers}). A partida não pode começar assim.`);
  setHidden(dom.minWarning, !capacityBelowMin);

  const readyDisabled = state.pendingAction === 'ready'
    || !state.connected
    || room.phase !== 'lobby'
    || waiting;
  dom.readyBtn.disabled = readyDisabled;
  dom.readyBtn.setAttribute('aria-pressed', room.you && room.you.ready ? 'true' : 'false');
  let readyLabel = room.you && room.you.ready ? 'CANCELAR PRONTIDÃO' : 'ESTOU PRONTO';
  if (state.pendingAction === 'ready') readyLabel = 'ENVIANDO…';
  else if (waiting) readyLabel = 'AGUARDANDO PARTIDA';
  else if (room.phase === 'launching') readyLabel = 'PREPARANDO…';
  else if (room.phase === 'playing') readyLabel = 'PARTIDA EM ANDAMENTO';
  else if (room.phase === 'finished') readyLabel = 'AGUARDANDO RETORNO';
  setText(dom.readyBtn, readyLabel);
  dom.readyBtn.title = !state.connected
    ? 'Sem conexão com o Hub.'
    : waiting
      ? 'Você entra na próxima partida.'
      : room.phase !== 'lobby'
        ? 'A prontidão só pode ser alterada no lobby.'
        : '';

  renderWaitingPanel(room, waiting);
  renderSettings(room, occupancy, force);
  renderMembers(room);
}

function renderWaitingPanel(room, waiting) {
  const activeMatch = isMatchActive();
  const show = (room.phase === 'playing' || room.phase === 'finished') && (waiting || !activeMatch);
  setHidden(dom.waitingPanel, !show);
  if (!show) return;

  if (waiting) {
    if (room.phase === 'finished') {
      setText(dom.waitingTitle, 'Aguardando o retorno da partida');
      setText(dom.waitingText, 'Os resultados estão na tela do jogo. A sala volta ao lobby em instantes.');
    } else {
      setText(dom.waitingTitle, 'Aguardando a partida terminar');
      setText(dom.waitingText, room.midMatchJoin
        ? `Você está na sala e entra assim que a partida atual terminar. Ocupação: ${room.members.length}/${room.capacity}.`
        : `Você entrou com a partida em andamento. ${room.gameName || 'Este jogo'} não aceita entrada no meio; você entra na próxima. Ocupação: ${room.members.length}/${room.capacity}.`);
    }
    setHidden(dom.roomLeaveMatch, true);
    return;
  }

  setText(dom.waitingTitle, room.phase === 'finished' ? 'Partida encerrada' : 'Partida em andamento');
  setText(dom.waitingText, room.phase === 'finished'
    ? 'Voltando para a sala…'
    : 'A tela do jogo não está aberta nesta conexão. Você pode voltar à sala e aguardar a próxima partida.');
  setHidden(dom.roomLeaveMatch, room.phase !== 'playing');
}

function renderSettings(room, occupancy, force) {
  const host = isRoomHost(room);
  const editable = host && room.phase === 'lobby' && state.connected && state.pendingAction !== 'settings';
  const minCapacity = Math.max(1, occupancy);
  const maxCapacity = Math.max(minCapacity, room.maxPlayers);

  syncRoomGameOptions(room, force);

  dom.roomGame.disabled = !editable;
  dom.roomCapacity.disabled = !editable;
  dom.roomCapacity.min = String(minCapacity);
  dom.roomCapacity.max = String(maxCapacity);
  if (force || document.activeElement !== dom.roomCapacity) dom.roomCapacity.value = String(room.capacity);
  const current = Number(dom.roomCapacity.value) || room.capacity;
  dom.roomCapMinus.disabled = !editable || current <= minCapacity;
  dom.roomCapPlus.disabled = !editable || current >= maxCapacity;

  let lockText;
  let locked = false;
  if (!state.connected) {
    lockText = 'Sem conexão com o Hub. Reconectando…';
    locked = true;
  } else if (!host) {
    lockText = 'Somente o anfitrião pode trocar o jogo ou a capacidade.';
    locked = true;
  } else if (room.phase !== 'lobby') {
    lockText = `Alterações de jogo e capacidade só são possíveis no lobby. A sala está em ${phaseLabel(room.phase).toLowerCase()}.`;
    locked = true;
  } else {
    lockText = 'Você controla o jogo e a capacidade. Mudanças resetam a prontidão.';
  }
  setText(dom.settingsLock, lockText);
  dom.settingsLock.classList.toggle('is-locked', locked);

  setText(dom.roomGameHint, editable
    ? 'Jogos offline ou com limite menor que a capacidade atual ficam indisponíveis.'
    : 'A configuração atual continua valendo.');
  setText(dom.roomCapHint, `Capacidade ${room.capacity} de ${room.maxPlayers}. Mínimo do jogo: ${room.minPlayers}. Não pode ficar abaixo de ${occupancy}.`);
}

function syncRoomGameOptions(room, force) {
  const signature = state.catalog.games
    .map((game) => `${game.id}|${game.name}|${game.status}|${game.maxPlayers}|${game.minPlayers}`)
    .join('~') + `#${room.gameId}`;

  if (dom.roomGame.dataset.sig !== signature || !dom.roomGame.options.length) {
    const frag = document.createDocumentFragment();
    for (const game of state.catalog.games) {
      const option = document.createElement('option');
      option.value = game.id;
      option.textContent = `${game.name || game.id} · até ${Number(game.maxPlayers) || 1}`;
      frag.append(option);
    }
    if (!frag.childNodes.length) {
      const option = document.createElement('option');
      option.value = room.gameId || '';
      option.textContent = room.gameName || 'Jogo atual';
      frag.append(option);
    }
    dom.roomGame.replaceChildren(frag);
    dom.roomGame.dataset.sig = signature;
  }

  for (const option of Array.from(dom.roomGame.options)) {
    const game = gameById(option.value);
    option.disabled = !game
      || (game.status !== 'online' && game.id !== room.gameId)
      || Number(game.maxPlayers) < room.capacity;
    if (game && game.id === room.gameId) option.disabled = false;
  }

  if (force || document.activeElement !== dom.roomGame) {
    if (room.gameId && dom.roomGame.value !== room.gameId) dom.roomGame.value = room.gameId;
  }
}

function renderMembers(room) {
  setText(dom.membersCount, `${room.members.length}/${room.capacity}`);
  const frag = document.createDocumentFragment();
  for (const member of room.members) {
    const node = cloneTemplate(tpl.member);
    const isHost = !!(member.isHost || member.id === room.hostId);
    const isYou = !!(room.you && member.id === room.you.id);
    const online = member.connected !== false;
    const waiting = member.role === 'waiting';

    node.classList.toggle('is-you', isYou);
    node.classList.toggle('is-offline', !online);
    node.classList.toggle('is-waiting', waiting);

    const crown = node.querySelector('.icon-crown');
    crown.hidden = !isHost;
    setText(node.querySelector('.member-nick'), member.nick || '—');
    setHidden(node.querySelector('.member-you'), !isYou);

    const role = node.querySelector('.member-role');
    setText(role, `${isHost ? 'Anfitrião · ' : ''}${waiting ? 'Aguardando' : 'Jogador'}`);
    const conn = node.querySelector('.member-conn');
    setText(conn, online ? 'Online' : 'Offline');
    conn.classList.add(online ? 'is-online' : 'is-offline');

    const tag = node.querySelector('.ready-tag');
    tag.classList.toggle('is-ready', !!member.ready && !waiting);
    tag.classList.toggle('is-waiting', waiting);
    setText(tag.querySelector('.ready-text'), waiting ? 'AGUARDANDO' : member.ready ? 'PRONTO' : 'NÃO PRONTO');
    frag.append(node);
  }
  dom.memberList.replaceChildren(frag);
}

function canEditSettings() {
  const room = state.room;
  return !!room
    && state.connected
    && isRoomHost(room)
    && room.phase === 'lobby'
    && state.pendingAction !== 'settings';
}

function sendSetting(message) {
  clearSettingsError();
  state.pendingAction = 'settings';
  renderRoom();
  if (!send(message, { silent: true })) {
    state.pendingAction = null;
    setSettingsError('Sem conexão com o Hub. Aguarde a reconexão.');
    renderRoom(true);
  }
}

function onRoomGameChange() {
  const room = state.room;
  if (!room || !canEditSettings()) {
    renderRoom(true);
    return;
  }
  const gameId = dom.roomGame.value;
  if (!gameId || gameId === room.gameId) {
    renderRoom(true);
    return;
  }
  const game = gameById(gameId);
  if (!game) {
    setSettingsError('Jogo inválido.');
    renderRoom(true);
    return;
  }
  if (game.status !== 'online') {
    setSettingsError('Esse jogo está offline no momento.');
    renderRoom(true);
    return;
  }
  if (Number(game.maxPlayers) < room.capacity) {
    setSettingsError(`A capacidade atual (${room.capacity}) passa do máximo de ${game.name} (${game.maxPlayers}). Reduza a capacidade antes.`);
    renderRoom(true);
    return;
  }
  sendSetting({ t: 'set_game', gameId });
}

function stepRoomCapacity(delta) {
  const room = state.room;
  if (!room || !canEditSettings()) {
    renderRoom(true);
    return;
  }
  const occupancy = roomOccupancy(room);
  const min = Math.max(1, occupancy);
  const current = clampNumber(dom.roomCapacity.value || room.capacity, min, room.maxPlayers);
  const next = clampNumber(current + delta, min, room.maxPlayers);
  if (next === room.capacity) {
    renderRoom(true);
    return;
  }
  sendSetting({ t: 'set_capacity', capacity: next });
}

function commitRoomCapacity() {
  const room = state.room;
  if (!room || !canEditSettings()) {
    renderRoom(true);
    return;
  }
  const occupancy = roomOccupancy(room);
  const min = Math.max(1, occupancy);
  const value = Number(dom.roomCapacity.value);
  if (!Number.isFinite(value) || value < min || value > room.maxPlayers) {
    setSettingsError(`A capacidade deve ficar entre ${min} e ${room.maxPlayers}.`);
    renderRoom(true);
    return;
  }
  const capacity = Math.trunc(value);
  if (capacity === room.capacity) {
    renderRoom(true);
    return;
  }
  sendSetting({ t: 'set_capacity', capacity });
}

/* ---------- partida ---------- */
function isMatchActive() {
  return !!(state.helloOk && state.play && !state.leftMatch);
}

function roomCodeFromPlay(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('room') || '';
  } catch {
    return '';
  }
}

function renderMatch() {
  const active = isMatchActive();
  if (!active) {
    if (state.matchShown) state.matchShown = false;
    dom.matchView.hidden = true;
    document.body.classList.remove('in-match');
    destroyFrame();
    hideGraceTrack();
    return;
  }

  dom.matchView.hidden = false;
  document.body.classList.add('in-match');

  const room = state.room;
  const game = gameById(state.play.gameId);
  const gameName = (room && room.gameName) || (game && game.name) || state.play.gameId || 'Partida';
  const code = (room && room.code) || roomCodeFromPlay(state.play.url) || '----';
  setText(dom.matchCode, code);
  setText(dom.matchGame, gameName);

  const finished = !!(room && room.phase === 'finished');
  const launching = !!(room && room.phase === 'launching');
  dom.matchStatus.classList.toggle('is-finished', finished);
  if (finished) {
    const total = graceMsFor(room.gameId);
    const remain = Math.max(0, Math.ceil((total - (Date.now() - state.finishedAt)) / 1000));
    setText(dom.matchStatusText, remain > 0 ? `PARTIDA ENCERRADA — VOLTANDO EM ~${remain}S` : 'PARTIDA ENCERRADA — VOLTANDO…');
    if (dom.graceTrack.hidden) {
      dom.graceTrack.style.setProperty('--grace', `${total}ms`);
      dom.graceTrack.hidden = false;
      const bar = dom.graceTrack.firstElementChild;
      if (bar) {
        bar.style.animation = 'none';
        void bar.offsetWidth;
        bar.style.animation = '';
      }
    }
  } else {
    hideGraceTrack();
    setText(dom.matchStatusText, launching ? 'INICIANDO PARTIDA…' : 'PARTIDA EM ANDAMENTO');
  }

  let frame = dom.matchFrameWrap.querySelector('iframe');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.title = `Partida de ${gameName}`;
    frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    frame.allowFullscreen = true;
    dom.matchFrameWrap.append(frame);
  }
  if (frame.dataset.url !== state.play.url) {
    frame.dataset.url = state.play.url;
    frame.src = state.play.url;
  }

  if (!state.matchShown) {
    state.matchShown = true;
    focusElement(dom.leaveMatch);
  }
}

/* ---------- lançamento ---------- */
function renderLaunch() {
  const visible = !!(state.helloOk
    && state.room
    && state.room.phase === 'launching'
    && !state.launchFailed
    && !isMatchActive()
    && state.screen === 'room');

  dom.launchOverlay.hidden = !visible;
  if (visible) {
    setText(dom.launchCode, state.room.code || '----');
    setText(dom.launchGame, state.room.gameName || (gameById(state.room.gameId) || {}).name || state.room.gameId || '—');
    if (!state.launchShown) {
      state.launchShown = true;
      focusElement(dom.launchOverlay);
    }
  } else if (state.launchShown) {
    state.launchShown = false;
    if (dom.launchOverlay.contains(document.activeElement)) {
      if (isMatchActive()) focusElement(dom.leaveMatch);
      else if (state.screen === 'room') focusRoomHeading();
      else if (state.screen === 'home') focusHomeHeading();
    }
  }

  dom.main.inert = visible || isMatchActive();
}

/* ---------- telas e render ---------- */
function computeScreen() {
  if (!state.helloOk) return state.needNick ? 'identity' : 'boot';
  return state.room ? 'room' : 'home';
}

function showScreen(screen, previousScreen) {
  document.querySelectorAll('main [data-screen]').forEach((section) => {
    section.hidden = section.dataset.screen !== screen;
  });
  document.body.dataset.screen = screen;
  if (previousScreen && previousScreen !== screen && !isMatchActive()) {
    window.scrollTo(0, 0);
  }
}

function render() {
  const previousScreen = state.screen;
  const screen = computeScreen();
  state.screen = screen;

  showScreen(screen, previousScreen);
  renderTopbar();
  renderConnectionBanner();
  renderBoot();
  renderIdentity();
  renderHome();
  renderRoom();
  renderMatch();
  renderLaunch();
  renderCreate();

  if (state.focusRoomOnRender) {
    state.focusRoomOnRender = false;
    if (screen === 'room' && !isMatchActive() && dom.launchOverlay.hidden) focusRoomHeading();
  }
  if (state.focusHomeOnRender) {
    state.focusHomeOnRender = false;
    if (screen === 'home' && !isMatchActive()) focusHomeHeading();
  }
}

function focusScreenHeading() {
  if (state.screen === 'room') focusRoomHeading();
  else if (state.screen === 'home') focusHomeHeading();
  else if (state.screen === 'identity') focusElement(document.getElementById('identity-title'));
}

function focusRoomHeading() {
  focusElement(dom.roomTitle);
}

function focusHomeHeading() {
  focusElement(document.getElementById('home-title'));
}

function renderTopbar() {
  let text = 'CONECTANDO';
  let mode = 'is-connecting';
  if (state.connected && state.helloOk) {
    text = 'CONECTADO';
    mode = 'is-online';
  } else if (state.connected) {
    text = 'AUTENTICANDO';
    mode = 'is-connecting';
  } else if (state.everConnected || state.reconnectAttempt > 0) {
    text = 'RECONECTANDO';
    mode = 'is-reconnecting';
  }
  setText(dom.connectionText, text);
  dom.connectionPill.classList.remove('is-online', 'is-connecting', 'is-reconnecting', 'is-offline');
  dom.connectionPill.classList.add(mode);

  const nick = state.you && state.you.nick ? state.you.nick : '';
  dom.nickChip.hidden = !nick;
  setText(dom.nickChip, nick ? `@${nick}` : '');
  if (nick) {
    dom.nickChip.title = `Seu apelido: ${nick}`;
    dom.nickChip.setAttribute('aria-label', `Seu apelido: ${nick}`);
  } else {
    dom.nickChip.removeAttribute('title');
    dom.nickChip.removeAttribute('aria-label');
  }
}

function renderConnectionBanner() {
  const show = (state.helloOk || state.needNick) && !state.connected;
  dom.connectionBanner.hidden = !show;
  if (!show) return;
  setText(dom.connectionBanner, navigator.onLine === false
    ? 'Sem rede. Verifique a conexão — o Hub tenta reconectar sozinho.'
    : 'Conexão perdida. Tentando reconectar…');
}

function renderBoot() {
  if (state.screen !== 'boot') return;
  let text = 'Abrindo o canal com o servidor…';
  if (state.connected) text = 'Autenticando no Hub…';
  else if (state.reconnectAttempt > 0) text = `Reconectando… tentativa ${state.reconnectAttempt}`;
  setText(dom.bootStatus, text);
  dom.bootRetry.hidden = state.connected || state.reconnectAttempt === 0;
  dom.bootRetry.disabled = state.connected;
}

function renderIdentity() {
  if (state.screen !== 'identity') return;
  const pending = state.pendingAction === 'hello';
  dom.identitySubmit.disabled = pending || !state.connected;
  setText(dom.identitySubmit, pending ? 'ENTRANDO…' : 'ENTRAR NO HUB');
  let connText = 'Conectado. Escolha seu apelido.';
  if (pending) connText = 'Entrando no Hub…';
  else if (!state.connected) connText = 'Sem conexão. Aguarde a reconexão para entrar.';
  setText(dom.identityConn, connText);
  dom.identityConn.classList.toggle('is-offline', !state.connected && !pending);
}

/* ---------- avisos ---------- */
function toast(text, kind) {
  if (!text) return;
  const type = kind || 'info';
  const node = cloneTemplate(tpl.toast);
  node.classList.add(`is-${type}`);
  setText(node.querySelector('.toast-text'), text);
  const region = type === 'error' ? dom.toastAssertive : dom.toastPolite;
  while (region.children.length >= 4) region.firstElementChild.remove();
  region.append(node);

  let timer = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    node.remove();
  };
  const schedule = (delay) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(close, delay);
  };
  schedule(type === 'error' ? 9000 : 5500);
  node.querySelector('.toast-close').addEventListener('click', close);
  node.addEventListener('mouseenter', () => { if (timer) clearTimeout(timer); timer = null; });
  node.addEventListener('mouseleave', () => schedule(3000));
  node.addEventListener('focusin', () => { if (timer) clearTimeout(timer); timer = null; });
  node.addEventListener('focusout', () => schedule(3000));
}

/* ---------- eventos ---------- */
function submitIdentity(event) {
  event.preventDefault();
  if (state.pendingAction === 'hello') return;
  const nick = normalizeNick(dom.nickInput.value);
  const problem = validateNick(nick);
  if (problem) {
    setIdentityError(problem);
    focusElement(dom.nickInput);
    dom.nickInput.select();
    return;
  }
  if (!state.connected) {
    setIdentityError('Sem conexão com o Hub. Aguarde a reconexão.');
    return;
  }
  clearIdentityError();
  state.pendingAction = 'hello';
  renderIdentity();
  if (!send({ t: 'hello', nick }, { silent: true })) {
    state.pendingAction = null;
    setIdentityError('Sem conexão com o Hub. Aguarde a reconexão.');
    renderIdentity();
  }
}

function stepCreateCapacity(delta) {
  const game = selectedCreateGame();
  if (!game) return;
  const max = Number(game.maxPlayers) || 1;
  const current = Number(dom.createCapacity.value) || max;
  dom.createCapacity.value = String(clampNumber(current + delta, 1, max));
  updateCreateUI();
  renderCreate();
}

function retryConnect() {
  if (state.ws && state.ws.readyState === WebSocket.CONNECTING) return;
  if (state.ws) {
    try { state.ws.close(); } catch { /* ignora */ }
    state.ws = null;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.connected = false;
  state.reconnectAttempt = 0;
  connect();
  render();
}

function bindEvents() {
  dom.identityForm.addEventListener('submit', submitIdentity);
  dom.nickInput.addEventListener('input', clearIdentityError);
  dom.bootRetry.addEventListener('click', retryConnect);

  dom.joinForm.addEventListener('submit', submitJoin);
  dom.joinCode.addEventListener('input', clearJoinError);

  dom.createForm.addEventListener('submit', submitCreate);
  dom.createGame.addEventListener('change', () => { updateCreateUI(); renderCreate(); });
  dom.createCapacity.addEventListener('change', () => { updateCreateUI(); renderCreate(); });
  dom.createCapMinus.addEventListener('click', () => stepCreateCapacity(-1));
  dom.createCapPlus.addEventListener('click', () => stepCreateCapacity(1));
  dom.createClose.addEventListener('click', () => closeCreateDialog(false));
  dom.createCancel.addEventListener('click', () => closeCreateDialog(false));
  dom.createDialog.addEventListener('cancel', (event) => {
    if (state.pendingAction === 'create') {
      event.preventDefault();
      return;
    }
    clearCreateError();
  });
  dom.createDialog.addEventListener('click', (event) => {
    if (event.target !== dom.createDialog) return;
    if (state.pendingAction === 'create') return;
    closeCreateDialog(false);
  });

  dom.readyBtn.addEventListener('click', toggleReady);
  dom.leaveRoom.addEventListener('click', leaveRoom);
  dom.copyCode.addEventListener('click', copyRoomCode);
  dom.leaveMatch.addEventListener('click', leaveMatch);
  dom.roomLeaveMatch.addEventListener('click', leaveMatch);

  dom.roomGame.addEventListener('change', onRoomGameChange);
  dom.roomCapacity.addEventListener('change', commitRoomCapacity);
  dom.roomCapacity.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dom.roomCapacity.blur();
    }
  });
  dom.roomCapMinus.addEventListener('click', () => stepRoomCapacity(-1));
  dom.roomCapPlus.addEventListener('click', () => stepRoomCapacity(1));

  window.addEventListener('online', () => {
    if (!state.connected) retryConnect();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.connected) retryConnect();
  });
  window.addEventListener('beforeunload', () => {
    if (state.ws) {
      try { state.ws.close(); } catch { /* ignora */ }
    }
  });
}

function init() {
  const savedNick = storageGet(STORAGE_NICK);
  if (savedNick && !dom.nickInput.value) dom.nickInput.value = savedNick;
  bindEvents();
  render();
  connect();
}

init();

/* ==PART4== */



