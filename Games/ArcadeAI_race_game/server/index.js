// Asfalto Vivo — servidor de produção: HTTP estático + WS + salas.
// Único ponto que importa shared/tracks.js (TRACKS real).
//
//   npm start   → node server/index.js (PORT=8080 por padrão, 0.0.0.0)
//   startServer({port, tracks?, timings?, now?}) → p/ testes (porta efêmera)
import { WebSocketServer } from 'ws';
import { createHttpServer, lanAddresses } from './http.js';
import { createRooms } from './rooms.js';
import { createRace } from './race.js';
import { TRACKS } from '../shared/tracks.js';

const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 50; // rate limit global por conexão (st 15 + ping 1 + folga)

function attachWs(server, { rooms, log }) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  let connSeq = 0;

  wss.on('connection', (ws) => {
    const conn = {
      id: `c${++connSeq}`,
      player: null, // preenchido por rooms ao entrar em sala
      room: null,
      // rate limit global (janela deslizante 1 s, ver MAX_MSGS_PER_SEC)
      msgWindowStart: 0,
      msgCount: 0,
      msgWarned: false,
      send(obj) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
      },
      close(code = 1000, reason = '') {
        try { ws.close(code, reason); } catch { /* ok */ }
      },
    };
    ws._conn = conn;

    conn.send({ t: 'welcome', protocol: 2, you: conn.id, serverNow: Date.now() });

    ws.on('message', (data, isBinary) => {
      if (isBinary) { conn.close(4400, 'binary'); return; }
      if (data.length > MAX_MSG_BYTES) { conn.close(4402, 'too large'); return; }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch {
        conn.close(4400, 'bad json');
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
        conn.close(4400, 'bad msg');
        return;
      }
      // Rate limit global: sem ele 1 socket criava salas infinitas/amplificava
      // msgs (o de rooms cobre só `st`). Excedente é descartado + 1 err/janela.
      const nowMs = Date.now();
      if (nowMs - conn.msgWindowStart >= 1000) {
        conn.msgWindowStart = nowMs;
        conn.msgCount = 0;
        conn.msgWarned = false;
      }
      conn.msgCount += 1;
      if (conn.msgCount > MAX_MSGS_PER_SEC) {
        if (!conn.msgWarned) {
          conn.msgWarned = true;
          conn.send({ t: 'err', code: 'RATE', msg: 'Muitas mensagens por segundo.' });
        }
        return;
      }
      if (msg.t === 'ping') {
        // contrato §3: {ts, serverNow}; `now` é alias p/ cliente antigo
        const serverNow = Date.now();
        conn.send({ t: 'pong', ts: msg.ts, serverNow, now: serverNow });
        return;
      }
      try {
        rooms.handleMessage(conn, msg);
      } catch (err) {
        log(`rooms: erro em "${msg.t}": ${err && err.message}`);
      }
    });

    ws.on('close', () => {
      try { rooms.onClose(conn); } catch { /* ok */ }
    });
    ws.on('error', () => { /* close dispara onClose */ });
  });

  return wss;
}

export function startServer({
  port = 8080,
  host = '0.0.0.0',
  tracks = TRACKS,
  timings = {},
  now,
  root = undefined,
  log = () => {},
  secret = process.env.HUB_SECRET || '',
  hubTestHooks = process.env.HUB_TEST_HOOKS === '1',
} = {}) {
  const rooms = createRooms({ tracks, timings, now, raceFactory: createRace, log });
  const server = createHttpServer({ root, rooms, secret, hubTestHooks });
  const wss = attachWs(server, { rooms, log });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const actual = server.address().port;
      resolve({
        server,
        wss,
        rooms,
        port: actual,
        async close() {
          rooms.destroy();
          await new Promise((r) => wss.close(r));
          await new Promise((r) => server.close(r));
        },
      });
    });
  });
}

// CLI: node server/index.js
const isMain = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  startServer({ port, log: (m) => console.log(m) }).then((s) => {
    console.log(`Asfalto Vivo em http://localhost:${s.port}`);
    for (const addr of lanAddresses()) console.log(`  LAN: http://${addr}:${s.port}`);
  }).catch((err) => {
    console.error('falha ao iniciar servidor:', err);
    process.exit(1);
  });
}
