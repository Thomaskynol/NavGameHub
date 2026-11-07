const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}
function started(extra = {}) {
  const m = sim.createMatch('T', { durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', B(extra.b1 || {}));
  sim.joinPlayer(m, 'p2', 'Beto', B(extra.b2 || {}));
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  m.players.get('p1').energy = 500; m.players.get('p2').energy = 500;
  return m;
}

test('armaduras ativas têm efeito real', () => {
  const cases = [
    [{ head: 'mercenary-hood', hSkill: 'energizing-shield' }, 'HEAD'],
    [{ head: 'mercenary-hood', hSkill: 'cleanse' }, 'HEAD'],
    [{ head: 'mercenary-hood', hSkill: 'howl' }, 'HEAD'],
    [{ chest: 'mercenary-jacket', cSkill: 'inferno-shield' }, 'CHEST'],
    [{ chest: 'mercenary-jacket', cSkill: 'bloodlust' }, 'CHEST'],
    [{ head: 'soldier-helmet', hSkill: 'stone-skin' }, 'HEAD'],
    [{ head: 'soldier-helmet', hSkill: 'block' }, 'HEAD'],
    [{ chest: 'soldier-armor', cSkill: 'taunt' }, 'CHEST'],
    [{ chest: 'soldier-armor', cSkill: 'fury' }, 'CHEST'],
    [{ boots: 'soldier-boots', bSkill: 'rejuvenating-sprint' }, 'BOOTS'],
    [{ boots: 'soldier-boots', bSkill: 'wanderlust' }, 'BOOTS'],
    [{ head: 'scholar-cowl', hSkill: 'force-field' }, 'HEAD'],
    [{ head: 'scholar-cowl', hSkill: 'aegis-of-energy' }, 'HEAD'],
    [{ chest: 'scholar-robe', cSkill: 'frost-shield' }, 'CHEST'],
    [{ chest: 'scholar-robe', cSkill: 'speed-caster' }, 'CHEST'],
    [{ boots: 'scholar-sandals', bSkill: 'energetic-sprint' }, 'BOOTS'],
    [{ boots: 'scholar-sandals', bSkill: 'focused-run' }, 'BOOTS'],
    [{ boots: 'mercenary-shoes', bSkill: 'refreshing-sprint' }, 'BOOTS'],
    [{ boots: 'mercenary-shoes', bSkill: 'break-free' }, 'BOOTS'],
  ];
  for (const [over, slot] of cases) {
    const m = started({ b1: over });
    const r = sim.useSkill(m, 'p1', slot, 'p2', { x: 14, y: 10 });
    assert.ok(r.ok, JSON.stringify(over) + ' deveria funcionar: ' + (r.error || ''));
  }
});

test('mend-wounds só fora de combate e dodge dá i-frames', () => {
  const m = started({ b1: { chest: 'scholar-robe', cSkill: 'mend-wounds' } });
  const p1 = m.players.get('p1');
  p1.hp = p1.maxHp - 500;
  p1.lastCombat = m.time; // em combate
  const r1 = sim.useSkill(m, 'p1', 'CHEST', null);
  assert.equal(r1.ok, false, 'mend em combate rejeita');
  p1.lastCombat = -1e12;
  const r2 = sim.useSkill(m, 'p1', 'CHEST', null);
  assert.ok(r2.ok, 'mend fora de combate');
  assert.ok(p1.channel && p1.channel.id === 'mend');
  // dodge
  const m2 = started({ b1: { boots: 'mercenary-shoes', bSkill: 'dodge' } });
  const r3 = sim.useSkill(m2, 'p1', 'BOOTS', null, { x: 14, y: 10 });
  assert.ok(r3.ok);
  assert.ok(m2.players.get('p1').immuneDmgUntil > m2.time);
});

test('capas automáticas: bridgewatch/caerleon/lymhurst/martlock/thetford/fort-sterling', () => {
  // Bridgewatch: E ativa aura
  let m = started({ b1: { cape: 'bridgewatch' } });
  m.players.get('p1').energy = 500;
  sim.useSkill(m, 'p1', 'E', 'p2');
  assert.ok(m.players.get('p1').capeBridgeUntil > m.time, 'bridgewatch aura');
  // Caerleon: Q reseta CD do Q
  m = started({ b1: { cape: 'caerleon' } });
  m.players.get('p1').energy = 500;
  sim.useSkill(m, 'p1', 'Q', 'p2');
  assert.equal(m.players.get('p1').cd.q, 0, 'caerleon reseta Q');
  // Lymhurst: cast abaixo de 40% recupera 70% da energia máxima em 10 ticks de 7%.
  m = started({ b1: { cape: 'lymhurst' } });
  const lp = m.players.get('p1'); lp.energy = lp.maxEnergy * 0.35;
  const eBefore = lp.energy;
  assert.ok(sim.useSkill(m, 'p1', 'Q', 'p2').ok, 'cast dispara gatilho');
  assert.ok(lp.lymhurstUntil > m.time, 'lymhurst ativa janela de 10s');
  assert.ok(lp.capeCdUntil > m.time, 'capa entra em recarga e impede reativação');
  sim.tick(m, 100); // conclui o cast instantâneo; janela de 10s ativa
  for (let i = 0; i < 10; i++) sim.tick(m, 1000); // passos finos: tick avança o relógio de uma vez
  assert.equal(lp.lymhurstTicks, 10, '10 parcelas de 7%');
  assert.ok(Math.abs(lp.energy - (eBefore + lp.maxEnergy * 0.70)) < lp.maxEnergy * 0.05 + 20, `energia restaurada ~70% do máximo (${eBefore} -> ${lp.energy})`);
  // Martlock: dano abaixo de 25% dá +defesa (via dealDamage direto; capa da VÍTIMA)
  m = started({ b2: { cape: 'martlock' } });
  const v = m.players.get('p2'); v.hp = v.maxHp * 0.26;
  sim.dealDamage(m, 'p1', 'p2', v.maxHp * 0.10, m.time);
  assert.ok(v.martlockUntil > m.time, 'martlock ativa');
  // Thetford: AA dispara raio em cadeia (242 mágico) com ICD 15s.
  m = sim.createMatch('T', { durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', B({ cape: 'thetford' }));
  sim.joinPlayer(m, 'p2', 'Beto', B({}));
  sim.joinPlayer(m, 'p3', 'Téo', B({}));
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true); sim.setReady(m, 'p3', true);
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  m.players.get('p1').energy = 500; m.players.get('p2').energy = 500;
  m.players.get('p3').x = 12; m.players.get('p3').y = 10; // a 1m da vítima, dentro dos 9m
  const h3 = m.players.get('p3').hp;
  const rAA = sim.basicAttack(m, 'p1', 'p2');
  assert.ok(rAA.ok, 'AA acerta');
  assert.ok(m.players.get('p1').thetfordIcdUntil > m.time, 'raio dispara e inicia ICD 15s');
  assert.ok(m.players.get('p3').hp < h3, 'raio encadeia no segundo inimigo a até 9m');
  // Fort Sterling: stun elegível limpa e imuniza; DoT permanece; CD impede reativação.
  const F = (cape) => {
    const mm = sim.createMatch('X', {});
    sim.joinPlayer(mm, 'a', 'A', B({ weapon: 'dagger', q: 'sunder-armor', w: 'shadow-edge', e: 'bloodthirsty-blade', cape: 'bridgewatch' }));
    sim.joinPlayer(mm, 'b', 'B', B({ cape }));
    sim.joinPlayer(mm, 'c', 'C', B({ weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', cape: 'bridgewatch' }));
    sim.setReady(mm, 'a', true); sim.setReady(mm, 'b', true); sim.setReady(mm, 'c', true);
    const pa = mm.players.get('a'), pb = mm.players.get('b'), pc = mm.players.get('c');
    pa.x = 10; pa.y = 10; pb.x = 11; pb.y = 10; pc.x = 12; pc.y = 10;
    pa.energy = 9999; pc.energy = 9999;
    sim.tick(mm, 5000); // expira proteção de surgimento
    return { mm, pa, pb, pc };
  };
  // Com a capa: bleed aplicado antes permanece; stun é limpo; imunidade + CD iniciam.
  let t = F('fort-sterling');
  assert.ok(sim.useSkill(t.mm, 'c', 'Q', 'b').ok, 'setup: bleed na vítima');
  assert.ok(t.pb.bleeds.length > 0, 'setup: DoT presente');
  sim.tick(t.mm, 100);
  assert.ok(sim.useSkill(t.mm, 'a', 'W', 'b').ok, 'shadow-edge teleporta e tenta stun');
  assert.ok(!(t.pb.cc.stunUntil > t.mm.time), 'stun elegível removido/impedido pela capa');
  assert.ok(t.pb.immuneCCUntil > t.mm.time, 'untouchable ~1s');
  assert.ok(t.pb.capeCdUntil > t.mm.time, 'cooldown da capa iniciado');
  assert.ok(t.pb.bleeds.length > 0, 'DoT NÃO removido');
  // Sem a capa: o mesmo golpe aplica stun de ~1,68s.
  t = F('bridgewatch');
  assert.ok(sim.useSkill(t.mm, 'a', 'W', 'b').ok, 'shadow-edge sem capa');
  assert.ok(t.pb.cc.stunUntil > t.mm.time, 'sem capa o stun aplica');
});

test('passivas contínuas alteram dano/CD e contadores funcionam', () => {
  // compara com/sem aggression no mesmo alvo (mitigação 100/(100+res) reduz abaixo da base).
  const mk = (pass) => {
    const m = sim.createMatch('T', {});
    sim.joinPlayer(m, 'p1', 'Ana', B({ chest: 'scholar-robe', cPass1: pass }));
    sim.joinPlayer(m, 'p2', 'Beto', B({}));
    sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
    m.players.get('p1').x = 10; m.players.get('p1').y = 10; m.players.get('p2').x = 11; m.players.get('p2').y = 10;
    const antes = m.players.get('p2').hp;
    sim.basicAttack(m, 'p1', 'p2');
    return antes - m.players.get('p2').hp;
  };
  const sem = mk(undefined);
  const com = mk('aggression');
  assert.ok(com > sem, `aggression +8% aumenta AA (${sem} -> ${com})`);
});
