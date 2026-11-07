'use strict';
// Harness E2E (WS) — PrettierRPG. Só cria tests/e2e/*; não toca server/lib/public.
// Cada cliente é um WebSocket isolado (sem estado compartilhado).
// Uso: node tests/e2e/s1-ffa-duel.cjs  (com servidor em PORT=8094)
const WebSocket = require('ws');

const WS_URL = process.env.E2E_WS || 'ws://127.0.0.1:8094';
const LOGDIR = process.env.E2E_LOG || '/tmp/opencode';

function ts() { return new Date().toISOString(); }
function log(...a) { console.log(ts(), ...a); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Retângulos de obstáculo (espelho de lib/world.js, só p/ asserção — sem editar nada).
const OBS = [
  { x: 44, y: 44, w: 12, h: 12 },
  { x: 18, y: 18, w: 6, h: 6 },
  { x: 76, y: 18, w: 6, h: 6 },
  { x: 18, y: 76, w: 6, h: 6 },
  { x: 76, y: 76, w: 6, h: 6 },
];
function insideObs(x, y, r = 0.4) {
  return OBS.some((o) => x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

let PASS = 0, FAIL = 0;
function check(name, cond, extra = '') {
  if (cond) { PASS++; log('  OK  ', name, extra); }
  else { FAIL++; log('  FAIL', name, extra); }
}

class Bot {
  constructor(nick) {
    this.nick = nick;
    this.last = null;      // último snapshot
    this.errors = [];      // msgs de erro do servidor
    this.joined = null;    // {code,id,secret,reconnected}
    this.leftMsg = false;
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.type === 'state') this.last = m.snap;
        else if (m.type === 'joined') this.joined = m;
        else if (m.type === 'error') this.errors.push(m.msg);
        else if (m.type === 'left') this.leftMsg = true;
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  me() {
    if (!this.last || !this.joined) return null;
    return this.last.players.find((p) => p.id === this.joined.id) || null;
  }
  other(nick) {
    if (!this.last) return null;
    return this.last.players.find((p) => p.nick === nick) || null;
  }
  async waitFor(fn, ms = 20000, poll = 150) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch { /* tenta de novo */ }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout (' + ms + 'ms) aguardando condição');
      await sleep(poll);
    }
  }
  close() { try { this.ws.close(); } catch { /* ignora */ } }
}

async function createRoom(bot, mode) {
  await bot.connect();
  bot.send({ type: 'join', nick: bot.nick, room: '', build: {}, ...(mode ? { mode } : {}) });
  const j = await bot.waitFor(() => bot.joined, 8000);
  await bot.waitFor(() => bot.last, 8000);
  return j.code;
}

async function joinRoom(bot, code, extra = {}) {
  await bot.connect();
  bot.send({ type: 'join', nick: bot.nick, room: code, build: {}, ...extra });
  const j = await bot.waitFor(() => bot.joined, 8000);
  await bot.waitFor(() => bot.last, 8000);
  return j;
}

// Mantém atacante colado no alvo (alcance 3 do machado) e bate AA+Q+W até cansar.
async function beatOn(att, targetNick, maxMs = 90000) {
  const t0 = Date.now();
  let q = 0, w = 0;
  while (Date.now() - t0 < maxMs) {
    const me = att.me(), tgt = att.other(targetNick);
    if (!me || !tgt) { await sleep(300); continue; }
    if (!tgt.alive) return true;
    if (me.hp <= 0 || !me.alive) { await sleep(500); continue; }
    const d = dist(me, tgt);
    if (d > 2.2) att.send({ type: 'move', x: +(tgt.x + 1.2).toFixed(1), y: +tgt.y.toFixed(1) });
    else {
      att.send({ type: 'attack', target: tgt.id });
      if (me.cd && me.cd.q === 0 && q % 2 === 0) att.send({ type: 'skill', slot: 'Q', target: tgt.id });
      if (me.cd && me.cd.w === 0) att.send({ type: 'skill', slot: 'W', target: tgt.id });
      q++;
    }
    await sleep(350);
  }
  return false;
}

module.exports = { WS_URL, LOGDIR, log, sleep, check, Bot, createRoom, joinRoom, beatOn, insideObs, dist,
  get PASS() { return PASS; }, get FAIL() { return FAIL; },
  summary(tag) { log(`== ${tag}: PASS=${PASS} FAIL=${FAIL}`); return FAIL; } };
