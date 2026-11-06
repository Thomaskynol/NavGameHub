// NEGATIVO DNF (standalone, sem Hub): A entra mas NÃO pilota; B pilota 1 volta
// de verdade. Caminho real do servidor: B cruza → onFirstFinish → deadline
// (finishGraceMs) → finish('deadline') com A dnf=true. A verificação positiva
// "A concluiu" (lap + results dnf=false + tempo) deve FALHAR mesmo com a tela
// de resultados visível e B concluído — prova que tela ≠ conclusão.
// Uso: node tools/dnf_check.mjs (servidor próprio efêmero, Chromium headless).
import { chromium } from 'playwright-core';
import { startServer } from '../server/index.js';
import { isLapConcluded, queryLapDone, queryResultRow } from './verify_lap.mjs';

// Matriz observável (função pura, sem navegador — MESMA guarda do positivo):
// (a) volta válida sem DNF → aprova; (b) results + DNF → rejeita;
// (c) sem tempo/linha → rejeita; (d) snapshot válido + DNF → rejeita.
// (d) é o caso que distingue a guarda `!totalDnf`: sem ela, (d) aprovaria.
const MATRIX = [
  ['a', true, { name: 'Ana', total: '1:23.45', totalDnf: false }, true],
  ['b', false, { name: 'Ana', total: 'Não concluiu', totalDnf: true }, false],
  ['c1', true, undefined, false],
  ['c2', true, { name: 'Ana', total: '', totalDnf: false }, false],
  ['c3', true, { name: 'Ana', total: 'Não concluiu', totalDnf: false }, false],
  ['d', true, { name: 'Ana', total: '1:23.45', totalDnf: true }, false],
];
function runMatrix() {
  let fails = 0;
  for (const [tag, lap, row, want] of MATRIX) {
    const got = isLapConcluded(lap, row);
    const pass = got === want;
    console.log(`${pass ? 'OK  ' : 'FALHOU'} matriz(${tag}): lap=${lap} row=${JSON.stringify(row)} → ${got} (esperado ${want})`);
    if (!pass) fails += 1;
  }
  return fails;
}

const EXE = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const GLOBAL_MS = 480_000;
const watchdog = setTimeout(() => { console.error('TIMEOUT global'); process.exit(2); }, GLOBAL_MS);

let failures = 0;
function ok(cond, name, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALHOU'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures += 1;
}
function watch(page, label) {
  page.on('pageerror', (e) => console.log(`[${label}] pageerror: ${String(e).slice(0, 160)}`));
}
// Driver Stanley: cópia fiel do smoke_e2e.mjs (comprovado: completa a volta).
// Só drives B; A fica parado (nenhuma tecla) para forçar o DNF pelo deadline.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function makeDriver(page, tag = 'drv') {
  const read = () => page.evaluate(() => {
    const av = globalThis.__av;
    const e = av?.engine?.(); const s = av?.sampler?.(); const info = av?.info?.();
    if (!e || !s || !info) return null;
    const st = e.getLocalState();
    if (!st || typeof st.x !== 'number') return null;
    const p = s.project(st.x, st.z);
    const n = s.pointAt(p.s);
    let kMax = 0.0001;
    for (let i = 1; i <= 6; i++) {
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
  let iSteer = 0, prevErr = 0;
  let lastResync = 0;
  async function step() {
    const st = await read();
    if (!st) { await sleep(80); return null; }
    if (lastS == null || Math.abs(st.s - lastS) > 3) { lastS = st.s; lastProgressAt = Date.now(); }
    let err = st.heading - st.hd;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    err -= Math.atan2(1.6 * st.lat, Math.max(5, st.v));
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
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
const lapDone = queryLapDone;
const resultRow = queryResultRow;

const run = async () => {
  const matrixFails = runMatrix();
  failures += matrixFails;
  if (process.argv.includes('--matrix-only')) {
    console.log(matrixFails === 0 ? '\nDNF-MATRIZ OK' : `\nDNF-MATRIZ FALHOU: ${matrixFails}`);
    process.exit(matrixFails === 0 ? 0 : 1);
  }
  const srv = await startServer({ port: 0, log: () => {} });
  const url = `http://127.0.0.1:${srv.port}/`;
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
  });
  try {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    for (const ctx of [ctxA, ctxB]) {
      await ctx.addInitScript(() => {
        try { localStorage.setItem('av.settings', JSON.stringify({ quality: 'low' })); } catch {}
      });
    }
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();
    watch(A, 'A'); watch(B, 'B');

    await A.goto(url, { waitUntil: 'domcontentloaded' });
    await A.getByText('Criar sala', { exact: true }).waitFor({ timeout: 15_000 });
    await A.locator('input[aria-label^="Apelido"]').fill('Ana');
    await A.getByText('Criar sala', { exact: true }).click();
    await A.locator('.room-code').waitFor({ timeout: 10_000 });
    const code = (await A.locator('.room-code').first().innerText()).trim().toUpperCase();
    ok(/^[A-Z0-9]{6}$/.test(code), `sala criada, código=${code}`);

    await B.goto(url, { waitUntil: 'domcontentloaded' });
    await B.getByText('Entrar em sala', { exact: true }).waitFor({ timeout: 15_000 });
    await B.locator('input[aria-label^="Apelido"]').fill('Bia');
    await B.locator('.swatches button').nth(3).click();
    await B.getByText('Entrar em sala', { exact: true }).click();
    await B.locator('.input-code').fill(code);
    await B.getByText('Entrar', { exact: true }).click();
    await B.locator('.room-code').waitFor({ timeout: 10_000 });

    await A.locator('[data-fkey="laps-minus"]').click();
    await A.locator('[data-fkey="laps-minus"]').click();
    await A.getByText('Pronto', { exact: true }).click();
    await B.getByText('Pronto', { exact: true }).click();
    await A.getByText('Iniciar corrida', { exact: true }).click();
    await B.locator('.hud:not([hidden])').waitFor({ timeout: 30_000 });
    ok(true, 'corrida iniciada (HUD visível em B; A parado no grid)');

    // Só B pilota; A fica parado (nenhuma tecla).
    const dB = makeDriver(B, 'B');
    const t0 = Date.now();
    let doneB = false, resultsOn = false, lastCheck = 0;
    while (Date.now() - t0 < 420_000) {
      await dB.step();
      if (Date.now() - lastCheck > 2000) {
        lastCheck = Date.now();
        doneB = await lapDone(B);
        resultsOn = await B.getByText('Voltar ao lobby', { exact: true }).isVisible().catch(() => false);
        if (resultsOn) break;
      }
      if (doneB) {
        // B terminou; deadline real (finishGraceMs) gera results com A dnf.
        // Aguarda a tela sem pilotar mais ninguém.
        await dB.stop();
        await B.getByText('Voltar ao lobby', { exact: true }).waitFor({ timeout: 120_000 });
        resultsOn = true;
        break;
      }
    }
    await dB.stop();
    ok(doneB, 'B concluiu a volta pilotando');
    ok(resultsOn, 'tela de resultados apareceu (via deadline real)');
    const rowB = await resultRow(B, 'Bia');
    const rowA = await resultRow(B, 'Ana');
    ok(!!rowB && !rowB.totalDnf, `B sem DNF (tempo=${rowB?.total ?? '?'})`);
    ok(!!rowA && rowA.totalDnf, `A marcado DNF (celula="${rowA?.total ?? '?'}")`);
    // A verificação positiva aplicada a A deve FALHAR (guarda compartilhada):
    const concluiuA = isLapConcluded(await lapDone(A), rowA);
    ok(concluiuA === false, '"A concluiu a volta" falha p/ DNF (tela não prova conclusão)');
  } finally {
    await browser.close().catch(() => {});
    await srv.close?.().catch(() => {});
    clearTimeout(watchdog);
  }
  console.log(failures === 0 ? '\nDNF-NEGATIVO OK' : `\nDNF-NEGATIVO FALHOU: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
};
run().catch((e) => { console.error('FATAL:', e); process.exit(1); });
