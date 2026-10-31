import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { MATCH } from '@vava/shared';
import type { RoomManager } from './rooms.js';

export interface HubHandlerOptions {
  rooms?: RoomManager | null;
  secret?: string;
  hubTestHooks?: boolean;
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function createRequestHandler(
  options: HubHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const distPath = fileURLToPath(new URL('../../client/dist', import.meta.url));
  const serveClient = existsSync(distPath)
    ? sirv(distPath, { single: true, etag: true, dev: false })
    : null;
  const rooms = options.rooms ?? null;
  const hubSecret = options.secret ?? process.env.HUB_SECRET ?? '';
  const hubTestHooks = options.hubTestHooks ?? process.env.HUB_TEST_HOOKS === '1';

  function handleHub(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    pathname: string,
  ): void {
    const given = req.headers['x-hub-secret'];
    if (!hubSecret || given !== hubSecret) {
      sendJson(res, 403, { ok: false, error: 'FORBIDDEN' });
      return;
    }
    const code = String(url.searchParams.get('room') ?? '').trim().toUpperCase();

    if (pathname === '/__hub/state') {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end();
        return;
      }
      const room = rooms ? rooms.get(code) : undefined;
      if (!room) {
        sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
        return;
      }
      const phase =
        room.phase === 'waiting'
          ? 'lobby'
          : room.phase === 'ended'
            ? 'results'
            : 'playing';
      sendJson(res, 200, {
        ok: true,
        room: {
          code: room.code,
          phase,
          players: room.playerCount,
          capacity: MATCH.maxPlayers,
          joinable: !room.isFull,
        },
      });
      return;
    }

    if (pathname === '/__hub/close') {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' });
        res.end();
        return;
      }
      if (rooms) rooms.close(code);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/__hub/test/end' || pathname === '/__hub/test/finish') {
      if (!hubTestHooks) {
        sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' });
        res.end();
        return;
      }
      const room = rooms ? rooms.get(code) : undefined;
      if (!room) {
        sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
        return;
      }
      room.forceEnd();
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
  }

  return (req, res) => {
    let url: URL;
    let pathname = req.url ?? '/';
    try {
      url = new URL(req.url ?? '/', 'http://x');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    if (pathname.startsWith('/__hub/')) {
      handleHub(req, res, url, pathname);
      return;
    }

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    if (pathname === '/lan') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ addresses: lanAddresses() }));
      return;
    }

    if (!serveClient) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        'VAVA2D — servidor online.\n\n' +
          'O build do cliente ainda não existe.\n' +
          'Em desenvolvimento abra http://localhost:5173 (npm run dev).\n' +
          'Para produção rode npm run build e reinicie o servidor.\n',
      );
      return;
    }

    serveClient(req, res, () => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });
  };
}


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
