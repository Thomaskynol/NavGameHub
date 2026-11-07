// Regen natural em combate: HP zero em combate, normal fora (BARRAGEM §4 + PRODUTO §14).
// Energia/curas/HoTs separados; flats de item só fora de combate.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}
function started(b1 = {}, b2 = {}, mode = 'ffa') {
  const m = sim.createMatch('RG', { mode, durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', B(b1));
  sim.joinPlayer(m, 'p2', 'Beto', B(b2));
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  p1.x = 10; p1.y = 10; p2.x = 11; p2.y = 10; // perto: dealDamage sem bloqueio
  p1.energy = p1.maxEnergy; p2.energy = p2.maxEnergy;
  p1.protUntil = 0; p2.protUntil = 0;
  p1.lastCombat = -1e12; p2.lastCombat = -1e12;
  return m;
}

test('HP<max em combate não sobe por regen', () => {
  const m = started();
  const p = m.players.get('p1');
  p.hp = p.maxHp - 500;
  p.lastCombat = m.time; // em combate
  const before = p.hp;
  sim.tick(m, 3000);
  assert.equal(p.hp, before, `regen em combate deveria ser zero (${before} -> ${p.hp})`);
});

test('cura por skill funciona em combate (distingue regen vs cura)', () => {
  const m = started({ weapon: 'holy', q: 'generous-heal', w: 'sacred-pulse', e: 'desperate-prayer' });
  const p = m.players.get('p1');
  p.energy = 9999;
  p.hp = p.maxHp - 500;
  p.lastCombat = m.time; // em combate
  const before = p.hp;
  const r = sim.useSkill(m, 'p1', 'Q', 'p1');
  assert.ok(r.ok || r.casting, 'generous-heal lança em combate: ' + (r.error || ''));
  sim.tick(m, 600); // conclui cast 500ms
  assert.ok(p.hp > before, `cura em combate funciona (${before} -> ${p.hp})`);
});

test('fora de combate regenera HP (1% + flats)', () => {
  const m = started();
  const p = m.players.get('p1');
  p.hp = p.maxHp - 500;
  p.lastCombat = -1e12; // fora há muito tempo
  const before = p.hp;
  sim.tick(m, 1000);
  const expect = p.maxHp * 0.01 + 2.7 + 5.4 + 2.7; // base + capuz + peito + botas
  assert.ok(p.hp > before, 'fora de combate regenera');
  assert.ok(Math.abs((p.hp - before) - expect) < 1.5, `regen fora ~1%+flats (${p.hp - before} vs ${expect})`);
});

test('applyHeal em combate cura enquanto regen sozinha é zero', () => {
  const m = started();
  const p = m.players.get('p1');
  p.hp = p.maxHp - 500;
  p.lastCombat = m.time;
  const before = p.hp;
  sim.tick(m, 1000);
  assert.equal(p.hp, before, 'regen pura em combate é zero');
  const r = sim.applyHeal(m, 'p1', 'p1', 200, m.time);
  assert.ok(r.ok, 'applyHeal funciona em combate');
  assert.ok(p.hp > before, 'cura direta soma em combate');
});

test('flats de item (HP e EN) só fora de combate', () => {
  const gear = { head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', offhand: 'tome' };
  const m = started(gear);
  const p = m.players.get('p1');
  // Em combate: HP zero, EN só 0,5% sem flats.
  p.hp = p.maxHp - 500; p.energy = p.maxEnergy * 0.5;
  p.lastCombat = m.time;
  const h0 = p.hp, e0 = p.energy;
  sim.tick(m, 1000);
  assert.equal(p.hp, h0, `flat HP zerado em combate (${h0} -> ${p.hp})`);
  const enExpectCombat = p.maxEnergy * 0.005;
  assert.ok(Math.abs((p.energy - e0) - enExpectCombat) < 1.0, `EN combate só 0,5% sem flats (${p.energy - e0} vs ${enExpectCombat})`);
  // Fora: flats voltam.
  p.hp = p.maxHp - 500;
  p.lastCombat = -1e12;
  const h1 = p.hp;
  sim.tick(m, 1000);
  const hpExpect = p.maxHp * 0.01 + 2.7 + 5.4 + 2.7;
  assert.ok(Math.abs((p.hp - h1) - hpExpect) < 1.5, `flat HP fora (${p.hp - h1} vs ${hpExpect})`);
});

test('entra em combate no dano e sai após 10s sem dano (incl. DoT)', () => {
  const m = started();
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  p2.hp = p2.maxHp;
  const r = sim.dealDamage(m, 'p1', 'p2', 100, m.time);
  assert.ok(r.ok, 'dano aplica');
  assert.equal(p2.lastCombat, m.time, 'vítima entra em combate');
  assert.equal(p1.lastCombat, m.time, 'atacante entra em combate');
  // DoT renova combate: bleed tick mantém lastCombat.
  p2.hp = p2.maxHp - 500;
  p2.bleeds = [{ until: m.time + 6000, perSec: 10, from: 'p1' }];
  sim.tick(m, 1000);
  assert.ok(m.time - p2.lastCombat < sim.COMBAT_MS, 'DoT renova combate');
  assert.equal(p2.hp, p2.maxHp - 500 - 10, 'DoT causa dano no tick');
  // Sem dano por 10s: sai e regen volta.
  p2.bleeds = [];
  p2.lastCombat = m.time;
  p2.hp = p2.maxHp - 500;
  sim.tick(m, 10001);
  assert.ok(m.time - p2.lastCombat >= sim.COMBAT_MS, 'saiu de combate após 10s');
  assert.ok(p2.hp > p2.maxHp - 500, 'regen retoma fora de combate');
});
