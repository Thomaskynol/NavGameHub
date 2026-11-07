const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

// RED: modos 2v2/PvE ainda não existem na v1 mínima (só FFA).
test('cria partida 2v2 e exige 2 prontos por equipe', () => {
  const m = sim.createMatch('T2', { mode: '2v2' });
  assert.equal(m.mode, '2v2');
  sim.joinPlayer(m, 'a1', 'Ana', undefined, 0);
  sim.joinPlayer(m, 'a2', 'Beto', undefined, 0);
  sim.joinPlayer(m, 'b1', 'Cleo', undefined, 1);
  sim.joinPlayer(m, 'b2', 'Dani', undefined, 1);
  sim.setReady(m, 'a1', true);
  sim.setReady(m, 'a2', true);
  sim.setReady(m, 'b1', true);
  assert.equal(m.state, 'lobby', 'não deve iniciar com 3 prontos');
  sim.setReady(m, 'b2', true);
  assert.equal(m.state, 'playing');
});

test('PvE tem monstro e boneco', () => {
  const m = sim.createMatch('PVE1', { mode: 'pve' });
  assert.equal(m.mode, 'pve');
  sim.joinPlayer(m, 'p1', 'Solo');
  sim.setReady(m, 'p1', true);
  assert.equal(m.state, 'playing');
  assert.ok(m.monster, 'monstro deveria existir');
  assert.ok(m.dummy, 'boneco deveria existir');
});
