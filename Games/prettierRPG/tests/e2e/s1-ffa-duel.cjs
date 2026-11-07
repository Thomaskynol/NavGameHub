'use strict';
// Cenário 1 — Duelo FFA com 2 clientes WS isolados:
// criar/entrar, apelidos, builds, pronto, auto-início, mover (para em obstáculo),
// AA + skill, dano nos dois, morte/respawn, placar, fim, retorno ao lobby.
// Não edita server/lib/public. Log em stdout (+ redirecionar p/ /tmp/opencode).
const H = require('./h.cjs');

(async () => {
  const A = new H.Bot('E2E-Ares');
  const code = await H.createRoom(A);
  H.log('sala criada:', code);
  H.check('código de 4 letras', /^[A-Z2-9]{4}$/.test(code), code);

  // Apelido duplicado rejeitado
  const Dup = new H.Bot('E2E-Ares');
  await Dup.connect();
  Dup.send({ type: 'join', nick: 'E2E-Ares', room: code, build: {} });
  await H.sleep(800);
  H.check('nick duplicado rejeitado', Dup.errors.some((e) => /Apelido já usado/.test(e)), JSON.stringify(Dup.errors));
  Dup.close();

  // Build inválida rejeitada
  const Bad = new H.Bot('E2E-Bad');
  await Bad.connect();
  Bad.send({ type: 'join', nick: 'E2E-Bad', room: code, build: { weapon: 'espada-laser' } });
  await H.sleep(800);
  H.check('build inválida rejeitada', Bad.errors.some((e) => /Build inválida/.test(e)), JSON.stringify(Bad.errors));
  Bad.close();

  // B entra com build montada (machado padrão) e apelido próprio
  const B = new H.Bot('E2E-Bia');
  const j = await H.joinRoom(B, code);
  H.check('B entrou na mesma sala', j.code === code, j.code);
  H.check('ids distintos', A.joined.id !== B.joined.id);

  // Pronto: auto-início com mínimo 2
  A.send({ type: 'ready', ready: true });
  await H.sleep(400);
  H.check('1 pronto não inicia', A.last.state === 'lobby', A.last.state);
  B.send({ type: 'ready', ready: true });
  await A.waitFor(() => A.last.state === 'playing', 10000);
  H.check('auto-início FFA com 2 prontos', true, 'phase=' + A.last.phase);

  // Mover: A clica no chão do lado oposto (reta atravessa a torre central) e deve parar fora
  const a0 = A.me();
  const tx = 100 - a0.x, ty = 100 - a0.y; // espelhado: reta passa pela torre 44..56
  H.log(`A sai de (${a0.x},${a0.y}) rumo a (${tx},${ty}) — reta cruza a torre`);
  A.send({ type: 'move', x: +tx.toFixed(1), y: +ty.toFixed(1) });
  await H.sleep(15000);
  const a1 = A.me();
  const andou = Math.hypot(a1.x - a0.x, a1.y - a0.y);
  const falta = Math.hypot(a1.x - tx, a1.y - ty);
  H.check('A moveu-se (clique no chão)', andou > 2, `andou ${andou.toFixed(1)}m até (${a1.x},${a1.y})`);
  H.check('A parou fora do obstáculo', !H.insideObs(a1.x, a1.y), `(${a1.x},${a1.y})`);
  H.check('A foi bloqueado por obstáculo (não chegou)', falta > 2, `faltam ${falta.toFixed(1)}m`);

  // B aproxima de A (posições frescas) e bate: dano observável em A
  async function approach(att, nick) {
    for (let i = 0; i < 40; i++) {
      const me = att.me(), tgt = att.other(nick);
      if (!me || !tgt) { await H.sleep(300); continue; }
      if (Math.hypot(me.x - tgt.x, me.y - tgt.y) < 2.2) return true;
      att.send({ type: 'move', x: +(tgt.x + 1.2).toFixed(1), y: +tgt.y.toFixed(1) });
      await H.sleep(300);
    }
    return false;
  }
  const hpA0 = A.me().hp;
  await approach(B, 'E2E-Ares');
  for (let i = 0; i < 6; i++) {
    const tgt = B.other('E2E-Ares'), me = B.me();
    if (tgt && me && Math.hypot(me.x - tgt.x, me.y - tgt.y) <= 3.2) B.send({ type: 'attack', target: tgt.id });
    await H.sleep(500);
  }
  const hpA1 = A.me().hp;
  H.check('AA de B causou dano em A', hpA1 < hpA0, `${hpA0} → ${hpA1}`);

  // Q funcional de A em B (aproxima com posições frescas)
  const hpB0 = B.me().hp;
  await approach(A, 'E2E-Bia');
  const tgtB = A.other('E2E-Bia');
  if (tgtB) A.send({ type: 'skill', slot: 'Q', target: tgtB.id });
  await H.sleep(2500);
  const hpB1 = B.me().hp;
  H.check('skill Q causou dano em B', hpB1 < hpB0, `${hpB0} → ${hpB1}`);

  // Duelo até a morte (A foca B)
  H.log('duelo até a morte: A foca B…');
  const morreu = await H.beatOn(A, 'E2E-Bia', 120000);
  H.check('B morreu', morreu);
  await H.sleep(600);
  const placar = A.last.scores || [];
  const ka = (placar.find((s) => s.nick === 'E2E-Ares' || s.name === 'E2E-Ares') || {});
  H.check('placar credita kill p/ A', (ka.kills || 0) >= 1, JSON.stringify(placar));
  const bDead = B.me();
  H.check('B consta morto/sem vida', bDead && (bDead.alive === false || bDead.hp <= 0), JSON.stringify(bDead && { hp: bDead.hp, alive: bDead.alive }));

  // Respawn ~5s com proteção
  const tR = Date.now();
  await B.waitFor(() => { const m = B.me(); return m && m.alive && m.hp === m.maxHp; }, 15000);
  const dtR = ((Date.now() - tR) / 1000).toFixed(1);
  H.check('B renasceu com vida cheia (~5s)', true, `respawn em ${dtR}s`);
  H.check('B renasceu protegido (3s)', B.me().prot === true, JSON.stringify({ prot: B.me().prot }));

  // Fim antecipado: A sai voluntariamente → B sozinho → partida encerra → resultado
  A.send({ type: 'leave' });
  await A.waitFor(() => A.leftMsg, 5000).catch(() => {});
  H.check('A saiu voluntariamente (left)', A.leftMsg === true);
  await B.waitFor(() => B.last.state === 'ended', 15000);
  H.check('partida encerrou após saída (fim antecipado)', true, 'result=' + JSON.stringify(B.last.result));
  H.check('placar final presente', Array.isArray(B.last.scores) && B.last.scores.length >= 1, JSON.stringify(B.last.scores));

  // Retorno ao lobby
  B.send({ type: 'return' });
  await B.waitFor(() => B.last.state === 'lobby', 10000);
  const bLob = B.me();
  H.check('B voltou ao lobby', true, 'state=' + B.last.state);
  H.check('pronto limpou no retorno', bLob && bLob.ready === false, JSON.stringify(bLob && { ready: bLob.ready }));

  // Sala libera quando vazia: B sai → código inválido
  B.send({ type: 'leave' });
  await H.sleep(1000);
  const Z = new H.Bot('E2E-Zed');
  await Z.connect();
  Z.send({ type: 'join', nick: 'E2E-Zed', room: code, build: {} });
  await H.sleep(800);
  H.check('sala vazia libera o código', Z.errors.some((e) => /não encontrada/.test(e)), JSON.stringify(Z.errors));
  Z.close();

  A.close(); B.close();
  process.exit(H.summary('S1-FFA') ? 1 : 0);
})().catch((e) => { console.error('S1 ERRO:', e); process.exit(2); });
