'use strict';
// Cenário 4 — Salas simultâneas isoladas + presença:
// 2 salas FFA isoladas; FFA mínimo 2; desconexão reserva vaga 30s (reconecta com
// segredo; outro nick não toma a vaga); expiração 30s remove; saída voluntária.
const H = require('./h.cjs');

(async () => {
  const RA = new H.Bot('E2E-R1');
  const code1 = await H.createRoom(RA);
  const RB = new H.Bot('E2E-R2');
  const code2 = await H.createRoom(RB);
  H.check('2 salas simultâneas com códigos distintos', code1 !== code2, `${code1} vs ${code2}`);
  H.check('sala1 não vê jogador da sala2', !RA.last.players.some((p) => p.nick === 'E2E-R2'));
  H.check('sala2 não vê jogador da sala1', !RB.last.players.some((p) => p.nick === 'E2E-R1'));

  // FFA mínimo 2: 1 pronto sozinho não inicia
  RA.send({ type: 'ready', ready: true });
  await H.sleep(3000);
  H.check('FFA com 1 pronto não inicia (mínimo 2)', RA.last.state === 'lobby', RA.last.state);
  const RC = new H.Bot('E2E-R3');
  await H.joinRoom(RC, code1);
  RC.send({ type: 'ready', ready: true });
  await RA.waitFor(() => RA.last.state === 'playing', 10000);
  H.check('2º pronto inicia a partida', true, 'state=' + RA.last.state);

  // Desconexão sem sair: vaga reservada (disconnected), reconecta com segredo
  const idC = RC.joined.id, secC = RC.joined.secret;
  RC.ws.close(); // drop seco, sem 'leave'
  await H.sleep(1200);
  const rcGhost = RA.other('E2E-R3');
  H.check('desconectado segue listado (vaga reservada)', !!rcGhost, JSON.stringify(rcGhost && { disconnected: rcGhost.disconnected, alive: rcGhost.alive }));
  H.check('marcado como disconnected', rcGhost && rcGhost.disconnected === true);
  const RC2 = new H.Bot('E2E-R3');
  await RC2.connect();
  RC2.send({ type: 'join', nick: 'E2E-R3', room: code1, build: {}, secret: secC });
  const jr = await RC2.waitFor(() => RC2.joined, 8000);
  H.check('reconectou com mesmo segredo', jr.reconnected === true && jr.id === idC, JSON.stringify({ reconnected: jr.reconnected, sameId: jr.id === idC }));

  // Outro nick não toma a vaga de quem caiu: reserva por nick vale 30s
  RC2.ws.close();
  await H.sleep(800);
  const IN = new H.Bot('E2E-Intruso');
  await IN.connect();
  IN.send({ type: 'join', nick: 'E2E-Intruso', room: code1, build: {} });
  await H.sleep(800);
  H.check('partida em andamento barra nick novo (ninguém toma vaga no jogo)', IN.errors.some((e) => /andamento/.test(e)), JSON.stringify(IN.errors));
  const ST = new H.Bot('E2E-R3'); // mesmo nick do caído, sem segredo
  await ST.connect();
  ST.send({ type: 'join', nick: 'E2E-R3', room: code1, build: {} });
  await H.sleep(800);
  H.check('nick do caído segue reservado (sem segredo não entra)', ST.errors.some((e) => /Apelido já usado/.test(e)), JSON.stringify(ST.errors));
  ST.close();

  // Expiração 30s: o caído (RC2) é removido; partida com minoria encerra
  H.log('aguardando expiração dos 30s do caído…');
  const tE = Date.now();
  await RA.waitFor(() => !RA.last.players.some((p) => p.nick === 'E2E-R3' && !p.left), 45000).catch(() => null);
  const sumiu = !RA.last.players.some((p) => p.nick === 'E2E-R3' && !p.left);
  H.check('caído expira em ~30s e libera a vaga', sumiu, `após ${((Date.now() - tE) / 1000).toFixed(0)}s`);
  IN.close();
  try { RC2.close(); } catch { /* já fechado */ }

  // Sala 2 segue isolada e íntegra após o caos da sala 1
  H.check('sala2 intacta (só E2E-R2)', RB.last.players.filter((p) => !p.left).map((p) => p.nick).join(',') === 'E2E-R2', JSON.stringify(RB.last.players.map((p) => p.nick)));

  RA.send({ type: 'leave' }); RB.send({ type: 'leave' });
  await H.sleep(800);
  RA.close(); RB.close();
  process.exit(H.summary('S4-ISOL') ? 1 : 0);
})().catch((e) => { console.error('S4 ERRO:', e); process.exit(2); });
