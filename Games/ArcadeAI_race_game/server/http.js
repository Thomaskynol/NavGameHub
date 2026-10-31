// Asfalto Vivo — servidor HTTP estático próprio (sem Express).
// Rotas (ARCHITECTURE.md §0/§1):
//   /            → public/  (SPA fallback: página sem arquivo → public/index.html)
//   /shared/*    → shared/
//   /vendor/*    → node_modules/three/build/
//   /api/info    → {addresses:[ipv4 não-loopback..., '127.0.0.1']} (dica de convite LAN)
import http from 'node:http';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MAX_PLAYERS } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const EXT_ASSET = new Set(Object.keys(MIME));

/** IPv4s não-loopback da LAN + 127.0.0.1 (convite LAN). */
export function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      const fam = i.family === 'IPv4' || i.family === 4;
      if (fam && !i.internal) out.push(i.address);
    }
  }
  out.push('127.0.0.1');
  return [...new Set(out)];
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function sendFile(req, res, filePath) {
  const stat = await fsp.stat(filePath);
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' };
  if (req.method === 'HEAD') { res.writeHead(200, headers); res.end(); return; }
  await new Promise((resolve) => {
    const stream = createReadStream(filePath);
    stream.on('error', () => { res.destroy(); resolve(); });
    stream.on('end', resolve);
    res.writeHead(200, headers);
    stream.pipe(res);
  });
}

/** Handler HTTP async (erros → 404/500, nunca lançam p/ o processo). */
export function createHttpHandler({
  root = ROOT,
  rooms = null,
  secret = process.env.HUB_SECRET || '',
  hubTestHooks = process.env.HUB_TEST_HOOKS === '1',
} = {}) {
  const publicDir = path.join(root, 'public');
  const sharedDir = path.join(root, 'shared');
  const vendorDir = path.join(root, 'node_modules', 'three', 'build');
  const hubSecret = typeof secret === 'string' ? secret : '';

  const hubPhase = (status) => (
    status === 'lobby' ? 'lobby'
      : status === 'results' ? 'results'
        : 'playing'
  );

  function handleHub(req, res, url, pathname) {
    const given = req.headers['x-hub-secret'];
    if (!hubSecret || given !== hubSecret) {
      sendJson(res, 403, { ok: false, error: 'FORBIDDEN' });
      return;
    }
    const code = String(url.searchParams.get('room') || '').trim().toUpperCase();

    if (pathname === '/__hub/state') {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
      const room = rooms ? rooms.getRoom(code) : null;
      if (!room) { sendJson(res, 404, { ok: false, error: 'NOT_FOUND' }); return; }
      sendJson(res, 200, {
        ok: true,
        room: {
          code: room.code,
          phase: hubPhase(room.status),
          players: room.players.length,
          capacity: MAX_PLAYERS,
          joinable: room.status === 'lobby',
        },
      });
      return;
    }

    if (pathname === '/__hub/close') {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
      if (rooms) rooms.closeRoom(code);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/__hub/test/finish') {
      if (!hubTestHooks) { sendJson(res, 404, { ok: false, error: 'NOT_FOUND' }); return; }
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
      const ok = rooms ? rooms.forceFinish(code) : false;
      if (!ok) { sendJson(res, 404, { ok: false, error: 'NOT_FOUND' }); return; }
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
  }

  return async function handler(req, res) {
    try {
      let url;
      let pathname;
      try {
        url = new URL(req.url, 'http://x');
        pathname = decodeURIComponent(url.pathname);
      } catch { res.writeHead(400); res.end(); return; }

      if (pathname.startsWith('/__hub/')) { handleHub(req, res, url, pathname); return; }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }

      if (pathname === '/api/info') { sendJson(res, 200, { addresses: lanAddresses() }); return; }

      let baseDir;
      let rel;
      if (pathname === '/shared' || pathname.startsWith('/shared/')) {
        baseDir = sharedDir;
        rel = pathname.slice('/shared'.length).replace(/^\/+/, '');
      } else if (pathname === '/vendor' || pathname.startsWith('/vendor/')) {
        baseDir = vendorDir;
        rel = pathname.slice('/vendor'.length).replace(/^\/+/, '');
      } else {
        baseDir = publicDir;
        rel = pathname.replace(/^\/+/, '');
      }
      if (rel.split('/').includes('..')) { res.writeHead(400); res.end(); return; }
      let filePath = path.resolve(baseDir, rel || 'index.html');
      if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) { res.writeHead(403); res.end(); return; }

      let stat = await fsp.stat(filePath).catch(() => null);
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fsp.stat(filePath).catch(() => null);
      }
      if (!stat) {
        // SPA fallback: página sem extensão de asset conhecida → index.html
        if (baseDir === publicDir && !EXT_ASSET.has(path.extname(rel).toLowerCase())) {
          filePath = path.join(publicDir, 'index.html');
          stat = await fsp.stat(filePath).catch(() => null);
        }
        if (!stat) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
      }
      await sendFile(req, res, filePath);
    } catch {
      try { res.writeHead(500); res.end(); } catch { /* já respondido */ }
    }
  };
}

export function createHttpServer(opts) {
  return http.createServer(createHttpHandler(opts));
}
