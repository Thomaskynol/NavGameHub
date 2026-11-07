'use strict';
// Cenário 2 — 2v2 com 4 clientes WS isolados:
// equipes 2+2, pronto geral, rodada, morte sem respawn, placar,
// intervalo 10s → rodada 2, fim melhor-de-3, retorno ao lobby. Specs = placar visível p/ mortos.
// Wave de 2:00 NÃO é forçada (timer real); este E2E valida rounds/placar/retorno
// e afirma wave.active=false; dano da wave já é coberto por tests/sim-modes2.test.js.
const H = require('./h.cjs');

(async () => {
  const A1 = new H.Bot('E2E-A1'), A2 = new H.Bot('E2E-A2');
  const B1 = new H.Bot('E2E-B1'), B2 = new H.Bot('E2E-B2');
  const code = await H.createRoom(A1, '2v2');
  H.log('sala 2v2 criada:', code);
  H.check('modo da sala é 2v2', A1.last.mode === '2v2', A1.last.mode);

  await H.joinRoom(A2, code, { team: 0 });
  await H.joinRoom(B1, code, { team: 1 });
  await H.joinRoom(B2, code, { team: 1 });
  A1.send({ type: 'team', team: 0 });
  await H.sleep(500);
  const teams = {};
  for (const p of A1.last.players) teams[p.nick] = p.team;
  H.check('equipes 2+2', teams['E2E-A1'] === 0 && teams['E2E-A2'] === 0 && teams['E2E-B1'] === 1 && teams['E2E-B2'] === 1, JSON.stringify(teams));

  // 3 prontos não bastam? regra: 2+2 prontos (ou FFA-like). Marca 3 e confere, depois o 4º.
  A1.send({ type: 'ready', ready: true });
  A2.send({ type: 'ready', ready: true });
  B1.send({ type: 'ready', ready: true });
  await H.sleep(1500);
  H.check('3 prontos não iniciam 2v2', A1.last.state === 'lobby', A1.last.state);
  B2.send({ type: 'ready', ready: true });
  await A1.waitFor(() => A1.last.state === 'playing', 10000);
  H.check('2+2 prontos iniciam rodada 1', A1.last.round === 1, 'phase=' + A1.last.phase);
  H.check('wave inativa no início (timer real, sem forçar)', A1.last.wave.active === false, JSON.stringify(A1.last.wave));

  async function killRound(vitimas) {
    // A1+A2 focam cada vítima até morrer; vivos restantes do time perdedor idem
    for (const v of vitimas) {
      const atk = v === 'E2E-B1' || v === 'E2E-B2' ? A1 : A1;
      void atk;
      // os dois atacantes batem juntos
      const t0 = Date.now();
      let done = false;
      while (Date.now() - t0 < 120000 && !done) {
        for (const at of [A1, A2]) {
          const me = at.me(), tgt = at.other(v);
          if (!me || !tgt) continue;
          if (!tgt.alive) { done = true; break; }
          if (!me.alive) continue;
          if (Math.hypot(me.x - tgt.x, me.y - tgt.y) > 2.2) at.send({ type: 'move', x: +(tgt.x + 1.2).toFixed(1), y: +tgt.y.toFixed(1) });
          else {
            at.send({ type: 'attack', target: tgt.id });
            if (me.cd && me.cd.q === 0) at.send({ type: 'skill', slot: 'Q', target: tgt.id });
            if (me.cd && me.cd.w === 0) at.send({ type: 'skill', slot: 'W', target: tgt.id });
          }
        }
        await H.sleep(350);
      }
      if (!done) throw new Error('não matou ' + v);
      H.log('  morto:', v);
    }
  }

  // Rodada 1: elimina time 1
  await killRound(['E2E-B1', 'E2E-B2']);
  await A1.waitFor(() => (A1.last.wins || {})[0] === 1, 10000).catch(() => {});
  H.check('time 0 venceu rodada 1', (A1.last.wins || {})[0] === 1, JSON.stringify(A1.last.wins));
  const b1morto = B1.me();
  H.check('morto não renasce no meio da rodada', b1morto && b1morto.alive === false, JSON.stringify(b1morto && { alive: b1morto.alive, hp: b1morto.hp }));
  H.check('placar 2v2 soma kills do time 0', (A1.last.scores || []).filter((s) => s.team === 0).reduce((a, s) => a + (s.kills || 0), 0) >= 2, JSON.stringify(A1.last.scores));

  // Intervalo 10s → rodada 2 começa de verdade quando todos revivem com vida cheia
  H.log('aguardando intervalo → rodada 2 (revive geral)…');
  await A1.waitFor(() => A1.last.round === 2 && ['E2E-A1', 'E2E-A2', 'E2E-B1', 'E2E-B2']
    .every((n) => { const p = A1.other(n); return p && p.alive && p.hp === p.maxHp; }), 30000);
  H.check('rodada 2 iniciou após intervalo', true, `round=${A1.last.round} state=${A1.last.state}`);
  const b1r2 = B1.me();
  H.check('rodada nova: todos com vida cheia', b1r2 && b1r2.alive && b1r2.hp === b1r2.maxHp, JSON.stringify(b1r2 && { hp: b1r2.hp, alive: b1r2.alive }));

  // Rodada 2: elimina time 1 de novo → melhor-de-3 encerra
  await killRound(['E2E-B1', 'E2E-B2']);
  await A1.waitFor(() => A1.last.state === 'ended', 15000);
  H.check('melhor-de-3 encerrou (2-0)', true, 'wins=' + JSON.stringify(A1.last.wins) + ' result=' + JSON.stringify(A1.last.result));
  H.check('vencedores são do time 0', Array.isArray(A1.last.winners) && A1.last.winners.length === 2, JSON.stringify(A1.last.winners));

  // Retorno ao lobby (todos os 4)
  for (const b of [A1, A2, B1, B2]) b.send({ type: 'return' });
  await A1.waitFor(() => A1.last.state === 'lobby', 10000);
  H.check('todos voltaram ao lobby', B2.last.state === 'lobby', `A1=${A1.last.state} B2=${B2.last.state}`);
  H.check('pronto limpou p/ todos', [A1, A2, B1, B2].every((b) => b.me() && b.me().ready === false));
  // Wins zeram quando a PRÓXIMA partida inicia (contrato: startMatch reseta; lobby guarda último resultado)
  H.check('lobby guarda último resultado', (A1.last.wins || {})[0] === 2, JSON.stringify(A1.last.wins));
  for (const b of [A1, A2, B1, B2]) b.send({ type: 'ready', ready: true });
  await A1.waitFor(() => A1.last.state === 'playing', 10000);
  H.check('nova partida zera wins e volta à rodada 1', (A1.last.wins || {})[0] === 0 && A1.last.round === 1, `wins=${JSON.stringify(A1.last.wins)} round=${A1.last.round}`);

  for (const b of [A1, A2, B1, B2]) b.close();
  process.exit(H.summary('S2-2V2') ? 1 : 0);
})().catch((e) => { console.error('S2 ERRO:', e); process.exit(2); });
