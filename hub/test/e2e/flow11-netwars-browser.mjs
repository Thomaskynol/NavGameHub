// flow11 — Net Wars NATURAL via Hub, no navegador de verdade (standalone,
// fora do run-all: boot próprio efêmero em portas fixas de teste).
//
// Cobre o caminho real do cliente: Hub (WS) cria sala -> play ?hub=1 ->
// navegador abre a URL (2 contexts isolados), auto-join sem digitar,
// host clica INICIAR no lobby do jogo, partida termina por timer (regra
// normal, MATCH_LEN_S=4), tela de resultado, botão volta-ao-Hub.
// proof=play-real (fim pelas regras normais, sem hook) — partial: sem
// pilotagem real (sem inputs de voo) e sem a UI do Hub (protocolo WS).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  E2E, REPO_ROOT, HubClient, gameCodeOf, htokOf, delay, waitOnline,
  strictCollector, launchBrowser, proofLine,
} from './e2e-helpers.mjs';

const TAG = 'flow11-netwars-browser';
const HUB_PORT = 18331;
const GAME_PORT = 18332;
const SECRET = `e2e-${Date.now().toString(36)}`;

function spawnGame() {
  const game = spawn(process.execPath, ['server/main.js'], {
    cwd: join(REPO_ROOT, 'Games', 'net_wars'),
    env: {
      ...process.env, PORT: String(GAME_PORT), HOST: '127.0.0.1',
      HUB_SECRET: SECRET, MATCH_LEN_S: '4',
    },
    stdio: 'ignore',
  });
  return game;
}

async function waitHttp(url, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* subindo */ }
    if (Date.now() - t0 > timeout) throw new Error(`timeout esperando ${url}`);
    await delay(150);
  }
}

const game = spawnGame();
const manifest = {
  hubPort: HUB_PORT,
  games: [{
    id: 'netwars', name: 'Net Wars', minPlayers: 2, maxPlayers: 12,
    midMatchJoin: false, codeLength: 6, port: GAME_PORT, healthPath: '/health',
  }],
};
const manifestPath = join(tmpdir(), `hub-manifest-${HUB_PORT}.json`);
writeFileSync(manifestPath, JSON.stringify(manifest));
const hub = spawn(process.execPath, ['hub/server.js'], {
  cwd: REPO_ROOT,
  env: { ...process.env, HUB_GAMES_FILE: manifestPath, HUB_SECRET: SECRET },
  stdio: 'ignore',
});

let browser;
const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok' : 'FALHA'}: ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

try {
  await waitHttp(`http://127.0.0.1:${GAME_PORT}/health`);
  await waitHttp(`http://127.0.0.1:${HUB_PORT}/health`);
  proofLine(TAG, 'play-real', 'navegador real: auto-join ?hub=1, start pelo botão, fim por timer, volta ao Hub');

  const a = new HubClient('A');
  const b = new HubClient('B');
  await a.connect(`ws://127.0.0.1:${HUB_PORT}/ws`);
  await b.connect(`ws://127.0.0.1:${HUB_PORT}/ws`);
  await a.hello('PilotoA');
  await b.hello('PilotoB');
  await waitOnline(a, 'netwars');
  const room = await a.createRoom('netwars', 2);
  await b.joinRoom(room.code);
  await a.setReady(true);
  await b.setReady(true);

  const playA = await a.waitPlay('1');
  const gameCode = gameCodeOf(playA);
  const htok = htokOf(playA);
  check(/^[A-Z0-9]{6}$/.test(gameCode), 'código do jogo no padrão do Hub', gameCode);

  browser = await launchBrowser();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const strictA = strictCollector(TAG + ':A');
  const strictB = strictCollector(TAG + ':B');
  strictA.attach(pageA);
  strictB.attach(pageB);

  // Criador abre primeiro (create=1 cria a sala); o wait do convidado
  // começa ANTES (o create=0 pode chegar enquanto a página carrega).
  const playBP = b.waitPlay('0');
  await pageA.goto(playA.url, { waitUntil: 'domcontentloaded' });
  await pageA.waitForFunction(
    () => { const el = document.getElementById('screen-lobby'); return el && getComputedStyle(el).display !== 'none'; },
    null, { timeout: 15000 },
  );
  const lobbyCode = await pageA.textContent('#l-code');
  check(lobbyCode && lobbyCode.trim().toUpperCase() === gameCode, 'auto-join: lobby com o código do Hub', lobbyCode);
  const hubNote = await pageA.$eval('#hub-note', (el) => !!(el && getComputedStyle(el).display !== 'none')).catch(() => false);
  check(hubNote, 'cliente Hub abre sem pedir nome de novo (nota visível)');

  const playB = await playBP;
  await pageB.goto(playB.url, { waitUntil: 'domcontentloaded' });
  // create=0 entra direto na partida (sem lobby): basta o snapshot chegar.
  await pageB.waitForFunction(() => !!(window.__nw && window.__nw.snap), null, { timeout: 15000 });
  check(true, 'convidado (create=0) entra direto, sem tela inicial');

  // Host inicia pelo botão real da UI do jogo.
  await pageA.click('#l-start');
  await pageA.waitForFunction(() => window.__nw && window.__nw.snap && window.__nw.snap.state === 'playing', null, { timeout: 10000 });
  check(true, 'partida inicia pelo botão INICIAR (estado playing)');
  const playingB = await pageB.waitForFunction(
    () => window.__nw && window.__nw.snap && window.__nw.snap.state === 'playing', null, { timeout: 10000 },
  ).then(() => true).catch(() => false);
  check(playingB, 'convidado entra na partida em curso');

  // Fim por timer (regra normal) -> tela de resultado nos dois.
  const overVisible = (page) => page.waitForFunction(
    () => { const el = document.getElementById('screen-over'); return el && getComputedStyle(el).display !== 'none'; },
    null, { timeout: 20000 },
  );
  await overVisible(pageA);
  await overVisible(pageB);
  const rows = await pageA.textContent('#final-rows');
  check(!!(rows && rows.trim()), 'tela de resultado com placar', (rows || '').trim().slice(0, 80));
  await pageA.screenshot({ path: join(E2E.shotDir, 'flow11-netwars-over.png') }).catch(() => {});

  // Sala do Hub recebe o retorno (protocolo) e o botão volta ao Hub existe.
  const backA = await a.waitRoom((r) => r.phase === 'lobby' && r.code === room.code, 20000)
    .then(() => true).catch(() => false);
  check(backA, 'Hub volta à mesma sala (fase lobby)');
  const hubBackVisible = await pageA.$eval('#hub-back', (el) => !!(el && el.offsetParent !== null)).catch(() => false);
  check(hubBackVisible, 'botão voltar-ao-Hub visível no cliente');
  await pageA.click('#hub-back');
  await pageA.waitForURL((url) => url.pathname === '/' && (url.searchParams.get('room') === room.code), { timeout: 10000 })
    .then(() => check(true, 'voltar-ao-Hub navega à sala do Hub'))
    .catch(() => check(false, 'voltar-ao-Hub navega à sala do Hub', String(pageA.url()).slice(0, 120)));

  const vA = strictA.verdict();
  const vB = strictB.verdict();
  check(vA.ok, 'navegador A sem pageerror/recurso falho', vA.detail);
  check(vB.ok, 'navegador B sem pageerror/recurso falho', vB.detail);

  a.close();
  b.close();
} catch (e) {
  console.log(`FALHA: exceção no fluxo (${String(e && e.message || e).slice(0, 300)})`);
  failures.push('excecao');
} finally {
  try { await browser?.close(); } catch { /* ok */ }
  try { hub.kill('SIGKILL'); } catch { /* ok */ }
  try { game.kill('SIGKILL'); } catch { /* ok */ }
}

console.log(failures.length === 0 ? `\n[${TAG}] PASSOU` : `\n[${TAG}] FALHOU: ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
