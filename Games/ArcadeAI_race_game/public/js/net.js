// public/js/net.js — transporte WebSocket + reconexão automática + relógio.
// Fachada canônica (ARCHITECTURE §6): connect, send, onMessage, disconnect, status.
// Extensões usadas pela integração (main.js): onStatus(cb), serverNow(),
// noteServerNow(ms). Offset de relógio: EMA de amostras serverNow do servidor
// (pong/welcome) e absolutas (cd.at, sn.raceNow + startAt) — §8.

const WS_PATH = '/ws';
const PING_MS = 2000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;
const EMA_ALPHA = 0.1;

let ws = null;
let st = 'offline';            // 'connecting' | 'online' | 'reconnecting' | 'offline'
let wantOpen = false;
let openedOnce = false;
let retryTimer = null;
let pingTimer = null;
let retryDelay = RETRY_MIN_MS;

const msgHandlers = new Set();
const statusHandlers = new Set();

let offset = 0;                // serverNow ≈ perf.now() + offset
let offsetInit = false;

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function setStatus(next) {
  if (st === next) return;
  st = next;
  for (const cb of [...statusHandlers]) {
    let remove = false;
    try { remove = cb(next) === false; } catch { /* handler não derruba o transporte */ }
    if (remove) statusHandlers.delete(cb);
  }
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}`;
}

/** Amostra de relógio do servidor (ms) → atualiza offset EMA (§8). */
export function noteServerNow(serverNowMs) {
  if (typeof serverNowMs !== 'number' || !Number.isFinite(serverNowMs)) return;
  const sample = serverNowMs - nowMs();
  if (!offsetInit) { offset = sample; offsetInit = true; return; }
  offset += EMA_ALPHA * (sample - offset);
}

/** Relógio do servidor estimado (ms, mesma base de cd.at/raceNow). */
export function serverNow() {
  return nowMs() + offset;
}

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}
function clearPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function startPing() {
  clearPing();
  pingTimer = setInterval(() => {
    // servidor responde {t:'pong', now} (wall-clock do servidor — ver server/index.js)
    send({ t: 'ping', ts: nowMs() });
  }, PING_MS);
}

function scheduleRetry() {
  if (!wantOpen || retryTimer) return;
  const delay = retryDelay;
  retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2);
  retryTimer = setTimeout(() => { retryTimer = null; openSocket(); }, delay);
}

function openSocket() {
  if (!wantOpen) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  setStatus(openedOnce ? 'reconnecting' : 'connecting');
  let sock;
  try {
    sock = new WebSocket(wsUrl());
  } catch {
    scheduleRetry();
    return;
  }
  ws = sock;

  sock.onopen = () => {
    if (ws !== sock) return;
    openedOnce = true;
    retryDelay = RETRY_MIN_MS;
    clearRetry();
    setStatus('online');
    startPing();
  };

  sock.onmessage = (ev) => {
    if (ws !== sock) return;
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === 'pong') {
      // servidor real manda {now}; protocolo §3 prevê {serverNow} — aceita ambos
      noteServerNow(msg.serverNow ?? msg.now);
    } else if (msg.t === 'welcome' && typeof msg.serverNow === 'number') {
      noteServerNow(msg.serverNow);
    }
    for (const cb of [...msgHandlers]) {
      try { cb(msg); } catch { /* handler isolado */ }
    }
  };

  sock.onerror = () => { /* onclose dispara em seguida */ };

  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    clearPing();
    if (!wantOpen) { setStatus('offline'); return; }
    setStatus('reconnecting');
    scheduleRetry();
  };
}

/** Conecta (idempotente). Resolve ao abrir; rejeita só se chamado com socket
 *  já morto e sem wantOpen — na prática resolve na 1ª abertura bem-sucedida. */
export function connect() {
  wantOpen = true;
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (!ws && !retryTimer) openSocket();
  return new Promise((resolve, reject) => {
    const waiter = (s) => {
      if (s === 'online') { statusHandlers.delete(waiter); resolve(); return false; }
      if (s === 'offline') { statusHandlers.delete(waiter); reject(new Error('net: offline')); return false; }
      return undefined;
    };
    statusHandlers.add(waiter);
  });
}

/** Envia obj JSON. Silencioso se não estiver aberto (st é descartável). */
export function send(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* conexão morrendo */ }
}

/** cb(msg) para todos os tipos; retorna função para remover. */
export function onMessage(cb) {
  if (typeof cb !== 'function') return () => {};
  msgHandlers.add(cb);
  return () => msgHandlers.delete(cb);
}

/** cb(status) quando o status muda; se cb retorna false, é removido. */
export function onStatus(cb) {
  if (typeof cb !== 'function') return () => {};
  statusHandlers.add(cb);
  return () => statusHandlers.delete(cb);
}

export function disconnect() {
  wantOpen = false;
  clearRetry();
  clearPing();
  retryDelay = RETRY_MIN_MS;
  const sock = ws;
  ws = null;
  if (sock) {
    try { sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null; } catch { /* ok */ }
    try { sock.close(); } catch { /* ok */ }
  }
  setStatus('offline');
}

export function status() {
  return st;
}
