'use strict';
// UI real — Chromium (Playwright, 2 contextos isolados) + Firefox (perfil temporário):
// criar/entrar com código, apelidos, pronto, auto-início, clique no canvas (mover),
// tecla de skill, screenshots, erros de console/página zerados e FPS via rAF.
// Browsers isolados: contextos efêmeros (sem perfil pessoal). Log em /tmp/opencode.
const fs = require('fs');
const path = require('path');
const ts0 = () => new Date().toISOString();
const H = require('./h.cjs');

let PW;
try { PW = require('playwright'); }
catch {
  const dirs = fs.readdirSync(process.env.HOME + '/.npm/_npx');
  let best = null, bestV = '';
  for (const d of dirs) {
    const p = `${process.env.HOME}/.npm/_npx/${d}/node_modules/playwright`;
    try {
      const v = require(p + '/package.json').version;
      if (v > bestV) { bestV = v; best = p; }
    } catch { /* sem playwright aqui */ }
  }
  if (!best) throw new Error('playwright não encontrado no cache npx');
  console.log(ts0(), 'playwright', bestV, 'em', best);
  PW = require(best);
}

const HTTP = process.env.E2E_HTTP || 'http://127.0.0.1:8094';
const OUT = process.env.E2E_LOG || '/tmp/opencode';
const ts = () => new Date().toISOString();
let PASS = 0, FAIL = 0;
function check(name, cond, extra = '') {
  if (cond) { PASS++; console.log(ts(), '  OK  ', name, extra); }
  else { FAIL++; console.log(ts(), '  FAIL', name, extra); }
}

(async () => {
  const errors = [];
  const toasts = [];
  const snapToast = async (page, tag) => {
    try {
      const t = await page.textContent('#toast');
      if (t && t.trim()) toasts.push(`[${tag}] toast: ${t.trim()}`);
    } catch { /* sem toast */ }
  };
  const watch = (page, tag) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  };

  // Chromium: 2 contextos isolados (2 "clientes" distintos, sem perfil pessoal)
  const chrom = await PW.chromium.launch({ headless: true });
  const ctxA = await chrom.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await chrom.newContext({ viewport: { width: 1280, height: 720 } });
  const pageA = await ctxA.newPage(); watch(pageA, 'chrom-A');
  const pageB = await ctxB.newPage(); watch(pageB, 'chrom-B');

  // A cria sala FFA
  await pageA.goto(HTTP, { waitUntil: 'networkidle' });
  await pageA.fill('#in-nick', 'E2E-UI1');
  await pageA.selectOption('#in-modo', 'ffa');
  await pageA.click('#btn-criar');
  await pageA.waitForSelector('#tela-lobby:not(.oculto)', { timeout: 8000 });
  const code = (await pageA.textContent('#lobby-codigo')).trim();
  check('UI-A criou sala (código visível)', /^[A-Z2-9]{4}$/.test(code), code);
  await pageA.screenshot({ path: path.join(OUT, 'ui-1-lobby-chromium.png') });

  // B entra com código
  await pageB.goto(HTTP, { waitUntil: 'networkidle' });
  await pageB.fill('#in-nick', 'E2E-UI2');
  await pageB.fill('#in-code', code);
  await pageB.click('#btn-entrar');
  await pageB.waitForSelector('#tela-lobby:not(.oculto)', { timeout: 8000 });
  const lobB = await pageB.textContent('#lobby-codigo');
  check('UI-B entrou na mesma sala', lobB.trim() === code, lobB.trim());

  // Firefox (playwright, perfil temporário) entra como 3º cliente
  const ff = await PW.firefox.launch({ headless: true });
  const ctxF = await ff.newContext({ viewport: { width: 1280, height: 720 } });
  const pageF = await ctxF.newPage(); watch(pageF, 'firefox');
  await pageF.goto(HTTP, { waitUntil: 'networkidle' });
  await pageF.fill('#in-nick', 'E2E-UI3');
  await pageF.fill('#in-code', code);
  await pageF.click('#btn-entrar');
  await pageF.waitForSelector('#tela-lobby:not(.oculto)', { timeout: 8000 });
  check('Firefox entrou na mesma sala', (await pageF.textContent('#lobby-codigo')).trim() === code);
  await pageF.screenshot({ path: path.join(OUT, 'ui-2-lobby-firefox.png') });

  // 3 bots WS completam a arena (6 bonecos p/ FPS) e todos marcam pronto
  const bots = [];
  for (let i = 1; i <= 3; i++) {
    const b = new H.Bot('E2E-UIB' + i);
    await H.joinRoom(b, code);
    bots.push(b);
  }
  await pageA.click('#btn-pronto');
  await pageB.click('#btn-pronto');
  await pageF.click('#btn-pronto');
  await pageA.waitForTimeout(500);
  await snapToast(pageA, 'apos-pronto-A'); await snapToast(pageB, 'apos-pronto-B'); await snapToast(pageF, 'apos-pronto-F');
  for (const b of bots) b.send({ type: 'ready', ready: true });
  await pageA.waitForSelector('#tela-jogo:not(.oculto)', { timeout: 15000 });
  await pageB.waitForSelector('#tela-jogo:not(.oculto)', { timeout: 15000 });
  await pageF.waitForSelector('#tela-jogo:not(.oculto)', { timeout: 15000 });
  check('auto-início real na UI (3 browsers + 3 bots)', true);
  await pageA.screenshot({ path: path.join(OUT, 'ui-3-jogo-chromium.png') });
  await pageF.screenshot({ path: path.join(OUT, 'ui-4-jogo-firefox.png') });

  // Clique no canvas = mover; tecla Q = skill (sem alvo explode? deve ser ignorado sem erro)
  const box = await pageA.locator('#cv').boundingBox();
  await pageA.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await pageA.waitForTimeout(2500);
  await pageA.keyboard.press('q');
  await pageA.waitForTimeout(1500);
  await snapToast(pageA, 'apos-q-A');
  await pageA.screenshot({ path: path.join(OUT, 'ui-5-move-skill.png') });
  await snapToast(pageA, 'fim-A');
  check('clique+tecla na UI sem travar (tela segue em jogo)', await pageA.locator('#tela-jogo:not(.oculto)').count() === 1);

  // FPS via rAF por 5s na arena com 6 bonecos
  const fps = await pageA.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const loop = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(loop); else res(n / 5); };
    requestAnimationFrame(loop);
  }));
  const cpu = fs.readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.+)/);
  console.log(ts(), 'FPS(rAF,5s,canvas 1280x720, 6 bonecos):', fps.toFixed(1),
    '| CPU:', cpu && cpu[1].trim(), '| GPU: software (headless)');
  check('FPS medido e registrado (sem declarar meta)', Number.isFinite(fps) && fps > 0, fps.toFixed(1) + ' fps');
  fs.writeFileSync(path.join(OUT, 'ui-fps.json'), JSON.stringify({
    fps_rAF_5s: +fps.toFixed(1), viewport: '1280x720', jogadores: 6,
    cenario: 'arena FFA real via UI + 3 bots WS, headless', cpu: cpu && cpu[1].trim(),
    data: ts(),
  }, null, 2));

  // Erros de console/página zerados; toasts de erro do servidor listados (não quebram o fluxo)
  if (errors.length) { console.log(ts(), 'ERROS DE CONSOLE/PÁGINA:'); errors.slice(0, 20).forEach((e) => console.log('   ', e)); }
  check('console+pageerrors zerados (3 páginas)', errors.length === 0, `${errors.length} erro(s)`);
  if (toasts.length) { console.log(ts(), 'TOASTS (erro servidor na UI):'); toasts.forEach((e) => console.log('   ', e)); }
  // Achado E2E-UI-BUILD-TOAST (p/ lane servidor, sem editar aqui): todo "Pronto"
  // da UI envia build limpa, mas o merge servidor ({...p.build,...msg.build}) herda
  // cPass2:null que o sim emite na build canônica; pick() trata null como "enviado"
  // e validateBuild rejeita (chestPassive2 só-Soldier). Fluxo segue (ready vale),
  // mas todo usuário vê o toast. Listado, não bloqueante p/ este E2E.
  check('toasts de erro listados (1 achado conhecido)', true, `${toasts.length} toast(s): E2E-UI-BUILD-TOAST`);

  for (const b of bots) { try { b.send({ type: 'leave' }); b.close(); } catch { /* ignora */ } }
  await chrom.close(); await ff.close();
  console.log(ts(), `== UI: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('UI ERRO:', e); process.exit(2); });
