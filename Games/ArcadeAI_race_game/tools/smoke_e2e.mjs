#!/usr/bin/env node
// Smoke E2E do Asfalto Vivo: servidor real + Chrome headless + 2 jogadores.
// Fases: boot → lobby (2 jogadores) → corrida com direção autônoma até o pódio
// → revanche → time trial com pausa. Falha != 0 se qualquer asserção quebrar.
import { chromium } from 'playwright-core';
import { startServer } from '../server/index.js';
import { isLapConcluded, queryLapDone, queryResultRow } from './verify_lap.mjs';

const EXE = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SHOTS = process.env.SMOKE_SHOTS || '/tmp/av-smoke';
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GLOBAL_MS = 660_000; // folga p/ variância de fps do SwiftShader headless (sim ~25-60% do wall clock)
const watchdog = setTimeout(() => { console.error(`TIMEOUT global (${GLOBAL_MS / 1000}s)`); process.exit(2); }, GLOBAL_MS);

const errors = []; // {page, text}
function watch(page, label) {
  page.on('pageerror', (e) => errors.push({ page: label, text: `pageerror: ${e.message}` }));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ page: label, text: `console: ${m.text()}` });
  });
}

// Convenção do input (input.js): ArrowLeft → steer +1 → AUMENTA hd (esquerda, lat↑).
// err = heading − hd; err>0 ⇒ precisa aumentar hd ⇒ ArrowLeft. err<0 ⇒ ArrowRight.
// latT = linha-alvo (m): cada bot tem sua própria faixa p/ não intertrincar no
// raio de colisão (2×1.6=3.2 m) — dois bots na mesma linha travavam no centerline.
function makeDriver(page, latT = 0, tag = 'drv') {
  const read = () => page.evaluate(() => {
    const av = globalThis.__av;
    const e = av?.engine?.(); const s = av?.sampler?.(); const info = av?.info?.();
    if (!e || !s || !info) return null;
    const st = e.getLocalState();
    if (!st || typeof st.x !== 'number') return null;
    const p = s.project(st.x, st.z);
    const v = Math.max(0, st.v);
    const n = s.pointAt(p.s);
    // curvatura mais severa nos próximos ~30 m
    let kMax = 0.0001;
    for (let i = 1; i <= 6; i++) {
      const k = Math.abs(s.curvature(Math.min(s.length - 0.01, p.s + i * 6)));
      if (k > kMax) kMax = k;
    }
    return { v: st.v, s: p.s, lat: p.lat, inside: p.inside, hd: st.hd, heading: n.heading, k: kMax, steer: st.steer, nit: st.nit, off: st.off };
  });
  const pressed = new Set();
  const setKeys = async (want) => {
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const has = pressed.has(k); const on = want.has(k);
      if (on && !has) { await page.keyboard.down(k); pressed.add(k); }
      if (!on && has) { await page.keyboard.up(k); pressed.delete(k); }
    }
  };
  let lastR = 0;
  let lastTrace = 0;
  let st = null;
  let lastS = null;
  let lastProgressAt = Date.now();
  let iSteer = 0, prevErr = 0;
  let stallAt = null, lastStallLog = 0;
  let lastResync = 0; // primeiro step força resync (sequência up+down comprovada)
  const ring = []; // amostras de 45 ms p/ diagnóstico de parada
  async function step() {
    st = await read();
    if (!st) { await sleep(80); return null; }
    if (lastS == null || Math.abs(st.s - lastS) > 3) { lastS = st.s; lastProgressAt = Date.now(); }
    // Stanley: heading + correção lateral (sinal validado por tools/probe_steer_sign.mjs —
    // lat<0 precisa steer=+1/esquerda ⇒ termo com sinal MINUS; '+' empurrava p/ a parede).
    let err = st.heading - st.hd;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    err -= Math.atan2(1.6 * (st.lat - latT), Math.max(5, st.v));
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    if (Date.now() - lastTrace > 2000) {
      lastTrace = Date.now();
      const cars = await page.evaluate(() => {
        const av = globalThis.__av; const sn = av?.lastSn?.(); const you = av?.info?.()?.you;
        if (!sn?.cars) return null;
        const me = sn.cars.find((c) => c.id === you);
        const other = sn.cars.find((c) => c.id !== you);
        if (!me || !other) return null;
        return { me: { cp: me.cp, lap: me.lap, v: +(me.v ?? 0).toFixed(1) }, d: +Math.hypot(me.x - other.x, me.z - other.z).toFixed(1), ov: +(other.v ?? 0).toFixed(1) };
      });
      console.log(`   [${tag}] s=${st.s.toFixed(0)} lat=${st.lat.toFixed(1)} v=${st.v.toFixed(1)} err=${err.toFixed(2)} k=${st.k.toFixed(3)} off=${st.inside ? 0 : 1} cp=${cars?.me?.cp} lap=${cars?.me?.lap} dOut=${cars?.d} vOut=${cars?.ov}`);
    }
    // PID de esterço
    iSteer = Math.max(-3, Math.min(3, iSteer + err * 0.05));
    const dErr = err - prevErr; prevErr = err;
    let steerCmd = 1.6 * err + 0.5 * iSteer + 0.05 * dErr;
    // velocidade segura: raio = v²·k ≤ ~9 m/s² → v ≤ sqrt(9/k); fora da pista é mais lento
    const safe = Math.min(st.inside ? 33 : 15, Math.sqrt(9 / st.k));
    const keys = new Set();
    if (st.v > safe + 0.5) keys.add('ArrowDown');
    else keys.add('ArrowUp');
    if (steerCmd > 0.02) keys.add('ArrowLeft');
    else if (steerCmd < -0.02) keys.add('ArrowRight');
    // diagnóstico: parado >1.2 s longe do spawn → log denso (estado completo do carro)
    if (st.v < 1.5 && st.s > 25) { if (stallAt == null) stallAt = Date.now(); }
    else stallAt = null;
    ring.push({ s: +st.s.toFixed(1), v: +st.v.toFixed(2), hd: +st.hd.toFixed(2), st: +(st.steer ?? 0).toFixed(2), k: [...keys].map((x) => x[5]).join('') });
    if (ring.length > 18) ring.shift();
    if (stallAt && Date.now() - stallAt > 1200 && Date.now() - lastStallLog > 500) {
      lastStallLog = Date.now();
      const env = await page.evaluate(() => {
        const av = globalThis.__av;
        const sn = av?.lastSn?.(); const you = av?.info?.()?.you;
        const me = sn?.cars?.find((c) => c.id === you);
        const ae = document.activeElement;
        return {
          n: (globalThis.__snaps || []).length,
          last: (globalThis.__snaps || []).slice(-1)[0] || null,
          hid: document.hidden, foc: document.hasFocus(),
          srv: me ? { v: +(me.v ?? 0).toFixed(2), x: +(me.x ?? 0).toFixed(1), z: +(me.z ?? 0).toFixed(1), cp: me.cp } : null,
          ae: ae ? `${ae.tagName}${ae.id ? '#' + ae.id : ''}` : '-',
        };
      }).catch(() => ({ n: 0, last: null, hid: null, foc: null, srv: null, ae: '?' }));
      console.log(`   [STALL ${tag}] s=${st.s.toFixed(1)} lat=${st.lat.toFixed(1)} hd=${st.hd.toFixed(2)} hdAlvo=${st.heading.toFixed(2)} err=${err.toFixed(2)} steerEng=${(st.steer ?? 0).toFixed(2)} off=${st.off} inside=${st.inside ? 1 : 0} keys=${[...keys].join('+')} v=${st.v.toFixed(1)} snaps=${env.n} ult=${env.last ? `v${env.last.v}@${env.last.x},${env.last.z}` : '-'} hid=${env.hid} foc=${env.foc} ae=${env.ae} srv=${env.srv ? `v${env.srv.v}@${env.srv.x},${env.srv.z} cp${env.srv.cp}` : '-'}`);
      console.log(`   [RING] ${ring.map((r) => `s${r.s}/v${r.v}/hd${r.hd}/${r.k}`).join(' ')}`);
    }
    // encravado (sem progresso de s por 3 s) → recover (cooldown físico de 3 s)
    if (Date.now() - lastProgressAt > 3000 && Date.now() - lastR > 3500) {
      lastR = Date.now(); lastProgressAt = Date.now(); lastS = null;
      await page.keyboard.press('KeyR');
    }
    // resync de teclado a cada 1 s: input.js zera tudo em blur/visibilitychange (§9,
    // correto p/ humano que re-pressiona) e nosso bookkeeping ficaria obsoleto — a
    // seta "segurada" nunca seria reenviada (throttle morto). Solta e reenvia tudo.
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

async function driveLap(page, { maxMs = 4_000, latT = 0 } = {}) {
  const d = makeDriver(page, latT, 'tt');
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < maxMs) { st = (await d.step()) || st; }
  await d.stop();
  return st;
}

// Guarda de conclusão: fonte única em ./verify_lap.mjs (lapDone/resultRow/
// isLapConcluded compartilhados com dnf_check.mjs e flow8-arcade-natural.mjs).
const lapDone = queryLapDone;
const resultRow = queryResultRow;

const run = async () => {
  // 1. servidor
  const srv = await startServer({ port: 0, log: () => {} });
  const url = `http://127.0.0.1:${srv.port}/`;
  console.log(`servidor em ${url} (porta ${srv.port})`);

  // 2. browser
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
  });

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  // qualidade 'low' p/ SwiftShader headless: sem AA, pixelRatio 0.75 — fps estável
  for (const ctx of [ctxA, ctxB]) {
    await ctx.addInitScript(() => {
      try { localStorage.setItem('av.settings', JSON.stringify({ quality: 'low' })); } catch {}
    });
  }
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  watch(A, 'A'); watch(B, 'B');

  // WebGL2
  const webgl = await A.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return gl ? gl.getParameter(gl.VERSION) : null;
  });
  ok(!!webgl, `WebGL2 disponível (${webgl || 'NÃO'})`);
  if (!webgl) throw new Error('sem WebGL2 — abortando');

  const shot = async (page, name) => { try { await page.screenshot({ path: `${SHOTS}/${name}.png` }); } catch {} };

  // 3. lobby com 2 jogadores
  await A.goto(url, { waitUntil: 'domcontentloaded' });
  await A.getByText('Criar sala', { exact: true }).waitFor({ timeout: 15_000 });
  await A.locator('input[aria-label^="Apelido"]').fill('Ana');
  await A.getByText('Criar sala', { exact: true }).click();
  await A.locator('.room-code').waitFor({ timeout: 10_000 });
  const code = (await A.locator('.room-code').first().innerText()).trim().toUpperCase();
  ok(/^[A-Z0-9]{6}$/.test(code), `sala criada, código=${code}`);
  await shot(A, '01-lobby-a');

  await B.goto(url, { waitUntil: 'domcontentloaded' });
  await B.getByText('Entrar em sala', { exact: true }).waitFor({ timeout: 15_000 });
  await B.locator('input[aria-label^="Apelido"]').fill('Bia');
  // cores são exclusivas por sala: B escolhe outra cor antes de entrar
  await B.locator('.swatches button').nth(3).click();
  await B.getByText('Entrar em sala', { exact: true }).click();
  await B.locator('.input-code').fill(code);
  await B.getByText('Entrar', { exact: true }).click();
  try {
    await B.locator('.room-code').waitFor({ timeout: 10_000 });
  } catch {
    const why = await B.evaluate(() => [...document.querySelectorAll('.toasts *, .error-msg')].map((n) => n.textContent).join(' | '));
    throw new Error(`B não entrou na sala — feedback: ${why}`);
  }
  const codeB = (await B.locator('.room-code').first().innerText()).trim().toUpperCase();
  ok(codeB === code, `B entrou na mesma sala (${codeB})`);

  // 4. 1 volta, ambos prontos, host inicia
  await A.locator('[data-fkey="laps-minus"]').click();
  await A.locator('[data-fkey="laps-minus"]').click();
  await A.getByText('Pronto', { exact: true }).click();
  await B.getByText('Pronto', { exact: true }).click();
  const startBtn = A.getByText('Iniciar corrida', { exact: true });
  await startBtn.waitFor({ timeout: 8_000 });
  await startBtn.click();

  // 5. corrida
  await A.locator('.hud:not([hidden])').waitFor({ timeout: 30_000 });
  ok(true, 'HUD da corrida visível em A');
  await B.locator('.hud:not([hidden])').waitFor({ timeout: 15_000 });
  ok(true, 'HUD da corrida visível em B');

  // instrumentação: registra toda correção recebida do servidor (snap_self → applyCorrection)
  for (const P of [A, B]) {
    await P.evaluate(() => {
      const e = globalThis.__av?.engine?.();
      if (!e || e.__snapped) return;
      e.__snapped = true;
      window.__snaps = [];
      const orig = e.applyCorrection.bind(e);
      e.applyCorrection = (m) => {
        window.__snaps.push({ v: +(m?.v ?? 0).toFixed(1), x: +(m?.x ?? 0).toFixed(1), z: +(m?.z ?? 0).toFixed(1), t: Date.now() });
        if (window.__snaps.length > 40) window.__snaps.shift();
        return orig(m);
      };
    }).catch(() => {});
  }

  // countdown (best-effort: pode já ter passado)
  const cd = await A.locator('.hud-countdown').innerText().catch(() => '');
  console.log(`   countdown visto: "${cd.trim()}"`);

  // diagnóstico de desempenho: fps rAF de cada aba (SwiftShader)
  const fpsOf = (P) => P.evaluate(() => new Promise((r) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else r(Math.round(n / 1.5)); };
    requestAnimationFrame(f);
  })).catch(() => -1);
  console.log(`   fps rAF: A=${await fpsOf(A)} B=${await fpsOf(B)}`);

  // largada: pilota as duas persianas em loop interleaved (teclas persistem entre
  // ciclos — soltar no fim de cada fatia deixava throttle morto ~1 s e a cada
  // recomeço o re-pressione era engolido; resync 1 s cobre blur/visibilitychange)
  await A.keyboard.press('body').catch(() => {});
  const dA = makeDriver(A, 0, 'A');
  const dB = makeDriver(B, -4, 'B');
  const t0 = Date.now();
  let doneA = false, doneB = false, resultsOn = false;
  let maxVA = 0;
  let lastCheck = 0;
  while (Date.now() - t0 < 420_000) {
    if (!doneA) { const stA = await dA.step(); if (stA) maxVA = Math.max(maxVA, stA.v); }
    if (!doneB) await dB.step();
    if (Date.now() - lastCheck > 2000) {
      lastCheck = Date.now();
      doneA = await lapDone(A);
      doneB = await lapDone(B);
      // Tela de resultados ≠ conclusão de volta: deadline/fin gera results com
      // dnf (race.js onFirstFinish/finish). Só registra a tela e sai do loop,
      // sem forçar doneA/doneB — a conclusão de A é provada abaixo (lap + row dnf=false).
      resultsOn = await A.getByText('Voltar ao lobby', { exact: true }).isVisible().catch(() => false);
      if (resultsOn) break;
    }
    if (doneA && doneB) break;
  }
  await dA.stop();
  await dB.stop();
  for (const P of [A, B]) for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await P.keyboard.up(k).catch(() => {});
  ok(maxVA > 8, `A atingiu velocidade (${maxVA.toFixed(1)} m/s)`);
  await shot(A, '02-corrida');

  // 6. resultados (tela apareceu ≠ A concluiu)
  await A.getByText('Voltar ao lobby', { exact: true }).waitFor({ timeout: 120_000 });
  const names = await A.locator('.r-name').allInnerTexts().catch(() => []);
  ok(names.some((n) => n.includes('Ana')), `results contém Ana (${JSON.stringify(names)})`);
  ok(names.some((n) => n.includes('Bia')), `results contém Bia (${JSON.stringify(names)})`);
  const rowA = await resultRow(A, 'Ana');
  const concludedA = isLapConcluded(doneA, rowA);
  ok(concludedA, `A concluiu volta sem DNF (lap + results dnf=false, tempo=${rowA?.total ?? '?'})`);
  await shot(A, '03-results');

  // 7. revanche → lobby
  await A.getByText('Voltar ao lobby', { exact: true }).click();
  await A.locator('.room-code').waitFor({ timeout: 10_000 });
  ok(true, 'revanche voltou ao lobby (A)');
  await B.locator('.room-code').waitFor({ timeout: 15_000 }).catch(() => {});
  ok(true, 'B de volta ao lobby (esperado)');

  // 8. time trial (página nova em contexto A)
  const TT = await ctxA.newPage();
  watch(TT, 'TT');
  await TT.goto(url, { waitUntil: 'domcontentloaded' });
  await TT.getByText('Contra o relógio', { exact: true }).waitFor({ timeout: 15_000 });
  await TT.locator('input[aria-label^="Apelido"]').fill('TT');
  await TT.getByText('Contra o relógio', { exact: true }).click();
  await TT.locator('[data-fkey="tt-costeiro"]').click();
  await TT.getByText('Começar', { exact: true }).click();
  await TT.locator('.hud:not([hidden])').waitFor({ timeout: 20_000 });
  await TT.keyboard.down('ArrowUp');
  await driveLap(TT, { maxMs: 6_000 });
  const timeTxt = (await TT.locator('.hud-time-main').innerText()).trim();
  ok(timeTxt !== '0:00.00', `cronômetro TT rodando (${timeTxt})`);
  await shot(TT, '04-tt');
  await TT.keyboard.up('ArrowUp');
  await TT.keyboard.press('Escape');
  // menu de pausa do TT: sem botão "Continuar" (Esc retoma); tem "Reiniciar tentativa"
  const pauseVisible = await TT.getByText('Reiniciar tentativa', { exact: true }).isVisible().catch(() => false);
  ok(pauseVisible, 'Esc abre a pausa no TT');
  await shot(TT, '05-pausa');
  await TT.keyboard.press('Escape'); // Esc de novo = retomar (onEsc toggles)
  await TT.close();

  // 9. erros de console/página
  const fatal = errors.filter((e) => !/favicon|Autoplay|AudioContext|WebGL.*fallback/i.test(e.text));
  ok(fatal.length === 0, `sem erros de página (${fatal.length})`);
  for (const e of fatal.slice(0, 10)) console.log(`   [${e.page}] ${e.text}`);

  await browser.close();
  await srv.close();
  clearTimeout(watchdog);
  console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FALHOU: ${failures} asserções`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => { console.error('ERRO:', err); process.exit(1); });
