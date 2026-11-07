// Layer 2: snapshot expõe estágio do E de 2 usos (blood-bandit) e combo searing-flame,
// para a UI sinalizar "2º uso disponível" e expiração.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim.js');

function B(over = {}) {
  return {
    weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
    weaponPassive: 'deep-cuts', offhand: 'torch',
    head: 'mercenary-hood', headActive: 'energizing-shield', headPassive: 'balanced-mind',
    chest: 'mercenary-jacket', chestActive: 'mend-wounds', chestPassive: 'balanced-mind',
    boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'balanced-mind',
    cape: 'cape-caerleon', ...over,
  };
}
function mkE() {
  const m = sim.createMatch('E2', { mode: 'ffa' });
  sim.joinPlayer(m, 'p1', 'Um', B());
  sim.joinPlayer(m, 'p2', 'Dois', B({ weapon: 'dagger', q: 'sunder-armor', w: 'dash', e: 'bloodthirsty-blade' }));
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  p1.x = 10; p1.y = 10; p2.x = 11; p2.y = 10;
  p1.energy = 9999; p2.energy = 9999;
  sim.tick(m, 5000);
  return { m, p1, p2 };
}
const snapP = (m, id) => sim.snapshot(m).players.find((p) => p.id === id);

test('L2: após 1º uso do E, snapshot sinaliza 2º uso disponível com expiração', () => {
  const { m, p1, p2 } = mkE();
  p1.energy = 9999;
  assert.ok(sim.useSkill(m, 'p1', 'E', 'p2').ok, '1º uso do E aplica');
  const s = snapP(m, 'p1');
  assert.ok(s.eCombo && s.eCombo.armed === true, 'eCombo.armed sinaliza 2º uso');
  assert.ok(s.eCombo.msLeft > 8000 && s.eCombo.msLeft <= 9000, `janela ~9s (msLeft=${s.eCombo && s.eCombo.msLeft})`);
  assert.equal(s.eCombo.stacks, p1.eStage.stacks, 'stacks do 1º uso expostos');
});

test('L2: 2º uso consome o sinal; expiração limpa o sinal', () => {
  const { m, p1, p2 } = mkE();
  p1.energy = 9999;
  sim.useSkill(m, 'p1', 'E', 'p2');
  sim.useSkill(m, 'p1', 'E', 'p2');
  assert.equal(snapP(m, 'p1').eCombo, null, 'após 2º uso, sem sinal');
  const t2 = mkE();
  t2.p1.energy = 9999;
  sim.useSkill(t2.m, 'p1', 'E', 'p2');
  sim.tick(t2.m, 9500);
  assert.equal(snapP(t2.m, 'p1').eCombo, null, 'após expirar 9s, sem sinal');
});
