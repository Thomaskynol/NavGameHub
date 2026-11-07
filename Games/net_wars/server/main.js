import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { MSG, validHello, validInput, validLeave, validStart, validReady, validShuffle } from '../shared/protocol.js';
import {
  TICK_HZ, SNAP_HZ, DEFAULT_MATCH_LEN_S, RECONNECT_S,
  MAX_ROOMS, MAX_WS_PAYLOAD, MAX_HTTP_BODY, MAX_PLAYERS,
  INPUT_MIN_MS, HELLO_MIN_MS,
  WS_BACKPRESSURE_SKIP, WS_BACKPRESSURE_KILL,
} from '../shared/constants.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Único ponto de process.env (contrato ARQUITETURA.md)
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const _envLen = Number(process.env.MATCH_LEN_S || DEFAULT_MATCH_LEN_S);
const MATCH_LEN_S = Number.isFinite(_envLen) && _envLen > 0 ? _envLen : DEFAULT_MATCH_LEN_S;
const _envRe = Number(process.env.RECONNECT_S || RECONNECT_S);
const RECONNECT_S_EFF = Number.isFinite(_envRe) && _envRe > 0 ? _envRe : RECONNECT_S;
const HUB_SECRET = process.env.HUB_SECRET || ''; // vazio = hub protegido recusado, jogo independente ok
const startedAt = Date.now();

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const rooms = new Map(); // name -> Room
// Busca case-insensitive: o Hub reserva/passsa código em MAIÚSCULA e o
// cliente cria em minúscula — códigos são efetivamente case-insensitive.
const findRoom = (code) => {
  const r = rooms.get(code);
  if (r) return r;
  const lower = String(code).toLowerCase();
  for (const v of rooms.values()) {
    if (v.name.toLowerCase() === lower) return v;
  }
  return undefined;
};
const getRoom = (name, len, mode) => {
  let r = rooms.get(name);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) return null; // cap: chamador nega com 'full'
    r = new Room(name, len || MATCH_LEN_S, { mode: mode || 'ffa', reconnectS: RECONNECT_S_EFF });
    rooms.set(name, r);
  }
  return r;
};

// Envelope do contrato Hub (hub/PROTOCOLO.md): hubOwner é o htok opaco
// (string do launch que criou a sala; null = sem dono). hubOwner interno da
// sala (id do criador p/ migração de host) não vaza aqui.
const hubPhase = (state) => (state === 'over' ? 'results' : state);
const hubRoomBody = (r, now) => {
  const humans = [...r.ships.values()].filter((s) => !s.bot).length;
  const room = {
    code: r.name,
    phase: hubPhase(r.state),
    players: humans,
    capacity: MAX_PLAYERS,
    // FFA admite late-join direto; teams/survival com partida em curso
    // recebem waitNext — joinable honesto p/ o Hub decidir.
    joinable: humans < MAX_PLAYERS &&
      (r.state === 'lobby' || (r.state === 'playing' && r.mode === 'ffa')),
    hubOwner: r.htok ?? null,
  };
  if (r.endsAt != null) room.startedAt = r.endsAt - r.matchLenS * 1000;
  return { ok: true, room };
};

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('method not allowed'); return; }
  let p;
  try {
    // '%zz' → URIError → 400, sem derrubar o processo
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch { res.writeHead(400); res.end('bad request'); return; }
  if (p === '/') p = '/index.html';
  // allowlist: só o jogo + protocolo; resto 403 (sem vazar server/tests/.planning)
  const ok =
    p === '/index.html' ||
    p.startsWith('/client/') || p.startsWith('/shared/') || p.startsWith('/vendor/');
  if (!ok) { res.writeHead(403); res.end('forbidden'); return; }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || p.includes('..')) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': data.length });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let p;
  try {
    // '%zz' → URIError → 400, sem derrubar o processo
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (p === '/health') {
    if (req.method !== 'GET') { res.writeHead(405); res.end('method not allowed'); return; }
    const now = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, game: 'net-wars', uptimeS: Math.floor((now - startedAt) / 1000) }));
    return;
  }
  if (p === '/__hub/state') {
    if (req.method !== 'GET') { res.writeHead(405); res.end('method not allowed'); return; }
    // Contrato Hub: ?room=CODE → envelope por sala (404 livre); sem ?room=
    // mantém o formato lista legado (overlay do cliente + ferramentas).
    // Leitura aberta (sem auth): o Hub envia x-hub-secret, o navegador não tem.
    let want = null;
    try {
      want = new URL(req.url, 'http://x').searchParams.get('room');
    } catch { res.writeHead(400); res.end('bad request'); return; }
    const now = Date.now();
    if (typeof want === 'string' && want !== '') {
      const r = findRoom(want);
      if (!r) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hubRoomBody(r, now)));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      rooms: [...rooms.values()].map((r) => ({
        room: r.name, mode: r.mode, state: r.state,
        // players = humanos (conectados + fantasmas que seguram vaga);
        // bots de survival NÃO contam (não ocupam vaga de 12).
        players: [...r.ships.values()].filter((s) => !s.bot).length, host: r.hostId,
        wave: r.wave || undefined,
        endsInS: r.endsAt == null ? 0 : Math.max(0, Math.ceil((r.endsAt - now) / 1000)),
      })),
      uptimeS: Math.floor((now - startedAt) / 1000),
    }));
    return;
  }
  if (p === '/__hub/close') {
    if (req.method !== 'POST') { res.writeHead(405); res.end('method not allowed'); return; }
    // Hub protegido: sem HUB_SECRET configurado, recusa (jogo independente segue ok).
    if (!HUB_SECRET || req.headers['x-hub-secret'] !== HUB_SECRET) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'FORBIDDEN' }));
      return;
    }
    let body = '';
    let bytes = 0; // conta BYTES (Buffer), não chars: multibyte não estoura o teto
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return; // já respondeu 413; só drena
      bytes += c.length;
      if (bytes > MAX_HTTP_BODY) {
        tooBig = true;
        try { res.writeHead(413); res.end('too large'); } catch { /* noop */ }
        return;
      }
      body += c;
    });
    const shut = (r) => {
      broadcast(r, { t: 'event', kind: 'over', scores: r.scores() });
      // fecha sockets da sala (1000) e solta ws.room; outras salas intactas
      for (const ws of [...wss.clients]) {
        if (ws.room === r) {
          ws.room = null;
          try { ws.close(1000, 'hub close'); } catch { /* noop */ }
        }
      }
      rooms.delete(r.name);
    };
    req.on('end', () => {
      if (tooBig) return;
      // Contrato Hub: room/htok via query (?room=CODE&htok=TOKEN). Legado:
      // corpo JSON {room} (ferramentas; htok só via query, nunca no corpo).
      let query;
      try {
        query = new URL(req.url, 'http://x').searchParams;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'BAD_ROOM' }));
        return;
      }
      let room = query.get('room');
      if (room === null || room === '') {
        try {
          const parsed = JSON.parse(body || '{}');
          const bRoom = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.room : undefined;
          room = typeof bRoom === 'string' && bRoom !== '' ? bRoom : null;
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'BAD_JSON' }));
          return;
        }
      } else {
        // query presente: corpo só precisa ser JSON válido (ignorado)
        try { JSON.parse(body || '{}'); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'BAD_JSON' }));
          return;
        }
      }
      if (typeof room !== 'string' || room === '') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'BAD_ROOM' }));
        return;
      }
      const qHtok = query.get('htok');
      const htok = typeof qHtok === 'string' && qHtok !== '' ? qHtok : null;
      // '*' legado (limpeza manual): sem dono possível — com htok recusa.
      if (room === '*') {
        if (htok !== null) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'FORBIDDEN' }));
          return;
        }
        const names = [...rooms.keys()];
        for (const r of [...rooms.values()]) shut(r);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, closed: names.length > 0, rooms: names }));
        return;
      }
      // Idempotente: sala inexistente → 200 {closed:false} (não 404).
      const r = findRoom(room);
      if (!r) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, closed: false }));
        return;
      }
      // Dono: só fecha se o htok conferir; divergente/ausente → 403 e preserva.
      // Sem dono (standalone): só fecha SEM htok; COM htok → 403 e preserva.
      const owner = r.htok ?? null;
      if (owner !== null ? htok !== owner : htok !== null) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'FORBIDDEN' }));
        return;
      }
      shut(r);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, closed: true }));
    });
    req.on('error', () => {}); // socket morto no meio do corpo
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });
wss.on('error', () => {}); // ex.: payload estourado não derruba o processo

let idSeq = 0;

function broadcast(room, msg, except) {
  const isSnap = !!msg && msg.t === MSG.SNAPSHOT;
  const raw = JSON.stringify(msg);
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1 && ws.room === room && ws !== except) {
      try {
        const buffered = ws.bufferedAmount || 0;
        if (buffered > WS_BACKPRESSURE_KILL) { try { ws.terminate(); } catch { /* noop */ } return; }
        if (isSnap && buffered > WS_BACKPRESSURE_SKIP) return; // lento: pula snapshot
        ws.send(raw);
      } catch { /* socket morto, limpa no close */ }
    }
  });
}

// Lobby → cliente: evento leve + snapshot autoritativo (cliente reage a ambos).
function lobbySync(room) {
  broadcast(room, { t: 'event', kind: 'lobby' });
  broadcast(room, room.snapshot(Date.now()));
}

function deny(ws, reason) {
  try { ws.send(JSON.stringify({ t: 'event', kind: 'denied', reason })); } catch { /* noop */ }
  ws.close(1013, reason);
}

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.id = `p${++idSeq}`;
    ws.on('message', (buf) => {
      try {
        let m;
        try { m = JSON.parse(String(buf)); } catch { return; } // msg inválida: ignora
        // JSON 'null'/array/número: m.t lançaria TypeError (crash) — ignora.
        if (!m || typeof m !== 'object' || Array.isArray(m)) return;
        if (m.t === MSG.HELLO) {
          const nowH = Date.now();
          if (ws.lastHelloAt && nowH - ws.lastHelloAt < HELLO_MIN_MS) return;
          ws.lastHelloAt = nowH;
          if (!validHello(m)) { ws.close(1008, 'bad hello'); return; }
          // segundo HELLO no mesmo socket: sai da sala antiga antes de trocar
          if (ws.room && ws.room.ships.has(ws.id)) ws.room.leave(ws.id);
          // case-insensitive: Hub passa código em MAIÚSCULA, cliente cria minúscula
          const room = findRoom(m.room) || getRoom(m.room, m.len, m.mode);
          if (!room) { deny(ws, 'full'); return; } // cap MAX_ROOMS
          const r = room.join(ws.id, m.name, m.color || '#44ccff', {
            team: m.team, htok: m.htok, resume: m.resume, resumeToken: m.resumeToken,
          });
          if (!r.ok) { deny(ws, r.error === 'FULL' ? 'full' : r.error); return; } // FULL|CODE_TAKEN|DUP
          ws.room = room;
          ws.send(JSON.stringify({
            t: MSG.WELCOME, id: ws.id, room: room.name,
            waitNext: r.waitNext || undefined, resumed: r.resumed || undefined,
            resumeToken: r.resumeToken || undefined, // guarda p/ reconectar; nunca no snapshot
          }));
          return;
        }
        const room = ws.room;
        if (!room) return;
        if (validLeave(m)) { // saída explícita: vaga libera na hora, sem fantasma
          room.leave(ws.id);
          ws.room = null;
          return;
        }
        if (m.t === MSG.INPUT) {
          const nowI = Date.now();
          if (ws.lastInputAt && nowI - ws.lastInputAt < INPUT_MIN_MS) return;
          ws.lastInputAt = nowI;
          if (!validInput(m) || !room.ships.has(ws.id)) return;
          m._at = nowI; // carimbo server-side p/ neutralizar input obsoleto (P1-11)
          room.inputs.set(ws.id, m);
        } else if (m.t === MSG.PING) {
          ws.send(JSON.stringify({ t: MSG.PONG, t0: m.t0 }));
        } else if (m.t === MSG.START) {
          if (!validStart(m)) return;
          if (ws.id !== room.hostId) return; // só host
          if (!room.start(Date.now())) return; // só lobby (falso = ignora)
          lobbySync(room);
        } else if (m.t === MSG.READY) {
          if (!validReady(m)) return;
          if (!room.setReady(ws.id, m.v)) return; // só lobby
          lobbySync(room);
        } else if (m.t === MSG.SHUFFLE) {
          if (!validShuffle(m)) return;
          if (ws.id !== room.hostId) return; // só host
          // só teams + lobby + ≥2 humanos (checados dentro de shuffleTeams)
          if (!room.shuffleTeams()) return;
          lobbySync(room);
        } else if (m.t === MSG.REMATCH) {
          // só com partida encerrada ou pedido do host; resto ignora (sem reset alheio)
          // rematch = revanche (reset → playing direto); 1ª partida usa START.
          if (!room.over && ws.id !== room.hostId) return;
          room.reset();
          broadcast(room, { t: 'event', kind: 'rematch' });
        }
      } catch { /* 1 mensagem ruim nunca mata o processo */ }
    });
    ws.on('error', () => {}); // erro de socket: limpa no close, sem unhandled
    ws.on('close', () => {
      if (!ws.room) return;
      ws.room.disconnect(ws.id); // fantasma 30s (reconexão sem duplicar)
    });
  });
});

// Loop autoritativo: tick 20Hz, snapshot a cada 2º tick (10Hz)
let n = 0;
setInterval(() => {
  const now = Date.now();
  const dt = 1 / TICK_HZ;
  n++;
  for (const [name, room] of rooms) {
    for (const ev of room.tick(dt, now)) broadcast(room, ev);
    if (n % (TICK_HZ / SNAP_HZ) === 0) broadcast(room, room.snapshot(now));
    room.purge(now);
    if (room.ships.size === 0) rooms.delete(name); // sala vazia encerra (host migra via hostId)
  }
}, 1000 / TICK_HZ);

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const realPort = addr && typeof addr === 'object' ? addr.port : PORT;
  console.log(`net-wars on http://${HOST}:${realPort} (MATCH_LEN_S=${MATCH_LEN_S})`);
});
