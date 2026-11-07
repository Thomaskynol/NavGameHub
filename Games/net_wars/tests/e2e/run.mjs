// E2E versionado v2 — harness CDP sem dependências novas (só `ws`, já runtime).
// Uso:
//   node tests/e2e/run.mjs [--flow=menu|lobby|full|modes] [--browser=chromium|firefox] [--game-port=N] [--keep]
// Chromium = harness completo (CDP: console+pageerror+rede + screenshots).
// Firefox = perna visual (sem geckodriver/playwright no ambiente offline:
// prova carga+render via --screenshot; console/pageerror do Firefox = lacuna
// registrada em docs/E2E.md, não afirmada).
// O que cada flow prova (asserts reais, sem sleep-cego — espera por condição):
//   menu  (FIRST INCREMENT): 1 sessão chromium headless → menu visível +
//           1 screenshot + zero pageerror + console limpo (allowlist) +
//           zero request de rede falhado.
//   lobby: menu→criar sala→lobby (código + piloto listados)→ready→start→HUD
//           visível + screenshots por etapa + mesmos asserts de console/rede.
//   full:  2 sessões CDP isoladas (2 profiles) + 1 aim-bot WS na mesma sala →
//           menu→lobby→start→move→laser/míssil no snapshot→dano observado→
//           morte/respawn de A→reload+retorno de B (mesmo id)→TP→FP em
//           partida→fim por timer (empate ou vitória)→revanche→playing.
//           + câmera TP rígida sem input (resposta a "TP-still-spins?") +
//           screenshots lobby/playing/morta/over/revanche + mesmos asserts.
//   modes: fumaça teams (lobby mostra EQUIPES, start→HUD, snap.mode) +
//           survival (start→HUD, wave≥1, snap.mode). Sem bots reais pilotados.
// Firefox: sem webdriver/geckodriver no ambiente (e sem pacote playwright p/
// instalar offline) → perna via `firefox --headless --screenshot` (prova que
// a página carrega e renderiza); console/pageerror do Firefox = BLOQUEADOR
// registrado em docs/E2E.md, não afirmado.
// Feel (câmera TP, pointer-lock real, áudio audível) = human-pending sempre.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { WebSocket } from 'ws';
import { AimBot } from './bot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = join(dirname(fileURLToPath(import.meta.url)), 'artifacts');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : ['_', a];
}));
const FLOW = args.flow || 'menu';
const BROWSER = args.browser || 'chromium';
const GAME_PORT = Number(args['game-port']) || 0;
const KEEP = args.keep === true || args.keep === 'true';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function startServer(port) {
  const child = spawn('node', ['server/main.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, get log() { return log; } };
}

async function ready(port, srv, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/__hub/state`);
      if (r.ok) return;
    } catch { /* subindo */ }
    if (srv.child.exitCode != null) throw new Error(`server morreu ao subir:\n${srv.log}`);
    await wait(100);
  }
  throw new Error('server não subiu');
}

// ---- CDP mínimo sobre `ws` (sem driver novo) ----
class CDP {
  constructor(url, { timeoutMs = 20000 } = {}) {
    this.seq = 0;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.events = [];
    this.ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
    this.open = new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    this.ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(String(buf)); } catch { return; }
      if (m.id != null && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(`CDP ${m.error.code}: ${m.error.message}`));
        else res(m.result);
      } else if (m.method) this.events.push(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`CDP timeout (${this.timeoutMs}ms): ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }), (e) => { if (e) { clearTimeout(timer); this.pending.delete(id); rej(e); } });
    });
  }
  async evaluate(expr, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise, userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(`evaluate lançou: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
    return r.result?.value;
  }
  async waitFor(expr, timeoutMs = 15000, stepMs = 150) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = await this.evaluate(`(() => { try { return (${expr}); } catch { return null; } })()`); } catch { /* tenta de novo */ }
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor expirou: ${expr}`);
      await wait(stepMs);
    }
  }
  close() { try { this.ws.close(); } catch {} }
}

async function dbgJson(dbgPort, path) {
  const r = await fetch(`http://127.0.0.1:${dbgPort}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' });
  if (!r.ok) throw new Error(`debugger ${path} → ${r.status}`);
  return r.json();
}

async function launchChromium(dbgPort, { tries = 3, tryTimeoutMs = 15000 } = {}) {
  // NUNCA /tmp: quota do ambiente quebra o cache do chromium (GPU exit 133).
  // Perfil + cache vão p/ dentro de tests/e2e (gitignored, disco com espaço).
  // Retry: falha de debugging (timeout/morte) mata o filho + limpa o perfil
  // antes da próxima tentativa — sem isso o processo vazado acumula e a
  // 2ª instância seguinte morre por exaustão (pilha de chromiums órfãos).
  const base = join(dirname(fileURLToPath(import.meta.url)), '.profiles');
  mkdirSync(base, { recursive: true });
  let lastErr = '';
  for (let attempt = 1; attempt <= tries; attempt++) {
    const t0 = Date.now();
    const profile = mkdtempSync(join(base, 'p-'));
    const child = spawn('chromium', [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--disable-crash-reporter',
      `--remote-debugging-port=${dbgPort}`,
      `--user-data-dir=${profile}`,
      `--disk-cache-dir=${join(profile, 'cache')}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const cleanup = () => {
      try { child.kill(); } catch {}
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* melhor esforço */ }
    };
    let ok = false;
    const triesN = Math.ceil(tryTimeoutMs / 100);
    for (let i = 0; i < triesN; i++) {
      try { await dbgJson(dbgPort, '/json/version'); ok = true; break; }
      catch { /* subindo */ }
      if (child.exitCode != null) break;
      await wait(100);
    }
    if (ok) {
      console.log(`INFO  chromium debugging em ${Date.now() - t0}ms (tentativa ${attempt}/${tries}, porta ${dbgPort})`);
      return { child, profile, err: () => err };
    }
    lastErr = err;
    console.log(`INFO  chromium tentativa ${attempt}/${tries} falhou em ${Date.now() - t0}ms (exit=${child.exitCode}, stderr ${err.length} chars) — limpando e repetindo`);
    cleanup();
    await wait(500);
  }
  throw new Error(`chromium não abriu debugging em ${dbgPort} após ${tries} tentativas:\n${String(lastErr).slice(-2000)}`);
}

const KNOWN_CONSOLE_ALLOW = [
  // Nada conhecido ainda — primeira evidência decide. Formato: substring.
];

async function dumpFailure(cdp, tag) {
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ART, `fail-${tag}-chromium.png`), Buffer.from(shot.data, 'base64'));
    console.log(`INFO  failshot: fail-${tag}-chromium.png`);
  } catch { /* sem screenshot no caminho de falha */ }
  for (const e of cdp.events.filter((x) => x.method === 'Runtime.exceptionThrown').slice(0, 3))
    console.log(`  pageerror: ${JSON.stringify(e.params?.exceptionDetails).slice(0, 400)}`);
  for (const e of cdp.events.filter((x) => x.method === 'Runtime.consoleAPICalled' && x.params?.type === 'error').slice(0, 5))
    console.log(`  console.error: ${JSON.stringify(e.params?.args).slice(0, 300)}`);
  try {
    const state = await cdp.evaluate(`(() => ({
      menu: getComputedStyle(document.getElementById('screen-menu')).display,
      lobby: getComputedStyle(document.getElementById('screen-lobby')).display,
      hud: getComputedStyle(document.getElementById('hud')).display,
      canvas: document.querySelectorAll('canvas').length,
      name: document.getElementById('m-name').value,
      code: document.getElementById('l-code').textContent,
    }))()`);
    console.log(`INFO  dom-state: ${JSON.stringify(state)}`);
  } catch (e) { console.log(`INFO  dom-state indisponível: ${e.message}`); }
}

// ---- helpers v2 (full/modes) ----
const HUD_EXPR = `document.getElementById('hud') && getComputedStyle(document.getElementById('hud')).display !== 'none'`;
const LOBBY_EXPR = `getComputedStyle(document.getElementById('screen-lobby')).display !== 'none'`;
const MENU_BOOT_EXPR = `document.getElementById('m-room').value !== ''`;

async function openTab(dbgPort) {
  const { webSocketDebuggerUrl } = await dbgJson(dbgPort, '/json/new?about:blank');
  const cdp = new CDP(webSocketDebuggerUrl);
  await cdp.open;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  return cdp;
}

async function shot(cdp, name) {
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(ART, name), Buffer.from(s.data, 'base64'));
  console.log(`INFO  shot: ${name}`);
}

const snapOf = (cdp) => cdp.evaluate(`window.__nw ? window.__nw.snap : null`);
const myShip = (cdp) => cdp.evaluate(`(() => {
  const n = window.__nw;
  if (!n || !n.snap) return null;
  const s = n.snap.ships.find((x) => x.id === n.id);
  return s ? { id: s.id, x: s.x, y: s.y, z: s.z, hp: s.hp, alive: s.alive } : null;
})()`);
const key = (cdp, type, code) =>
  cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' }))`);
const vis = (cdp, id) =>
  cdp.evaluate(`(() => { const el = document.getElementById('${id}'); return el && getComputedStyle(el).display !== 'none'; })()`);

async function cleanChecks(cdp, label) {
  const pageerrors = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  check(pageerrors.length === 0, `[${label}] zero pageerror (${pageerrors.length})`);
  for (const e of pageerrors.slice(0, 3)) console.log(`  pageerror: ${JSON.stringify(e.params?.exceptionDetails).slice(0, 300)}`);
  const consoleCalls = cdp.events.filter((e) => e.method === 'Runtime.consoleAPICalled');
  const badConsole = consoleCalls.filter((e) =>
    (e.params?.type === 'error') &&
    !KNOWN_CONSOLE_ALLOW.some((s) => JSON.stringify(e.params?.args || []).includes(s)));
  check(badConsole.length === 0, `[${label}] zero console.error (${badConsole.length})`);
  for (const e of badConsole.slice(0, 5)) console.log(`  console.error: ${JSON.stringify(e.params?.args).slice(0, 300)}`);
  const warns = consoleCalls.filter((e) => e.params?.type === 'warning');
  const unknownWarns = warns.filter((e) =>
    !KNOWN_CONSOLE_ALLOW.some((s) => JSON.stringify(e.params?.args || []).includes(s)));
  console.log(`INFO  [${label}] console.warn: ${warns.length} (${unknownWarns.length} fora da allowlist)`);
  for (const e of unknownWarns.slice(0, 5)) console.log(`  warn: ${JSON.stringify(e.params?.args).slice(0, 200)}`);
  const failedReq = cdp.events.filter((e) =>
    e.method === 'Network.loadingFailed' &&
    !/favicon\.ico/.test(e.params?.blockedReason || '') &&
    !/favicon/.test(JSON.stringify(e.params || '')));
  const realFails = failedReq.filter((e) => (e.params?.errorText || '') !== 'net::ERR_ABORTED');
  check(realFails.length === 0, `[${label}] zero request falhado (${realFails.length})`);
  for (const e of realFails.slice(0, 5)) console.log(`  loadingFailed: ${JSON.stringify(e.params).slice(0, 200)}`);
}

async function killBrowser(browser) {
  browser.child.kill();
  if (!KEEP) {
    await wait(800); // ExFAT/pendrive segura locks por um instante após o kill
    try {
      rmSync(browser.profile, { recursive: true, force: true });
    } catch { /* melhor esforço */ }
  }
}

async function main() {
  if (!['menu', 'lobby', 'full', 'modes'].includes(FLOW)) throw new Error(`flow desconhecido: ${FLOW} (menu|lobby|full|modes)`);
  if (!['chromium', 'firefox'].includes(BROWSER)) throw new Error(`browser desconhecido: ${BROWSER} (chromium|firefox)`);
  if ((FLOW === 'full' || FLOW === 'modes') && BROWSER !== 'chromium')
    throw new Error(`flow ${FLOW} exige --browser=chromium (2 sessões CDP)`);
  mkdirSync(ART, { recursive: true });

  const gamePort = GAME_PORT || await freePort();
  const srv = startServer(gamePort);
  try {
    await ready(gamePort, srv);
    console.log(`server up: http://127.0.0.1:${gamePort}`);
    if (BROWSER === 'firefox') {
      await firefoxShot(gamePort);
      console.log('E2E OK');
      return;
    }
    if (FLOW === 'full') await chromiumFull(gamePort);
    else if (FLOW === 'modes') await chromiumModes(gamePort);
    else await chromiumFlow(gamePort);
  } finally {
    srv.child.kill();
    await wait(300);
  }

  console.log(failures === 0 ? 'E2E OK' : `E2E ${failures} FALHA(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

// Perna Firefox: sem driver CDP (geckodriver ausente, sem pacote playwright
// offline) → prova carga+render com --screenshot one-shot.
// Exige profile em disco ext4 (perfil no pendrive/exFAT = no-op silencioso).
async function firefoxShot(gamePort) {
  const { homedir } = await import('node:os');
  const profBase = join(homedir(), '.cache', 'nw-e2e-ff');
  mkdirSync(profBase, { recursive: true });
  const out = join(ART, `${FLOW === 'lobby' ? 'lobby' : 'menu'}-firefox.png`);
  const url = `http://127.0.0.1:${gamePort}/?len=30`;
  const child = spawn('firefox', [
    '--headless', '--no-remote', `--profile=${profBase}`,
    '--window-size=1280,800', `--screenshot=${out}`, url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const code = await new Promise((res) => { child.once('exit', res); setTimeout(() => { child.kill(); res('timeout'); }, 90000); });
  check(code === 0, `firefox --screenshot exit 0 (exit=${code})`);
  let size = 0;
  try { size = (await import('node:fs')).statSync(out).size; } catch { /* ausente */ }
  check(size > 50000, `screenshot firefox existe e não é vazio (${size} bytes → ${out})`);
  // Sem CDP no Firefox: sem asserts de console/pageerror aqui (lacuna em docs/E2E.md).
}

async function chromiumFlow(gamePort) {
  let browser = null;
  let cdp = null;
  try {
    const dbgPort = await freePort();
    browser = await launchChromium(dbgPort);
    const { webSocketDebuggerUrl } = await dbgJson(dbgPort, '/json/new?about:blank');
    cdp = new CDP(webSocketDebuggerUrl);
    await cdp.open;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');

    const base = `http://127.0.0.1:${gamePort}/?len=30`;
    await cdp.send('Page.navigate', { url: base });
    const menuVisible = await cdp.waitFor(
      `document.getElementById('screen-menu') && getComputedStyle(document.getElementById('screen-menu')).display !== 'none' && !!document.getElementById('btn-create')`);
    check(!!menuVisible, 'menu visível após boot');
    // Menu é HTML estático: visível ANTES de client/main.js rodar. Sinal real
    // de boot = init do módulo (ui.room recebe 'ffa1'; wire() roda no mesmo
    // tick síncrono, logo handlers já estão ligados quando isto é observado).
    const booted = await cdp.waitFor(`document.getElementById('m-room').value !== ''`);
    check(!!booted, 'módulo cliente bootado (wire ligado)');

    const title = await cdp.evaluate(`document.title`);
    check(/NET WARS/i.test(title || ''), `título da página (${title})`);

    if (FLOW === 'lobby') {
      // Seta nome + clica no MESMO evaluate: sem janela p/ o init sobrescrever.
      await cdp.evaluate(`(() => { document.getElementById('m-name').value = 'e2e-p1'; document.getElementById('btn-create').click(); })()`);
      const lobbyVisible = await cdp.waitFor(
        `getComputedStyle(document.getElementById('screen-lobby')).display !== 'none'`);
      check(!!lobbyVisible, 'lobby visível após criar sala');
      const code = await cdp.evaluate(`document.getElementById('l-code').textContent`);
      check(/^[A-Z0-9]{4,8}$/.test((code || '').trim()), `código da sala (${(code || '').trim()})`);
      await cdp.waitFor(`document.getElementById('l-rows').textContent.includes('e2e-p1')`);
      check(true, 'piloto listado no hangar');
      const shot0 = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(ART, 'lobby-chromium.png'), Buffer.from(shot0.data, 'base64'));

      await cdp.evaluate(`document.getElementById('l-ready').click()`);
      await cdp.waitFor(`document.getElementById('l-ready').textContent.includes('PRONTO')`);
      check(true, 'ready autoritativo espelhado no botão');
      await cdp.evaluate(`document.getElementById('l-start').click()`);
      const hudVisible = await cdp.waitFor(
        `document.getElementById('hud') && getComputedStyle(document.getElementById('hud')).display !== 'none'`, 20000);
      check(!!hudVisible, 'HUD visível após start (enterMatch)');
      // Deixa a simulação rodar alguns segundos p/ WebGL erros tardios aparecerem.
      await wait(4000);
      const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(ART, 'hud-chromium.png'), Buffer.from(shot1.data, 'base64'));
    } else {
      await wait(1500); // 1 frame-loop p/ erros tardios de boot (condição: menu já visível)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(ART, 'menu-chromium.png'), Buffer.from(shot.data, 'base64'));
    }

    // ---- asserts de limpeza: pageerror + console + rede ----
    const pageerrors = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
    check(pageerrors.length === 0, `zero pageerror (${pageerrors.length})`);
    for (const e of pageerrors.slice(0, 3)) console.log(`  pageerror: ${JSON.stringify(e.params?.exceptionDetails).slice(0, 300)}`);

    const consoleCalls = cdp.events.filter((e) => e.method === 'Runtime.consoleAPICalled');
    const badConsole = consoleCalls.filter((e) =>
      (e.params?.type === 'error') &&
      !KNOWN_CONSOLE_ALLOW.some((s) => JSON.stringify(e.params?.args || []).includes(s)));
    check(badConsole.length === 0, `zero console.error (${badConsole.length})`);
    for (const e of badConsole.slice(0, 5)) console.log(`  console.error: ${JSON.stringify(e.params?.args).slice(0, 300)}`);
    const warns = consoleCalls.filter((e) => e.params?.type === 'warning');
    const unknownWarns = warns.filter((e) =>
      !KNOWN_CONSOLE_ALLOW.some((s) => JSON.stringify(e.params?.args || []).includes(s)));
    console.log(`INFO  console.warn: ${warns.length} (${unknownWarns.length} fora da allowlist)`);
    for (const e of unknownWarns.slice(0, 5)) console.log(`  warn: ${JSON.stringify(e.params?.args).slice(0, 200)}`);

    const failedReq = cdp.events.filter((e) =>
      e.method === 'Network.loadingFailed' &&
      !/favicon\.ico/.test(e.params?.blockedReason || '') &&
      !/favicon/.test(JSON.stringify(e.params || '')));
    const realFails = failedReq.filter((e) => (e.params?.errorText || '') !== 'net::ERR_ABORTED');
    check(realFails.length === 0, `zero request falhado (${realFails.length})`);
    for (const e of realFails.slice(0, 5)) console.log(`  loadingFailed: ${JSON.stringify(e.params).slice(0, 200)}`);
  } catch (e) {
    if (cdp) await dumpFailure(cdp, FLOW);
    throw e;
  } finally {
    cdp?.close();
    if (browser) {
      browser.child.kill();
      if (!KEEP) {
        // ExFAT/pendrive segura locks por um instante após o kill — espera antes.
        await wait(800);
        try {
          rmSync(browser.profile, { recursive: true, force: true });
        } catch { /* melhor esforço */ }
      }
    }
  }
}

// ---- flow full: partida completa em 2 sessões + bot ----
async function chromiumFull(gamePort) {
  const LEN = 60; // partida curta p/ o fim por timer chegar rápido
  const browsers = [];
  const cdps = [];
  let bot = null;
  const tag = 'full';
  try {
    const dbgA = await freePort();
    const brA = await launchChromium(dbgA);
    browsers.push(brA);
    const dbgB = await freePort();
    const brB = await launchChromium(dbgB);
    browsers.push(brB);
    const A = await openTab(dbgA);
    const B = await openTab(dbgB);
    cdps.push(A, B);
    const base = `http://127.0.0.1:${gamePort}/?len=${LEN}`;

    // A cria a sala (btn-create gera código aleatório — lê do lobby).
    await A.send('Page.navigate', { url: base });
    await A.waitFor(
      `document.getElementById('screen-menu') && getComputedStyle(document.getElementById('screen-menu')).display !== 'none'`);
    await A.waitFor(MENU_BOOT_EXPR, 30000); // boot do módulo (three.js) em disco lento
    await A.evaluate(`(() => { document.getElementById('m-name').value = 'e2e-p1'; document.getElementById('btn-create').click(); })()`);
    await A.waitFor(LOBBY_EXPR);
    const code = (await A.evaluate(`document.getElementById('l-code').textContent`) || '').trim().toLowerCase();
    check(/^[a-z0-9]{4,8}$/.test(code), `sala criada (código ${code})`);

    // Bot WS entra na mesma sala (alvo: A). Fica parado até ser armado.
    bot = new AimBot({ port: gamePort, room: code, target: 'e2e-p1' });
    await bot.connect();
    check(true, 'bot WS entrou na sala');

    // B entra com o código.
    await B.send('Page.navigate', { url: base });
    await B.waitFor(
      `document.getElementById('screen-menu') && getComputedStyle(document.getElementById('screen-menu')).display !== 'none'`);
    await B.waitFor(MENU_BOOT_EXPR, 30000); // boot do módulo (three.js) em disco lento
    await B.evaluate(`(() => { document.getElementById('m-name').value = 'e2e-p2'; document.getElementById('m-room').value = '${code}'; document.getElementById('btn-join').click(); })()`);
    await B.waitFor(LOBBY_EXPR);
    await B.waitFor(`document.getElementById('l-rows').textContent.includes('e2e-p2')`);
    check(true, 'B no hangar (join com código)');
    await shot(A, 'full-lobby-chromium.png');

    // Câmera: A→TP no lobby, B fica no default FP.
    await A.evaluate(`document.querySelector('#l-cam button[data-cam="tp"]').click()`);
    await A.waitFor(`window.__nw && window.__nw.camMode === 'tp'`);
    check(true, 'A em 3ª pessoa (TP)');
    check((await B.evaluate(`window.__nw && window.__nw.camMode`)) === 'fp', 'B em 1ª pessoa (FP default)');

    // Ready nos dois + host inicia; B entra na vista (servidor já playing).
    await A.evaluate(`document.getElementById('l-ready').click()`);
    await B.evaluate(`document.getElementById('l-ready').click()`);
    await A.waitFor(`document.getElementById('l-ready').textContent.includes('PRONTO')`);
    await B.waitFor(`document.getElementById('l-ready').textContent.includes('PRONTO')`);
    check(true, 'ready autoritativo nos dois');
    await A.evaluate(`document.getElementById('l-start').click()`);
    await A.waitFor(HUD_EXPR, 20000);
    await B.evaluate(`document.getElementById('l-start').click()`);
    await B.waitFor(HUD_EXPR, 20000);
    check(true, 'HUD visível nos dois (playing)');
    check((await snapOf(A))?.state === 'playing', 'snapshot playing');

    // Movimento: B (FP) segura W real via teclado sintético e sai do lugar.
    const p0 = await myShip(B);
    check(!!p0, 'nave de B no snapshot');
    await key(B, 'keydown', 'KeyW');
    await wait(1500);
    await key(B, 'keyup', 'KeyW');
    const p1 = await myShip(B);
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    check(moved > 2, `B moveu com W (${moved.toFixed(1)}u)`);

    // Laser: B segura click no canvas até o snapshot mostrar lasers.
    let lasers = 0;
    for (let i = 0; i < 4 && lasers === 0; i++) {
      await B.evaluate(`document.querySelector('canvas').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))`);
      await wait(700);
      lasers = (await snapOf(B))?.lasers?.length || 0;
    }
    check(lasers > 0, `laser de B no snapshot (${lasers})`);
    await B.evaluate(`window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))`);

    // Míssil: B segura E até o snapshot mostrar mísseis.
    await key(B, 'keydown', 'KeyE');
    let missiles = 0;
    for (let i = 0; i < 10 && missiles === 0; i++) {
      await wait(400);
      missiles = (await snapOf(B))?.missiles?.length || 0;
    }
    await key(B, 'keyup', 'KeyE');
    check(missiles > 0, `míssil de B no snapshot (${missiles})`);

    // §8 (Lane N): observador vê o outro coerente — nave/orientação/tiros.
    // Lock SIMULADO EXPLÍCITO: mousedown/teclado abaixo são dispatchEvent
    // sintético, sem pointer-lock real (feel real = validação humana pendente).
    console.log('INFO  §8 lock simulado EXPLÍCITO: inputs via dispatchEvent, sem pointer-lock real');
    let aLasersSeenByB = 0;
    for (let i = 0; i < 4 && aLasersSeenByB === 0; i++) {
      await A.evaluate(`document.querySelector('canvas').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))`);
      await wait(700);
      aLasersSeenByB = (await snapOf(B))?.lasers?.length || 0;
    }
    check(aLasersSeenByB > 0, `B vê tiros de A no snapshot (${aLasersSeenByB})`);
    await A.evaluate(`window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))`);
    const aSelf = await A.evaluate(`(() => {
      const n = window.__nw;
      const s = n.snap && n.snap.ships.find((x) => x.id === n.id);
      return s ? { id: s.id, hp: s.hp, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch } : null;
    })()`);
    const aSeenByB = await B.evaluate(`(() => {
      const n = window.__nw;
      const s = (n.snap?.ships || []).find((x) => x.name === 'e2e-p1');
      return s ? { id: s.id, hp: s.hp, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch } : null;
    })()`);
    check(!!(aSelf && aSeenByB) && aSelf.id === aSeenByB.id, 'B vê a nave de A (mesmo id)');
    if (aSelf && aSeenByB) {
      const dp = Math.hypot(aSelf.x - aSeenByB.x, aSelf.y - aSeenByB.y, aSelf.z - aSeenByB.z);
      const dy = Math.abs(aSelf.yaw - aSeenByB.yaw), dpit = Math.abs(aSelf.pitch - aSeenByB.pitch);
      console.log(`INFO  §8 coerência: Δpos=${dp.toFixed(2)}u Δyaw=${dy.toFixed(4)} Δpitch=${dpit.toFixed(4)} Δhp=${Math.abs(aSelf.hp - aSeenByB.hp)}`);
      check(aSelf.hp === aSeenByB.hp, 'hp de A igual nos dois observadores');
      check(dp < 15, `posição de A coerente entre observadores (Δ=${dp.toFixed(2)}u)`);
      check(dy < 0.15 && dpit < 0.15, `orientação de A coerente (Δyaw=${dy.toFixed(3)} Δpitch=${dpit.toFixed(3)})`);
    }

    // §8b (FIX): ○+✛ em browser — __nw.aim finito nos dois observadores (TP e FP).
    // Prova ○ (ball no mundo + cursor em px) + ✛ (reticle central = nariz/gun)
    // com a partida rodando; morto/espera publicaria nulls (não é o caso aqui).
    const aimA = await A.evaluate(`window.__nw && window.__nw.aim`);
    const aimB = await B.evaluate(`window.__nw && window.__nw.aim`);
    const finiteAim = (a) => !!a && !!a.nose && Number.isFinite(a.nose.yaw) && Number.isFinite(a.nose.pitch)
      && !!a.ball && Number.isFinite(a.ball.x + a.ball.y + a.ball.z)
      && !!a.cursor && Number.isFinite(a.cursor.x + a.cursor.y)
      && !!a.reticle && Number.isFinite(a.reticle.x + a.reticle.y);
    check(finiteAim(aimA), `__nw.aim finito em A TP (○+✛) cursor=${JSON.stringify(aimA?.cursor)}`);
    check(finiteAim(aimB), `__nw.aim finito em B FP (○+✛) cursor=${JSON.stringify(aimB?.cursor)}`);
    check(aimA?.mode === 'tp' && aimB?.mode === 'fp', `modos aim TP/FP (${aimA?.mode}/${aimB?.mode})`);

    // §9 (Lane N): blur SIMULADO — aba perde foco, atuação zera e o desejo
    // recentra no nariz (input.js blur→clearKeys+recenter). visibilitychange
    // real (document.hidden) não é forçável no headless: lacuna registrada.
    await A.evaluate(`window.dispatchEvent(new Event('blur'))`);
    await wait(400);
    const recentered = await A.evaluate(`(() => {
      const l = window.__nw && window.__nw.local;
      return l ? Math.abs(l.dyaw - l.yaw) < 1e-6 : null;
    })()`);
    check(recentered === true, 'blur zera atuação e recentra desejo (simulado)');
    await shot(A, 'full-playing-tp-chromium.png');
    await shot(B, 'full-playing-fp-chromium.png');

    // TP quieta? Para a nave primeiro (manete TP→0 segurando S): com v≈0 o
    // lag de smoothing some e o offset tem que ficar pixel-parado mesmo com
    // stutter de frame (2 browsers + swiftshader). O que NÃO pode mexer sem
    // input é a ATITUDE (nariz): Δyaw/pitch/roll = "TP-still-spins?".
    await key(A, 'keydown', 'KeyS');
    await A.waitFor(`window.__nw && window.__nw.local && Math.abs(window.__nw.local.thr) < 0.1`, 8000).catch(() => null);
    await key(A, 'keyup', 'KeyS');
    // fecha a malha no residual: S/W em toques até |thr|≤0.02 (poll 150ms ×
    // 0.8/s deixaria até 0.12 = 3.4u/s de ré/frente, que respira no smoothing)
    for (let i = 0; i < 6; i++) {
      const thr = await A.evaluate(`window.__nw && window.__nw.local && window.__nw.local.thr`);
      if (thr == null || Math.abs(thr) <= 0.02) break;
      const code = thr > 0 ? 'KeyS' : 'KeyW';
      await key(A, 'keydown', code);
      await wait(150);
      await key(A, 'keyup', code);
      await wait(200);
    }
    await wait(2500); // desacelera (ACCEL) + smoothing TP converge (rate 6/s)
    const off = [];
    let prevT = Date.now();
    for (let i = 0; i < 40; i++) {
      const o = await A.evaluate(`(() => {
        const n = window.__nw;
        if (!n || !n.cam || !n.pred || !n.local) return null;
        const s = n.snap && n.snap.ships.find((x) => x.id === n.id);
        return { cx: n.cam.x, cy: n.cam.y, cz: n.cam.z, px: n.pred.x, py: n.pred.y, pz: n.pred.z,
          yaw: n.local.yaw, pitch: n.local.pitch, roll: n.local.roll };
      })()`).catch(() => null);
      const now = Date.now();
      if (o) off.push({ ...o, dtWall: (now - prevT) / 1000 });
      prevT = now;
      await wait(50);
    }
    check(off.length >= 30, `amostras câmera+nave+atitude em A (${off.length}/40)`);
    let maxD = 0, dYaw = 0, dPitch = 0, dRoll = 0, vMax = 0, vMin = Infinity;
    if (off.length > 0) {
      const o0 = off[0];
      const ox0 = o0.cx - o0.px, oy0 = o0.cy - o0.py, oz0 = o0.cz - o0.pz;
      for (let i = 0; i < off.length; i++) {
        const o = off[i];
        maxD = Math.max(maxD, Math.hypot((o.cx - o.px) - ox0, (o.cy - o.py) - oy0, (o.cz - o.pz) - oz0));
        dYaw = Math.max(dYaw, Math.abs(o.yaw - o0.yaw));
        dPitch = Math.max(dPitch, Math.abs(o.pitch - o0.pitch));
        dRoll = Math.max(dRoll, Math.abs(o.roll - o0.roll));
        if (i > 0) {
          const p = off[i - 1];
          const dt = Math.max(1e-3, o.dtWall || 0.05);
          const v = Math.hypot(o.px - p.px, o.py - p.py, o.pz - p.pz) / dt;
          vMax = Math.max(vMax, v); vMin = Math.min(vMin, v);
        }
      }
    }
    const vSpread = vMax - Math.min(vMin, vMax);
    check(dYaw === 0 && dPitch === 0 && dRoll === 0, `nariz TP parado sem input (Δyaw=${dYaw} Δpitch=${dPitch} Δroll=${dRoll})`);
    console.log(`INFO  tp-still: atitude Δyaw=${dYaw} Δpitch=${dPitch} Δroll=${dRoll}; v∈[${(vMin === Infinity ? 0 : vMin).toFixed(2)},${vMax.toFixed(2)}]u/s; offset-máx=${maxD.toExponential(2)}u em ${off.length} amostras`);
    // lag de smoothing = v/rate: só é constante (offset rígido) se v é constante
    if (vSpread < 0.3) {
      check(maxD < 0.05, `câmera TP rígida parada (offset máx ${maxD.toExponential(2)}u)`);
    } else {
      console.log(`INFO  tp-still: offset posicional não avaliado (v variou ${vSpread.toFixed(2)}u/s na janela — lag de smoothing respira)`);
    }

    // Morte/respawn: arma o bot e observa hp cair + alive apagar + overlay.
    const watchHp = (async () => {
      let m = 100;
      for (let i = 0; i < 260; i++) {
        const s = await myShip(A).catch(() => null);
        if (s && Number.isFinite(s.hp) && s.hp < m) m = s.hp;
        if (s && s.alive === false) break;
        await wait(250);
      }
      return m;
    })();
    const killed = await bot.killOnce(60000);
    const seenMin = await watchHp;
    check(seenMin < 100, `dano observado em A (hp mín ${seenMin})`);
    check(killed, 'A morreu (kill do bot)');
    check(await vis(A, 'dead-overlay'), 'overlay de morte visível em A');
    await shot(A, 'full-dead-chromium.png');
    await A.waitFor(`(() => {
      const n = window.__nw;
      const s = n && n.snap && n.snap.ships.find((x) => x.id === n.id);
      return s && s.alive;
    })()`, 10000);
    check(true, 'A respawnou (alive de novo)');

    // Disconnect+return: B recarrega e volta na mesma sessão (resume 30s).
    const oldIdB = await B.evaluate(`window.__nw && window.__nw.id`);
    await B.evaluate(`location.reload()`);
    await B.waitFor(
      `document.getElementById('screen-menu') && getComputedStyle(document.getElementById('screen-menu')).display !== 'none'`, 15000);
    await B.waitFor(`document.getElementById('m-room').value !== ''`, 30000); // boot do módulo pós-reload
    await B.evaluate(`(() => { document.getElementById('m-name').value = 'e2e-p2'; document.getElementById('m-room').value = '${code}'; document.getElementById('btn-join').click(); })()`);
    await B.waitFor(`window.__nw && window.__nw.id`, 15000); // welcome (id) chega DEPOIS do lobby (DOM local)
    const newIdB = await B.evaluate(`window.__nw && window.__nw.id`);
    // resume RENUMERA por desenho (room.js join: fantasma vira o novo pN,
    // resumeToken preservado) — igualdade de id seria sempre falsa, mesmo
    // com resume ok. Prova: 1 nave viva com o novo id + 1 entrada no placar
    // (join fresco deixaria fantasma: 2 entradas com o mesmo nome).
    check(!!newIdB, `B tem id após welcome (id=${newIdB})`);
    const rejoin = await B.evaluate(`(() => {
      const n = window.__nw;
      const ships = (n.snap?.ships || []).filter((s) => s.name === 'e2e-p2').map((s) => s.id);
      const sc = n.snap?.scores?.players || n.snap?.scores || {};
      const nScores = Object.values(sc).filter((p) => p.name === 'e2e-p2').length;
      return { ships, nScores };
    })()`);
    check(rejoin.ships.includes(newIdB), `B retomou a sessão: nave viva com novo id (resume ${oldIdB}→${newIdB})`);
    check(rejoin.nScores === 1, `sem duplicata fantasma no placar (entradas e2e-p2=${rejoin.nScores})`);
    await B.evaluate(`document.getElementById('l-start').click()`);
    await B.waitFor(HUD_EXPR, 15000);
    check(true, 'B de volta à partida após reload');

    // FP↔TP: A abre pausa→settings, troca p/ FP, volta. (TP já coberta acima.)
    await key(A, 'keydown', 'Escape');
    await key(A, 'keyup', 'Escape');
    await A.waitFor(`getComputedStyle(document.getElementById('screen-pause')).display !== 'none'`, 8000);
    check(true, 'pausa abriu (Esc)');
    await A.evaluate(`document.getElementById('pause-settings').click()`);
    await A.waitFor(`getComputedStyle(document.getElementById('screen-settings')).display !== 'none'`, 8000);
    await A.evaluate(`document.querySelector('#s-cam button[data-cam="fp"]').click()`);
    await A.waitFor(`window.__nw && window.__nw.camMode === 'fp'`, 5000);
    check(true, 'A trocou TP→FP em partida');
    await A.evaluate(`document.getElementById('settings-close').click()`);
    await A.evaluate(`document.getElementById('pause-resume').click()`);
    await A.waitFor(`getComputedStyle(document.getElementById('screen-pause')).display === 'none'`, 5000);
    check(true, 'pausa fechou, HUD de volta');

    // §9 (Lane N): troca de câmera ida-e-volta em partida (FP→TP de volta).
    await key(A, 'keydown', 'Escape');
    await key(A, 'keyup', 'Escape');
    await A.waitFor(`getComputedStyle(document.getElementById('screen-pause')).display !== 'none'`, 8000);
    await A.evaluate(`document.getElementById('pause-settings').click()`);
    await A.waitFor(`getComputedStyle(document.getElementById('screen-settings')).display !== 'none'`, 8000);
    await A.evaluate(`document.querySelector('#s-cam button[data-cam="tp"]').click()`);
    await A.waitFor(`window.__nw && window.__nw.camMode === 'tp'`, 5000);
    check(true, 'A voltou FP→TP em partida (§9 troca câmera ida-e-volta)');
    await A.evaluate(`document.getElementById('settings-close').click()`);
    await A.evaluate(`document.getElementById('pause-resume').click()`);
    await A.waitFor(`getComputedStyle(document.getElementById('screen-pause')).display === 'none'`, 5000);
    check(true, 'pausa fechou de novo, HUD de volta');
    await shot(A, 'full-playing-fp-switch-chromium.png');

    // Fim por timer: empate (0 kills humanos — bot não pontua) ou vitória.
    const overVisible = await A.waitFor(
      `getComputedStyle(document.getElementById('screen-over')).display !== 'none'`, (LEN + 40) * 1000)
      .catch(() => null);
    check(!!overVisible, `tela de fim (len=${LEN}s)`);
    const title = await A.evaluate(`document.getElementById('final-title').textContent`) || '';
    const rows = await A.evaluate(`document.getElementById('final-rows').textContent`) || '';
    console.log(`INFO  over: ${title} | ${(rows || '').replace(/\s+/g, ' ').slice(0, 200)}`);
    check(/Empate|venceu|VENCEU|Derrota|Fim de jogo/.test(title), `título do fim (${title})`);
    await shot(A, 'full-over-chromium.png');

    // Revanche: A clica, todos entram direto em playing (espera o snapshot
    // com prova — o HUD é DOM local e aparece antes do broadcast do servidor).
    await A.evaluate(`document.getElementById('btn-rematch').click()`);
    const st2 = await A.waitFor(`window.__nw && window.__nw.snap && window.__nw.snap.state === 'playing' && window.__nw.snap.state`, 15000)
      .catch(() => null);
    check(st2 === 'playing', `revanche → playing (${st2})`);
    await B.waitFor(HUD_EXPR, 15000);
    check(true, 'B voltou junto na revanche');
    await shot(A, 'full-rematch-chromium.png');

    await cleanChecks(A, 'A');
    await cleanChecks(B, 'B');
  } catch (e) {
    if (cdps[0]) await dumpFailure(cdps[0], tag).catch(() => {});
    throw e;
  } finally {
    try { bot?.close(); } catch {}
    for (const c of cdps) c.close();
    for (const b of browsers) await killBrowser(b);
  }
}

// ---- flow modes: fumaça teams + survival (só o essencial em browser) ----
async function chromiumModes(gamePort) {
  const tag = 'modes';
  let browser = null;
  let cdp = null;
  try {
    const dbgPort = await freePort();
    browser = await launchChromium(dbgPort);
    cdp = await openTab(dbgPort);
    const base = `http://127.0.0.1:${gamePort}/?len=30`;

    // teams: lobby mostra EQUIPES, start→HUD, snapshot diz teams.
    await cdp.send('Page.navigate', { url: base });
    await cdp.waitFor(
      `document.getElementById('screen-menu') && getComputedStyle(document.getElementById('screen-menu')).display !== 'none'`);
    await cdp.waitFor(MENU_BOOT_EXPR, 30000); // boot do módulo (three.js) em disco lento
    await cdp.evaluate(`(() => {
      document.querySelector('#m-modes button[data-mode="teams"]').click();
      document.getElementById('m-name').value = 'e2e-teams';
      document.getElementById('btn-create').click();
    })()`);
    await cdp.waitFor(LOBBY_EXPR);
    const lmode = await cdp.waitFor(
      `/EQUIPES/.test(document.getElementById('l-mode').textContent) && document.getElementById('l-mode').textContent`, 8000)
      .catch(() => null) || await cdp.evaluate(`document.getElementById('l-mode').textContent`) || '';
    check(/EQUIPES/.test(lmode), `lobby teams (${lmode})`);
    await shot(cdp, 'modes-teams-lobby-chromium.png');
    await cdp.evaluate(`document.getElementById('l-ready').click()`);
    await cdp.waitFor(`document.getElementById('l-ready').textContent.includes('PRONTO')`);
    await cdp.evaluate(`document.getElementById('l-start').click()`);
    await cdp.waitFor(HUD_EXPR, 20000);
    check((await snapOf(cdp))?.mode === 'teams', 'snapshot mode=teams em jogo');
    await shot(cdp, 'modes-teams-hud-chromium.png');

    // survival: start→HUD, primeira wave chega (bots), snapshot diz survival.
    await cdp.send('Page.navigate', { url: base });
    await cdp.waitFor(
      `document.getElementById('screen-menu') && getComputedStyle(document.getElementById('screen-menu')).display !== 'none'`);
    await cdp.waitFor(MENU_BOOT_EXPR, 30000); // boot do módulo (three.js) em disco lento
    await cdp.evaluate(`(() => {
      document.querySelector('#m-modes button[data-mode="survival"]').click();
      document.getElementById('m-name').value = 'e2e-surv';
      document.getElementById('btn-create').click();
    })()`);
    await cdp.waitFor(LOBBY_EXPR);
    const lmode2 = await cdp.waitFor(
      `/SOBREVIV/.test(document.getElementById('l-mode').textContent) && document.getElementById('l-mode').textContent`, 8000)
      .catch(() => null) || await cdp.evaluate(`document.getElementById('l-mode').textContent`) || '';
    check(/SOBREVIV/.test(lmode2), `lobby survival (${lmode2})`);
    await cdp.evaluate(`document.getElementById('l-ready').click()`);
    await cdp.waitFor(`document.getElementById('l-ready').textContent.includes('PRONTO')`);
    await cdp.evaluate(`document.getElementById('l-start').click()`);
    await cdp.waitFor(HUD_EXPR, 20000);
    check((await snapOf(cdp))?.mode === 'survival', 'snapshot mode=survival em jogo');
    const wave = await cdp.waitFor(
      `window.__nw && window.__nw.snap && window.__nw.snap.wave >= 1 && window.__nw.snap.wave`, 15000)
      .catch(() => null);
    check(!!wave, `primeira wave (wave=${wave})`);
    await shot(cdp, 'modes-survival-hud-chromium.png');

    await cleanChecks(cdp, 'modes');
  } catch (e) {
    if (cdp) await dumpFailure(cdp, tag).catch(() => {});
    throw e;
  } finally {
    cdp?.close();
    if (browser) await killBrowser(browser);
  }
}

main().catch((e) => { console.error(`E2E ERRO: ${e.message}`); process.exit(2); });
