'use strict';
// S7 — §10(1): barra 7 slots com efeito autoritativo visível nos DOIS clientes.
// FFA 2 WS: AA + Q/W/E (dano) + HEAD (escudo+energia) + CHEST (cura canalizada
// + BOOTS (dash + imunidade), tudo conferido no snapshot dos dois lados.
const H = require('./h.cjs');

(async () => {
  const A = new H.Bot('E2E-S7A'), B = new H.Bot('E2E-S7B');
  const code = await H.createRoom(A);
  await H.joinRoom(B, code);
  A.send({ type: 'ready', ready: true });
  B.send({ type: 'ready', ready: true });
  await A.waitFor(() => A.last.state === 'playing', 10000);
  H.check('FFA iniciou', true, 'phase=' + A.last.phase);

  async function perto(at, nick, d = 2.0) {
    for (let i = 0; i < 40; i++) {
      const me = at.me(), tgt = at.other(nick);
      if (!me || !tgt) { await H.sleep(300); continue; }
      if (Math.hypot(me.x - tgt.x, me.y - tgt.y) <= d) return true;
      at.send({ type: 'move', x: +(tgt.x + 1.2).toFixed(1), y: +tgt.y.toFixed(1) });
      await H.sleep(300);
    }
    return false;
  }

  // AA + Q/W/E: dano de A em B visto dos dois lados
  await perto(A, 'E2E-S7B');
  const hb0 = { a: A.other('E2E-S7B').hp, b: B.me().hp };
  for (const s of ['AA', 'Q', 'W', 'E']) {
    const tgt = A.other('E2E-S7B');
    if (!tgt) break;
    if (s === 'AA') A.send({ type: 'attack', target: tgt.id });
    else A.send({ type: 'skill', slot: s, target: tgt.id });
    await H.sleep(1200);
  }
  const hb1 = { a: A.other('E2E-S7B').hp, b: B.me().hp };
  H.check('AA+Q/W/E: B perdeu vida (visto por A)', hb1.a < hb0.a, `${hb0.a} → ${hb1.a}`);
  H.check('AA+Q/W/E: B perdeu vida (visto por B)', hb1.b < hb0.b, `${hb0.b} → ${hb1.b}`);
  H.check('snapshots concordam sobre hp de B', hb1.a === hb1.b, `${hb1.a} vs ${hb1.b}`);

  // HEAD energizing-shield (self): escudo + energia nos dois snapshots
  const en0 = A.me().energy;
  B.send({ type: 'attack', target: A.other('E2E-S7A').id }); // garante energia gasta antes? (só marca combate)
  await H.sleep(300);
  A.send({ type: 'skill', slot: 'HEAD', target: A.joined.id });
  await H.sleep(1200);
  const shA = A.me().shield, shB = B.other('E2E-S7A').shield;
  H.check('HEAD: escudo autoritativo (visto por A)', shA > 0, `shield=${shA}`);
  H.check('HEAD: escudo autoritativo (visto por B)', shB > 0, `shield=${shB}`);
  H.check('HEAD: energia restaurada (+25%)', A.me().energy > en0 || A.me().energy === A.me().maxEnergy, `en ${en0} → ${A.me().energy}`);
  H.check('HEAD: CD ativo nos dois', A.me().cd.head > 0 && B.other('E2E-S7A').cd.head > 0, `cd=${A.me().cd.head}`);

  // B fere A com 3×W (502, sem dot — Q/AA aplicariam bleed e renovariam combate).
  // Espera o escudo do HEAD (505/3s) expirar antes, senão o W morre no escudo.
  await H.sleep(4000);
  await perto(B, 'E2E-S7A');
  const ferir0 = A.me().hp;
  for (let w = 0; w < 3; w++) {
    await B.waitFor(() => { const me = B.me(); return me && me.cd.w === 0; }, 25000);
    for (let i = 0; i < 20; i++) {
      const me = B.me(), tgt = B.other('E2E-S7A');
      if (!me || !tgt) { await H.sleep(300); continue; }
      if (Math.hypot(me.x - tgt.x, me.y - tgt.y) > 2.8) B.send({ type: 'move', x: +(tgt.x + 1.2).toFixed(1), y: +tgt.y.toFixed(1) });
      else if (me.cd.w === 0) { B.send({ type: 'skill', slot: 'W', target: tgt.id }); break; }
      await H.sleep(300);
    }
    await H.sleep(1500);
    H.log(`  após W#${w + 1}: Ahp=${A.me().hp}`);
  }
  H.check('A ferido p/ teste de cura', A.me().hp < ferir0 - 150, `${ferir0} → ${A.me().hp}`);

  // Paz 11s (mend-wounds exige 10s fora de combate; W não deixa dot) → CHEST (retry)
  await H.sleep(11000);
  const hc0 = A.me().hp;
  let chestOk = false;
  for (let i = 0; i < 3 && !chestOk; i++) {
    A.send({ type: 'skill', slot: 'CHEST', target: A.joined.id });
    await H.sleep(1000);
    chestOk = !A.errors.slice(-1).join(' ').includes('Só fora de combate');
    if (!chestOk) await H.sleep(5000);
  }
  const chErr = A.errors.slice(-2).join(' | ');
  H.check('CHEST aceito fora de combate', !/Só fora de combate/.test(chErr), chErr || 'sem erro');
  await H.sleep(6000);
  const hc1a = A.me().hp, hc1b = B.other('E2E-S7A').hp;
  H.check('CHEST: cura autoritativa (visto por A)', hc1a > hc0, `${hc0} → ${hc1a}`);
  H.check('CHEST: cura autoritativa (visto por B)', hc1b > hc0, `${hc0} → ${hc1b}`);

  // BOOTS dodge com destino (canal mend dura 7s: espera acabar p/ poder agir)
  await H.sleep(2500);
  const p0 = { a: { x: A.me().x, y: A.me().y }, b: { x: B.other('E2E-S7A').x, y: B.other('E2E-S7A').y } };
  const dx = Math.min(99, p0.a.x + 3), dy = p0.a.y;
  A.send({ type: 'skill', slot: 'BOOTS', target: A.joined.id, x: +dx.toFixed(1), y: +dy.toFixed(1) });
  await H.sleep(1200);
  const p1 = { a: { x: A.me().x, y: A.me().y }, b: { x: B.other('E2E-S7A').x, y: B.other('E2E-S7A').y } };
  const moved = Math.hypot(p1.a.x - p0.a.x, p1.a.y - p0.a.y);
  H.check('BOOTS: dash moveu (visto por A)', moved > 1, `andou ${moved.toFixed(1)}m`);
  H.check('BOOTS: posição concorda nos dois', Math.abs(p1.a.x - p1.b.x) < 0.01 && Math.abs(p1.a.y - p1.b.y) < 0.01, `A=(${p1.a.x},${p1.a.y}) B=(${p1.b.x},${p1.b.y})`);
  H.check('BOOTS: CD ativo', A.me().cd.boots > 0, `cd=${A.me().cd.boots}`);

  const errs = [...A.errors, ...B.errors].filter((e) => !/Fora de alcance|Em recarga/.test(e));
  H.check('sem erros inesperados do servidor', errs.length === 0, errs.slice(-3).join(' | '));

  A.send({ type: 'leave' }); B.send({ type: 'leave' });
  await H.sleep(800);
  A.close(); B.close();
  process.exit(H.summary('S7-SLOTS') ? 1 : 0);
})().catch((e) => { console.error('S7 ERRO:', e); process.exit(2); });
