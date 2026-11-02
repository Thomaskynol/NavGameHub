// UI smoke: 2 contextos Chromium isolados, Hub real no navegador.
// Roteiro: nick -> criar (VAVA) -> entrar por código -> prontos ->
// iframes com mesmo game code -> end via hook -> retorno ao lobby.
// PROOF: hooks — o fim da partida é forçado via hook (não é partida jogada);
// o fluxo de Hub no navegador (nick/criar/entrar/pronto/iframe) é real.
import {
  E2E, hubSecret, launchBrowser, strictCollector, shotPath, proofLine,
} from './e2e-helpers.mjs';
import { mkdirSync } from 'node:fs';

proofLine('ui', 'hooks', 'Hub no navegador real; fim forçado por hook');

const SECRET = hubSecret();
mkdirSync(E2E.shotDir, { recursive: true });

const browser = await launchBrowser();

async function newHubPage(nick, strict) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[ui] pageerror(${nick}):`, String(e).slice(0, 160)));
  strict.attach(page);
  await page.goto(`${E2E.hubBase()}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#nick-input').fill(nick);
  await page.locator('#identity-submit').click();
  await page.locator('#game-grid .game-card').first().waitFor({ timeout: 15000 });
  return { ctx, page };
}

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[ui] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

const strict = strictCollector('ui');
try {
  const nickA = `UiA${Date.now().toString(36).slice(-4)}`;
  const nickB = `UiB${Date.now().toString(36).slice(-4)}`;
  const { ctx: ctxA, page: A } = await newHubPage(nickA, strict);
  const { ctx: ctxB, page: B } = await newHubPage(nickB, strict);
  await A.screenshot({ path: shotPath('ui-01-home.png') });

  // A cria sala de VAVA.
  await A.locator('.game-card', { hasText: 'VAVA' }).locator('.create-game-btn').click();
  await A.locator('#create-game').selectOption('vava');
  await A.locator('#create-capacity').fill('2');
  const cap = await A.locator('#create-capacity').inputValue();
  console.log(`[ui] capacidade default no diálogo: ${cap}`);
  await A.screenshot({ path: shotPath('ui-02-create-dialog.png') });
  await A.locator('#create-submit').click();
  await A.locator('#room-code').waitFor({ timeout: 10000 });
  const hubCode = (await A.locator('#room-code').textContent()).trim();
  console.log(`[ui] sala Hub: ${hubCode}`);
  await A.screenshot({ path: shotPath('ui-03-room-host.png') });

  // B entra pelo código.
  await B.locator('#join-code').fill(hubCode);
  await B.locator('#join-submit').click();
  await B.locator('#room-code').waitFor({ timeout: 10000 });
  const hubCodeB = (await B.locator('#room-code').textContent()).trim();
  check('B entrou na mesma sala pelo código', hubCodeB === hubCode, `${hubCodeB}`);
  await B.screenshot({ path: shotPath('ui-04-room-guest.png') });

  // Ambos prontos -> partida (botão some ao sair do lobby; espera o iframe).
  await A.locator('#ready-btn').click();
  await B.locator('#ready-btn').click();
  const frameA = A.locator('#match-frame-wrap iframe');
  const frameB = B.locator('#match-frame-wrap iframe');
  async function dump(tag, page) {
    try {
      const st = await page.evaluate(() => ({
        launching: !document.getElementById('launch-overlay')?.hidden,
        matchHidden: document.getElementById('view-match')?.hidden,
        iframes: document.querySelectorAll('#match-frame-wrap iframe').length,
        phaseTag: document.getElementById('room-phase-tag')?.textContent,
        pressed: document.getElementById('ready-btn')?.getAttribute('aria-pressed'),
        readyText: document.getElementById('ready-count')?.textContent,
        alert: (document.getElementById('room-alert')?.textContent || '').slice(0, 120),
        toasts: [...document.querySelectorAll('.toast-text')].map((t) => t.textContent?.slice(0, 80)),
      }));
      console.log(`[ui] ${tag}: ${JSON.stringify(st)}`);
    } catch (e) { console.log(`[ui] ${tag}: dump falhou`); }
  }
  try {
    await frameA.waitFor({ timeout: 30000 });
  } catch (e) {
    await dump('A', A);
    await dump('B', B);
    throw e;
  }
  await frameB.waitFor({ timeout: 30000 });
  const srcA = await frameA.getAttribute('src');
  const srcB = await frameB.getAttribute('src');
  const codeA = new URL(srcA).searchParams.get('room');
  const codeB = new URL(srcB).searchParams.get('room');
  console.log(`[ui] iframe A: ${srcA?.slice(0, 120)}`);
  console.log(`[ui] iframe B: ${srcB?.slice(0, 120)}`);
  check('iframes apontam p/ o mesmo game code', !!codeA && codeA === codeB, `${codeA} vs ${codeB}`);
  await A.waitForTimeout(4000);
  await A.screenshot({ path: shotPath('ui-05-match-a.png') });
  await B.screenshot({ path: shotPath('ui-05-match-b.png') });

  // Encerra via hook; ambos voltam ao lobby (graça VAVA 6s).
  const fin = await fetch(`${E2E.gameBase(E2E.vavaPort)}/__hub/test/end?room=${codeA}`, {
    method: 'POST', headers: { 'x-hub-secret': SECRET },
  });
  console.log(`[ui] hook end: ${fin.status}`);
  await A.locator('#room-code').waitFor({ timeout: 40000 });
  await B.locator('#room-code').waitFor({ timeout: 40000 });
  const backA = (await A.locator('#room-code').textContent()).trim();
  const backB = (await B.locator('#room-code').textContent()).trim();
  check('retorno à mesma sala', backA === hubCode && backB === hubCode, `${backA},${backB}`);
  await A.screenshot({ path: shotPath('ui-06-back-lobby.png') });

  const v = strict.verdict();
  check('sem pageerror/falhas de recursos necessários', v.ok, v.detail);

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  console.error(`[ui] FAIL: ${e.message?.slice(0, 500)}`);
  pass = false;
} finally {
  await browser.close();
}
console.log(pass ? '[ui] PASS' : '[ui] FAIL');
if (!pass) process.exitCode = 1;
