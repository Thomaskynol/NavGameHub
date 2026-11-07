'use strict';
// E direcional autoritativo (Blood Bandit): mira=servidor, cone 17m, LOS, miss permitido.
// RED inicial: etapa1/etapa2 devem validar direção/x-y, não só targetId/dist.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return {
    weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
    offhand: 'shield', head: 'mercenary-hood', headActive: 'cleanse', headPassive: 'swiftness',
    chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness',
    boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness',
    cape: 'bridgewatch', weaponPassive: 'deep-cuts', ...over,
  };
}
function arena() {
  const m = sim.createMatch('EDIR', { mode: 'ffa', durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Um', B());
  sim.joinPlayer(m, 'p2', 'Dois', B());
  sim.joinPlayer(m, 'p3', 'Tres', B());
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true); sim.setReady(m, 'p3', true);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2'), p3 = m.players.get('p3');
  p1.x = 10; p1.y = 10; p2.x = 15; p2.y = 10; p3.x = 10; p3.y = 15;
  sim.tick(m, 4000);
  p1.energy = 9999; p2.energy = 9999; p3.energy = 9999;
  p1.protUntil = 0; p2.protUntil = 0; p3.protUntil = 0;
  return { m, p1, p2, p3 };
}

test('E etapa1: alvo na direção sofre dano; fora da direção não', () => {
  const { m, p1, p2, p3 } = arena();
  const h2 = p2.hp, h3 = p3.hp;
  // mira +x: p2 em (15,10) na trajetória, p3 em (10,15) fora
  const r = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  assert.ok(r.ok, 'acerta na direção: ' + (r.error || ''));
  assert.ok(p2.hp < h2, 'alvo na direção sofre dano');
  assert.equal(p3.hp, h3, 'fora da trajetória não sofre dano só por estar perto');
});

test('E etapa1: 2 inimigos na direção sofrem dano; clique sem inimigo permite errar', () => {
  const { m, p1, p2, p3 } = arena();
  p3.x = 16; p3.y = 10; // ambos no eixo +x
  const h2 = p2.hp, h3 = p3.hp;
  const r = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  assert.ok(r.ok, 'cone atinge: ' + (r.error || ''));
  assert.ok(p2.hp < h2 && p3.hp < h3, '2 inimigos na direção sofrem dano');
  // clique sem inimigo e sem direção útil: mira para longe vazio
  const a2 = arena();
  const m2 = a2.m;
  const q1 = a2.p1;
  q1.energy = 9999;
  // move todos para longe da mira
  m2.players.get('p2').x = 80; m2.players.get('p2').y = 80;
  m2.players.get('p3').x = 81; m2.players.get('p3').y = 80;
  const e0 = q1.energy;
  const r2 = sim.useSkill(m2, 'p1', 'E', null, { x: 27, y: 10 });
  assert.equal(r2.ok, false, 'sem acerto permite errar');
  assert.match(r2.error || '', /Errou/i, 'motivo Errou');
  assert.ok(e0 - q1.energy >= 39, 'errou mas gastou (lançamento válido)');
});

test('E etapa1: inimigo fora da trajetória não é atingido só por targetId perto do clique', () => {
  const { m, p1, p2, p3 } = arena();
  // p3 ao norte (10,15); p2 longe da trajetória para isolar o caso
  p2.x = 80; p2.y = 80;
  const h = p3.hp, h2 = p2.hp;
  const r = sim.useSkill(m, 'p1', 'E', 'p3', { x: 27, y: 10 });
  // direção +x, p3 ao norte: deve errar mesmo com targetId explícito
  assert.equal(r.ok, false, 'fora da trajetória não aplica dano: ' + JSON.stringify(r));
  assert.match(r.error || '', /Errou/i, 'motivo Errou');
  assert.equal(p3.hp, h, 'HP intacto fora da trajetória');
  assert.equal(p2.hp, h2, 'distante intacto');
});

test('E etapa1: obstáculo bloqueia (segmentBlocked) sem dano', () => {
  const { m, p1, p2, p3 } = arena();
  // torre central 44..56: p1 a oeste e p2 logo atrás da borda oeste, mira dentro de 17m mas com parede no meio
  p1.x = 35; p1.y = 50; p2.x = 48; p2.y = 50; p3.x = 80; p3.y = 80;
  p1.energy = 9999;
  const h = p2.hp;
  const r = sim.useSkill(m, 'p1', 'E', null, { x: 48, y: 50 });
  // dealDamage tem LOS; cone atinge mas LOS bloqueia -> Errou (gasto) sem dano
  assert.equal(p2.hp, h, 'obstáculo bloqueia dano');
  // aceita ok com 0 hits? Não: deve retornar Errou (sem acerto efetivo)
  assert.equal(r.ok, false, 'bloqueado retorna Errou, não ok fingido');
  assert.match(r.error || '', /Errou|bloqueia/i);
});

test('E etapa2 direcional: exige direção, valida cone, consome janela', () => {
  const { m, p1, p2, p3 } = arena();
  p1.energy = 9999;
  const r1 = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  assert.ok(r1.ok, 'etapa1 arma: ' + (r1.error || ''));
  assert.ok(p1.eStage && p1.eStage.until > m.time, 'janela 9s armada');
  // etapa2 na mesma direção atinge p2 e cura p1
  p1.hp = p1.maxHp - 500;
  const h2 = p2.hp, hp1 = p1.hp;
  const r2 = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  assert.ok(r2.ok, 'etapa2 na direção: ' + (r2.error || ''));
  assert.ok(p2.hp < h2, 'etapa2 dano na direção');
  assert.ok(p1.hp > hp1, 'etapa2 cura');
  assert.equal(p1.eStage, null, 'etapa2 consome janela');
});

test('E etapa2 fora da direção erra sem dano; expiração limpa janela', () => {
  const { m, p1, p2 } = arena();
  p1.energy = 9999;
  sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  // move p2 para fora da nova mira (norte) e tenta etapa2 para o sul vazio
  p2.x = 10; p2.y = 15;
  const h = p2.hp;
  p1.energy = 9999;
  const r2 = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 30 });
  // p2 ao norte, mira ao sul-leste: deve errar
  assert.equal(r2.ok, false, 'etapa2 fora erra');
  assert.equal(p2.hp, h, 'sem dano fora');
  // expiração: nova etapa1 arma, tick 9.5s limpa
  const b2 = arena();
  const m2b = b2.m;
  b2.p1.energy = 9999;
  sim.useSkill(m2b, 'p1', 'E', null, { x: 27, y: 10 });
  assert.ok(m2b.players.get('p1').eStage, 'armada');
  sim.tick(m2b, 9500);
  assert.equal(sim.snapshot(m2b).players.find((p) => p.id === 'p1').eCombo, null, 'expirou limpa sinal');
});

test('E etapa1: 2 no cone curam pelo da frente (projeção, não ordem Map)', () => {
  const { m, p1, p2, p3 } = arena();
  // frente = menor projeção na direção +x: p3 em (12,10), p2 ao fundo em (16,10)
  p3.x = 12; p3.y = 10; p2.x = 16; p2.y = 10;
  p3.rend = 3; p3.rendUntil = m.time + 6000;
  p2.rend = 0; p2.rendUntil = m.time + 6000;
  p1.energy = 9999;
  const r = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  assert.ok(r.ok, 'cone atinge os dois: ' + (r.error || ''));
  assert.equal(p1.eStage && p1.eStage.stacks, 3, 'stacks do mais próximo na trajetória (frente), não do 1º no Map');
});

test('E alvo em movimento: usa posição no lançamento', () => {
  const { m, p1, p2 } = arena();
  p1.energy = 9999;
  // p2 corre para fora antes do cast: move p2 ao norte, mira onde ele estava (+x) deve errar
  p2.x = 10; p2.y = 15;
  const h = p2.hp;
  const r = sim.useSkill(m, 'p1', 'E', null, { x: 27, y: 10 });
  assert.equal(r.ok, false, 'alvo que saiu da trajetória não é atingido');
  assert.match(r.error || '', /Errou/i, 'motivo Errou (não Alvo inválido)');
  assert.equal(p2.hp, h, 'sem dano em alvo móvel fora');
});

test('E 2v2: aliado na direção não sofre dano; inimigo sim', () => {
  const B2 = (over = {}) => ({
    weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
    offhand: 'shield', head: 'mercenary-hood', headActive: 'cleanse', headPassive: 'swiftness',
    chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness',
    boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness',
    cape: 'bridgewatch', weaponPassive: 'deep-cuts', ...over,
  });
  const m = sim.createMatch('E22', { mode: '2v2', durationSec: 300 });
  sim.joinPlayer(m, 'a1', 'A1', B2(), 0);
  sim.joinPlayer(m, 'a2', 'A2', B2(), 0);
  sim.joinPlayer(m, 'b1', 'B1', B2(), 1);
  sim.joinPlayer(m, 'b2', 'B2', B2(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  const a1 = m.players.get('a1'), a2 = m.players.get('a2'), b1 = m.players.get('b1');
  a1.x = 10; a1.y = 10; a2.x = 15; a2.y = 10; b1.x = 16; b1.y = 10;
  m.players.get('b2').x = 80; m.players.get('b2').y = 80;
  sim.tick(m, 4000);
  a1.energy = 9999;
  a1.protUntil = 0; a2.protUntil = 0; b1.protUntil = 0;
  const ha = a2.hp, hb = b1.hp;
  const r = sim.useSkill(m, 'a1', 'E', null, { x: 27, y: 10 });
  assert.ok(r.ok, 'cone atinge: ' + (r.error || ''));
  assert.equal(a2.hp, ha, 'aliado protegido no 2v2');
  assert.ok(b1.hp < hb, 'inimigo na direção sofre dano');
});

test('E treino PvE: monstro na direção sofre dano; etapa2 cura', () => {
  const Bp = {
    weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
    offhand: 'shield', head: 'mercenary-hood', headActive: 'cleanse', headPassive: 'swiftness',
    chest: 'mercenary-jacket', chestActive: 'bloodlust', chestPassive: 'swiftness',
    boots: 'mercenary-shoes', bootsActive: 'dodge', bootsPassive: 'swiftness',
    cape: 'bridgewatch', weaponPassive: 'deep-cuts',
  };
  const m = sim.createMatch('EPVE', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', Bp);
  sim.setReady(m, 'p1', true);
  const p1 = m.players.get('p1');
  p1.x = 30; p1.y = 50; m.monster.x = 35; m.monster.y = 50;
  p1.energy = 9999;
  const hm = m.monster.hp;
  const r1 = sim.useSkill(m, 'p1', 'E', null, { x: 45, y: 50 });
  assert.ok(r1.ok, 'etapa1 PvE: ' + (r1.error || ''));
  assert.ok(m.monster.hp < hm, 'monstro na direção sofre dano');
  assert.ok(p1.eStage, 'janela armada no treino');
  p1.hp = p1.maxHp - 500;
  const hp1 = p1.hp, hm2 = m.monster.hp;
  const r2 = sim.useSkill(m, 'p1', 'E', null, { x: 45, y: 50 });
  assert.ok(r2.ok, 'etapa2 PvE: ' + (r2.error || ''));
  assert.ok(m.monster.hp < hm2, 'etapa2 dano no monstro');
  assert.ok(p1.hp > hp1, 'etapa2 cura no treino');
});
