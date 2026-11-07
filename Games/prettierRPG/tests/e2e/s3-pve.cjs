'use strict';
// Cenário 3 — PvE treino em rede (1 cliente WS + troca de build em jogo):
// monstro persegue/ataca, jogador causa dano (stats/DPS), cura no boneco,
// editor pausa monstro, pveReset zera stats, morte do monstro → respawn 30s.
const H = require('./h.cjs');

(async () => {
  const S = new H.Bot('E2E-Solo');
  const code = await H.createRoom(S, 'pve');
  H.log('sala pve criada:', code);
  H.check('modo pve', S.last.mode === 'pve', S.last.mode);
  S.send({ type: 'ready', ready: true });
  await S.waitFor(() => S.last.state === 'playing', 10000);
  H.check('treino iniciou', true, 'monster=' + JSON.stringify(S.last.monster && { hp: S.last.monster.hp, alive: S.last.monster.alive }));
  H.check('monstro vivo no início', S.last.monster && S.last.monster.alive === true);
  H.check('boneco de treino presente', !!S.last.dummy, JSON.stringify(S.last.dummy));

  // Monstro persegue: distância cai; e ataca: jogador perde vida
  const m0 = S.last.monster, p0 = S.me();
  const d0 = Math.hypot(m0.x - p0.x, m0.y - p0.y);
  H.log(`dist inicial monstro-jogador: ${d0.toFixed(1)}m`);
  await S.waitFor(() => {
    const m = S.last.monster, p = S.me();
    return m && p && Math.hypot(m.x - p.x, m.y - p.y) < d0 - 2;
  }, 30000).catch(() => null);
  const d1 = Math.hypot(S.last.monster.x - S.me().x, S.last.monster.y - S.me().y);
  H.check('monstro persegue (distância cai)', d1 < d0 - 2, `${d0.toFixed(1)} → ${d1.toFixed(1)}m`);
  const hpAntes = S.me().hp;
  await S.waitFor(() => S.me() && (S.me().hp < S.me().maxHp || (S.me().dmgTaken || 0) > 0), 60000).catch(() => null);
  const hpDepois = S.me().hp;
  H.check('monstro ataca (jogador perde vida)', hpDepois < hpAntes || (S.me().dmgTaken || 0) > 0, `hp ${hpAntes} → ${hpDepois}`);

  // Jogador causa dano: aproxima + AA até dmgTotal>0
  H.log('atacando o monstro…');
  const t0 = Date.now();
  let danoOk = false;
  while (Date.now() - t0 < 90000) {
    const me = S.me(), m = S.last.monster;
    if (!me || !m) { await H.sleep(300); continue; }
    if (!me.alive) { await H.sleep(1000); continue; } // morreu? espera respawn 3s
    if ((S.last.pve || {}).dmgTotal > 0) { danoOk = true; break; }
    if (!m.alive) break;
    if (Math.hypot(me.x - m.x, me.y - m.y) > 2.2) S.send({ type: 'move', x: +(m.x + 1.2).toFixed(1), y: +m.y.toFixed(1) });
    else S.send({ type: 'attack', target: '__monster__' });
    await H.sleep(350);
  }
  H.check('dano no monstro registrado', danoOk, 'pve=' + JSON.stringify(S.last.pve));
  H.check('DPS>0 após dano', (S.last.pve || {}).dps5 > 0, 'pve=' + JSON.stringify(S.last.pve));

  // Troca p/ build de cura em jogo (permitido no PvE) e cura o boneco
  // Troca p/ build de cura em jogo (permitido no PvE; passiva junto pois o merge
  // servidor valida a build combinada e a passiva do machado não serve no cajado)
  S.send({ type: 'build', build: { weapon: 'holy', weaponPassive: 'energetic', q: 'generous-heal', w: 'reawaken', e: 'desperate-prayer', chest: 'soldier-armor', chestActive: 'mend-wounds', chestPassive: 'toughness', chestPassive2: 'spirit-crush' } });
  await H.sleep(1000);
  H.check('troca de build em jogo (PvE)', !S.errors.some((e) => /Build/.test(e)), JSON.stringify(S.errors.slice(-2)));
  // Aproxima do boneco (cura exige alcance ~15m). Roteamento comprometido que
  // NUNCA mira através da torre 44..56 (regras por região, sem oscilar):
  // faixa→sai vertical; norte/leste→oeste por cima; resto→direto. Sem revide
  // (atacar prende o bot no combate e o monstro gruda); só anda (tankando).
  {
    const t0 = Date.now();
    let lastD = 1e9, lastT = Date.now(), side = 1;
    while (Date.now() - t0 < 60000) {
      const me = S.me();
      if (!me || !S.last.dummy) { await H.sleep(300); continue; }
      if (!me.alive) { await H.sleep(3500); continue; }
      const dd = Math.hypot(me.x - S.last.dummy.x, me.y - S.last.dummy.y);
      if (dd <= 12) break;
      if (dd < lastD - 0.5) { lastD = dd; lastT = Date.now(); }
      if (me.y > 42 && me.y < 58 && me.x > 44) {
        S.send({ type: 'move', x: +me.x.toFixed(1), y: me.y < 50 ? 28 : 72 }); // sai da faixa da torre
      } else if (me.y >= 58 && me.x > 44) {
        S.send({ type: 'move', x: 30, y: +me.y.toFixed(1) }); // oeste por cima (y>=58 livre)
      } else if (me.x > 58 && me.y > 42) {
        S.send({ type: 'move', x: 70, y: 28 }); // corredor nordeste
      } else if (Date.now() - lastT > 3000) {
        side = -side; lastT = Date.now(); // pilar: desvio lateral
        const dx = S.last.dummy.x - me.x, dy = S.last.dummy.y - me.y, L = Math.hypot(dx, dy) || 1;
        S.send({ type: 'move', x: +(me.x + (-dy / L) * 8 * side).toFixed(1), y: +(me.y + (dx / L) * 8 * side).toFixed(1) });
      } else {
        S.send({ type: 'move', x: +(S.last.dummy.x + 1.2).toFixed(1), y: +S.last.dummy.y.toFixed(1) });
      }
      await H.sleep(350);
    }
    H.log('  dist ao boneco:', Math.hypot(S.me().x - S.last.dummy.x, S.me().y - S.last.dummy.y).toFixed(1) + 'm');
  }
  const heal0 = (S.last.pve || {}).healTotal || 0;
  let heal1 = heal0;
  for (let i = 0; i < 4 && heal1 <= heal0; i++) {
    S.send({ type: 'skill', slot: 'Q', target: '__dummy__' });
    await H.sleep(1500);
    heal1 = (S.last.pve || {}).healTotal || 0;
  }
  H.check('cura no boneco com valor da skill', heal1 > heal0, `healTotal ${heal0} → ${heal1}`);

  // Editor pausa o monstro; jogador anda com editor aberto; ao fechar, monstro volta a caçar
  S.send({ type: 'editor', open: true });
  await H.sleep(500);
  const mx = S.last.monster.x, my = S.last.monster.y;
  const me0 = S.me();
  S.send({ type: 'move', x: me0.x > 50 ? 8 : 92, y: me0.y > 50 ? 8 : 92 }); // foge p/ canto oposto
  await H.sleep(1500);
  const mx2 = S.last.monster.x, my2 = S.last.monster.y;
  H.check('editor aberto pausa o monstro', mx === mx2 && my === my2, `(${mx},${my}) → (${mx2},${my2})`);
  H.check('jogador move com editor aberto', Math.hypot(S.me().x - me0.x, S.me().y - me0.y) > 2, `andou ${Math.hypot(S.me().x - me0.x, S.me().y - me0.y).toFixed(1)}m`);
  S.send({ type: 'editor', open: false });
  let voltou = false;
  try {
    await S.waitFor(() => {
      const m = S.last.monster, p = S.me();
      return m && (m.x !== mx2 || m.y !== my2 || (p && Math.hypot(m.x - p.x, m.y - p.y) < 9));
    }, 20000);
    voltou = true;
  } catch { /* mantém false */ }
  H.check('editor fechado: monstro volta a caçar', voltou, `monstro=(${S.last.monster.x},${S.last.monster.y})`);

  // resets independentes (contrato atual: sem heal = só dano/DPS; heal:true = só cura)
  const healAntes = (S.last.pve || {}).healTotal || 0;
  S.send({ type: 'pveReset' });
  await H.sleep(1500);
  H.check('pveReset zera dano/DPS e preserva cura', ((S.last.pve || {}).dmgTotal === 0) && ((S.last.pve || {}).healTotal === healAntes), 'pve=' + JSON.stringify(S.last.pve));
  S.send({ type: 'pveReset', heal: true });
  await H.sleep(1500);
  H.check('pveReset heal:true zera só a cura', ((S.last.pve || {}).healTotal === 0), 'pve=' + JSON.stringify(S.last.pve));

  // Mata o monstro (2500hp) → respawn em 30s com stats zerados
  H.log('focando o monstro até matar (pode levar ~1min)…');
  S.send({ type: 'build', build: { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit' } });
  await H.sleep(500);
  const tk = Date.now();
  let matou = false;
  while (Date.now() - tk < 180000) {
    const me = S.me(), m = S.last.monster;
    if (!me || !m) { await H.sleep(300); continue; }
    if (!m.alive) { matou = true; break; }
    if (!me.alive) { await H.sleep(1200); continue; }
    if (Math.hypot(me.x - m.x, me.y - m.y) > 2.2) S.send({ type: 'move', x: +(m.x + 1.2).toFixed(1), y: +m.y.toFixed(1) });
    else {
      S.send({ type: 'attack', target: '__monster__' });
      if (me.cd && me.cd.q === 0) S.send({ type: 'skill', slot: 'Q', target: '__monster__' });
      if (me.cd && me.cd.w === 0) S.send({ type: 'skill', slot: 'W', target: '__monster__' });
    }
    await H.sleep(350);
  }
  H.check('monstro morto', matou, 'monster=' + JSON.stringify(S.last.monster && { hp: S.last.monster.hp, alive: S.last.monster.alive }));
  if (matou) {
    const tr = Date.now();
    await S.waitFor(() => S.last.monster && S.last.monster.alive, 60000);
    H.check('monstro renasce (~30s)', true, `respawn em ${((Date.now() - tr) / 1000).toFixed(0)}s`);
    H.check('renascimento zera dano/DPS', (S.last.pve || {}).dmgTotal === 0, 'pve=' + JSON.stringify(S.last.pve));
  }

  S.close();
  process.exit(H.summary('S3-PVE') ? 1 : 0);
})().catch((e) => { console.error('S3 ERRO:', e); process.exit(2); });
