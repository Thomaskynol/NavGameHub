import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { createHub } from '../server.js';

export const GAME_MANIFEST = JSON.parse(
  readFileSync(new URL('../games.json', import.meta.url), 'utf8'),
);
export const SECRET = 'test-secret';

export const FAST_TIMINGS = {
  disconnectGrace: 80,
  launchPollInterval: 10,
  launchTimeout: 400,
  playPollInterval: 15,
  playNotFoundLimit: 3,
  graceVava: 50,
  graceDefault: 70,
  closeDelay: 40,
  healthInterval: 60_000,
  healthTimeout: 250,
  stateTimeout: 250,
  rateLimit: 30,
  rateWindow: 1_000,
  payloadLimit: 64 * 1024,
};

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(check, timeout = 2_000, interval = 5) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(interval);
  }
  throw new Error('Tempo esgotado esperando condição.');
}

export function makeManifest(ports = {}) {
  return {
    hubPort: 0,
    games: GAME_MANIFEST.games.map((game) => ({
      ...game,
      // Porta 1 recusa conexão rapidamente; evita depender de serviços reais.
      port: ports[game.id] ?? 1,
    })),
  };
}

function writeJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

export async function startFakeGame({ id, secret = SECRET } = {}) {
  const definition = GAME_MANIFEST.games.find((game) => game.id === id) || {
    id,
    healthPath: '/health',
    codeLength: 6,
  };
  const rooms = new Map();
  const requests = [];
  // Injeção de falha para R8: responde 500 nas próximas N consultas de state.
  let failStateCount = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const roomCode = url.searchParams.get('room');
    requests.push({
      method: req.method,
      path: url.pathname,
      room: roomCode,
      htok: url.searchParams.get('htok'),
      secret: req.headers['x-hub-secret'],
    });

    if (url.pathname.startsWith('/__hub/')) {
      if (req.headers['x-hub-secret'] !== secret) {
        writeJson(res, 403, { ok: false, error: 'FORBIDDEN' });
        return;
      }
      if (url.pathname === '/__hub/state') {
        if (failStateCount > 0) {
          failStateCount -= 1;
          writeJson(res, 500, { ok: false, error: 'BOOM' });
          return;
        }
        const room = rooms.get(roomCode);
        if (!room) {
          writeJson(res, 404, { ok: false, error: 'NOT_FOUND' });
          return;
        }
        writeJson(res, 200, {
          ok: true,
          room: {
            code: room.code,
            phase: room.phase,
            players: room.players,
            capacity: room.capacity,
            joinable: room.joinable,
            ...(room.startedAt ? { startedAt: room.startedAt } : {}),
          },
        });
        return;
      }
      if (url.pathname === '/__hub/close') {
        rooms.delete(roomCode);
        writeJson(res, 200, { ok: true });
        return;
      }
    }

    if (
      url.pathname === '/health'
      || url.pathname === '/api/info'
      || url.pathname === (definition.healthPath || '/health')
    ) {
      writeJson(res, 200, { ok: true });
      return;
    }
    writeJson(res, 404, { ok: false, error: 'NOT_FOUND' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    id,
    port: server.address().port,
    server,
    rooms,
    requests,
    setFailState(n) {
      failStateCount = n;
    },
    createRoom(code, options = {}) {
      rooms.set(code, {
        code,
        phase: 'lobby',
        players: 2,
        capacity: 8,
        joinable: true,
        ...options,
      });
    },
    setRoom(code, options) {
      const room = rooms.get(code);
      if (room) Object.assign(room, options);
    },
    removeRoom(code) {
      rooms.delete(code);
    },
    async close() {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export async function startTestHub({
  ports = {},
  timings = {},
  probe,
  manifest,
  secret = SECRET,
  publicHost,
} = {}) {
  const hub = createHub({
    manifest: manifest || makeManifest(ports),
    secret,
    probe,
    publicHost,
    log: () => {},
    timings: { ...FAST_TIMINGS, ...timings },
  });
  const address = await hub.listen(0, '127.0.0.1');
  return { hub, port: address.port };
}

export async function connectClient(port, options = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, options);
  const messages = [];
  const waiters = [];
  let cursor = 0;
  let closeInfo = null;

  const closed = new Promise((resolve) => {
    ws.once('close', (code, reason) => {
      closeInfo = { code, reason: reason.toString() };
      resolve(closeInfo);
    });
  });

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    messages.push(message);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i];
      if (waiter.predicate(message)) {
        waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  return {
    ws,
    messages,
    closed,
    get closeInfo() {
      return closeInfo;
    },
    send(message) {
      ws.send(JSON.stringify(message));
    },
    next(predicate, timeout = 2_000) {
      for (let i = cursor; i < messages.length; i += 1) {
        if (predicate(messages[i])) {
          cursor = i + 1;
          return Promise.resolve(messages[i]);
        }
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: (message) => {
            const index = messages.indexOf(message);
            if (index >= cursor) cursor = index + 1;
            resolve(message);
          },
          timer: null,
        };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          reject(new Error('Tempo esgotado esperando mensagem.'));
        }, timeout);
        waiters.push(waiter);
      });
    },
    async hello(payload = {}) {
      this.send({ t: 'hello', ...payload });
      return this.next(
        (message) => message.t === 'hello_ok'
          || message.t === 'need_nick'
          || (message.t === 'error' && (message.code === 'BAD_NICK' || message.code === 'NICK_TAKEN')),
      );
    },
    clear() {
      messages.length = 0;
      cursor = 0;
    },
    async close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      await closed;
    },
  };
}

export function waitForRoom(client, phase, timeout = 2_000) {
  return client.next(
    (message) => message.t === 'room' && message.room.phase === phase,
    timeout,
  );
}

export function waitForPlay(client, create, timeout = 2_000) {
  return client.next((message) => {
    if (message.t !== 'play') return false;
    try {
      return new URL(message.url).searchParams.get('create') === String(create);
    } catch {
      return false;
    }
  }, timeout);
}
