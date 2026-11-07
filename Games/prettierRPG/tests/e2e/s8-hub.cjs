'use strict';
// S8 — §10(6): Hub lado-jogo. Endpoints HTTP com HUB_SECRET (state/close) + UI ?hub=1.
// Browsers isolados (contextos efêmeros). Estado atual: sem HUB_SECRET → 503 (modo
// independente segue). Com HUB_SECRET=e2e-hub-test: state/close exercidos de verdade.
const fs = require('fs');
const path = require('path');
const H = require('./h.cjs');

const HTTP = process.env.E2E_HTTP || 'http://127.0.0.1:8094';
const OUT = process.env.E2E_LOG || '/tmp/opencode';
const SECRET = process.env.HUB_SECRET || '';
let PW;
try { PW = require('playwright'); }
catch {
  const dirs = fs.readdirSync(process.env.HOME + '/.npm/_npx');
  let best = null, bestV = '';
  for (const d of dirs) {
    const p = `${process.env.HOME}/.npm/_npx/${d}/node_modules/playwright`;
    try { const v = require(p + '/package.json').version; if (v > bestV) { bestV = v; best = p; } } catch {}
  }
  if (!best) throw new Error('playwright ausente');
  PW = require(best);
}
const ts = () => new Date().toISOString();
let PASS = 0, FAIL = 0;
function check(n, c, e = '') { if (c) { PASS++; console.log(ts(), '  OK  ', n, e); } else { FAIL++; console.log(ts(), '  FAIL', n, e); } }

async function get(p) {
  const r = await fetch(HTTP + p);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function post(p, secret) {
  const r = await fetch(HTTP + p, { method: 'POST', headers: secret ? { 'x-hub-secret': secret } : {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  // state sala inexistente
  const s0 = await get('/__hub/state?room=ZZZ9');
  check('state sala livre → 404 free:true', s0.status === 404 && s0.body.free === true, JSON.stringify(s0.body));

  // sala real em lobby
  const A = new H.Bot('E2E-HubA');
  const code = await H.createRoom(A);
  const s1 = await get(`/__hub/state?room=${code}`);
  check('state sala lobby → 200 lobby/joinable', s1.status === 200 && s1.body.lobby === 'lobby' && s1.body.joinable === true, JSON.stringify(s1.body));
  check('state expõe players/capacity/mode', s1.body.players === 1 && s1.body.capacity === 12 && s1.body.mode === 'ffa', JSON.stringify({ p: s1.body.players, c: s1.body.capacity, m: s1.body.mode }));

  // close sem segredo → 403; segredo errado → 403
  const c0 = await post(`/__hub/close?room=${code}&htok=H1`, '');
  check('close sem segredo → 403', c0.status === 403, JSON.stringify(c0.body));
  const c1 = await post(`/__hub/close?room=${code}&htok=H1`, 'errado');
  check('close segredo errado → 403', c1.status === 403, JSON.stringify(c1.body));

  // outro dono (htok divergente após reserva) → 403; fecha certo → closed:true
  const c2 = await post(`/__hub/close?room=${code}&htok=H1`, SECRET);
  check('close com segredo fecha sala viva', c2.status === 200 && c2.body.closed === true, JSON.stringify(c2.body));
  await H.sleep(500);
  check('sala fechada some (join rejeitado)', await (async () => {
    const Z = new H.Bot('E2E-HubZ');
    await Z.connect();
    Z.send({ type: 'join', nick: 'E2E-HubZ', room: code, build: {} });
    await H.sleep(700);
    const bad = Z.errors.some((e) => /não encontrada/.test(e));
    Z.close();
    return bad;
  })());

  // idempotente: fechar de novo → closed:false
  const c3 = await post(`/__hub/close?room=${code}&htok=H1`, SECRET);
  check('close idempotente (já livre) → closed:false', c3.status === 200 && c3.body.closed === false, JSON.stringify(c3.body));

  // UI ?hub=1: auto-cria e mostra aviso Hub; hubUrl mostra voltar
  const chrom = await PW.chromium.launch({ headless: true });
  const page = await (await chrom.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(HTTP + '/?hub=1&name=HubJog&create=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('#tela-lobby:not(.oculto), #tela-jogo:not(.oculto)', { timeout: 12000 });
  const av = await page.textContent('#hub-aviso');
  check('?hub=1 auto-entrou (aviso Hub)', /Modo Hub ativo/.test(av), av.slice(0, 90));
  const hubCode = (await page.textContent('#lobby-codigo')).trim();
  check('sala Hub criada', /^[A-Z2-9]{4}$/.test(hubCode), hubCode);
  await page.screenshot({ path: path.join(OUT, 's8-hub-auto.png') });
  const st = await get(`/__hub/state?room=${hubCode}`);
  check('sala Hub visível no state', st.status === 200 && st.body.players >= 1, JSON.stringify(st.body));
  await page.goto(HTTP + '/?hub=1&name=X&hubUrl=http%3A%2F%2Fhub.local%2F', { waitUntil: 'networkidle' });
  await H.sleep(800);
  const back = await page.locator('#btn-hub-voltar:not(.oculto)').count();
  check('hubUrl exibe voltar ao Hub', back === 1);
  check('UI Hub sem erros console', errs.length === 0, errs.slice(0, 3).join(' | '));
  await chrom.close();

  try { A.close(); } catch {}
  console.log(ts(), `== S8-HUB: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('S8 ERRO:', e); process.exit(2); });
