'use strict';

// Integração catálogo ↔ sim + protocolo snapshot (lane integração).
// Fonte única: data/equipment.json via lib/catalog.js. Se divergir, vale o catálogo.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../lib/catalog');
const sim = require('../lib/sim');

// Amostra cruzada documentada (1 skill por arma Q + ativas de armadura/botas + capa)
// + verificação FULL de todas as skills (sem teste artificial por combinação:
// custo/CD/alcance de TODAS provam fonte única; efeito principal exercido na amostra + matriz).
const SAMPLE = [
  'rending-strike', // battleaxe Q
  'sunder-armor', // dagger Q
  'fire-bolt', // fire-staff Q
  'frostbite', // frost-staff Q
  'generous-heal', // holy-staff Q
  'mend-wounds', // armadura (peito)
  'dash', // dagger W (custo 1)
  'howl', // elmo (custo 0)
  'inferno-shield', // peito (custo 0/CD30)
  'bloodlust', // peito (custo 0/CD30, cura % com limite — não flat)
  'refreshing-sprint', // botas (+40%/+20%)
  'rejuvenating-sprint', // botas (40/s)
  'wanderlust', // botas (+80% 8s)
  'force-field', // elmo (custo 0 D.6)
  'caerleon-reset', // capa
];

test('catálogo é fonte única: custo/CD/alcance da amostra = sim', () => {
  assert.equal(typeof sim.skillParams, 'function', 'sim.skillParams(skillId) ausente');
  for (const id of SAMPLE) {
    const cat = catalog.getSkill(id);
    assert.ok(cat, `catálogo sem skill ${id}`);
    const p = sim.skillParams(id);
    assert.ok(p, `sim sem params p/ ${id}`);
    assert.equal(p.cost, cat.cost, `${id}: custo sim(${p.cost}) != catálogo(${cat.cost})`);
    assert.equal(p.cdMs, Math.round(cat.cd * 1000), `${id}: CD sim(${p.cdMs}) != catálogo(${cat.cd * 1000}ms)`);
    assert.equal(p.range, cat.range, `${id}: alcance sim(${p.range}) != catálogo(${cat.range})`);
  }
});

test('catálogo é fonte única FULL: TODAS as skills têm custo/CD/alcance = sim', () => {
  const ids = Object.keys(catalog.SKILLS);
  assert.ok(ids.length >= 90, `catálogo insuficiente: ${ids.length}`);
  let n = 0;
  for (const id of ids) {
    const cat = catalog.getSkill(id);
    const p = sim.skillParams(id);
    assert.ok(p, `sim sem params p/ ${id}`);
    assert.equal(p.cost, cat.cost, `${id}: custo`);
    assert.equal(p.cdMs, Math.round(cat.cd * 1000), `${id}: CD`);
    assert.equal(p.range, cat.range, `${id}: alcance`);
    assert.equal(p.radius, cat.radius, `${id}: raio`);
    n++;
  }
  console.log(`skills fonte-única FULL: ${n}`);
});

test('stats da build vêm do catálogo (calcStats)', () => {
  const b = { ...require('../lib/build').DEFAULT_BUILD };
  const st = sim.statsFor(b);
  const ref = catalog.calcStats(b);
  assert.equal(st.maxHp, ref.maxHp, `maxHp sim(${st.maxHp}) != catálogo(${ref.maxHp})`);
  assert.equal(st.maxEnergy, ref.maxEnergy, `maxEnergy sim(${st.maxEnergy}) != catálogo(${ref.maxEnergy})`);
});

test('snapshot contém protocolo que o cliente lê (valores reais, não só chaves)', () => {
  const m = sim.createMatch('TST1', { mode: '2v2' });
  assert.ok(sim.joinPlayer(m, 'p1', 'Ana', undefined, 0).ok);
  assert.ok(sim.joinPlayer(m, 'p2', 'Beto', undefined, 1).ok);
  const s = sim.snapshot(m);
  // topo
  for (const k of ['phase', 'mode', 'timeLeft', 'wave', 'players', 'scores', 'result']) {
    assert.ok(k in s, `snapshot sem campo ${k}`);
  }
  assert.ok(s.wave && typeof s.wave.r === 'number' && typeof s.wave.active === 'boolean', 'wave precisa de {r,active}');
  assert.ok(Array.isArray(s.players) && s.players.length === 2, 'players precisa listar os 2');
  const p = s.players[0];
  for (const k of ['id', 'name', 'team', 'x', 'y', 'hp', 'maxHp', 'en', 'maxEn', 'alive', 'left', 'downed', 'shield', 'effects', 'build', 'stats']) {
    assert.ok(k in p, `player sem campo ${k}`);
  }
  assert.ok(p.downed && typeof p.downed.state === 'string', 'downed precisa de {state,…}');
  assert.ok(Array.isArray(p.effects), 'effects precisa ser lista');
  assert.ok(p.stats && typeof p.stats.maxHp === 'number', 'stats precisa ter maxHp');
  // valores reais (não só existência): maxHp/maxEn vêm do catálogo via mesma build
  const ref = catalog.calcStats(require('../lib/build').DEFAULT_BUILD);
  assert.equal(p.maxHp, ref.maxHp, `snapshot maxHp (${p.maxHp}) != catálogo (${ref.maxHp})`);
  assert.equal(p.maxEn, ref.maxEnergy, `snapshot maxEn (${p.maxEn}) != catálogo (${ref.maxEnergy})`);
  assert.equal(p.hp, p.maxHp, 'início com vida cheia');
  assert.equal(p.team, 0, 'time 0 preservado no snapshot');
  assert.ok(p.build && typeof p.build.weapon === 'string', 'build canônica presente no snapshot');
});

test('PvE: contadores independentes {dano,dps} vs {heal} (contrato §3.4)', () => {
  const m = sim.createMatch('PVE1', { mode: 'pve' });
  assert.ok(sim.joinPlayer(m, 'p1', 'Ana', undefined).ok);
  sim.setReady(m, 'p1', true);
  assert.ok(m.pve, 'pve precisa existir');
  assert.deepEqual(Object.keys(m.pve).sort(), ['dmgTotal', 'dmgWindow', 'healTotal'].sort(), 'pve tem 3 contadores independentes');
  // dano acumula
  const r1 = sim.hitMonster(m, 'p1', 200, m.time);
  assert.ok(r1.ok && r1.dmg > 0, 'hitMonster causa dano real');
  assert.ok(m.pve.dmgTotal > 0, 'dmgTotal acumula');
  assert.ok(m.pve.dmgWindow.length > 0, 'janela DPS acumula');
  assert.ok(sim.dps5s(m) > 0, 'DPS5s > 0 após dano');
  // cura acumula separado (boneco com 25% inicial; cura real usa valor da skill, não fixo)
  const du0 = m.dummy.hp;
  const rh = sim.healDummy(m, 'p1', 213, m.time); // holy-flash 213
  assert.ok(rh.ok && rh.healed > 0, 'healDummy cura real');
  assert.ok(m.pve.healTotal > 0, 'healTotal acumula separado');
  const dmgAntes = m.pve.dmgTotal, healAntes = m.pve.healTotal;
  assert.ok(dmgAntes > 0 && healAntes > 0, 'ambos contadores > 0 antes do respawn');
  // respawn do monstro zera só dano/DPS, preserva cura (sim tick)
  m.monster.hp = 0; m.monster.alive = false; m.monster.respawnAt = m.time;
  sim.tick(m, 50);
  assert.equal(m.pve.dmgTotal, 0, 'respawn zera dmgTotal');
  assert.equal(m.pve.dmgWindow.length, 0, 'respawn zera janela DPS');
  assert.equal(m.pve.healTotal, healAntes, `respawn preserva healTotal (${healAntes})`);
  assert.ok(du0 < m.dummy.maxHp, 'boneco começou com 25% (sanidade)');
});
