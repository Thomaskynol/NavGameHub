// Helpers compartilhados dos fluxos E2E (não tocam em fontes do projeto).
//
// Portabilidade: tudo deriva da raiz do repo (este arquivo está em
// hub/test/e2e/) e de env, sem caminhos absolutos pessoais — pendrive-safe.
//   E2E_HUB_PORT / E2E_ARCADE_PORT / E2E_VAVA_PORT / E2E_CATAN_PORT
//     portas efêmeras exportadas pelo orquestrador (run-all.mjs). Ausentes
//     => cai nos padrões do start.sh (8090..8093), p/ rodar um fluxo avulso
//     contra uma instância já no ar.
//   E2E_HUB_SECRET (ou HUB_SECRET) tem precedência sobre .run/hub_secret.
//   E2E_SHOT_DIR: onde os verificadores de navegador salvam screenshots.
//   CHROMIUM_PATH: executável do Chromium (senão, autodetecta).
import WebSocket from 'ws';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';

// Raiz do repo = três níveis acima de hub/test/e2e/.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function numEnv(name, fallback) {
  const raw = process.env[name];
  const n = raw !== undefined && raw !== '' ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const E2E = {
  hubPort: numEnv('E2E_HUB_PORT', 8090),
  arcadePort: numEnv('E2E_ARCADE_PORT', 8091),
  vavaPort: numEnv('E2E_VAVA_PORT', 8092),
  catanPort: numEnv('E2E_CATAN_PORT', 8093),
  hubBase() { return `http://127.0.0.1:${this.hubPort}`; },
  hubWs() { return `ws://127.0.0.1:${this.hubPort}/ws`; },
  gameBase(port) { return `http://127.0.0.1:${port}`; },
  shotDir: process.env.E2E_SHOT_DIR || join(tmpdir(), 'hub-e2e'),
};

// Compat: nome antigo usado como default em alguns fluxos.
export const HUB_WS = E2E.hubWs();
export const SECRET_FILE = join(REPO_ROOT, '.run', 'hub_secret');
export { SECRET_FILE as _SECRET_FILE };

export function hubSecret() {
  const fromEnv = process.env.E2E_HUB_SECRET || process.env.HUB_SECRET;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv.trim();
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
  connect(url = E2E.hubWs()) {
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
  return `${base}${Date.now().toString(36).slice(4)}${n}`.slice(0, 16);
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

// --- Rótulo de prova (R9): todo fluxo declara de que tipo é a evidência. ---
// hooks     = final forçado por hook de teste (não é partida completa).
// regras    = término/efeito pelas regras normais, sem jogar tudo.
// play-real = ações reais de jogo até o fim (ou progresso real sem hook).
export function proofLine(tag, proof, desc) {
  console.log(`[${tag}] proof=${proof} — ${desc}`);
}

// --- Navegador estrito (R9) ---
//
// pageerror e falhas de recursos NECESSÁRIOS (scripts do Hub/jogos, WS,
// respostas HTTP do mesmo host do Hub ou dos jogos) reprovam o teste.
// Allowlist justificada (benigna, não mascara defeito real):
//   - /favicon.ico (navegador pede sozinho; Hub/jogos podem não servir um):
//     404 aqui não afeta o jogo.
//   - *.map (source maps ausentes em build de produção não quebram nada).
const BENIGN_URL = [/\/favicon\.ico(\?|$)/, /\.map(\?|$)/];

function isBenignUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true; // data:, blob:, etc.
  } catch {
    return true;
  }
  return BENIGN_URL.some((re) => re.test(url));
}

function isHubOrGameUrl(url) {
  try {
    const u = new URL(url);
    const port = Number(u.port);
    return [E2E.hubPort, E2E.arcadePort, E2E.vavaPort, E2E.catanPort].includes(port);
  } catch {
    return false;
  }
}

export function strictCollector(tag) {
  const errors = [];
  return {
    errors,
    attach(page) {
      page.on('pageerror', (e) => {
        errors.push(`pageerror: ${String(e && e.message || e).slice(0, 200)}`);
      });
      page.on('requestfailed', (r) => {
        const url = r.url();
        if (isBenignUrl(url)) return;
        // Falha de handshake WS ou de recurso necessário: reprova.
        errors.push(`requestfailed: ${url.slice(0, 160)} ${r.failure()?.errorText || ''}`);
      });
      page.on('response', (r) => {
        if (r.ok()) return;
        const url = r.url();
        if (!isHubOrGameUrl(url)) return;
        if (isBenignUrl(url)) return;
        errors.push(`http-${r.status()}: ${url.slice(0, 160)}`);
      });
    },
    // Devolve {ok, detail} p/ usar com check(): sem achados => ok.
    verdict() {
      return { ok: errors.length === 0, detail: errors.slice(0, 5).join(' | ') };
    },
  };
}

export function resolveChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const sys = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  for (const p of sys) if (existsSync(p)) return p;
  // Cache do Playwright (~/.cache/ms-playwright/chromium-*/chrome-linux/chrome).
  try {
    const cache = join(homedir(), '.cache', 'ms-playwright');
    const entries = readdirSync(cache).filter((e) => e.startsWith('chromium-') || e.startsWith('chromium_headless_shell-'));
    entries.sort().reverse();
    for (const e of entries) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const p = join(cache, e, sub);
        if (existsSync(p)) return p;
      }
    }
  } catch { /* sem cache acessível */ }
  throw new Error('Chromium não encontrado (CHROMIUM_PATH, /usr/bin/chromium*, cache ms-playwright)');
}

export async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  return chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

export function shotPath(name) {
  return join(E2E.shotDir, name);
}
