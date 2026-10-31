// Re-verificação BUG-2: Arcade honra ?hub=1 — 2 Chromiums isolados, SEM cliques no jogo.
// Hub: nick → criar → entrar por código → prontos → iframes entram sozinhos na
// MESMA sala do Arcade → hook finish → retorno ao lobby.
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
  page.on('pageerror', (e) => console.log(`[ab] pageerror(${nick}):`, String(e).slice(0, 160)));
  await page.goto('http://127.0.0.1:8090/', { waitUntil: 'domcontentloaded' });
  await page.locator('#nick-input').fill(nick);
  await page.locator('#identity-submit').click();
  await page.locator('#game-grid .game-card').first().waitFor({ timeout: 15000 });
  return { ctx, page };
}

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[ab] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

try {
  const nickA = `ArB${Date.now().toString(36).slice(-4)}a`;
  const nickB = `ArB${Date.now().toString(36).slice(-4)}b`;
  const { ctx: ctxA, page: A } = await newHubPage(nickA);
  const { ctx: ctxB, page: B } = await newHubPage(nickB);

  await A.locator('.game-card', { hasText: 'Asfalto' }).locator('.create-game-btn').click();
  await A.locator('#create-game').selectOption('arcade');
  await A.locator('#create-capacity').fill('2');
  await A.locator('#create-submit').click();
  await A.locator('#room-code').waitFor({ timeout: 10000 });
  const hubCode = (await A.locator('#room-code').textContent()).trim();
  console.log(`[ab] sala Hub: ${hubCode}`);

  await B.locator('#join-code').fill(hubCode);
  await B.locator('#join-submit').click();
  await B.locator('#room-code').waitFor({ timeout: 10000 });

  // Só cliques de PRONTO no Hub — NENHUM clique dentro do jogo.
  await A.locator('#ready-btn').click();
  await B.locator('#ready-btn').click();

  // Sem BUG-2, o Hub ficaria em launching até LAUNCH_FAILED (12s). Com a
  // correção, os iframes criam/entram sozinhos e o Hub chega a playing.
  const frameA = A.locator('#match-frame-wrap iframe');
  const frameB = B.locator('#match-frame-wrap iframe');
  await frameA.waitFor({ timeout: 30000 });
  await frameB.waitFor({ timeout: 30000 });
  const srcA = await frameA.getAttribute('src');
  const srcB = await frameB.getAttribute('src');
  const codeA = new URL(srcA).searchParams.get('room');
  const codeB = new URL(srcB).searchParams.get('room');
  check('iframes com o mesmo game code (sem clique no jogo)', !!codeA && codeA === codeB, `${codeA} vs ${codeB}`);
  // Fase playing = o jogo criou a sala sozinho (antes: impossível).
  await A.locator('#match-frame-wrap iframe').waitFor({ timeout: 5000 });
  await A.waitForTimeout(4000);
  await A.screenshot({ path: `${SHOT}/arcade2-match-a.png` });
  await B.screenshot({ path: `${SHOT}/arcade2-match-b.png` });

  const fin = await fetch(`http://127.0.0.1:8091/__hub/test/finish?room=${codeA}`, {
    method: 'POST', headers: { 'x-hub-secret': SECRET },
  });
  check('hook finish arcade', fin.status === 200, `${fin.status}`);
  await A.locator('#room-code').waitFor({ timeout: 45000 });
  await B.locator('#room-code').waitFor({ timeout: 45000 });
  const backA = (await A.locator('#room-code').textContent()).trim();
  const backB = (await B.locator('#room-code').textContent()).trim();
  check('retorno à mesma sala', backA === hubCode && backB === hubCode, `${backA},${backB}`);
  await A.screenshot({ path: `${SHOT}/arcade2-back.png` });

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  console.error(`[ab] FAIL: ${e.message?.slice(0, 400)}`);
  pass = false;
} finally {
  await browser.close();
}
console.log(pass ? '[ab] PASS' : '[ab] FAIL');
if (!pass) process.exitCode = 1;
