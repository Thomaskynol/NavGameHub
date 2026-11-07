// TDD Layer 1 (rodada combate+machado): snapshot expõe conjuração/canal em curso
// para a UI desenhar progresso (arco) em qualquer entidade.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim.js');

function B(over = {}) {
  return Object.assign({
    weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
    weaponPassive: 'deep-cuts', offhand: 'torch',
    head: 'mercenary-hood', headActive: 'energizing-shield', headPassive: 'balanced-mind',
    chest: 'mercenary-jacket', chestActive: 'mend-wounds', chestPassive: 'balanced-mind',
    boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'balanced-mind',
    cape: 'cape-caerleon',
  }, over);
}

function mk2(bover = {}) {
  const m = sim.createMatch('CV', { mode: '2v2' });
  sim.joinPlayer(m, 'p1', 'Ana', B(), 0);
  sim.joinPlayer(m, 'p2', 'Beto', B(bover), 0);
  sim.joinPlayer(m, 'p3', 'Cleo', B(), 1);
  sim.joinPlayer(m, 'p4', 'Dani', B(), 1);
  for (const id of ['p1', 'p2', 'p3', 'p4']) sim.setReady(m, id, true);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2'), p3 = m.players.get('p3');
  p1.x = 10; p1.y = 10; p2.x = 11; p2.y = 10; p3.x = 12; p3.y = 10;
  p1.energy = 9999; p2.energy = 9999;
  sim.tick(m, 5000); // expira proteção
  return m;
}

test('snapshot mostra cast em curso (deadly-chop 400ms)', () => {
  const m = mk2();
  const r = sim.useSkill(m, 'p1', 'W', 'p3');
  assert.ok(r.ok || r.casting, 'chop lança (ok ou casting)');
  const s = sim.snapshot(m).players.find((p) => p.id === 'p1');
  assert.ok(s.cast, 'snapshot expõe cast em curso');
  assert.equal(s.cast.total, 400, 'total do cast = 400ms');
  assert.ok(s.cast.until > m.time, 'until no futuro');
});

test('snapshot mostra channel em curso (holy-beam 3000ms no aliado)', () => {
  const m = mk2({ weapon: 'holy-staff', q: 'generous-heal', w: 'holy-beam', e: 'desperate-prayer', weaponPassive: 'energetic' });
  const r = sim.useSkill(m, 'p2', 'W', 'p1');
  assert.ok(r.ok, 'beam lança');
  const s = sim.snapshot(m).players.find((p) => p.id === 'p2');
  assert.ok(s.chan, 'snapshot expõe channel em curso');
  assert.equal(s.chan.id, 'holy-beam');
  assert.equal(s.chan.total, 3000, 'total do channel = 3000ms');
  assert.ok(s.chan.until > m.time, 'until no futuro');
});
