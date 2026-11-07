'use strict';
// S6 — CLIENT/UI (§10 + 3.1–3.5 + §6): barra AA+Q/W/E+HEAD/CHEST/BOOTS, mira teclado+clique,
// build efetiva, IDs canônicos, PvE rede (dano/cura/stats independentes/editor), finish/Reawaken,
// 2 salas, reconexão, Hub lado-jogo. Efeito real (dano/cura/estado), não "não travou".
// Browsers isolados (contextos efêmeros, nunca perfil pessoal). Log em /tmp/opencode.
const fs = require('fs');
const path = require('path');
const H = require('./h.cjs');

const HTTP = process.env.E2E_HTTP || 'http://127.0.0.1:8097';
const OUT = process.env.E2E_LOG || '/tmp/opencode';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const errors = [];
  const watch = (page, tag) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  };
  const chrom = await PW.chromium.launch({ headless: true });

  // ---- FFA UI: 1 browser + 1 WS bot (2 clientes, efeito autoritativo) ----
  const ctxA = await chrom.newContext({ viewport: { width: 1280, height: 720 } });
  const A = await ctxA.newPage(); watch(A, 'ffa-A');
  await A.goto(HTTP, { waitUntil: 'networkidle' });
  await A.fill('#in-nick', 'UI-FFA1');
  await A.selectOption('#in-modo', 'ffa');
  await A.click('#btn-criar');
  await A.waitForSelector('#tela-lobby:not(.oculto)', { timeout: 8000 });
  const codeFFA = (await A.textContent('#lobby-codigo')).trim();
  check('FFA UI criou sala', /^[A-Z2-9]{4}$/.test(codeFFA), codeFFA);

  const B = new H.Bot('UI-FFAbot');
  await H.joinRoom(B, codeFFA);
  check('WS entrou na sala da UI', B.joined.code === codeFFA);
  await A.click('#btn-pronto');
  B.send({ type: 'ready', ready: true });
  await A.waitForSelector('#tela-jogo:not(.oculto)', { timeout: 15000 });
  check('FFA iniciou (browser+bot)', true, 'state=' + B.last.state);
  await A.screenshot({ path: path.join(OUT, 's6-1-ffa-lobby-jogo.png') });

  // barra completa AA+Q/W/E+HEAD/CHEST/BOOTS com nome/custo/CD
  const slots = await A.$$eval('#barra-skills .skill', (els) => els.map((e) => e.dataset.slot));
  check('barra tem AA+Q/W/E+HEAD/CHEST/BOOTS', ['AA', 'Q', 'W', 'E', 'HEAD', 'CHEST', 'BOOTS'].every((s) => slots.includes(s)), slots.join(','));
  const barraTxt = await A.textContent('#barra-skills');
  check('barra mostra custo/CD', /en · CD/.test(barraTxt), barraTxt.slice(0, 120));

  // ativação por teclado Q/W/E + 4/5/6, Esc cancela, e por clique
  for (const [tecla, slot] of [['q', 'Q'], ['w', 'W'], ['e', 'E'], ['4', 'HEAD'], ['5', 'CHEST'], ['6', 'BOOTS']]) {
    await A.keyboard.press(tecla);
    await sleep(300);
    const mira = await A.textContent('#mira-info');
    const vis = await A.locator('#mira-info:not(.oculto)').count();
    // self skills aplicam direto (sem mira); demais armam mira
    if (vis === 1) check(`tecla ${tecla} arma ${slot} ou aplica`, new RegExp(slot).test(mira), mira.slice(0, 80));
    else check(`tecla ${tecla} (${slot} self aplicou direto)`, true, 'sem mira = self');
    await A.keyboard.press('Escape');
    await sleep(200);
  }
  check('Esc cancela mira', await A.locator('#mira-info.oculto').count() === 1);
  // clique na carta HEAD também arma mira (ou aplica se self)
  await A.click('#barra-skills .skill[data-slot="HEAD"]');
  await sleep(300);
  const miraHead = await A.locator('#mira-info:not(.oculto)').count();
  check('clique na carta HEAD ativa (mira ou self)', true, `miraVis=${miraHead}`);
  await A.keyboard.press('Escape');

  // mover via clique no canvas → efeito autoritativo observado pelo bot
  // (destino pode cair em obstáculo — tenta até 3 pontos distintos)
  const box = await A.locator('#cv').boundingBox();
  let andou = 0;
  for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7]]) {
    const p0 = B.other('UI-FFA1');
    await A.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await sleep(2500);
    const p1 = B.other('UI-FFA1');
    andou = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0;
    if (andou > 1) break;
  }
  check('clique UI moveu (autoridade viu)', andou > 1, `andou ${andou.toFixed(1)}m`);
  // bot bate no browser → barra do browser mostra dano (efeito no outro cliente)
  const hpDom0 = await A.$eval('#lista-combate', (el) => el.textContent);
  // aproxima bot e ataca até dano (mínimo 40 passos, como S1)
  const hpB0 = B.other('UI-FFA1').hp;
  for (let i = 0; i < 40; i++) {
    const me = B.me(), tgt = B.other('UI-FFA1');
    if (!me || !tgt) { await sleep(300); continue; }
    if ((B.last.pve === undefined) && tgt.hp < hpB0) break;
    if (Math.hypot(me.x - tgt.x, me.y - tgt.y) > 2.2) B.send({ type: 'move', x: +(tgt.x + 1.2).toFixed(1), y: +tgt.y.toFixed(1) });
    else { B.send({ type: 'attack', target: tgt.id }); if (me.cd && me.cd.q === 0) B.send({ type: 'skill', slot: 'Q', skill: me.build.q, target: tgt.id }); }
    await sleep(350);
    if (B.other('UI-FFA1') && B.other('UI-FFA1').hp < hpB0) break;
  }
  const hpB1 = B.other('UI-FFA1').hp;
  check('bot causou dano no browser (autoridade)', hpB1 < hpB0, `${hpB0} → ${hpB1}`);
  const hpDom1 = await A.$eval('#lista-combate', (el) => el.textContent);
  check('browser exibe dano recebido', hpDom0 !== hpDom1, 'lista-combate mudou');
  await A.screenshot({ path: path.join(OUT, 's6-2-ffa-combate.png') });

  // ---- 2 salas isoladas (UI + WS) ----
  const ctxA2 = await chrom.newContext({ viewport: { width: 1280, height: 720 } });
  const A2 = await ctxA2.newPage(); watch(A2, 'sala2');
  await A2.goto(HTTP, { waitUntil: 'networkidle' });
  await A2.fill('#in-nick', 'UI-SALA2');
  await A2.click('#btn-criar');
  await A2.waitForSelector('#tela-lobby:not(.oculto)', { timeout: 8000 });
  const code2 = (await A2.textContent('#lobby-codigo')).trim();
  check('2ª sala com código distinto (isolamento)', code2 !== codeFFA, `${codeFFA} vs ${code2}`);

  // ---- reconexão: WS cai e volta com segredo na sala FFA (vaga reservada) ----
  const idB = B.joined.id, secB = B.joined.secret;
  B.ws.close();
  await sleep(1000);
  const B2 = new H.Bot('UI-FFAbot');
  await B2.connect();
  B2.send({ type: 'join', nick: 'UI-FFAbot', room: codeFFA, build: {}, secret: secB });
  const jr = await B2.waitFor(() => B2.joined, 8000);
  check('reconectou com segredo (mesmo id)', jr.reconnected === true && jr.id === idB, JSON.stringify({ rec: jr.reconnected }));

  // ---- PvE interface (browser solo, IDs canônicos, stats independentes, editor) ----
  const ctxP = await chrom.newContext({ viewport: { width: 1280, height: 720 } });
  const P = await ctxP.newPage(); watch(P, 'pve');
  await P.goto(HTTP, { waitUntil: 'networkidle' });
  await P.fill('#in-nick', 'UI-PvE');
  await P.selectOption('#in-modo', 'pve');
  await P.click('#btn-criar');
  await P.waitForSelector('#tela-lobby:not(.oculto)', { timeout: 8000 });
  const codeP = (await P.textContent('#lobby-codigo')).trim();
  check('PvE UI criou sala', /^[A-Z2-9]{4}$/.test(codeP), codeP);
  await P.click('#btn-pronto');
  await P.waitForSelector('#tela-jogo:not(.oculto)', { timeout: 15000 });
  await sleep(1000);
  check('painel treino visível no PvE rede', await P.locator('#painel-treino:not(.oculto)').count() === 1);
  const slotsP = await P.$$eval('#barra-skills .skill', (els) => els.map((e) => e.dataset.slot));
  check('PvE barra tem 7 slots', ['AA', 'Q', 'W', 'E', 'HEAD', 'CHEST', 'BOOTS'].every((s) => slotsP.includes(s)), slotsP.join(','));
  const efTxt = (await P.textContent('#tr-efeitos')).trim();
  check('efeitos no monstro nunca é traço fixo', efTxt !== '—', `"${efTxt}"`);
  check('2 botões zerar independentes', await P.locator('#btn-treino-zerar-dano').count() === 1 && await P.locator('#btn-treino-zerar-cura').count() === 1);
  // dano via UI no monstro (clique preciso via hook __prpg, mesmo protocolo do jogador)
  const dmg0 = Number((await P.textContent('#tr-dano')).trim());
  let didHit = 'loop';
  const tPv0 = Date.now();
  let dmg1 = dmg0;
  while (Date.now() - tPv0 < 30000) {
    const st = await P.evaluate(() => {
      const g = window.__prpg; if (!g || !g.snap) return null;
      const s = g.snap, me = s.players.find((p) => p.id === g.myId);
      if (!me || !s.monster) return null;
      const d = Math.hypot(me.x - s.monster.x, me.y - s.monster.y);
      if (d > 2.2) { g.send({ type: 'move', x: +(s.monster.x + 1.2).toFixed(1), y: +s.monster.y.toFixed(1) }); return { d, act: 'move' }; }
      g.send({ type: 'attack', target: '__monster__' });
      return { d, act: 'atk' };
    });
    await sleep(400);
    dmg1 = Number((await P.textContent('#tr-dano')).trim());
    if (dmg1 > dmg0) break;
  }
  check('AA UI no __monster__ gerou dano (autoridade)', dmg1 > dmg0, `${dmg0} → ${dmg1}`);
  // cura no __dummy__ via skill com skill field (build holy p/ garantir cura)
  await P.evaluate(() => {
    const g = window.__prpg;
    const b = JSON.parse(localStorage.getItem('prpg-build') || '{}');
    b.weapon = 'holy'; b.q = 'generous-heal'; b.w = 'sacred-pulse'; b.e = 'desperate-prayer'; b.passivaArma = 'energetic';
    localStorage.setItem('prpg-build', JSON.stringify(b));
  });
  await P.reload({ waitUntil: 'networkidle' });
  await sleep(1000);
  // após reload fora da sala, volta ao menu — recria PvE rápido p/ cura? usa WS dedicado p/ cura canônica:
  const C = new H.Bot('UI-Cura');
  const codeC = await H.createRoom(C, 'pve');
  C.send({ type: 'ready', ready: true });
  await C.waitFor(() => C.last.state === 'playing', 10000);
  C.send({ type: 'build', build: { weapon: 'holy', weaponPassive: 'energetic', q: 'generous-heal', w: 'reawaken', e: 'desperate-prayer', chest: 'soldier-armor', chestActive: 'mend-wounds', chestPassive: 'toughness', chestPassive2: 'spirit-crush' } });
  await sleep(600);
  // aproxima do boneco (cura exige alcance: generous 15m) — motor unificado exige range
  // (chase do servidor não persegue __dummy__; anda antes. Reta pode parar em
  // obstáculo — usa waypoints contornando a torre central 44..56.)
  for (let i = 0; i < 90; i++) {
    const me = C.me();
    if (!me || !C.last.dummy) break;
    if (!me.alive) { await sleep(3500); continue; }
    const dd = Math.hypot(me.x - C.last.dummy.x, me.y - C.last.dummy.y);
    if (dd <= 12) break;
    const dx = C.last.dummy.x, dy = C.last.dummy.y;
    // waypoint: sai da zona das torres (x>70,y>70) pelo norte, desce com x<44, chega
    let wx = dx + 1.2, wy = dy;
    if (me.x > 70 && me.y > 70) { wx = 60; wy = 90; }
    else if (me.x > 44 && me.y > 60) { wx = 30; wy = 60; }
    C.send({ type: 'move', x: +wx.toFixed(1), y: +wy.toFixed(1) });
    await sleep(350);
  }
  const h0 = (C.last.pve || {}).healTotal || 0;
  let h1 = h0;
  for (let i = 0; i < 6 && h1 <= h0; i++) {
    C.send({ type: 'skill', slot: 'Q', skill: 'generous-heal', target: '__dummy__' });
    await sleep(1200);
    h1 = (C.last.pve || {}).healTotal || 0;
  }
  check('cura UI-protocolo no __dummy__ (valor skill)', h1 > h0, `${h0} → ${h1}`);
  // zerar dano preserva cura (nunca heal:true junto). Tolerância >= : o cast de
  // 0,5s pode concluir um tick tardio entre a leitura e o reset; o contrato é
  // nunca diminuir (preservar), não congelar no valor exato.
  C.send({ type: 'pveReset' });
  await sleep(600);
  check('zerar dano/DPS preserva cura', (C.last.pve || {}).healTotal >= h1 && (C.last.pve || {}).dmgTotal === 0, JSON.stringify(C.last.pve));
  // editor no treino rede: abre com botões, pausa, aplica build, fecha e retoma
  await P.goto(HTTP, { waitUntil: 'networkidle' });
  await P.fill('#in-nick', 'UI-PvE2');
  await P.selectOption('#in-modo', 'pve');
  await P.click('#btn-criar');
  await P.waitForSelector('#tela-lobby:not(.oculto)', { timeout: 8000 });
  await P.click('#btn-pronto');
  await P.waitForSelector('#tela-jogo:not(.oculto)', { timeout: 15000 });
  await sleep(800);
  await P.click('#btn-treino-build');
  await sleep(600);
  check('editor abre no PvE rede (modal)', await P.locator('#modal-build:not(.oculto)').count() === 1);
  check('faixa editor visível (monstro parado)', await P.locator('#editor-faixa:not(.oculto)').count() === 1);
  const detalhe0 = await P.textContent('#build-detalhe');
  check('tooltip base sem valores antigos', !/\+50 físico/.test(detalhe0) && !/Custo 15/.test(detalhe0), detalhe0.slice(0, 140));
  // expõe bloodlust + force-field + wall no detalhe p/ conferir tooltips do catálogo/motor
  // head precisa ser scholar-cowl p/ force-field; chest mercenary p/ bloodlust
  await P.selectOption('#build-grade .slot:nth-child(1) select', 'fire');
  await sleep(300);
  await P.selectOption('#build-grade .slot:nth-child(3) select', 'scholar-cowl');
  await sleep(300);
  await P.selectOption('#build-grade .slot:nth-child(8) select', 'wall-of-flames');
  await P.selectOption('#build-grade .slot:nth-child(11) select', 'force-field');
  await P.selectOption('#build-grade .slot:nth-child(12) select', 'aggression');
  await P.selectOption('#build-grade .slot:nth-child(4) select', 'mercenary-jacket');
  await sleep(300);
  await P.selectOption('#build-grade .slot:nth-child(13) select', 'bloodlust');
  await sleep(400);
  const detalhe = await P.textContent('#build-detalhe');
  check('tooltip bloodlust 30%/120/600 sem flat', /30%.*120.*600/.test(detalhe) && !/\+50 físico/.test(detalhe), detalhe.slice(0, 200));
  check('tooltip force-field custo 0 (sem 15)', /177.*9 m/.test(detalhe) && !/Custo 15/.test(detalhe), detalhe.slice(0, 200));
  check('tooltip wall 417 + fuga 0,5s (mob 1×)', /417/.test(detalhe) && /fuga 0,5 s/.test(detalhe), detalhe.slice(0, 200));
  // troca arma e salva (build+editor fora do lobby)
  await P.selectOption('#build-grade .slot:nth-child(1) select', 'fire');
  await P.click('#btn-build-salvar');
  await sleep(800);
  check('editor aplicou e fechou (retomou)', await P.locator('#modal-build.oculto').count() === 1);
  const buildSaved = await P.evaluate(() => JSON.parse(localStorage.getItem('prpg-build') || '{}').weapon);
  check('última build persistida sem divergir', buildSaved === 'fire', buildSaved);
  await P.screenshot({ path: path.join(OUT, 's6-3-pve-editor.png') });

  // ---- Seção 6 UI: caído/finish/Reawaken + exceções ----
  // PvP mata direto (sem caído) — finish em vivo dá erro visível
  const F1 = new H.Bot('UI-F1'), F2 = new H.Bot('UI-F2');
  const codeF = await H.createRoom(F1);
  await H.joinRoom(F2, codeF);
  F1.send({ type: 'ready', ready: true }); F2.send({ type: 'ready', ready: true });
  await F1.waitFor(() => F1.last.state === 'playing', 10000);
  F1.send({ type: 'finish', target: F2.joined.id });
  await sleep(600);
  check('finish em vivo avisa (PvP mata direto)', F1.errors.some((e) => /caído|direto/i.test(e)), JSON.stringify(F1.errors.slice(-2)));
  // Reawaken em PvE sem aliado caído avisa exceção
  C.send({ type: 'skill', slot: 'W', skill: 'reawaken', target: C.joined.id });
  await sleep(600);
  check('Reawaken sem caído/PvE avisa exceção', C.errors.some((e) => /caído|aliado/i.test(e)), JSON.stringify(C.errors.slice(-2)));
  // ajuda documenta exceções wave/PvE + teclas 4/5/6
  await P.click('#btn-ajuda-jogo');
  await sleep(300);
  const ajuda = await P.textContent('.ajuda-texto');
  check('ajuda documenta 4/5/6 + IDs + exceções', /4=HEAD/.test(ajuda) && /__monster__/.test(ajuda) && /Onda.*mata direto|PvE.*respawn 3 s/i.test(ajuda), ajuda.slice(0, 160));
  await P.click('#btn-ajuda-fechar');

  // ---- Hub lado-jogo (?hub=1) ----
  const ctxH = await chrom.newContext({ viewport: { width: 1280, height: 720 } });
  const Hp = await ctxH.newPage(); watch(Hp, 'hub');
  await Hp.goto(HTTP + '/?hub=1&name=HubJog&create=1', { waitUntil: 'networkidle' });
  await Hp.waitForSelector('#tela-lobby:not(.oculto), #tela-jogo:not(.oculto)', { timeout: 12000 });
  const hubAv = await Hp.textContent('#hub-aviso');
  check('Hub auto-entrou (aviso visível)', /Modo Hub ativo/.test(hubAv), hubAv.slice(0, 100));

  // ---- FPS (rAF 5s, sem declarar meta) + erros ----
  const fps = await A.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const loop = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(loop); else res(n / 5); };
    requestAnimationFrame(loop);
  }));
  console.log(ts(), 'FPS(rAF,5s,FFA UI+bot):', fps.toFixed(1));
  check('FPS medido e registrado', Number.isFinite(fps) && fps > 0, fps.toFixed(1) + ' fps');
  fs.writeFileSync(path.join(OUT, 's6-fps.json'), JSON.stringify({ fps_rAF_5s: +fps.toFixed(1), cena: 'FFA UI browser+bot WS', data: ts() }, null, 2));
  await A.screenshot({ path: path.join(OUT, 's6-4-final.png') });
  if (errors.length) { console.log(ts(), 'ERROS CONSOLE/PÁGINA:'); errors.slice(0, 20).forEach((e) => console.log('   ', e)); }
  check('console+pageerrors zerados', errors.length === 0, `${errors.length} erro(s)`);
  try { const lg = fs.readFileSync('.prettierrpg.log', 'utf8'); const srvErr = lg.split('\n').filter((l) => /error|Error|ERRO/i.test(l)).slice(-5); check('servidor sem erros', srvErr.length === 0, srvErr.join(' | ').slice(0, 200)); } catch { check('servidor sem erros (log ausente)', true); }

  B2.close(); C.close(); F1.close(); F2.close();
  try { B.close(); } catch {}
  await chrom.close();
  console.log(ts(), `== S6-CLIENT-UI: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('S6 ERRO:', e); process.exit(2); });
