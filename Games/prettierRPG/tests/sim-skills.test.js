// Seção 9: asserções de efeito REAL por skill (sem `r.ok || r.error`).
// Cada caso verifica mudança de estado: HP, buff/debuff, posição, canal/timer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');
const world = require('../lib/world');

function B(weapon, q, w, e, extra = {}) {
  return { weapon, q, w, e, offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...extra };
}
// arena nova por skill: p1(10,10) p2(11,10), energia alta.
function mk(b1, b2, mode = 'ffa') {
  const m = sim.createMatch('T', { mode, durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', b1);
  sim.joinPlayer(m, 'p2', 'Beto', b2 || B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'));
  if (mode === '2v2') { m.players.get('p1').team = 0; m.players.get('p2').team = 1; }
  if (mode === '2v2') {
    // 2v2 exige 2 prontos por equipe p/ iniciar: completa com p3/p4 distantes.
    sim.joinPlayer(m, 'p3', 'Cleo', B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'), 0);
    sim.joinPlayer(m, 'p4', 'Dani', B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'), 1);
  }
  sim.setReady(m, 'p1', true);
  if (mode !== 'pve') sim.setReady(m, 'p2', true);
  if (mode === '2v2') { sim.setReady(m, 'p3', true); sim.setReady(m, 'p4', true); }
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  if (mode !== 'pve') { m.players.get('p2').x = 11; m.players.get('p2').y = 10; }
  if (mode === '2v2') { m.players.get('p3').x = 80; m.players.get('p3').y = 80; m.players.get('p4').x = 81; m.players.get('p4').y = 80; }
  m.players.get('p1').energy = 9999;
  if (mode !== 'pve') m.players.get('p2').energy = 9999;
  return m;
}
// usa skill e avança waitMs (resolve casts/canals/timers curtos). Retorna {m, r}.
function U(m, slot, target, point, waitMs = 0) {
  const r = sim.useSkill(m, 'p1', slot, target, point ? { x: point[0], y: point[1] } : undefined);
  if (waitMs) sim.tick(m, waitMs);
  return r;
}
const hp = (m, id = 'p2') => m.players.get(id).hp;

test('battleaxe Q: strike/spin/rage causam dano real + cargas', () => {
  let m = mk(B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'));
  const h0 = hp(m);
  assert.ok(U(m, 'Q', 'p2').ok);
  assert.ok(hp(m) < h0, 'strike causa dano');
  assert.ok(m.players.get('p2').bleeds.length > 0, 'strike aplica bleed');
  assert.equal(m.players.get('p2').rend, 1);

  m = mk(B('battleaxe', 'rending-spin', 'deadly-chop', 'blood-bandit'));
  const h1 = hp(m);
  assert.ok(U(m, 'Q', null, [11, 10]).ok);
  assert.ok(hp(m) < h1, 'spin atinge ao redor');

  m = mk(B('battleaxe', 'rending-rage', 'deadly-chop', 'blood-bandit'));
  const h2 = hp(m);
  assert.ok(U(m, 'Q', 'p2').ok);
  assert.ok(hp(m) < h2, 'rage etapa1 causa dano');
  assert.ok(m.players.get('p1').searingStage >= 1, 'rage arma combo');
});

test('battleaxe W: chop (cast 0,4s), adrenaline, rush, hemorrhage, raging', () => {
  let m = mk(B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'));
  const h0 = hp(m);
  const r = U(m, 'W', 'p2');
  assert.ok(r.ok || r.casting, 'chop lança');
  assert.equal(hp(m), h0, 'chop sem dano durante cast');
  sim.tick(m, 400);
  assert.ok(hp(m) < h0, 'chop causa 502 ao concluir');
  assert.ok(m.players.get('p2').vulnUntil > m.time, 'chop aplica vuln 8s');

  m = mk(B('battleaxe', 'rending-strike', 'adrenaline-boost', 'blood-bandit'));
  assert.ok(U(m, 'W', null).ok);
  assert.ok(m.players.get('p1').adrenalineUntil > m.time, 'adrenaline ativa 9s');

  m = mk(B('battleaxe', 'rending-strike', 'battle-rush', 'blood-bandit'));
  assert.ok(U(m, 'W', null, [14, 10]).ok);
  assert.ok(Math.abs(m.players.get('p1').x - 14) < 0.6, 'rush teleporta');

  m = mk(B('battleaxe', 'rending-strike', 'internal-bleeding', 'blood-bandit'));
  const h3 = hp(m);
  assert.ok(U(m, 'W', null).ok);
  assert.ok(hp(m) < h3, 'hemorragia dano direto');
  assert.ok(m.players.get('p2').dots.some((x) => x.id === 'int-bleed'), 'hemorragia aplica dot moveOnly');

  m = mk(B('battleaxe', 'rending-strike', 'raging-blades', 'blood-bandit'));
  assert.ok(U(m, 'W', null).ok);
  assert.ok(m.players.get('p1').ragingUntil > m.time, 'raging aura 3s');
});

test('battleaxe E blood-bandit: 2 etapas com dano e cura', () => {
  const m = mk(B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'));
  const h0 = hp(m);
  assert.ok(U(m, 'E', 'p2').ok, 'etapa1');
  assert.ok(hp(m) < h0, 'etapa1 causa dano');
  assert.ok(m.players.get('p1').eStage, 'etapa2 armada 9s');
  const s = m.players.get('p1');
  s.hp = s.maxHp - 400;
  const hA = s.hp, h1 = hp(m);
  assert.ok(U(m, 'E', 'p2').ok, 'etapa2');
  assert.ok(hp(m) < h1, 'etapa2 causa 363');
  assert.ok(s.hp > hA, 'etapa2 cura');
});

test('dagger Q: sunder, swipe (salto), assassin-spirit (toggle)', () => {
  let m = mk(B('dagger', 'sunder-armor', 'forbidden-stab', 'bloodthirsty-blade'));
  const h0 = hp(m);
  assert.ok(U(m, 'Q', 'p2').ok);
  assert.ok(hp(m) < h0, 'sunder causa dano');
  assert.ok(m.players.get('p2').sunderStacks >= 1, 'sunder aplica carga');

  m = mk(B('dagger', 'deadly-swipe', 'forbidden-stab', 'bloodthirsty-blade'));
  const h1 = hp(m);
  assert.ok(U(m, 'Q', null, [13, 10]).ok);
  assert.ok(Math.abs(m.players.get('p1').x - 13) < 0.6, 'swipe salta ao ponto');
  assert.ok(!world.isBlocked(m.players.get('p1').x, m.players.get('p1').y, 0.4), 'swipe fora de obstáculo');
  assert.ok(hp(m) < h1, 'swipe causa dano em área');

  m = mk(B('dagger', 'assassin-spirit', 'forbidden-stab', 'bloodthirsty-blade'));
  assert.ok(U(m, 'Q', null).ok);
  assert.ok(m.players.get('p1').assassinSpiritOn, 'spirit liga');
  sim.tick(m, 2100);
  assert.ok((m.players.get('p1').assassinStacks || 0) >= 1, 'spirit gera carga a cada 2s');
});

test('dagger W: blades-cone, dash, forbidden, shadow, chain', () => {
  let m = mk(B('dagger', 'sunder-armor', 'throwing-blades', 'bloodthirsty-blade'));
  const h0 = hp(m);
  assert.ok(U(m, 'W', 'p2', [14, 10]).ok);
  assert.ok(hp(m) < h0, 'throwing-blades atinge no cone');

  m = mk(B('dagger', 'sunder-armor', 'dash', 'bloodthirsty-blade'));
  assert.ok(U(m, 'W', null, [14, 10]).ok);
  assert.ok(Math.abs(m.players.get('p1').x - 14) < 0.6, 'dash teleporta 4m');
  assert.ok(!world.isBlocked(m.players.get('p1').x, m.players.get('p1').y, 0.4), 'dash fora de obstáculo');
  assert.ok(m.players.get('p1').buffs.some((x) => x.id === 'dash-dmg'), 'dash +15% dano 4s');

  m = mk(B('dagger', 'sunder-armor', 'forbidden-stab', 'bloodthirsty-blade'));
  const h2 = hp(m);
  assert.ok(U(m, 'W', 'p2').ok);
  assert.ok(hp(m) < h2, 'forbidden causa 290');
  assert.ok(m.players.get('p2').forbiddenUntil > m.time, 'nega cura 1,5s');

  m = mk(B('dagger', 'sunder-armor', 'shadow-edge', 'bloodthirsty-blade'));
  const h3 = hp(m);
  assert.ok(U(m, 'W', 'p2').ok);
  assert.equal(hp(m), h3, 'shadow-edge sem dano inventado');
  assert.ok(m.players.get('p2').cc.stunUntil > m.time, 'shadow aplica stun');

  m = mk(B('dagger', 'sunder-armor', 'chain-slash', 'bloodthirsty-blade'));
  const h4 = hp(m);
  assert.ok(U(m, 'W', 'p2').ok);
  assert.ok(hp(m) < h4 - 100, 'chain-slash encadeia dano real');
});

test('dagger E bloodthirsty-blade: toggle, bônus, lifesteal, mov, auto-dano', () => {
  const m = mk(B('dagger', 'sunder-armor', 'dash', 'bloodthirsty-blade'));
  assert.ok(U(m, 'E', null).ok);
  const s = m.players.get('p1');
  assert.ok(s.bloodthirstyOn && s.moveBonus === 0.30, 'buff +30% mov');
  s.hp = s.maxHp - 500; s.cd.aa = 0;
  const hA = s.hp, h0 = hp(m);
  sim.basicAttack(m, 'p1', 'p2');
  assert.ok(h0 - hp(m) > 70, 'AA soma bônus mágico real');
  assert.ok(s.hp > hA, 'lifesteal 100% do bônus');
});

test('fire Q: bolt (cast), burning-field (ponto), searing (direcional)', () => {
  let m = mk(B('fire', 'fire-bolt', 'flame-blast', 'pyroblast'));
  const h0 = hp(m);
  const r = U(m, 'Q', 'p2');
  assert.ok(r.ok || r.casting);
  assert.equal(hp(m), h0, 'bolt sem dano durante cast 0,8s');
  sim.tick(m, 800);
  assert.ok(hp(m) < h0, 'bolt 178 ao concluir');
  assert.ok(m.players.get('p2').dots.some((x) => x.id === 'burn'), 'bolt aplica burn');

  m = mk(B('fire', 'burning-field', 'flame-blast', 'pyroblast'));
  const h1 = hp(m);
  assert.ok(U(m, 'Q', null, [11, 10], 600).ok);
  assert.ok(hp(m) < h1, 'burning-field impacto 201');
  assert.ok(m.timers.some((t) => t.kind === 'burning-field'), 'campo persiste 4s');

  m = mk(B('fire', 'searing-flame', 'flame-blast', 'pyroblast'));
  const h2 = hp(m);
  assert.ok(U(m, 'Q', 'p2', [11, 10], 500).ok);
  assert.ok(hp(m) < h2, 'searing causa dano direcional');
});

test('fire W: blast, wall, flare, wave-cone, artillery', () => {
  let m = mk(B('fire', 'fire-bolt', 'flame-blast', 'pyroblast'));
  assert.ok(U(m, 'W', 'p2').ok);
  assert.ok(m.timers.some((t) => t.kind === 'flame-blast'), 'blast explode após 1,6s');
  const h0 = hp(m);
  sim.tick(m, 1700);
  assert.ok(hp(m) < h0, 'blast 402 em área');

  m = mk(B('fire', 'fire-bolt', 'wall-of-flames', 'pyroblast'));
  assert.ok(U(m, 'W', null, [14, 10]).ok);
  const wall = m.timers.find((t) => t.kind === 'wall');
  assert.ok(wall, 'parede criada');
  assert.ok(wall.x > 10, 'parede à frente (não atrás)');

  m = mk(B('fire', 'fire-bolt', 'raging-flare', 'pyroblast'));
  const h1 = hp(m);
  assert.ok(U(m, 'W', 'p2', [11, 10], 500).ok);
  assert.ok(hp(m) < h1, 'raging-flare 588 em área');

  m = mk(B('fire', 'fire-bolt', 'fire-wave', 'pyroblast'));
  const h2 = hp(m);
  m.players.get('p1').x = 30; m.players.get('p1').y = 30;
  m.players.get('p2').x = 25; m.players.get('p2').y = 30;
  const rw = sim.useSkill(m, 'p1', 'W', 'p2', { x: 35, y: 30 });
  assert.equal(rw.ok, false, 'wave atrás do cone erra (gasto)');
  m.players.get('p2').x = 35; m.players.get('p2').y = 30;
  m.players.get('p1').cd.w = 0; m.players.get('p1').energy = 9999; m.players.get('p1').castUntil = 0;
  assert.ok(sim.useSkill(m, 'p1', 'W', 'p2', { x: 35, y: 30 }).ok);
  assert.ok(hp(m) < h2, 'wave na frente causa dano');

  m = mk(B('fire', 'fire-bolt', 'fire-artillery', 'pyroblast'));
  const ra = U(m, 'W', 'p2', null, 1600);
  assert.ok(ra.casting, 'artillery conjura 1,5s antes de canalizar');
  assert.ok(m.players.get('p1').channel?.id === 'artillery', 'artillery canaliza após cast 1,5s');
});

test('fire E pyroblast: estágios e interrupção', () => {
  const m = mk(B('fire', 'fire-bolt', 'flame-blast', 'pyroblast'));
  m.players.get('p2').x = 12;
  const h0 = hp(m);
  assert.ok(U(m, 'E', 'p2', [12, 10]).charging);
  sim.tick(m, 1200);
  assert.ok(h0 - hp(m) > 350, 'canal completo ~976');
});

test('frost Q: frostbite-cone, ice-shard (cast+delay), frozen-surge (faixa)', () => {
  let m = mk(B('frost', 'frostbite', 'frost-bomb', 'freezing-wind'));
  const h0 = hp(m);
  assert.ok(U(m, 'Q', 'p2', [11, 10], 400).ok);
  assert.ok(hp(m) < h0, 'frostbite 293 no cone');

  m = mk(B('frost', 'ice-shard', 'frost-bomb', 'freezing-wind'));
  const h1 = hp(m);
  assert.ok(U(m, 'Q', null, [11, 10], 1500).ok);
  sim.tick(m, 300); // delay 0,2s após concluir o cast
  assert.ok(hp(m) < h1, 'ice-shard 373 após cast+delay');

  m = mk(B('frost', 'frozen-surge', 'frost-bomb', 'freezing-wind'));
  const h2 = hp(m);
  assert.ok(U(m, 'Q', 'p2', [14, 10]).ok);
  assert.ok(hp(m) < h2, 'frozen-surge 258 na faixa');
  assert.ok(m.players.get('p2').cc.slowUntil > m.time, 'surge aplica slow');
});

test('frost W: bomb, beam, nova-teleporte, lance, obelisco', () => {
  let m = mk(B('frost', 'frostbite', 'frost-bomb', 'freezing-wind'));
  assert.ok(U(m, 'W', null, [11, 10]).ok);
  assert.ok(m.players.get('p2').cc.slowUntil > m.time, 'bomb slow inicial');
  assert.ok(m.timers.some((t) => t.kind === 'frost-bomb'), 'bomb explode após 1,6s');

  m = mk(B('frost', 'frostbite', 'frost-beam', 'freezing-wind'));
  assert.ok(U(m, 'W', 'p2').ok);
  assert.ok(m.players.get('p1').channel?.id === 'frost-beam', 'beam canaliza 2,7s');

  m = mk(B('frost', 'frostbite', 'frost-nova', 'freezing-wind'));
  const h0 = hp(m);
  assert.ok(U(m, 'W', null, [14, 10]).ok);
  assert.ok(!world.isBlocked(m.players.get('p1').x, m.players.get('p1').y, 0.4), 'nova fora de obstáculo');
  assert.ok(hp(m) < h0, 'nova 201 + stun na origem (raio 3m)');
  assert.ok(m.players.get('p2').cc.stunUntil > m.time, 'nova aplica stun 1,4s');

  m = mk(B('frost', 'frostbite', 'frost-lance', 'freezing-wind'));
  const h1 = hp(m);
  assert.ok(U(m, 'W', null, [11, 10]).ok);
  assert.ok(hp(m) < h1, 'lance 425 em área');

  m = mk(B('frost', 'frostbite', 'glacial-obelisk', 'freezing-wind'));
  assert.ok(U(m, 'W', null, [14, 10], 500).ok);
  assert.ok(m.timers.some((t) => t.kind === 'obelisk'), 'obelisco colocado 6s');
});

test('frost E freezing-wind: cone frontal real', () => {
  const m = mk(B('frost', 'frostbite', 'frost-bomb', 'freezing-wind'));
  m.players.get('p1').x = 30; m.players.get('p1').y = 30;
  m.players.get('p2').x = 35; m.players.get('p2').y = 30;
  const h0 = hp(m);
  assert.ok(U(m, 'E', 'p2', [35, 30]).ok);
  assert.ok(hp(m) < h0 - 200, 'cone 574 na frente');
});

test('holy Q/W/E: cura só aliado/self, beam sem self sem gastar', () => {
  const m = mk(B('holy', 'generous-heal', 'sacred-pulse', 'desperate-prayer'), B('holy', 'generous-heal', 'holy-beam', 'desperate-prayer'), '2v2');
  m.players.get('p2').team = 0; // aliado de p1
  for (const id of ['p1', 'p2']) { m.players.get(id).x = 10; m.players.get(id).y = 10; m.players.get(id).energy = 9999; }
  m.players.get('p2').x = 11;
  m.players.get('p2').hp = m.players.get('p2').maxHp - 500;
  const h0 = hp(m, 'p2');
  assert.ok(U(m, 'Q', 'p2', null, 600).ok, 'generous cura aliado 2v2');
  assert.ok(hp(m, 'p2') > h0, 'cura 201 aplicada após cast');
  // holy beam self rejeitado sem gastar
  const en2 = m.players.get('p2').energy;
  const rb2 = sim.useSkill(m, 'p2', 'W', 'p2');
  assert.equal(rb2.ok, false);
  assert.equal(m.players.get('p2').energy, en2, 'beam self não gasta');
  // FFA: cura só si
  const mf = mk(B('holy', 'generous-heal', 'holy-beam', 'desperate-prayer'));
  mf.players.get('p1').energy = 300; mf.players.get('p2').hp = mf.players.get('p2').maxHp - 50;
  const rf = sim.useSkill(mf, 'p1', 'Q', 'p2');
  assert.equal(rf.ok, false, 'FFA cura só si');
  const enF = mf.players.get('p1').energy;
  const rbf = sim.useSkill(mf, 'p1', 'W', 'p2');
  assert.equal(rbf.ok, false, 'FFA beam sem alvo válido');
  assert.equal(mf.players.get('p1').energy, enF, 'FFA beam não gasta');
});

test('holy W/E restantes têm efeito real', () => {
  let m = mk(B('holy', 'smite', 'sacred-pulse', 'desperate-prayer'));
  const h0 = hp(m);
  assert.ok(U(m, 'Q', null, [11, 10], 900).ok);
  sim.tick(m, 400); // delay 0,25s após concluir o cast
  assert.ok(hp(m) < h0, 'smite 330 em área');

  m = mk(B('holy', 'generous-heal', 'sacred-pulse', 'desperate-prayer'), B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'));
  m.players.get('p1').hp = m.players.get('p1').maxHp - 300;
  const hA = hp(m, 'p1');
  m.players.get('p2').x = 14; m.players.get('p2').y = 10;
  assert.ok(U(m, 'W', 'p1').ok, 'sacred-pulse');
  assert.ok(hp(m, 'p1') > hA, 'pulse cura');

  m = mk(B('holy', 'generous-heal', 'holy-blessing', 'desperate-prayer'));
  assert.ok(U(m, 'W', 'p1').ok);
  assert.ok(m.players.get('p1').blessingUntil > m.time, 'blessing +armadura/cura');

  m = mk(B('holy', 'generous-heal', 'holy-orb', 'desperate-prayer'));
  assert.ok(U(m, 'W', null, [15, 10]).ok);
  assert.ok(m.timers.some((t) => t.kind === 'holy-orb'), 'orbe lançado');

  m = mk(B('holy', 'generous-heal', 'reawaken', 'desperate-prayer'), B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'));
  m.players.get('p1').hp = m.players.get('p1').maxHp - 500;
  const hB = hp(m, 'p1'), r = U(m, 'E', 'p1');
  assert.ok(r.ok, 'desperate-prayer cura');
  assert.ok(hp(m, 'p1') > hB, 'desperate cura 201/443');
});

test('armor: dodge/deslize, taunt, force-field, howl-cone', () => {
  let m = mk(B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'));
  assert.ok(U(m, 'BOOTS', null, [14, 10]).ok);
  assert.ok(m.players.get('p1').immuneDmgUntil > m.time, 'dodge i-frames 0,8s');

  m = mk(B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit', { hSkill: 'howl' }), B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'), '2v2');
  m.players.get('p1').team = 0; m.players.get('p2').team = 1;
  m.players.get('p2').x = 12;
  m.players.get('p1').energy = 9999;
  const miss = sim.useSkill(m, 'p1', 'HEAD', 'p2', { x: 0, y: 0 }); // mira p/ longe
  assert.equal(miss.ok, false, 'howl fora do cone erra (gasto)');
  m.players.get('p1').cd.head = 0; m.players.get('p1').castUntil = 0;
  const hhw = hp(m);
  const hw = sim.useSkill(m, 'p1', 'HEAD', 'p2', { x: 12, y: 10 });
  assert.ok(hw.ok, 'howl com mira no cone acerta');
  assert.ok(hp(m) < hhw, 'howl 163 no cone');

  m = mk(B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit', { chest: 'soldier-armor', cSkill: 'taunt' }));
  m.players.get('p2').x = 12;
  assert.ok(U(m, 'CHEST', 'p2').ok);
  assert.ok(m.players.get('p2').tauntVulnUntil > m.time, 'taunt +20% dano recebido');
});

test('friendly-fire 2v2: sem dano hostil entre aliados', () => {
  const m = mk(B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'), B('battleaxe', 'rending-strike', 'deadly-chop', 'blood-bandit'), '2v2');
  m.players.get('p2').team = 0; // mesmo time de p1
  const antes = hp(m);
  const r = sim.basicAttack(m, 'p1', 'p2');
  assert.equal(r.ok, false);
  assert.equal(hp(m), antes);
});

test('pve: skills aplicam split correto (smite 390, ice 258, art 16)', () => {
  const m = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', B('holy', 'smite', 'sacred-pulse', 'desperate-prayer'));
  sim.setReady(m, 'p1', true);
  // jogador colado no monstro: monstro fica em alcance de ataque (parado).
  m.players.get('p1').x = 59; m.players.get('p1').y = 60;
  m.players.get('p1').energy = 9999;
  const mo0 = m.monster.hp;
  const mx = m.monster.x, my = m.monster.y;
  sim.useSkill(m, 'p1', 'Q', '__monster__', { x: mx, y: my });
  assert.ok(m.players.get('p1').pendingCast, 'smite conjura antes do impacto');
  sim.tick(m, 800); // cast 500 conclui, timer agenda +250
  sim.tick(m, 300); // impacto
  assert.ok(m.monster.hp < mo0, 'smite atinge monstro (390 split)');
});
