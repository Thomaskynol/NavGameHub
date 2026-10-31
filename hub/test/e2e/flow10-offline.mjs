// F10: fluxo Hub COMPLETO sob bloqueio de hosts externos (offline real em
// execução, não grep). Intercepta TODOS os requests das páginas/iframes:
// host fora de {localhost,127.0.0.1,::1} é ABORTADO e reprova o teste; asset
// necessário local que falhar (HTTP !ok em host permitido, pageerror)
// também reprova. Roteiro: Hub no navegador (nick/criar/entrar/pronto) +
// Arcade no iframe (pronto/iniciar/HUD real) + fim por hook + retorno.
// O fim usa hook (transição Hub, rótulo hooks); o que este fluxo PROVA é o
// isolamento offline (rótulo offline). Nada de rede/firewall da máquina é
// alterado — só o roteamento interno do Chromium de teste.
// PROOF: offline — N requests locais ok, 0 externos (ver relatório abaixo).
import {
  E2E, hubSecret, launchBrowser, strictCollector, shotPath, proofLine,
} from './e2e-helpers.mjs';
import { mkdirSync } from 'node:fs';

proofLine('f10', 'offline', 'Hub+Arcade completos com hosts externos abortados; fim por hook');

const SECRET = hubSecret();
mkdirSync(E2E.shotDir, { recursive: true });

const ALLOWED = new Set(['localhost', '127.0.0.1', '::1']);
const seenLocal = new Map(); // "host:port" -> n requests
const external = []; // hrefs externos que o app tentou buscar (devem ser 0)

async function newObservedPage(browser, nick, strict) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    try { localStorage.setItem('av.settings', JSON.stringify({ quality: 'low' })); } catch {}
  });
  await ctx.route('**/*', (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.continue().catch(() => {}); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.continue().catch(() => {});
    if (!ALLOWED.has(u.hostname)) {
      external.push(req.url());
      return route.abort('blockedbyclient').catch(() => {});
    }
    seenLocal.set(`${u.hostname}:${u.port || '80'}`, (seenLocal.get(`${u.hostname}:${u.port || '80'}`) || 0) + 1);
    return route.continue().catch(() => {});
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[f10] pageerror(${nick}):`, String(e && e.message || e).slice(0, 160)));
  strict.attach(page);
  await page.goto(`${E2E.hubBase()}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#nick-input').fill(nick);
  await page.locator('#identity-submit').click();
  await page.locator('#game-grid .game-card').first().waitFor({ timeout: 15000 });
  return { ctx, page };
}

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f10] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

const browser = await launchBrowser();
const strict = strictCollector('f10');
try {
  const suffix = Date.now().toString(36).slice(-4);
  const { ctx: ctxA, page: A } = await newObservedPage(browser, `OfA${suffix}`, strict);
  const { ctx: ctxB, page: B } = await newObservedPage(browser, `OfB${suffix}`, strict);

  await A.locator('.game-card', { hasText: 'Asfalto' }).locator('.create-game-btn').click();
  await A.locator('#create-game').selectOption('arcade');
  await A.locator('#create-capacity').fill('2');
  await A.locator('#create-submit').click();
  await A.locator('#room-code').waitFor({ timeout: 10000 });
  const hubCode = (await A.locator('#room-code').textContent()).trim();
  console.log(`[f10] sala Hub: ${hubCode}`);

  await B.locator('#join-code').fill(hubCode);
  await B.locator('#join-submit').click();
  await B.locator('#room-code').waitFor({ timeout: 10000 });

  await A.locator('#ready-btn').click();
  await B.locator('#ready-btn').click();
  const frameA = A.locator('#match-frame-wrap iframe');
  const frameB = B.locator('#match-frame-wrap iframe');
  await frameA.waitFor({ timeout: 30000 });
  await frameB.waitFor({ timeout: 30000 });
  const srcA = await frameA.getAttribute('src');
  const srcB = await frameB.getAttribute('src');
  const codeA = new URL(srcA).searchParams.get('room');
  const codeB = new URL(srcB).searchParams.get('room');
  check('iframes com o mesmo game code', !!codeA && codeA === codeB, `${codeA}`);
  check('fim usa hook (rotulado, não natural)', true, 'POST /__hub/test/finish');

  // Jogo real no iframe (prova que os assets do Arcade carregaram offline).
  const gfA = A.frameLocator('#match-frame-wrap iframe');
  const gfB = B.frameLocator('#match-frame-wrap iframe');
  await gfA.getByText('Iniciar corrida', { exact: true }).waitFor({ timeout: 30000 });
  await gfA.getByText('Pronto', { exact: true }).click();
  await gfB.getByText('Pronto', { exact: true }).click();
  await gfA.getByText('Iniciar corrida', { exact: true }).click();
  await gfA.locator('.hud:not([hidden])').waitFor({ timeout: 30000 });
  check('HUD do Arcade no ar (assets locais ok)', true);
  await gfB.locator('.hud:not([hidden])').waitFor({ timeout: 15000 });
  check('HUD do Arcade no ar em B', true);
  await A.screenshot({ path: shotPath('f10-match.png') });

  const fin = await fetch(`${E2E.gameBase(E2E.arcadePort)}/__hub/test/finish?room=${codeA}`, {
    method: 'POST', headers: { 'x-hub-secret': SECRET },
  });
  check('hook finish (fim rotulado hooks)', fin.status === 200, `${fin.status}`);
  await A.locator('#room-code').waitFor({ timeout: 45000 });
  await B.locator('#room-code').waitFor({ timeout: 45000 });
  const backA = (await A.locator('#room-code').textContent()).trim();
  const backB = (await B.locator('#room-code').textContent()).trim();
  check('retorno à mesma sala', backA === hubCode && backB === hubCode, `${backA},${backB}`);

  // Vereditos offline: nada externo requisitado; nada necessário falhou.
  const localOnly = strict.errors.filter((e) => {
    const m = e.match(/https?:\/\/([^/:]+)/);
    return !m || ALLOWED.has(m[1]);
  });
  check('nenhum request externo (abort seria listado)', external.length === 0,
    external.length ? external.slice(0, 5).join(' | ').slice(0, 300) : `${seenLocal.size} hosts locais, ${[...seenLocal.values()].reduce((a, b) => a + b, 0)} requests`);
  check('sem pageerror/falhas em assets necessários', localOnly.length === 0, localOnly.slice(0, 5).join(' | '));
  console.log(`[f10] cobertura offline: ${JSON.stringify([...seenLocal.entries()])} (Hub+WS+Arcade via 127.0.0.1; 0 hosts externos)`);
  console.log('[f10] NÃO COBERTO: uso com cabo desplugado/rede cortada no SO (sem acesso a 2º PC/rede real); isto aqui bloqueia no nível do request do navegador de teste.');

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  console.error(`[f10] FAIL: ${e.message?.slice(0, 500)}`);
  pass = false;
} finally {
  await browser.close();
}
console.log(pass ? '[f10] PASS' : '[f10] FAIL');
if (!pass) process.exitCode = 1;
