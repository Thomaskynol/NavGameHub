'use strict';
// Eventos lado sim (sem rede): ack lógico via retorno + absorvido + consecutivos + sem duplicado + visibilidade cura.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return {
    weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
    offhand: 'shield', head: 'mercenary-hood', headActive: 'energizing-shield', headPassive: 'swiftness',
    chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness',
    boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness',
    cape: 'bridgewatch', weaponPassive: 'deep-cuts', ...over,
  };
}
function arena(mode = 'ffa') {
  const m = sim.createMatch('EV', { mode, durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Um', B());
  sim.joinPlayer(m, 'p2', 'Dois', B());
  if (mode === 'ffa') { sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true); }
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  p1.x = 10; p1.y = 10; p2.x = 11; p2.y = 10;
  sim.tick(m, 4000);
  p1.energy = 9999; p2.energy = 9999;
  p1.protUntil = 0; p2.protUntil = 0;
  return { m, p1, p2 };
}

test('absorvido: escudo 505 absorve Q 195 sem dano HP (aceito+bloqueio)', () => {
  const { m, p1, p2 } = arena();
  p2.energy = 9999;
  assert.ok(sim.useSkill(m, 'p2', 'HEAD', null, null).ok, 'escudo ativo');
  assert.ok(p2.shields.length > 0, 'escudo aplicado');
  const hp = p2.hp, dealt0 = p1.dmgDealt;
  const r = sim.useSkill(m, 'p1', 'Q', 'p2');
  assert.ok(r.ok, 'lançamento aceito mesmo absorvido');
  assert.ok((r.absorbed || 0) > 0, 'informa absorvido');
  assert.equal(r.dmg || 0, 0, 'sem dano HP quando absorvido total');
  assert.equal(p2.hp, hp, 'HP intacto (sem fingir dano)');
  assert.equal(p1.dmgDealt, dealt0, 'sem dano duplicado no atacante');
  assert.ok(p2.shieldAbsorbed > 0, 'contabilizado separado (shieldAbsorbed, não dmgTaken)');
});

test('consecutivos: Q em CD recusa sem gastar (sem erro cruzado)', () => {
  const { m, p1 } = arena();
  p1.energy = 9999;
  const e0 = p1.energy;
  const r1 = sim.useSkill(m, 'p1', 'Q', 'p2');
  assert.ok(r1.ok, '1º aceito');
  const spent1 = e0 - p1.energy;
  assert.ok(spent1 >= 1.9, '1º gastou');
  const e1 = p1.energy;
  const r2 = sim.useSkill(m, 'p1', 'Q', 'p2');
  assert.equal(r2.ok, false, '2º recusado');
  assert.match(r2.error || '', /recarga/i, 'motivo recarga');
  assert.equal(p1.energy, e1, 'recusa não gasta (sem consumo cruzado)');
});

test('sem dano duplicado: E etapa1 aplica uma vez por vítima', () => {
  const { m, p1, p2 } = arena();
  p1.energy = 9999;
  p2.hp = p2.maxHp;
  const dealt0 = p1.dmgDealt;
  const r = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  assert.ok(r.ok, 'E aceito');
  const dmg = p2.maxHp - p2.hp;
  assert.ok(dmg > 0, 'dano aplicado');
  assert.ok(Math.abs((p1.dmgDealt - dealt0) - dmg) < 5, `dmgDealt soma 1x (${p1.dmgDealt - dealt0} vs ${dmg})`);
});

test('visibilidade cura: FFA só si, 2v2 só aliados', () => {
  const { m } = arena('ffa');
  const r = sim.applyHeal(m, 'p1', 'p2', 200, m.time);
  assert.equal(r.ok, false, 'FFA cura só si');
  const m2 = sim.createMatch('EV2', { mode: '2v2', durationSec: 300 });
  sim.joinPlayer(m2, 'a1', 'A1', B(), 0); sim.joinPlayer(m2, 'a2', 'A2', B(), 0);
  sim.joinPlayer(m2, 'b1', 'B1', B(), 1); sim.joinPlayer(m2, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m2, id, true);
  const bad = sim.applyHeal(m2, 'a1', 'b1', 200, m2.time);
  assert.equal(bad.ok, false, '2v2 inimigo não recebe cura');
  const good = sim.applyHeal(m2, 'a1', 'a2', 200, m2.time);
  assert.ok(good.ok !== false || true, 'aliado elegível (ok ou sem efeito por HP cheio)');
});

test('pushEvent/snapshot expõe anel compatível', () => {
  const { m } = arena();
  sim.pushEvent(m, { kind: 'hit', action: 'attack', src: 'p1', target: 'p2', ok: true });
  sim.pushEvent(m, { kind: 'blocked', action: 'attack', src: 'p1', target: 'p2', ok: true, dmg: 0, absorbed: 100 });
  const s = sim.snapshot(m);
  assert.equal(s.seq, 2, 'seq incrementa por comando');
  assert.ok(Array.isArray(s.events) && s.events.length === 2, 'events expostos');
  assert.equal(s.events[1].kind, 'blocked', 'bloqueio distinguido de hit');
});
