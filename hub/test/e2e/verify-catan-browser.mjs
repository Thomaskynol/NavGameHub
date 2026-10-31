// Re-verificação BUG-1: Catan em PRODUÇÃO via Hub — 3 Chromiums isolados.
// Navegadores fazem o fluxo Hub (nick/criar/entrar/pronto) e os iframes criam/
// entram sozinhos na sala do Catan (antes: LAUNCH_FAILED). Lado do jogo
// (ready/start) via socket.io — mesmo protocolo do cliente — + hook win;
// os 3 navegadores devem voltar à mesma sala do Hub.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const SHOT = '/tmp/opencode/hub-e2e';
const SECRET = readFileSync('/home/thomaskyn/Documents/dev/Game_Hub/.run/hub_secret', 'utf8').trim();

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});

async function newHubPage(nick) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[cb] pageerror(${nick}):`, String(e).slice(0, 160)));
  await page.goto('http://127.0.0.1:8090/', { waitUntil: 'domcontentloaded' });
  await page.locator('#nick-input').fill(nick);
  await page.locator('#identity-submit').click();
  await page.locator('#game-grid .game-card').first().waitFor({ timeout: 15000 });
  return { ctx, page };
}

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[cb] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

let ridSeq = 0;
try {
  const suffix = Date.now().toString(36).slice(-4);
  const nicks = [`CtA${suffix}`, `CtB${suffix}`, `CtC${suffix}`];
  const clients = [];
  for (const n of nicks) clients.push(await newHubPage(n));
  const [A, B, C] = clients.map((c) => c.page);

  await A.locator('.game-card', { hasText: 'Catan' }).locator('.create-game-btn').click();
  await A.locator('#create-game').selectOption('catan');
  await A.locator('#create-capacity').fill('4');
  await A.locator('#create-submit').click();
  await A.locator('#room-code').waitFor({ timeout: 10000 });
  const hubCode = (await A.locator('#room-code').textContent()).trim();
  console.log(`[cb] sala Hub: ${hubCode}`);

  for (const page of [B, C]) {
    await page.locator('#join-code').fill(hubCode);
    await page.locator('#join-submit').click();
    await page.locator('#room-code').waitFor({ timeout: 10000 });
  }
  check('3 navegadores na mesma sala', true, hubCode);
  await A.screenshot({ path: `${SHOT}/catan-room.png` });

  await A.locator('#ready-btn').click();
  await B.locator('#ready-btn').click();
  await C.locator('#ready-btn').click();

  // Com BUG-1, o Hub nunca saía de launching (LAUNCH_FAILED em 12s).
  const frames = [A, B, C].map((p) => p.locator('#match-frame-wrap iframe'));
  for (const f of frames) await f.waitFor({ timeout: 30000 });
  const srcs = [];
  for (const f of frames) srcs.push(await f.getAttribute('src'));
  const codes = srcs.map((s) => new URL(s).searchParams.get('room'));
  console.log(`[cb] game codes: ${codes.join(',')}`);
  check('3 iframes com o MESMO game code', codes.every((c) => c && c === codes[0]), codes[0]);
  const gameCode = codes[0];
  await A.waitForTimeout(4000);
  await A.screenshot({ path: `${SHOT}/catan-match-a.png` });

  // Lado do jogo, via UI real dentro dos iframes: pronto nos 3 + iniciar (anfitrião).
  const gameFrames = [A, B, C].map((p) => p.frameLocator('#match-frame-wrap iframe'));
  for (const gf of gameFrames) {
    await gf.getByRole('button', { name: 'Estou pronto' }).click({ timeout: 20000 });
  }
  console.log('[cb] 3 prontos no jogo');
  await gameFrames[0].getByRole('button', { name: 'Iniciar partida' }).click({ timeout: 20000 });
  console.log('[cb] partida iniciada no jogo');

  const win = await fetch(`http://127.0.0.1:8093/__hub/test/win?room=${gameCode}`, {
    method: 'POST', headers: { 'x-hub-secret': SECRET },
  });
  check('hook win catan', win.status === 200, `${win.status}`);
  for (const page of [A, B, C]) await page.locator('#room-code').waitFor({ timeout: 45000 });
  const backs = [];
  for (const page of [A, B, C]) backs.push((await page.locator('#room-code').textContent()).trim());
  check('3 navegadores retornam à mesma sala', backs.every((b) => b === hubCode), backs.join(','));
  await A.screenshot({ path: `${SHOT}/catan-back.png` });

  for (const c of clients) await c.ctx.close();
} catch (e) {
  console.error(`[cb] FAIL: ${e.message?.slice(0, 400)}`);
  pass = false;
} finally {
  await browser.close();
}
console.log(pass ? '[cb] PASS' : '[cb] FAIL');
if (!pass) process.exitCode = 1;
