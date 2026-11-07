'use strict';
// Diagnóstico drift heal: 1 único Q no __dummy__, amostra healTotal a cada 300ms.
// H1 (loop do teste enviou 2×): 0→227 estável. H2 (dupla aplicação servidor): 0→227→454.
const H = require('./h.cjs');
(async () => {
  const S = new H.Bot('E2E-Drift');
  await H.createRoom(S, 'pve');
  const B = { weapon: 'holy', weaponPassive: 'energetic', q: 'generous-heal', w: 'sacred-pulse', e: 'desperate-prayer', chest: 'mercenary-jacket', chestActive: 'mend-wounds', chestPassive: 'balanced-mind', boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'balanced-mind' };
  S.send({ type: 'build', build: B });
  await H.sleep(500);
  S.send({ type: 'ready', ready: true });
  await S.waitFor(() => S.last.state === 'playing', 10000);
  // aproxima com desvio lateral (mesma lógica s3)
  const t0 = Date.now();
  let lastD = 1e9, lastT = Date.now(), side = 1, n = 0;
  while (Date.now() - t0 < 60000) {
    const me = S.me();
    if (!me || !S.last.dummy) { await H.sleep(300); continue; }
    if (!me.alive) { await H.sleep(3500); continue; }
    const dd = Math.hypot(me.x - S.last.dummy.x, me.y - S.last.dummy.y);
    if (dd <= 11) break;
    if (dd < lastD - 0.5) { lastD = dd; lastT = Date.now(); }
    let act;
    if (me.y > 42 && me.y < 58 && me.x > 44) {
      S.send({ type: 'move', x: +me.x.toFixed(1), y: me.y < 50 ? 28 : 72 }); act = 'BAND';
    } else if (me.x > 58 && me.y > 42) {
      S.send({ type: 'move', x: 70, y: 28 }); act = 'CORR';
    } else if (Date.now() - lastT > 3000) {
      side = -side; lastT = Date.now();
      const dx = S.last.dummy.x - me.x, dy = S.last.dummy.y - me.y, L = Math.hypot(dx, dy) || 1;
      const wx = +(me.x + (-dy / L) * 8 * side).toFixed(1), wy = +(me.y + (dx / L) * 8 * side).toFixed(1);
      S.send({ type: 'move', x: wx, y: wy }); act = `DET(${wx},${wy})`;
    } else {
      const wx = +(S.last.dummy.x + 1.2).toFixed(1);
      S.send({ type: 'move', x: wx, y: +S.last.dummy.y.toFixed(1) }); act = 'DIR';
    }
    if (n++ % 6 === 0) H.log(`pos=(${me.x},${me.y}) dd=${dd.toFixed(1)} hp=${me.hp} act=${act} merr=${JSON.stringify(S.errors.slice(-1))}`);
    await H.sleep(350);
  }
  const me = S.me();
  H.log('dist dummy:', Math.hypot(me.x - S.last.dummy.x, me.y - S.last.dummy.y).toFixed(1) + 'm');
  S.errors.length = 0;
  S.send({ type: 'skill', slot: 'Q', target: '__dummy__' }); // UM envio
  for (let i = 0; i < 14; i++) {
    await H.sleep(300);
    H.log(`t+${((i + 1) * 0.3).toFixed(1)}s healTotal=${(S.last.pve || {}).healTotal} dummy=${Math.round(S.last.dummy.hp)} errs=${JSON.stringify(S.errors.slice(-1))}`);
  }
  S.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
