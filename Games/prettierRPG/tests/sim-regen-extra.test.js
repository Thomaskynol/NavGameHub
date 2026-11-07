'use strict';
// Regen extra: DoT/dots/wave/Bloodthirsty/Mend/treino + Wanderlust faixa + flats base.
// Confirma BARRAGEM §4 (HP 0% combate) vs APROX (flats base, pct pendente).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}
function started(b1 = {}, b2 = {}, mode = 'ffa') {
  const m = sim.createMatch('RGX', { mode, durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', B(b1));
  sim.joinPlayer(m, 'p2', 'Beto', B(b2));
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  p1.x = 10; p1.y = 10; p2.x = 11; p2.y = 10;
  p1.energy = p1.maxEnergy; p2.energy = p2.maxEnergy;
  p1.protUntil = 0; p2.protUntil = 0;
  p1.lastCombat = -1e12; p2.lastCombat = -1e12;
  return { m, p1, p2 };
}

test('dots genéricos (burn) renovam combate e causam dano', () => {
  const { m, p2 } = started();
  p2.hp = p2.maxHp - 500;
  p2.dots = [{ id: 'burn', until: m.time + 4000, tickEvery: 1000, next: m.time + 1000, perTick: 20, from: 'p1', type: 'magic' }];
  const before = p2.hp;
  sim.tick(m, 1100);
  assert.ok(p2.hp < before, 'dot causa dano');
  assert.ok(m.time - p2.lastCombat < sim.COMBAT_MS, 'dot renova combate');
  // regen pura continua zero em combate mesmo com dot
  p2.hp = p2.maxHp - 500; p2.dots = [];
  p2.lastCombat = m.time;
  const h0 = p2.hp;
  sim.tick(m, 1000);
  assert.equal(p2.hp, h0, 'sem dot, regen combate zero');
});

test('wave 2v2 mantém em combate e regen HP zero fora da área', () => {
  const m = sim.createMatch('WV', { mode: '2v2', durationSec: 300 });
  const Bj = B();
  sim.joinPlayer(m, 'a1', 'A1', Bj, 0); sim.joinPlayer(m, 'a2', 'A2', Bj, 0);
  sim.joinPlayer(m, 'b1', 'B1', Bj, 1); sim.joinPlayer(m, 'b2', 'B2', Bj, 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  const p = m.players.get('a1');
  // força wave ativa: tempo de rodada >2:00
  m.roundStartAt = m.time - 130000;
  p.x = 90; p.y = 90; // fora do círculo (centro 50,50 r~0 após 2:00+)
  p.hp = p.maxHp - 100; p.lastCombat = -1e12;
  const before = p.hp;
  sim.tick(m, 1000);
  assert.ok(p.hp < before, 'wave causa dano fora da área');
  assert.ok(m.time - p.lastCombat < sim.COMBAT_MS, 'wave mantém em combate');
  assert.ok(p.waveSec > 0, 'contador wave incrementa');
});

test('Bloodthirsty auto-dano mantém em combate (sem regen HP)', () => {
  const { m, p1 } = started({ weapon: 'dagger', q: 'sunder-armor', w: 'forbidden-stab', e: 'bloodthirsty-blade' });
  p1.energy = 9999;
  const r = sim.useSkill(m, 'p1', 'E', null, null);
  assert.ok(r.ok, 'liga bloodthirsty: ' + (r.error || ''));
  p1.hp = p1.maxHp - 100;
  p1.lastCombat = -1e12;
  // tick 1s: auto-dano 2,5% max + sem regen (lastCombat renovado)
  const before = p1.hp;
  sim.tick(m, 1100);
  assert.ok(p1.hp < before, 'auto-dano 2,5% supera regen (que é zero em combate)');
  assert.ok(m.time - p1.lastCombat < sim.COMBAT_MS, 'auto-dano renova combate');
});

test('Mend cura fora de combate e cancela ao entrar em combate', () => {
  const { m, p1 } = started({ chest: 'mercenary-jacket', chestActive: 'mend-wounds' });
  p1.lastCombat = -1e12;
  p1.hp = p1.maxHp - 800;
  p1.energy = 9999;
  const r = sim.useSkill(m, 'p1', 'CHEST', null, null);
  assert.ok(r.ok, 'mend lança fora de combate: ' + (r.error || ''));
  const before = p1.hp;
  sim.tick(m, 1100);
  assert.ok(p1.hp > before, 'mend pulsa 9% fora de combate');
  // dano cancela o canal (no próximo pulso)
  sim.dealDamage(m, 'p2', 'p1', 100, m.time);
  sim.tick(m, 1100);
  assert.equal(p1.channel, null, 'dano recebido cancela mend');
  // dentro de combate, lançar falha sem gastar canal
  p1.lastCombat = m.time;
  p1.energy = 9999;
  const r2 = sim.useSkill(m, 'p1', 'CHEST', null, null);
  assert.equal(r2.ok, false, 'mend em combate recusa');
  assert.match(r2.error || '', /combate/i);
});

test('Wanderlust usa faixa (não ===) e não limpa outro bônus 0.80', () => {
  const { m, p1 } = started({ boots: 'soldier-boots', bootsActive: 'wanderlust' });
  p1.lastCombat = -1e12;
  p1.energy = 9999;
  const r = sim.useSkill(m, 'p1', 'BOOTS', null, null);
  assert.ok(r.ok, 'wanderlust lança: ' + (r.error || ''));
  // float imperfeito: simula 0.8 como 0.8000000001
  p1.moveBonus = 0.8000000001;
  // entrar em combate cancela mesmo com float
  sim.dealDamage(m, 'p2', 'p1', 10, m.time);
  sim.tick(m, 100);
  assert.ok(!(p1.wanderlustUntil > m.time), 'cancela em combate com float');
  assert.equal(p1.moveBonus, 0, 'limpa bônus próprio (faixa)');
  // outro bônus 0.80 com janela distinta (rejuvenating 5s) não é limpo pelo cancelamento wanderlust
  const s2 = started({ boots: 'soldier-boots', bootsActive: 'rejuvenating-sprint' });
  const q = s2.p1;
  q.energy = 9999; q.lastCombat = -1e12;
  sim.useSkill(s2.m, 'p1', 'BOOTS', null, null);
  assert.equal(q.moveBonus, 0.80, 'rejuvenating dá 0.80');
  const wUntil = q.wanderlustUntil || 0;
  assert.equal(wUntil, 0, 'rejuvenating não arma wanderlustUntil');
  // força wanderlustUntil ativo mas com janela distinta: não deve limpar rejuvenating
  q.wanderlustUntil = s2.m.time + 8000;
  q.moveBonusUntil = s2.m.time + 5000; // janela rejuvenating, não wanderlust
  q.lastCombat = s2.m.time;
  sim.tick(s2.m, 100);
  assert.equal(q.moveBonus, 0.80, 'não limpa bônus de outra fonte com janela distinta');
});

test('treino PvE regen segue mesma regra (HP zero combate, volta fora)', () => {
  const m = sim.createMatch('RGPVE', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', B({ weapon: 'holy', q: 'generous-heal', w: 'sacred-pulse', e: 'desperate-prayer' }));
  sim.setReady(m, 'p1', true);
  const p1 = m.players.get('p1');
  p1.protUntil = 0; p1.lastCombat = -1e12;
  p1.hp = p1.maxHp - 500;
  p1.lastCombat = m.time;
  const h0 = p1.hp;
  sim.tick(m, 1000);
  assert.equal(p1.hp, h0, 'treino: regen combate zero (lado sim)');
  p1.lastCombat = -1e12;
  sim.tick(m, 1000);
  assert.ok(p1.hp > h0, 'treino: fora de combate regenera');
});

test('flats base aplicados sem pct (APROX documentada)', () => {
  const { m, p1 } = started();
  p1.lastCombat = -1e12;
  p1.hp = p1.maxHp - 500;
  const before = p1.hp;
  sim.tick(m, 1000);
  const baseFlats = 2.7 + 5.4 + 2.7;
  const expectBase = p1.maxHp * 0.01 + baseFlats;
  const got = p1.hp - before;
  assert.ok(Math.abs(got - expectBase) < 1.5, `flats base sem pct (${got} vs ${expectBase})`);
  // pct +150% da jaqueta NÃO aplicado (pendente): se aplicado, seria ~2x maior
  const withPct = p1.maxHp * 0.01 + (2.7 + 5.4) * 2.5 + 2.7;
  assert.ok(Math.abs(got - withPct) > 5, 'pct +150% pendente, não aplicado (sem inventar stacking)');
});
