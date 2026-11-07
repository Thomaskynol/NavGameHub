'use strict';
// Capacidade FFA: 12 clientes WS isolados entram, marcam pronto, partida inicia
// com 12; 13º é rejeitado (Sala cheia). Sai tudo e libera o código.
const H = require('./h.cjs');

(async () => {
  const bots = [];
  const first = new H.Bot('E2E-C01');
  const code = await H.createRoom(first);
  bots.push(first);
  for (let i = 2; i <= 12; i++) {
    const b = new H.Bot('E2E-C' + String(i).padStart(2, '0'));
    await H.joinRoom(b, code);
    bots.push(b);
  }
  H.check('12 clientes na mesma sala', first.last.players.length === 12, `${first.last.players.length} jogadores`);
  const full = new H.Bot('E2E-C13');
  await full.connect();
  full.send({ type: 'join', nick: 'E2E-C13', room: code, build: {} });
  await H.sleep(800);
  H.check('13º rejeitado (Sala cheia máx. 12)', full.errors.some((e) => /cheia/.test(e)), JSON.stringify(full.errors));
  full.close();
  for (const b of bots) b.send({ type: 'ready', ready: true });
  await first.waitFor(() => first.last.state === 'playing', 10000);
  H.check('partida inicia com 12', first.last.players.filter((p) => !p.left).length === 12);
  for (const b of bots) { try { b.send({ type: 'leave' }); } catch { /* ignora */ } }
  await H.sleep(1500);
  for (const b of bots) b.close();
  const Z = new H.Bot('E2E-CZ');
  await Z.connect();
  Z.send({ type: 'join', nick: 'E2E-CZ', room: code, build: {} });
  await H.sleep(800);
  H.check('sala de 12 libera o código ao esvaziar', Z.errors.some((e) => /não encontrada/.test(e)), JSON.stringify(Z.errors));
  Z.close();
  process.exit(H.summary('S5-CAP12') ? 1 : 0);
})().catch((e) => { console.error('S5 ERRO:', e); process.exit(2); });
