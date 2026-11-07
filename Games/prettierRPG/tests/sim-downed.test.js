const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}

test('reawaken levanta caído com 30% e respeita exceções', () => {
  const m = sim.createMatch('R', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', B(), 0);
  sim.joinPlayer(m, 'a2', 'A2', B({ weapon: 'holy', q: 'generous-heal', w: 'reawaken', e: 'desperate-prayer' }), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1); sim.joinPlayer(m, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  const v = m.players.get('a1'); v.x = 10; v.y = 10;
  const c = m.players.get('a2'); c.x = 11; c.y = 10; c.energy = 500;
  sim.dealDamage(m, null, 'a1', 9999, m.time, { env: true });
  assert.ok(v.knocked, 'caído');
  const r = sim.useSkill(m, 'a2', 'W', 'a1');
  assert.ok(r.ok, 'reawaken inicia cast: ' + (r.error || 'ok'));
  sim.tick(m, 1100); // cast 1s conclui
  assert.ok(!v.knocked, 'levantou');
  assert.ok(Math.abs(v.hp - v.maxHp * 0.30) < 2, 'reawaken 30% max (hp=' + v.hp + ')');
  // FFA: sem aliado elegível
  const mf = sim.createMatch('F', { mode: 'ffa' });
  sim.joinPlayer(mf, 'p1', 'A', B({ weapon: 'holy', q: 'generous-heal', w: 'reawaken', e: 'desperate-prayer' }));
  sim.joinPlayer(mf, 'p2', 'B', B());
  sim.setReady(mf, 'p1', true); sim.setReady(mf, 'p2', true);
  const rf = sim.useSkill(mf, 'p1', 'W', 'p2');
  assert.equal(rf.ok, false, 'FFA sem alvo válido');
  // PvE: sem alvo válido (boneco não cai)
  const mp = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(mp, 's', 'Solo', B({ weapon: 'holy', q: 'generous-heal', w: 'reawaken', e: 'desperate-prayer' }));
  sim.setReady(mp, 's', true);
  mp.players.get('s').energy = 500;
  const rp = sim.useSkill(mp, 's', 'W', 's');
  assert.equal(rp.ok, false, 'PvE sem caído');
});

test('levantar natural: 15s caído + 5s getup = 100% (sem wave/pve)', () => {
  const m = sim.createMatch('G', { mode: 'ffa' });
  sim.joinPlayer(m, 'p1', 'A', B()); sim.joinPlayer(m, 'p2', 'B', B());
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  const v = m.players.get('p1');
  sim.dealDamage(m, null, 'p1', 9999, m.time, { env: true });
  assert.ok(v.knocked);
  sim.tick(m, 15000);
  assert.ok(v.gettingUpUntil > 0, 'inicia levantar após 15s');
  sim.tick(m, 5100);
  assert.ok(!v.knocked && v.hp === v.maxHp, 'levanta com 100%');
});
