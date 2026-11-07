'use strict';
// Item 2 — varredura COMPORTAMENTAL catálogo x simulação.
//
// Para cada skill selecionável (q/w/e/active): executa de verdade via
// sim.useSkill com contexto válido e observa o resultado no estado:
//   (a) ok verdadeiro; (b) energia gasta == custo do catálogo;
//   (c) recarga do slot == cd do catálogo (ms exatos, sem cdr no setup).
// NÃO compara getter com getter: gasto/CD vêm da execução do motor.
// Valores esperados (custo/cd) vêm do catálogo = dado do produto; o motor
// é o observado. Divergência real falha aqui (red) e exige fix ou
// documentação explícita (ver .planning/prettierrpg-revisao/plan.md item 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');
const catalog = require('../lib/catalog');

function B(over = {}) {
  return {
    weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
    offhand: 'shield', // sem cdr: recarga observada == base exata
    head: 'mercenary-hood', headActive: 'cleanse', headPassive: 'swiftness',
    chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness',
    boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness',
    cape: 'bridgewatch', weaponPassive: 'deep-cuts',
    ...over,
  };
}
const CDKEY = { Q: 'q', W: 'w', E: 'e', HEAD: 'head', CHEST: 'chest', BOOTS: 'boots' };

const WEAPON_FILL = {
  battleaxe: { e: 'blood-bandit', weaponPassive: 'deep-cuts' },
  dagger: { e: 'bloodthirsty-blade', weaponPassive: 'deep-cuts' },
  fire: { e: 'pyroblast', weaponPassive: 'burn' },
  frost: { e: 'freezing-wind', weaponPassive: 'frost' },
  holy: { e: 'desperate-prayer', weaponPassive: 'energetic' },
};
function fillWeapon(b) {
  const f = WEAPON_FILL[b.weapon];
  if (!f) return b;
  const o = { ...b };
  if (o.e === undefined) o.e = f.e;
  if (o.weaponPassive === undefined) o.weaponPassive = f.weaponPassive;
  return o;
}
// Contexto FFA: p1 executa, p2 inimigo adjacente. tick 4000 expira proteção.
function ctxFFA(b1 = {}, b2 = {}, n3 = 0) {
  b1 = { ...B(), ...fillWeapon(b1) }; b2 = { ...B(), ...fillWeapon(b2) };
  const m = sim.createMatch('T', { mode: 'ffa', durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', b1);
  sim.joinPlayer(m, 'p2', 'Beto', b2);
  if (n3) sim.joinPlayer(m, 'p3', 'Tea', B());
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  if (n3) sim.setReady(m, 'p3', true);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  p1.x = 10; p1.y = 10; p2.x = 11; p2.y = 10;
  if (n3) { m.players.get('p3').x = 12; m.players.get('p3').y = 10; }
  sim.tick(m, 4000);
  p1.energy = 9999; p2.energy = 9999;
  return { m, p1, p2 };
}
// Contexto 2v2 mesmo time (curas/aliados). 4 jogadores p/ iniciar.
function ctxAlly(b1 = {}) {
  b1 = { ...B(), ...fillWeapon(b1) };
  const m = sim.createMatch('A', { mode: '2v2', durationSec: 300 });
  sim.joinPlayer(m, 'a1', 'A1', b1, 0);
  sim.joinPlayer(m, 'a2', 'A2', B(), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1);
  sim.joinPlayer(m, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  const a1 = m.players.get('a1'), a2 = m.players.get('a2');
  a1.x = 10; a1.y = 10; a2.x = 11; a2.y = 10;
  m.players.get('b1').x = 40; m.players.get('b1').y = 40;
  m.players.get('b2').x = 42; m.players.get('b2').y = 40;
  sim.tick(m, 4000);
  a1.energy = 9999; a2.energy = 9999;
  return { m, a1, a2 };
}

function checkSpend(m, p, slot, skillId) {
  const cat = catalog.getSkill(skillId);
  assert.ok(cat, `catálogo tem ${skillId}`);
  const e0 = p.energy;
  return { cat, e0 };
}
function expectSpent(m, p, slot, cat, e0, label) {
  const spent = Math.round((e0 - p.energy) * 100) / 100;
  assert.equal(spent, cat.cost, `${label}: energia gasta == custo catálogo (${cat.cost})`);
  const cdMs = Math.round(cat.cd * 1000);
  assert.equal(p.cd[CDKEY[slot]] - m.time, cdMs, `${label}: recarga == cd catálogo (${cdMs}ms)`);
}

// ---- Q inimigo direto ----
for (const [qid, extra] of [['rending-strike', {}], ['sunder-armor', { weapon: 'dagger', q: 'sunder-armor', w: 'forbidden-stab' }], ['fire-bolt', { weapon: 'fire', q: 'fire-bolt', w: 'flame-blast', e: 'pyroblast' }]]) {
  test(`sweep Q inimigo ${qid}: gasto+CD==catálogo`, () => {
    const { m, p1 } = ctxFFA(extra);
    const { cat, e0 } = checkSpend(m, p1, 'Q', qid);
    const r = sim.useSkill(m, 'p1', 'Q', 'p2', { x: 11, y: 10 });
    assert.ok(r.ok, `${qid} ok: ${r.error || ''}`);
    expectSpent(m, p1, 'Q', cat, e0, qid);
  });
}
// ---- Q ponto/área ----
for (const [qid, extra, px, py] of [
  ['burning-field', { weapon: 'fire', q: 'burning-field', w: 'flame-blast', e: 'pyroblast' }, 11, 10],
  ['frozen-surge', { weapon: 'frost', q: 'frozen-surge', w: 'frost-bomb', e: 'freezing-wind' }, 11, 10],
  ['smite', { weapon: 'holy', q: 'smite', w: 'sacred-pulse', e: 'desperate-prayer' }, 11, 10],
  ['ice-shard', { weapon: 'frost', q: 'ice-shard', w: 'frost-bomb', e: 'freezing-wind' }, 11, 10],
]) {
  test(`sweep Q ponto ${qid}: gasto+CD==catálogo`, () => {
    const { m, p1 } = ctxFFA(extra);
    const { cat, e0 } = checkSpend(m, p1, 'Q', qid);
    const T0 = m.time;
    const r = sim.useSkill(m, 'p1', 'Q', 'p2', { x: px, y: py });
    assert.ok(r.ok, `${qid} ok: ${r.error || ''}`);
    expectSpent(m, p1, 'Q', cat, e0, qid);
    if (qid === 'smite') {
      // semântica fixed-step: avançar em passos (tick único grande atrasa
      // cadeias cast->timer para o próximo passo; produção usa 50ms).
      for (let i = 0; i < 8; i++) sim.tick(m, 100);
      assert.equal(p1.cd.q, T0 + 1500, 'smite: acertar inimigo reduz CD 3000->1500');
    }
  });
}
test('sweep Q area rending-spin: gasto+CD==catálogo', () => {
  const { m, p1 } = ctxFFA({ q: 'rending-spin' });
  const { cat, e0 } = checkSpend(m, p1, 'Q', 'rending-spin');
  const r = sim.useSkill(m, 'p1', 'Q', 'p2', { x: 11, y: 10 });
  assert.ok(r.ok, `rending-spin ok: ${r.error || ''}`);
  expectSpent(m, p1, 'Q', cat, e0, 'rending-spin');
});
test('sweep Q direcao frostbite/searing-flame: gasto+CD==catálogo', () => {
  for (const [qid, extra] of [
    ['frostbite', { weapon: 'frost', q: 'frostbite', w: 'frost-bomb', e: 'freezing-wind' }],
    ['searing-flame', { weapon: 'fire', q: 'searing-flame', w: 'flame-blast', e: 'pyroblast' }],
  ]) {
    const { m, p1 } = ctxFFA(extra);
    const { cat, e0 } = checkSpend(m, p1, 'Q', qid);
    const r = sim.useSkill(m, 'p1', 'Q', 'p2', { x: 11, y: 10 });
    assert.ok(r.ok, `${qid} ok: ${r.error || ''}`);
    expectSpent(m, p1, 'Q', cat, e0, qid);
  }
});
test('sweep Q combo rending-rage: cone nas etapas 1-2, salto+root na 3a', () => {
  const B4 = { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', weaponPassive: 'deep-cuts', offhand: 'shield', head: 'mercenary-hood', headActive: 'cleanse', headPassive: 'swiftness', chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness', boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness', cape: 'bridgewatch' };
  const m = sim.createMatch('T', { mode: 'ffa', durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', { ...B4, q: 'rending-rage' });
  sim.joinPlayer(m, 'p2', 'Beto', B4);
  sim.joinPlayer(m, 'p3', 'Tea', { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', weaponPassive: 'deep-cuts', offhand: 'shield', head: 'mercenary-hood', headActive: 'cleanse', headPassive: 'swiftness', chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness', boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness', cape: 'bridgewatch' });
  sim.joinPlayer(m, 'p4', 'Atras', { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', weaponPassive: 'deep-cuts', offhand: 'shield', head: 'mercenary-hood', headActive: 'cleanse', headPassive: 'swiftness', chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness', boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness', cape: 'bridgewatch' });
  for (const id of ['p1', 'p2', 'p3', 'p4']) sim.setReady(m, id, true);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  const p3 = m.players.get('p3'); p3.x = 12; p3.y = 10; p3.energy = 9999;
  const p4 = m.players.get('p4'); p4.x = 8; p4.y = 10; p4.energy = 9999;
  p1.x = 10; p1.y = 10; p2.x = 11; p2.y = 10;
  sim.tick(m, 4000); p1.energy = 9999;
  const hp2 = p2.hp, hp3 = p3.hp, hp4 = p4.hp;
  const cat = catalog.getSkill('rending-rage');
  assert.equal(cat.cd, 1.2, 'catálogo: CD 1,2s por etapa (janela combo 2,5s no efeito)');
  for (const etapa of [1, 2]) {
    const e0 = p1.energy;
    const r = sim.useSkill(m, 'p1', 'Q', 'p2', { x: 12, y: 10 });
    assert.ok(r.ok, `rage etapa ${etapa}: ${r.error || ''}`);
    assert.equal(Math.round((e0 - p1.energy) * 100) / 100, 4, `etapa ${etapa} custa 4`);
    assert.equal(p1.cd.q - m.time, 1200, `etapa ${etapa} CD 1200ms`);
    sim.tick(m, 1300); p1.energy = 9999; // expira CD da etapa, dentro da janela
  }
  assert.ok(p2.hp < hp2 && p3.hp < hp3, 'cone atinge inimigos à frente');
  assert.equal(p4.hp, hp4, 'cone NÃO atinge quem está atrás');
  const e0 = p1.energy;
  const r3 = sim.useSkill(m, 'p1', 'Q', 'p2', { x: 11, y: 10 });
  assert.ok(r3.ok, `rage etapa 3: ${r3.error || ''}`);
  assert.equal(Math.round((e0 - p1.energy) * 100) / 100, 4, 'etapa 3 custa 4');
  assert.ok(Math.abs(p1.x - 11) < 0.01, '3ª etapa salta ao ponto');
  assert.ok(p2.cc.rootUntil > m.time, '3ª etapa aplica root em área');
});
// ---- W inimigo direto ----
for (const [wid, extra] of [
  ['deadly-chop', {}],
  ['forbidden-stab', { weapon: 'dagger', q: 'sunder-armor', w: 'forbidden-stab' }],
  ['chain-slash', { weapon: 'dagger', q: 'sunder-armor', w: 'chain-slash' }],
  ['flame-blast', { weapon: 'fire', q: 'fire-bolt', w: 'flame-blast', e: 'pyroblast' }],
  ['frost-beam', { weapon: 'frost', q: 'frostbite', w: 'frost-beam', e: 'freezing-wind' }],
  ['fire-artillery', { weapon: 'fire', q: 'fire-bolt', w: 'fire-artillery', e: 'pyroblast' }],
]) {
  test(`sweep W inimigo ${wid}: gasto+CD==catálogo`, () => {
    const { m, p1 } = wid === 'chain-slash' ? ctxFFA(extra, {}, 1) : ctxFFA(extra);
    const { cat, e0 } = checkSpend(m, p1, 'W', wid);
    const r = sim.useSkill(m, 'p1', 'W', 'p2', { x: 11, y: 10 });
    assert.ok(r.ok, `${wid} ok: ${r.error || ''}`);
    expectSpent(m, p1, 'W', cat, e0, wid);
  });
}
// ---- W direcao/cone (inimigo + ponto) ----
for (const [wid, extra] of [
  ['throwing-blades', { weapon: 'dagger', q: 'sunder-armor', w: 'throwing-blades' }],
  ['shadow-edge', { weapon: 'dagger', q: 'sunder-armor', w: 'shadow-edge' }],
  ['raging-flare', { weapon: 'fire', q: 'fire-bolt', w: 'raging-flare', e: 'pyroblast' }],
  ['fire-wave', { weapon: 'fire', q: 'fire-bolt', w: 'fire-wave', e: 'pyroblast' }],
  ['frost-lance', { weapon: 'frost', q: 'frostbite', w: 'frost-lance', e: 'freezing-wind' }],
  ['holy-orb', { weapon: 'holy', q: 'generous-heal', w: 'holy-orb', e: 'desperate-prayer' }],
]) {
  test(`sweep W direcao ${wid}: gasto+CD==catálogo`, () => {
    const mk = () => ctxAlly(extra);
    const use = wid === 'holy-orb'
      ? () => { const { m, a1, a2 } = mk(); a2.x = 12; a2.y = 10; a2.hp = a2.maxHp - 500;
          const cat = catalog.getSkill(wid); const e0 = a1.energy;
          const r = sim.useSkill(m, 'a1', 'W', 'a2', { x: 20, y: 10 });
          assert.ok(r.ok, `${wid} ok: ${r.error || ''}`);
          expectSpent(m, a1, 'W', cat, e0, wid); }
      : () => { const { m, p1 } = ctxFFA(extra);
          const { cat, e0 } = checkSpend(m, p1, 'W', wid);
          const r = sim.useSkill(m, 'p1', 'W', 'p2', { x: 11, y: 10 });
          assert.ok(r.ok, `${wid} ok: ${r.error || ''}`);
          if (wid === 'shadow-edge') {
            assert.equal(Math.round((e0 - p1.energy) * 100) / 100, cat.cost, 'custo 41');
            assert.equal(p1.cd.w - m.time, 15000, 'CD 15s após acertar player (-25% de 20s)');
          } else expectSpent(m, p1, 'W', cat, e0, wid); };
    use();
  });
}
// ---- W ponto/chão ----
for (const [wid, extra, px, py] of [
  ['battle-rush', {}, 20, 10],
  ['frost-bomb', { weapon: 'frost', q: 'frostbite', w: 'frost-bomb', e: 'freezing-wind' }, 11, 10],
  ['frost-nova', { weapon: 'frost', q: 'frostbite', w: 'frost-nova', e: 'freezing-wind' }, 14, 10],
  ['glacial-obelisk', { weapon: 'frost', q: 'frostbite', w: 'glacial-obelisk', e: 'freezing-wind' }, 15, 10],
  ['dash', { weapon: 'dagger', q: 'sunder-armor', w: 'dash' }, 16, 10],
]) {
  test(`sweep W ponto ${wid}: gasto+CD==catálogo`, () => {
    const { m, p1 } = ctxFFA({ ...extra, w: wid });
    const { cat, e0 } = checkSpend(m, p1, 'W', wid);
    const r = sim.useSkill(m, 'p1', 'W', wid === 'dash' || wid === 'frost-nova' || wid === 'battle-rush' ? null : 'p2', { x: px, y: py });
    assert.ok(r.ok, `${wid} ok: ${r.error || ''}`);
    expectSpent(m, p1, 'W', cat, e0, wid);
  });
}
// ---- W área (centrada no usuário) ----
for (const [wid, wextra] of [['internal-bleeding', { w: 'internal-bleeding' }], ['raging-blades', { w: 'raging-blades' }]]) {
  test(`sweep W área ${wid}: gasto+CD==catálogo`, () => {
    const { m, p1 } = ctxFFA(wextra);
    const { cat, e0 } = checkSpend(m, p1, 'W', wid);
    const r = sim.useSkill(m, 'p1', 'W', 'p2');
    assert.ok(r.ok, `${wid} ok: ${r.error || ''}`);
    expectSpent(m, p1, 'W', cat, e0, wid);
  });
}
test('sweep W self adrenaline-boost: gasto+CD==catálogo', () => {
  const { m, p1 } = ctxFFA({ w: 'adrenaline-boost' });
  const { cat, e0 } = checkSpend(m, p1, 'W', 'adrenaline-boost');
  const r = sim.useSkill(m, 'p1', 'W', null, null);
  assert.ok(r.ok, `adrenaline-boost ok: ${r.error || ''}`);
  expectSpent(m, p1, 'W', cat, e0, 'adrenaline-boost');
});
// ---- W aliado ----
for (const wid of ['sacred-pulse', 'holy-blessing', 'holy-beam']) {
  test(`sweep W aliado ${wid}: gasto+CD==catálogo`, () => {
    const { m, a1 } = ctxAlly({ weapon: 'holy', q: 'generous-heal', w: wid, e: 'desperate-prayer' });
    const cat = catalog.getSkill(wid); const e0 = a1.energy;
    const r = sim.useSkill(m, 'a1', 'W', 'a2');
    assert.ok(r.ok, `${wid} ok: ${r.error || ''}`);
    assert.equal(Math.round((e0 - a1.energy) * 100) / 100, cat.cost, `${wid} custo`);
    assert.equal(a1.cd.w - m.time, Math.round(cat.cd * 1000), `${wid} CD`);
  });
}
test('sweep E blood-bandit: gasto+CD==catálogo', () => {
  const { m, p1 } = ctxFFA();
  const { cat, e0 } = checkSpend(m, p1, 'E', 'blood-bandit');
  const r = sim.useSkill(m, 'p1', 'E', 'p2', { x: 11, y: 10 });
  assert.ok(r.ok, `blood-bandit ok: ${r.error || ''}`);
  expectSpent(m, p1, 'E', cat, e0, 'blood-bandit');
});
test('sweep E self bloodthirsty-blade: gasto+CD==catálogo e liga', () => {
  const { m, p1 } = ctxFFA({ weapon: 'dagger', q: 'sunder-armor', w: 'forbidden-stab', e: 'bloodthirsty-blade' });
  const { cat, e0 } = checkSpend(m, p1, 'E', 'bloodthirsty-blade');
  const r = sim.useSkill(m, 'p1', 'E', null, null);
  assert.ok(r.ok, `bloodthirsty ok: ${r.error || ''}`);
  expectSpent(m, p1, 'E', cat, e0, 'bloodthirsty-blade');
});
test('sweep E inimigo pyroblast: gasto+CD==catálogo (inicia conjuração)', () => {
  const { m, p1 } = ctxFFA({ weapon: 'fire', q: 'fire-bolt', w: 'flame-blast', e: 'pyroblast' });
  const { cat, e0 } = checkSpend(m, p1, 'E', 'pyroblast');
  const r = sim.useSkill(m, 'p1', 'E', 'p2', { x: 11, y: 10 });
  assert.ok(r.ok, `pyroblast ok: ${r.error || ''}`);
  expectSpent(m, p1, 'E', cat, e0, 'pyroblast');
});
test('sweep E cone freezing-wind: gasto+CD==catálogo', () => {
  const { m, p1 } = ctxFFA({ weapon: 'frost', q: 'frostbite', w: 'frost-bomb', e: 'freezing-wind' });
  const { cat, e0 } = checkSpend(m, p1, 'E', 'freezing-wind');
  const r = sim.useSkill(m, 'p1', 'E', 'p2', { x: 11, y: 10 });
  assert.ok(r.ok, `freezing-wind ok: ${r.error || ''}`);
  expectSpent(m, p1, 'E', cat, e0, 'freezing-wind');
});
test('sweep E aliado desperate-prayer: gasto+CD==catálogo', () => {
  const { m, a1 } = ctxAlly({ weapon: 'holy', q: 'generous-heal', w: 'sacred-pulse', e: 'desperate-prayer' });
  const cat = catalog.getSkill('desperate-prayer'); const e0 = a1.energy;
  const r = sim.useSkill(m, 'a1', 'E', 'a2');
  assert.ok(r.ok, `desperate-prayer ok: ${r.error || ''}`);
  assert.equal(Math.round((e0 - a1.energy) * 100) / 100, cat.cost, 'custo');
  assert.equal(a1.cd.e - m.time, Math.round(cat.cd * 1000), 'CD');
});
// ---- armadura: HEAD ----
for (const [hid, hskill, hpass] of [['mercenary-hood', 'cleanse', 'swiftness'], ['soldier-helmet', 'stone-skin', 'toughness'], ['scholar-cowl', 'force-field', 'aggression']]) {
  test(`sweep HEAD ${hid}/${hskill}: gasto+CD==catálogo`, () => {
    const { m, p1 } = ctxFFA({ head: hid, headActive: hskill, headPassive: hpass });
    const cat = catalog.getSkill(hskill);
    const e0 = p1.energy;
    const r = hskill === 'force-field'
      ? sim.useSkill(m, 'p1', 'HEAD', null, null)
      : sim.useSkill(m, 'p1', 'HEAD', null, null);
    assert.ok(r.ok, `${hskill} ok: ${r.error || ''}`);
    assert.equal(Math.round((e0 - p1.energy) * 100) / 100, cat.cost, `${hskill} custo`);
    assert.equal(p1.cd.head - m.time, Math.round(cat.cd * 1000), `${hskill} CD`);
  });
}
test('sweep HEAD howl cone: gasto+CD==catálogo', () => {
  const { m, p1 } = ctxFFA({ head: 'mercenary-hood', headActive: 'howl' });
  const cat = catalog.getSkill('howl');
  const e0 = p1.energy;
  const r = sim.useSkill(m, 'p1', 'HEAD', 'p2', { x: 20, y: 10 });
  assert.ok(r.ok, `howl ok: ${r.error || ''}`);
  assert.equal(Math.round((e0 - p1.energy) * 100) / 100, cat.cost, 'howl custo');
  assert.equal(p1.cd.head - m.time, Math.round(cat.cd * 1000), 'howl CD');
});
// ---- armadura: CHEST ----
for (const [cid, cskill, cpass] of [['mercenary-jacket', 'bloodlust', 'swiftness'], ['mercenary-jacket', 'inferno-shield', 'swiftness'], ['soldier-armor', 'taunt', 'toughness'], ['soldier-armor', 'fury', 'toughness'], ['scholar-robe', 'frost-shield', 'aggression'], ['scholar-robe', 'speed-caster', 'aggression']]) {
  test(`sweep CHEST ${cid}/${cskill}: gasto+CD==catálogo`, () => {
    const over = { chest: cid, chestActive: cskill, chestPassive: cpass };
    if (cid === 'soldier-armor') over.chestPassive2 = 'spirit-crush';
    const { m, p1 } = ctxFFA(over);
    const cat = catalog.getSkill(cskill);
    const e0 = p1.energy;
    const tgt = cskill === 'taunt' ? 'p2' : null;
    const r = sim.useSkill(m, 'p1', 'CHEST', tgt, tgt ? { x: 11, y: 10 } : null);
    assert.ok(r.ok, `${cskill} ok: ${r.error || ''}`);
    assert.equal(Math.round((e0 - p1.energy) * 100) / 100, cat.cost, `${cskill} custo`);
    assert.equal(p1.cd.chest - m.time, Math.round(cat.cd * 1000), `${cskill} CD`);
  });
}
test('sweep CHEST mend-wounds fora de combate: gasto+CD==catálogo', () => {
  const { m, p1 } = ctxFFA({ chest: 'mercenary-jacket', chestActive: 'mend-wounds' });
  const cat = catalog.getSkill('mend-wounds');
  const e0 = p1.energy;
  const r = sim.useSkill(m, 'p1', 'CHEST', null, null);
  assert.ok(r.ok, `mend ok: ${r.error || ''}`);
  assert.equal(Math.round((e0 - p1.energy) * 100) / 100, cat.cost, 'mend custo');
  assert.equal(p1.cd.chest - m.time, Math.round(cat.cd * 1000), 'mend CD');
});
// ---- armadura: BOOTS ----
for (const [bid, bskill, pt, bpass] of [
  ['mercenary-shoes', 'dodge', { x: 13, y: 10 }, 'swiftness'],
  ['mercenary-shoes', 'break-free', { x: 20, y: 10 }, 'swiftness'],
  ['soldier-boots', 'rejuvenating-sprint', null, 'toughness'],
  ['scholar-sandals', 'energetic-sprint', null, 'aggression'],
  ['scholar-sandals', 'focused-run', null, 'aggression'],
]) {
  test(`sweep BOOTS ${bid}/${bskill}: gasto+CD==catálogo`, () => {
    const { m, p1 } = ctxFFA({ boots: bid, bootsActive: bskill, bootsPassive: bpass });
    const cat = catalog.getSkill(bskill);
    const e0 = p1.energy;
    const r = sim.useSkill(m, 'p1', 'BOOTS', null, pt);
    assert.ok(r.ok, `${bskill} ok: ${r.error || ''}`);
    assert.equal(Math.round((e0 - p1.energy) * 100) / 100, cat.cost, `${bskill} custo`);
    assert.equal(p1.cd.boots - m.time, Math.round(cat.cd * 1000), `${bskill} CD`);
  });
}
