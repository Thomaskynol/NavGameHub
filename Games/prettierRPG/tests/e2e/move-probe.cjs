'use strict';
// Diagnóstico binário: UM move por vez, log 1s. Sem reenvio.
const H = require('./h.cjs');
(async () => {
  const S = new H.Bot('E2E-Move');
  await H.createRoom(S, 'pve');
  S.send({ type: 'ready', ready: true });
  await S.waitFor(() => S.last.state === 'playing', 10000);
  const me0 = S.me();
  H.log('spawn:', me0.x, me0.y);
  const legs = [[70, 28], [41.2, 40]];
  for (const [tx, ty] of legs) {
    const a = S.me();
    H.log(`-- move único p/ (${tx},${ty}) a partir de (${a.x},${a.y})`);
    S.send({ type: 'move', x: tx, y: ty });
    for (let i = 0; i < 12; i++) {
      await H.sleep(1000);
      const m = S.me();
      H.log(`   t+${i + 1}s pos=(${m.x},${m.y}) hp=${m.hp}`);
      if (Math.hypot(m.x - tx, m.y - ty) < 1) { H.log('   CHEGOU'); break; }
    }
  }
  S.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
