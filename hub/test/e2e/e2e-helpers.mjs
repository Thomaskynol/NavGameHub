// Helper WS para os fluxos E2E do Hub (não toca em fontes do projeto).
import WebSocket from 'ws';

export const HUB_WS = 'ws://127.0.0.1:8090/ws';
export const SECRET_FILE = '/home/thomaskyn/Documents/dev/Game_Hub/.run/hub_secret';
export { SECRET_FILE as _SECRET_FILE };

import { readFileSync } from 'node:fs';
export function hubSecret() {
  return readFileSync(SECRET_FILE, 'utf8').trim();
}

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class HubClient {
  constructor(label = '') {
    this.label = label;
    this.messages = [];
    this.waiters = [];
  }
  connect(url = HUB_WS) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
      this.ws.on('message', (data) => {
        let m;
        try { m = JSON.parse(data.toString()); } catch { return; }
        if (process.env.E2E_DEBUG) {
          let extra = '';
          try {
            if (m.t === 'play') extra = 'create=' + new URL(m.url).searchParams.get('create');
          } catch { /* ok */ }
          console.error(`[wire:${this.label}] t=${m.t} ${m.code || ''} ${m.room ? `phase=${m.room.phase} code=${m.room.code}` : ''} ${extra} ${(m.message || '').slice(0, 60)}`);
        }
        this.messages.push(m);
        for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
          if (this.waiters[i].pred(m)) {
            const w = this.waiters.splice(i, 1)[0];
            clearTimeout(w.timer);
            w.resolve(m);
          }
        }
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  next(pred, timeout = 8000) {
    if (process.env.E2E_DEBUG) console.error(`[waiter:${this.label}] scan backlog (${this.messages.filter((m) => !m._seen).length} unseen)`);
    for (const m of this.messages) {
      if (m._seen) continue;
      if (pred(m)) { m._seen = true; return Promise.resolve(m); }
    }
    return new Promise((resolve, reject) => {
      const w = {
        pred: (m) => { if (pred(m)) { m._seen = true; return true; } return false; },
        resolve: (m) => {
          if (process.env.E2E_DEBUG) console.error(`[waiter:${this.label}] resolved t=${m.t}`);
          resolve(m);
        },
        reject, timer: null,
      };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timeout esperando mensagem do Hub (${timeout}ms)`));
      }, timeout);
      this.waiters.push(w);
    });
  }
  async hello(nick) {
    for (const m of this.messages) m._seen = true;
    this.send({ t: 'hello', nick });
    const m = await this.next(
      (x) => x.t === 'hello_ok' || x.t === 'need_nick' || x.t === 'error',
      8000,
    );
    if (m.t === 'error') throw new Error(`hello(${nick}) -> ${m.code}: ${m.message}`);
    if (m.t === 'need_nick') throw new Error(`hello(${nick}) -> need_nick`);
    return m;
  }
  async createRoom(gameId, capacity) {
    for (const m of this.messages) m._seen = true;
    this.send({ t: 'create_room', gameId, capacity });
    const m = await this.next((x) => x.t === 'room' || x.t === 'error', 8000);
    if (m.t === 'error') throw new Error(`create_room -> ${m.code}: ${m.message}`);
    return m.room;
  }
  async joinRoom(code) {
    for (const m of this.messages) m._seen = true;
    this.send({ t: 'join_room', code });
    const m = await this.next(
      (x) => (x.t === 'room' && x.room.code === code) || x.t === 'error',
      8000,
    );
    if (m.t === 'error') throw new Error(`join_room -> ${m.code}: ${m.message}`);
    return m.room;
  }
  async setReady(ready) {
    for (const m of this.messages) m._seen = true;
    this.send({ t: 'set_ready', ready });
    // resposta vem como room atualizado (ou error)
    const m = await this.next((x) => x.t === 'room' || x.t === 'error', 8000);
    if (m.t === 'error') throw new Error(`set_ready -> ${m.code}: ${m.message}`);
    return m.room;
  }
  async waitRoom(pred, timeout = 15000) {
    // Só vale o que chegar DEPOIS desta chamada (ignora backlog já recebido).
    for (const m of this.messages) m._seen = true;
    return this.next((x) => x.t === 'room' && pred(x.room), timeout);
  }
  async waitPlay(create, timeout = 20000) {
    for (const m of this.messages) m._seen = true;
    return this.next((m) => {
      if (m.t !== 'play') return false;
      try {
        return new URL(m.url).searchParams.get('create') === String(create);
      } catch { return false; }
    }, timeout);
  }
  lastRoom() {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].t === 'room') return this.messages[i].room;
    }
    return null;
  }
  lastCatalog() {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].t === 'catalog') return this.messages[i];
    }
    return null;
  }
  close() { try { this.ws.close(); } catch { /* ok */ } }
}

export function gameCodeOf(playMsg) {
  return new URL(playMsg.url).searchParams.get('room');
}

// Conecta no WS de um jogo (arcade/vava) e cria/entrar com código do Hub.
export function gameWs(port, path = '/ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export function wsNext(ws, pred, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timeout esperando mensagem do jogo'));
    }, timeout);
    function onMsg(data) {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (pred(m)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(m);
      }
    }
    ws.on('message', onMsg);
  });
}

export async function hubPost(gamePort, path, code) {
  const res = await fetch(`http://127.0.0.1:${gamePort}${path}?room=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'x-hub-secret': hubSecret() },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function hubState(gamePort, code) {
  const res = await fetch(`http://127.0.0.1:${gamePort}/__hub/state?room=${encodeURIComponent(code)}`, {
    headers: { 'x-hub-secret': hubSecret() },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

let n = 0;
export function uniqNick(base) {
  n += 1;
  // NFKC/lower colapsado; base ASCII + sufixo garante unicidade entre runs.
  return `${base}${Date.now().toString(36).slice(-4)}${n}`.slice(0, 16);
}

// Aguarda o Hub marcar o jogo como online (probe periódico de saúde).
export async function waitOnline(client, gameId, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    const cat = client.lastCatalog();
    const g = cat && cat.games.find((x) => x.id === gameId);
    if (g && g.status === 'online') return;
    if (Date.now() - t0 > timeout) {
      throw new Error(`jogo ${gameId} segue offline após ${timeout}ms`);
    }
    await delay(1000);
  }
}
