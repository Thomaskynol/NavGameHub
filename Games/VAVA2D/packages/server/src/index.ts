import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { NET, TICK_DT, TICK_RATE, WS_MAX_PAYLOAD } from '@vava/shared';
import { RoomManager } from './rooms.js';
import { Session } from './session.js';
import { createRequestHandler } from './static.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const rooms = new RoomManager();
const requestHandler = createRequestHandler({
  rooms,
  secret: process.env.HUB_SECRET ?? '',
  hubTestHooks: process.env.HUB_TEST_HOOKS === '1',
});
const server = createServer(requestHandler);
const wss = new WebSocketServer({
  server,
  path: NET.path,
  maxPayload: WS_MAX_PAYLOAD,
});

wss.on('connection', (ws) => {
  new Session(ws, rooms);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  VAVA2D rodando em:');
  console.log(`    local:   http://localhost:${PORT}`);
  for (const address of lanAddresses()) {
    console.log(`    rede:    http://${address}:${PORT}`);
  }
  console.log(`    WebSocket: ${NET.path}`);
  console.log('');
});

let accumulator = 0;
let previous = performance.now();
const tickIntervalMs = 1000 / TICK_RATE;

setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(now - previous, 250);
  previous = now;

  let steps = 0;
  while (accumulator >= tickIntervalMs && steps < 15) {
    rooms.update(TICK_DT);
    accumulator -= tickIntervalMs;
    steps += 1;
  }
  if (steps === 15) accumulator = 0;
}, 4);

setInterval(() => rooms.cleanup(), 10_000);

function lanAddresses(): string[] {
  const addresses: string[] = [];
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function shutdown(): void {
  console.log('Encerrando VAVA2D...');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
