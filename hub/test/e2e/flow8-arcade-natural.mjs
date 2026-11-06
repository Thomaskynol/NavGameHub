// F8: Arcade NATURAL iniciado pelo Hub — 2 Chromiums isolados (perfis
// temporários, nunca o pessoal), sala no Hub → prontos → Hub lança (play via
// iframe) → 1 volta pilotada DE VERDADE com o driver Stanley (lógica de
// tools/smoke_e2e.mjs, mas lendo `globalThis.__av` DENTRO do iframe via
// frame.evaluate e teclando no page focado) → pódio natural SEM hook →
// results → retorno dos 2 à mesma sala do Hub.
// PROOF: play-real + natural — corrida completa pelas regras normais; o `__av`
// já é exposto pelo próprio jogo (main.js), nenhum hook, nenhuma mudança no
// Hub/jogo foi necessária.
import {
  E2E, launchBrowser, strictCollector, shotPath, proofLine,
} from './e2e-helpers.mjs';
import { mkdirSync } from 'node:fs';
// Guarda de conclusão compartilhada com o jogo (fonte única — o negativo
// dnf_check.mjs exercita este MESMO código, não uma cópia).
import { isLapConcluded, queryLapDone, queryResultRow } from '../../../Games/ArcadeAI_race_game/tools/verify_lap.mjs';

proofLine('f8', 'play-real', 'corrida natural completa via Hub (1 volta, 2 pilotos reais, sem hook)');

mkdirSync(E2E.shotDir, { recursive: true });

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f8] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

// Driver Stanley adaptado do smoke (frames em vez de pages; teclado no page).
function makeDriver(frame, page, latT = 0, tag = 'drv') {
  const read = () => frame.evaluate(() => {
    const av = globalThis.__av;
    const e = av?.engine?.(); const s = av?.sampler?.(); const info = av?.info?.();
    if (!e || !s || !info) return null;
    const st = e.getLocalState();
    if (!st || typeof st.x !== 'number') return null;
    const p = s.project(st.x, st.z);
    const v = Math.max(0, st.v);
    const n = s.pointAt(p.s);
    let kMax = 0.0001;
    for (let i = 1; i <= 6; i += 1) {
      const k = Math.abs(s.curvature(Math.min(s.length - 0.01, p.s + i * 6)));
      if (k > kMax) kMax = k;
    }
    return { v: st.v, s: p.s, lat: p.lat, inside: p.inside, hd: st.hd, heading: n.heading, k: kMax, steer: st.steer };
  }).catch(() => null);
  const pressed = new Set();
  const setKeys = async (want) => {
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const has = pressed.has(k); const on = want.has(k);
      if (on && !has) { await page.keyboard.down(k); pressed.add(k); }
      if (!on && has) { await page.keyboard.up(k); pressed.delete(k); }
    }
  };
  let lastR = 0;
  let lastProgressAt = Date.now();
  let lastS = null;
  let lastTrace = 0;
  let prevErr = 0;
  let iSteer = 0;
  let lastResync = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function step() {
    const st = await read();
    if (!st) { await sleep(80); return null; }
    if (lastS == null || Math.abs(st.s - lastS) > 3) { lastS = st.s; lastProgressAt = Date.now(); }
    let err = st.heading - st.hd;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    err -= Math.atan2(1.6 * (st.lat - latT), Math.max(5, st.v));
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    if (Date.now() - lastTrace > 5000) {
      lastTrace = Date.now();
      console.log(`   [${tag}] s=${st.s.toFixed(0)} lat=${st.lat.toFixed(1)} v=${st.v.toFixed(1)} err=${err.toFixed(2)}`);
    }
    iSteer = Math.max(-3, Math.min(3, iSteer + err * 0.05));
    const dErr = err - prevErr; prevErr = err;
    const steerCmd = 1.6 * err + 0.5 * iSteer + 0.05 * dErr;
    const safe = Math.min(st.inside ? 33 : 15, Math.sqrt(9 / st.k));
    const keys = new Set();
    if (st.v > safe + 0.5) keys.add('ArrowDown');
    else keys.add('ArrowUp');
    if (steerCmd > 0.02) keys.add('ArrowLeft');
    else if (steerCmd < -0.02) keys.add('ArrowRight');
    if (Date.now() - lastProgressAt > 3000 && Date.now() - lastR > 3500) {
      lastR = Date.now(); lastProgressAt = Date.now(); lastS = null;
      await page.keyboard.press('KeyR');
    }
    if (Date.now() - lastResync > 1000) {
      lastResync = Date.now();
      for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await page.keyboard.up(k).catch(() => {});
      pressed.clear();
    }
    await setKeys(keys);
    await sleep(45);
    return st;
  }
  async function stop() { await setKeys(new Set()); }
  return { step, stop };
}

// Leitura de conclusão via fonte única (../.../tools/verify_lap.mjs).
const lapDone = queryLapDone;
const resultRow = queryResultRow;

async function newHubPage(browser, nick, strict) {
  const ctx = await browser.newContext();
  // Qualidade 'low' p/ SwiftShader headless (mesmo que o smoke): sem AA,
  // pixelRatio menor — fps estável, senão a simulação anda a ~1 m/s.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('av.settings', JSON.stringify({ quality: 'low' })); } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[f8] pageerror(${nick}):`, String(e && e.message || e).slice(0, 160)));
  strict.attach(page);
  await page.goto(`${E2E.hubBase()}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#nick-input').fill(nick);
  await page.locator('#identity-submit').click();
  await page.locator('#game-grid .game-card').first().waitFor({ timeout: 15000 });
  return { ctx, page };
}

const browser = await launchBrowser();
const strict = strictCollector('f8');
let pageA = null;
const GLOBAL_MS = 600_000;
const watchdog = setTimeout(() => {
  console.error('[f8] TIMEOUT global — abortando');
  process.exitCode = 1;
  process.exit(1);
}, GLOBAL_MS);

try {
  const suffix = Date.now().toString(36).slice(-4);
  const nickA = `NtA${suffix}`;
  const nickB = `NtB${suffix}`;
  const { ctx: ctxA, page: A } = await newHubPage(browser, nickA, strict);
  pageA = A;
  const { ctx: ctxB, page: B } = await newHubPage(browser, nickB, strict);

  // Hub: A cria sala arcade (cap 2), B entra pelo código.
  await A.locator('.game-card', { hasText: 'Asfalto' }).locator('.create-game-btn').click();
  await A.locator('#create-game').selectOption('arcade');
  await A.locator('#create-capacity').fill('2');
  await A.locator('#create-submit').click();
  await A.locator('#room-code').waitFor({ timeout: 10000 });
  const hubCode = (await A.locator('#room-code').textContent()).trim();
  console.log(`[f8] sala Hub: ${hubCode}`);
  await B.locator('#join-code').fill(hubCode);
  await B.locator('#join-submit').click();
  await B.locator('#room-code').waitFor({ timeout: 10000 });
  check('2 navegadores na mesma sala do Hub', true, hubCode);

  // Hub: ambos prontos → iframes do jogo.
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
  check('Hub lançou: iframes com o mesmo game code', !!codeA && codeA === codeB, `${codeA} vs ${codeB}`);
  check('play do criador veio com create=1', new URL(srcA).searchParams.get('create') === '1');
  check('play do convidado veio com create=0', new URL(srcB).searchParams.get('create') === '0');

  const gfA = A.frameLocator('#match-frame-wrap iframe');
  const gfB = B.frameLocator('#match-frame-wrap iframe');

  // Frame real (evaluate roda no contexto do iframe, mesma API do smoke).
  // Locator.contentFrame() devolve FrameLocator (sem evaluate): localiza o
  // Frame pela URL (contém o room do jogo).
  async function gameFrame(page, code, timeout = 15000) {
    const t0 = Date.now();
    for (;;) {
      const fr = page.frames().find((f) => {
        try { return new URL(f.url()).searchParams.get('room') === code; } catch { return false; }
      });
      if (fr) return fr;
      if (Date.now() - t0 > timeout) throw new Error('game frame não encontrado');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const frA = await gameFrame(A, codeA);
  const frB = await gameFrame(B, codeB);

  // Jogo (UI real dentro dos iframes): 1 volta, ambos prontos, host inicia.
  await gfA.getByText('Iniciar corrida', { exact: true }).waitFor({ timeout: 30000 });
  await gfA.locator('[data-fkey="laps-minus"]').click();
  await gfA.locator('[data-fkey="laps-minus"]').click();
  console.log('[f8] voltas reduzidas para 1 (host, UI real do jogo)');
  await gfA.getByText('Pronto', { exact: true }).click();
  await gfB.getByText('Pronto', { exact: true }).click();
  console.log('[f8] 2 prontos no jogo');
  await gfA.getByText('Iniciar corrida', { exact: true }).click();
  console.log('[f8] largada pelo host (UI real, sem hook)');

  await gfA.locator('.hud:not([hidden])').waitFor({ timeout: 30000 });
  check('HUD da corrida visível em A (largada real)', true);
  await gfB.locator('.hud:not([hidden])').waitFor({ timeout: 15000 });
  check('HUD da corrida visível em B (largada real)', true);
  await A.screenshot({ path: shotPath('f8-race-a.png') });

  // Foca os iframes p/ o teclado chegar ao jogo.
  await gfA.locator('body').click().catch(() => {});
  await gfB.locator('body').click().catch(() => {});

  // Pilota as 2 persianas até o pódio natural (sem hook de finish).
  const dA = makeDriver(frA, A, 0, 'A');
  const dB = makeDriver(frB, B, -4, 'B');
  const t0 = Date.now();
  let doneA = false; let doneB = false; let resultsOn = false;
  let maxVA = 0; let lastCheck = 0;
  while (Date.now() - t0 < 420_000) {
    if (!doneA) { const stA = await dA.step(); if (stA) maxVA = Math.max(maxVA, stA.v); }
    if (!doneB) await dB.step();
    if (Date.now() - lastCheck > 2000) {
      lastCheck = Date.now();
      doneA = await lapDone(frA);
      doneB = await lapDone(frB);
      // Tela de resultados ≠ conclusão de volta: deadline gera results com dnf
      // (race.js onFirstFinish/finish). Só registra a tela e sai, sem forçar done.
      resultsOn = await gfA.getByText('Voltar ao lobby', { exact: true }).isVisible().catch(() => false);
      if (resultsOn) break;
    }
    if (doneA && doneB) break;
  }
  await dA.stop(); await dB.stop();
  for (const P of [A, B]) for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    await P.keyboard.up(k).catch(() => {});
  }
  check('A atingiu velocidade de corrida', maxVA > 8, `${maxVA.toFixed(1)} m/s`);
  await A.screenshot({ path: shotPath('f8-race-end.png') });

  // Pódio natural (sem hook): tela de resultados dentro do iframe (tela ≠ conclusão).
  await gfA.getByText('Voltar ao lobby', { exact: true }).waitFor({ timeout: 120_000 });
  const names = await gfA.locator('.r-name').allInnerTexts().catch(() => []);
  check('results natural contém A', names.some((n) => n.includes(nickA.slice(0, 5))), JSON.stringify(names).slice(0, 120));
  check('results natural contém B', names.some((n) => n.includes(nickB.slice(0, 5))), JSON.stringify(names).slice(0, 120));
  const rowA = await resultRow(frA, nickA.slice(0, 5));
  check('A concluiu volta sem DNF (lap + results dnf=false)', isLapConcluded(doneA, rowA), `lap=${doneA} tempo=${rowA?.total ?? '?'}`);
  await A.screenshot({ path: shotPath('f8-results.png') });

  // Hub detecta o fim natural → graça (15s) → os 2 voltam à MESMA sala.
  await A.locator('#room-code').waitFor({ timeout: 60000 });
  await B.locator('#room-code').waitFor({ timeout: 60000 });
  const backA = (await A.locator('#room-code').textContent()).trim();
  const backB = (await B.locator('#room-code').textContent()).trim();
  check('retorno natural à mesma sala do Hub', backA === hubCode && backB === hubCode, `${backA},${backB}`);
  await A.screenshot({ path: shotPath('f8-back.png') });

  const v = strict.verdict();
  check('sem pageerror/falhas de recursos necessários', v.ok, v.detail);

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  console.error(`[f8] FAIL: ${e.message?.slice(0, 500)}`);
  try { if (pageA) await pageA.screenshot({ path: shotPath('f8-fail.png') }); } catch { /* ok */ }
  pass = false;
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
console.log(pass ? '[f8] PASS' : '[f8] FAIL');
if (!pass) process.exitCode = 1;
