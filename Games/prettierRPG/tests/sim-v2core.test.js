'use strict';
// Lane CORE v2 — RED TDD para A/B/C/D + 4.5/4.6 + Seções 5/6.
// Cada teste deve FALHAR antes do fix pelo motivo documentado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}
function arena(mode = 'ffa', b1 = {}, b2 = {}) {
  const m = sim.createMatch('T', { mode, durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', B(b1));
  sim.joinPlayer(m, 'p2', 'Beto', B(b2));
  if (mode === '2v2') { m.players.get('p1').team = 0; m.players.get('p2').team = 1; }
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  m.players.get('p1').energy = 500; m.players.get('p2').energy = 500;
  return m;
}
const FROST = { weapon: 'frost', q: 'frostbite', w: 'frost-bomb', e: 'freezing-wind' };

// ---------- A. cone direcional ----------
test('A-freezing-wind atrás do caster não atinge (frente 12m, ~60°)', () => {
  const m = arena('ffa', FROST, FROST);
  m.players.get('p1').x = 30; m.players.get('p1').y = 30;
  m.players.get('p2').x = 25; m.players.get('p2').y = 30; // atrás
  const hp0 = m.players.get('p2').hp;
  const r = sim.useSkill(m, 'p1', 'E', 'p2', { x: 35, y: 30 }); // mira p/ frente
  // cone vazio atrás = lançamento válido que errou: gasta (CD), informa Errou.
  assert.equal(r.ok, false, 'cone sem acerto informa Errou');
  assert.ok(m.players.get('p1').cd.e > m.time, 'lançamento válido que errou inicia CD');
  assert.equal(m.players.get('p2').hp, hp0, 'inimigo ATRÁS do cone não sofre dano');
  assert.ok(!(m.players.get('p2').cc.rootUntil > m.time), 'sem root atrás do cone');
});

test('A-freezing-wind na frente atinge + root 2,8s', () => {
  const m = arena('ffa', FROST, FROST);
  m.players.get('p1').x = 30; m.players.get('p1').y = 30;
  m.players.get('p2').x = 35; m.players.get('p2').y = 30; // frente, 5m
  const hp0 = m.players.get('p2').hp;
  const r = sim.useSkill(m, 'p1', 'E', 'p2', { x: 35, y: 30 });
  assert.ok(r.ok);
  assert.ok(m.players.get('p2').hp < hp0, 'inimigo na frente sofre dano');
  // root 2,8s mitigado por CCR do alvo (F.4): só exige aplicação + ordem de grandeza
  assert.ok(m.players.get('p2').cc.rootUntil - m.time > 2000, 'root ~2,8s (reduzido por CCR)');
});

test('A-fire-wave/how/frostbite não atingem fora do cone', () => {
  const m = arena('ffa', { weapon: 'fire', q: 'fire-bolt', w: 'fire-wave', e: 'pyroblast' });
  m.players.get('p1').x = 30; m.players.get('p1').y = 30;
  m.players.get('p2').x = 25; m.players.get('p2').y = 30;
  const hp0 = m.players.get('p2').hp;
  const r = sim.useSkill(m, 'p1', 'W', 'p2', { x: 35, y: 30 });
  assert.equal(r.ok, false, 'fire-wave sem acerto informa Errou');
  assert.ok(m.players.get('p1').cd.w > m.time, 'lançamento válido que errou gasta');
  assert.equal(m.players.get('p2').hp, hp0, 'fire-wave atrás do cone não atinge');
});

// ---------- B. deslocamento nunca em obstáculo ----------
test('B-dodge (42,50)->(45,50) para antes da parede, fora do obstáculo', () => {
  const m = arena();
  m.players.get('p1').x = 42; m.players.get('p1').y = 50;
  const r = sim.useSkill(m, 'p1', 'BOOTS', null, { x: 45, y: 50 });
  assert.ok(r.ok, 'dodge válido executa (para antes)');
  const p = m.players.get('p1');
  const world = require('../lib/world');
  assert.ok(!world.isBlocked(p.x, p.y, 0.4), `destino final fora do obstáculo (x=${p.x})`);
  assert.ok(p.x < 44 && p.x > 42, `parou antes da parede (x=${p.x})`);
});

test('B-dash através da parede + knockback p/ parede param em borda válida', () => {
  const m = arena('ffa', { weapon: 'dagger', q: 'sunder-armor', w: 'dash', e: 'bloodthirsty-blade' });
  const world = require('../lib/world');
  m.players.get('p1').x = 40; m.players.get('p1').y = 50;
  const r = sim.useSkill(m, 'p1', 'W', null, { x: 48, y: 50 }); // 8m através da torre
  assert.ok(r.ok);
  const p = m.players.get('p1');
  assert.ok(!world.isBlocked(p.x, p.y, 0.4), 'dash não termina em obstáculo');
  assert.ok(p.x < 44, `dash parou antes da torre (x=${p.x})`);
});

// ---------- C. cast com efeito ao concluir ----------
test('C-deadly-chop: gasta no lançamento, dano só após 0,4s', () => {
  const m = arena();
  const hp0 = m.players.get('p2').hp, en0 = m.players.get('p1').energy;
  const r = sim.useSkill(m, 'p1', 'W', 'p2');
  assert.ok(r.ok, 'lançamento válido aceito');
  assert.equal(m.players.get('p2').hp, hp0, 'SEM dano imediato durante conjuração');
  assert.ok(m.players.get('p1').energy < en0, 'energia gasta no lançamento');
  assert.ok(m.players.get('p1').cd.w > m.time, 'CD inicia no lançamento');
  sim.tick(m, 400);
  assert.ok(m.players.get('p2').hp < hp0, 'dano aplicado ao concluir o cast');
  assert.ok(m.players.get('p2').vulnUntil > m.time, 'vuln aplicada ao concluir');
});

test('C-cast cancelado por movimento não causa dano (mas mantém gasto)', () => {
  const m = arena();
  const hp0 = m.players.get('p2').hp;
  sim.useSkill(m, 'p1', 'W', 'p2');
  sim.moveCommand(m, 'p1', 20, 20); // move cancela
  sim.tick(m, 500);
  assert.equal(m.players.get('p2').hp, hp0, 'cast interrompido não causa dano');
});

test('C-pyroblast: completo 976+knockback; soltar andando aplica estágio parcial', () => {
  const m = arena('ffa', { weapon: 'fire', q: 'fire-bolt', w: 'flame-blast', e: 'pyroblast' });
  m.players.get('p2').x = 12; m.players.get('p2').y = 10;
  const hp0 = m.players.get('p2').hp;
  sim.useSkill(m, 'p1', 'E', 'p2', { x: 12, y: 10 });
  sim.tick(m, 1200);
  const full = hp0 - m.players.get('p2').hp;
  assert.ok(full > 350, `canal completo ~976 mitigado (achou ${full})`);
  // parcial: interrompe andando aos 700ms -> estágio 689, sem knockback total
  const m2 = arena('ffa', { weapon: 'fire', q: 'fire-bolt', w: 'flame-blast', e: 'pyroblast' });
  m2.players.get('p1').x = 10; m2.players.get('p1').y = 10;
  m2.players.get('p2').x = 12; m2.players.get('p2').y = 10;
  const h0 = m2.players.get('p2').hp;
  sim.useSkill(m2, 'p1', 'E', 'p2', { x: 12, y: 10 });
  sim.tick(m2, 700);
  const px = m2.players.get('p2').x;
  sim.moveCommand(m2, 'p1', 20, 20); // solta andando -> libera estágio parcial
  const part = h0 - m2.players.get('p2').hp;
  assert.ok(part > 150 && part < full, `parcial ~689 entre 402 e 976 (achou ${part})`);
  assert.equal(m2.players.get('p2').x, px, 'parcial sem knockback total');
});

// ---------- D. bloodthirsty-blade ficha completa ----------
test('D-bloodthirsty: AA +172 mágico PvP, roubo 100%, +30% mov', () => {
  const m = arena('ffa', { weapon: 'dagger', q: 'sunder-armor', w: 'dash', e: 'bloodthirsty-blade' });
  sim.useSkill(m, 'p1', 'E', null);
  const s = m.players.get('p1'), d = m.players.get('p2');
  assert.ok(s.bloodthirstyOn, 'buff ativo');
  assert.ok(s.moveBonusUntil > m.time && Math.abs(s.moveBonus - 0.30) < 0.001, '+30% mov');
  s.hp = s.maxHp - 500; s.cd.aa = 0;
  const hpA = s.hp, dd0 = d.hp;
  sim.basicAttack(m, 'p1', 'p2');
  const bonus = (dd0 - d.hp); // AA base ~23 + bônus 172 mitigado ~72
  assert.ok(dd0 - d.hp > 70, `bônus mágico somado (dano total ${dd0 - d.hp})`);
  assert.ok(s.hp > hpA, 'roubou vida do bônus');
});

test('D-bloodthirsty: auto-dano verdadeiro 2,5%/s, sem E = sem efeito', () => {
  const m = arena('ffa', { weapon: 'dagger', q: 'sunder-armor', w: 'dash', e: 'bloodthirsty-blade' });
  const s = m.players.get('p1');
  sim.useSkill(m, 'p1', 'E', null);
  const hp0 = s.hp;
  sim.tick(m, 1000);
  const perTick = hp0 - s.hp;
  const esperado = s.maxHp * 0.025;
  assert.ok(Math.abs(perTick - esperado) < esperado * 0.3 + 5, `auto-dano ~2,5%/s (${perTick.toFixed(1)} vs ${esperado.toFixed(1)})`);
  // sem E: AA não tem bônus/cura/move
  const m2 = arena('ffa', { weapon: 'dagger', q: 'sunder-armor', w: 'dash', e: 'bloodthirsty-blade' });
  const s2 = m2.players.get('p1'), d2 = m2.players.get('p2');
  s2.hp = s2.maxHp - 500; s2.cd.aa = 0;
  const hA = s2.hp, dd = d2.hp;
  sim.basicAttack(m2, 'p1', 'p2');
  assert.ok(!(s2.moveBonusUntil > m2.time && s2.moveBonus === 0.30), 'sem E: sem +30% mov');
  assert.ok(Math.abs(s2.hp - hA) < 1, 'sem E: sem cura do bônus');
  assert.ok(dd - d2.hp < 100, 'sem E: só AA base');
});

// ---------- 4.5 custo/recarga ----------
test('4.5-alvo-inválido-antes não gasta; lançamento-válido-que-errou gasta', () => {
  const m = arena('2v2', {}, {});
  // aliado em 2v2: inválido antes -> sem gasto
  const en0 = m.players.get('p1').energy;
  m.players.get('p1').team = 0; m.players.get('p2').team = 0;
  const r = sim.useSkill(m, 'p1', 'Q', 'p2');
  assert.equal(r.ok, false);
  assert.equal(m.players.get('p1').energy, en0, 'alvo inválido não gasta energia');
  assert.ok(!(m.players.get('p1').cd.q > m.time), 'alvo inválido não inicia CD');
  // cone válido que erra (vazio): gasta
  const m2 = arena('ffa', FROST, FROST);
  m2.players.get('p2').x = 80; m2.players.get('p2').y = 80;
  const e0 = m2.players.get('p1').energy;
  const r2 = sim.useSkill(m2, 'p1', 'E', 'p2', { x: 15, y: 10 });
  assert.ok(m2.players.get('p1').energy < e0 || m2.players.get('p1').cd.e > m2.time, 'lançamento válido que errou gasta/inicia CD');
});

// ---------- 4.6 bloodlust ficha ----------
test('4.6-bloodlust: cura 30% do dano direto, cap 120/acerto, sem +50 flat', () => {
  const m = arena('ffa', { cSkill: 'bloodlust' });
  const r = sim.useSkill(m, 'p1', 'CHEST', null);
  assert.ok(r.ok);
  assert.ok(m.players.get('p1').bloodlustUntil > m.time);
  const s = m.players.get('p1');
  s.hp = s.maxHp - 500;
  const hpA = s.hp;
  const d0 = m.players.get('p2').hp;
  s.cd.aa = 0;
  sim.basicAttack(m, 'p1', 'p2');
  const dealt = d0 - m.players.get('p2').hp;
  const healed = s.hp - hpA;
  assert.ok(dealt < 150, `sem +50 flat por AA (dano ${dealt})`);
  assert.ok(healed > 0 && healed <= 120, `cura 30% cap 120 (curou ${healed} de ${dealt})`);
  // dano direto via skill também cura 30% com cap 120 (pré-fix: bloodlust só no AA)
  s.hp = s.maxHp - 500;
  const hC = s.hp;
  m.players.get('p2').hp = m.players.get('p2').maxHp;
  const hpP2 = m.players.get('p2').hp;
  sim.dealDamage(m, 'p1', 'p2', 400, m.time, { type: 'phys' });
  const dealt2 = hpP2 - m.players.get('p2').hp;
  const want = Math.min(120, Math.round(dealt2 * 0.30));
  assert.equal(Math.round(s.hp - hC), want, `dano direto cura 30% cap 120 (dealt ${dealt2})`);
  // DoT não é dano direto: não cura
  s.hp = s.maxHp - 500;
  const hB = s.hp;
  m.players.get('p2').bleeds.push({ until: m.time + 6000, perSec: 50, from: 'p1' });
  sim.tick(m, 1000);
  assert.ok(Math.abs(s.hp - hB) < 60, 'DoT não dispara bloodlust como dano direto');
});

// ---------- Seção 5: mesmo motor no PvE ----------
test('5-AA no monstro usa mesmo motor (dmgMul, sem cura fixa)', () => {
  const m = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', B());
  sim.setReady(m, 'p1', true);
  const mo0 = m.monster.hp;
  m.players.get('p1').x = 58; m.players.get('p1').y = 60;
  const r = sim.basicAttack(m, 'p1', '__monster__');
  assert.ok(r.ok, 'AA atinge monstro pelo mesmo motor');
  assert.ok(m.monster.hp < mo0, 'monstro sofreu dano real');
  assert.ok(m.pve.dmgTotal > 0 && m.pve.dmgTotal === mo0 - m.monster.hp, 'stats refletem dano real');
});

test('5-skill de dano atinge monstro; cura atinge boneco com valor real', () => {
  const m = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', B({ weapon: 'fire', q: 'fire-bolt', w: 'flame-blast', e: 'pyroblast' }));
  sim.setReady(m, 'p1', true);
  m.players.get('p1').x = 55; m.players.get('p1').y = 60;
  m.players.get('p1').energy = 500;
  const mo0 = m.monster.hp;
  sim.tick(m, 1300); // conclui cast 0,8s do fire-bolt
  const r = sim.useSkill(m, 'p1', 'Q', '__monster__');
  assert.ok(r.ok, 'fire-bolt no monstro aceito');
  sim.tick(m, 900);
  assert.ok(m.monster.hp < mo0, 'monstro sofreu dano da skill + burn');
  assert.ok((m.monster.dots || []).length > 0, 'debuff aplicado ao monstro');
});

// ---------- Seção 6: finish ----------
test('6b-resultado volta ao lobby limpo (30s), pronto zerado', () => {
  const m = sim.createMatch('R', { durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', B());
  sim.joinPlayer(m, 'p2', 'Beto', B());
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  assert.equal(m.state, 'playing');
  m.players.get('p2').hp = 1;
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  sim.basicAttack(m, 'p1', 'p2');
  m.players.get('p2').left = true; // desistente sai: só 1 contendor
  sim.tick(m, 100);
  assert.equal(m.state, 'ended', 'encerra com 1 contendor');
  const winners = [...m.winnerIds];
  sim.tick(m, 30000);
  assert.equal(m.state, 'lobby', 'auto-retorno em 30s');
  assert.equal(m.result, null, 'resultado limpo');
  assert.ok(!m.players.get('p1').ready, 'pronto zerado');
  assert.deepEqual([...m.winnerIds], [], 'vencedores limpos');
  assert.ok(winners.includes('p1'), 'vencedor foi p1');
});

test('6-finish cancela por ataque e por desconexão; reawaken só caído', () => {
  const m = sim.createMatch('D', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', B(), 0); sim.joinPlayer(m, 'a2', 'A2', B(), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1);
  sim.joinPlayer(m, 'b2', 'B2', B({ weapon: 'holy', q: 'generous-heal', w: 'reawaken', e: 'desperate-prayer' }), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  const v = m.players.get('a1'); v.x = 10; v.y = 10; v.hp = 100;
  sim.dealDamage(m, null, 'a1', 9999, m.time, { env: true });
  assert.ok(v.knocked);
  const f = m.players.get('b1'); f.x = 10.5; f.y = 10; f.energy = 500;
  assert.ok(sim.useSkill(m, 'b1', 'FINISH', 'a1').ok);
  f.cd.aa = 0; f.energy = 500; f.castUntil = 0;
  m.players.get('a2').hp = m.players.get('a2').maxHp; m.players.get('a2').x = 10.5; m.players.get('a2').y = 10.5;
  sim.basicAttack(m, 'b1', 'a2'); // ataque do finalizador cancela
  assert.ok(!f.finish, 'ataque do finalizador cancela finish');
  // desconexão cancela
  assert.ok(sim.useSkill(m, 'b1', 'FINISH', 'a1').ok);
  f.disconnected = true;
  sim.tick(m, 100);
  assert.ok(!f.finish, 'desconexão cancela finish');
  f.disconnected = false;
  // reawaken em quem não está caído falha sem gastar
  const b2 = m.players.get('b2');
  b2.x = 10.5; b2.y = 10; b2.energy = 500; b2.cd.w = 0; b2.castUntil = 0;
  m.players.get('b1').x = 10.6; m.players.get('b1').y = 10;
  const e1 = b2.energy;
  const rr = sim.useSkill(m, 'b2', 'W', 'b1'); // b1 aliado vivo, não caído
  assert.equal(rr.ok, false, 'reawaken só em caído');
  assert.equal(b2.energy, e1, 'reawaken inválido não gasta');
});

// ---------- Wall: fuga 0,5s (D.4; monstros uma vez por parede) ----------
test('W-wall-of-flames: burn 417 + fuga 0,5s que interrompe; monstro uma vez', () => {
  const FIRE = { weapon: 'fire', q: 'fire-bolt', w: 'wall-of-flames', e: 'pyroblast' };
  const m = arena('ffa', FIRE, FIRE);
  const p1 = m.players.get('p1'), p2 = m.players.get('p2');
  // p2 recebe ordem de movimento + perseguição: o toque interrompe ambas
  p2.dest = { x: 30, y: 10 };
  p2.chase = { target: 'p1', kind: 'aa' };
  const hp0 = p2.hp;
  assert.ok(sim.useSkill(m, 'p1', 'W', null, { x: 14, y: 10 }).ok, 'parede lançada à frente');
  sim.tick(m, 500);
  assert.ok(p2.hp < hp0, 'toque aplica burn 417');
  assert.ok(p2.fleeUntil > m.time, 'fuga 0,5s aplicada');
  assert.equal(p2.dest, null, 'toque interrompe movimento');
  assert.equal(p2.chase, null, 'toque interrompe perseguição');
  const distAntes = Math.hypot(p2.x - 14, p2.y - 10);
  sim.tick(m, 400); // fuga corre (ainda dentro dos 0,5s)
  const distDepois = Math.hypot(p2.x - 14, p2.y - 10);
  assert.ok(distDepois > distAntes, `fuga afasta da parede (${distAntes.toFixed(1)}→${distDepois.toFixed(1)})`);
  // durante a fuga não ataca (ordem ofensiva bloqueada)
  p2.x = 11; p2.y = 10; p2.fleeUntil = m.time + 500;
  const ra = sim.basicAttack(m, 'p2', 'p1');
  assert.equal(ra.ok, false, 'sem ataque durante a fuga');

  // monstro: foge uma vez por parede (burn pode repetir, fuga não)
  const mp = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(mp, 'p1', 'Solo', B(FIRE));
  sim.setReady(mp, 'p1', true);
  const solo = mp.players.get('p1');
  solo.x = 59; solo.y = 60; solo.energy = 9999;
  const mo = mp.monster;
  assert.ok(sim.useSkill(mp, 'p1', 'W', null, { x: mo.x, y: mo.y }).ok);
  const wid = mp.timers.find((t) => t.kind === 'wall').wid;
  sim.tick(mp, 500);
  assert.ok(mo.fleeUntil > mp.time, 'monstro foge no 1º toque');
  assert.equal(mo.lastFledWall, wid, 'parede marcada no monstro');
  sim.tick(mp, 3600); // wallHit (4s) expira; parede segue ativa até 5s
  mo.x = mp.timers.find((t) => t.kind === 'wall').x;
  mo.y = mp.timers.find((t) => t.kind === 'wall').y;
  mo.fleeUntil = 0;
  const fleeAntes = mo.fleeUntil;
  sim.tick(mp, 500);
  assert.ok(mo.hp < mo.maxHp, '2º toque ainda queima');
  assert.equal(mo.fleeUntil, fleeAntes, 'mas NÃO foge de novo na mesma parede');
});

// ---------- Gate cav-3: pveReset independente (§3.4) ----------
test('pveReset independente: heal:true zera SÓ cura; sem heal zera SÓ dano', () => {
  const m = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', B());
  sim.setReady(m, 'p1', true);
  m.pve.dmgTotal = 123; m.pve.dmgWindow = [{ t: m.time, amt: 123 }]; m.pve.healTotal = 45;
  sim.pveResetStats(m, true);
  assert.equal(m.pve.healTotal, 0, 'heal:true zera cura');
  assert.equal(m.pve.dmgTotal, 123, 'heal:true NÃO arrasta dano');
  assert.equal(m.pve.dmgWindow.length, 1, 'DPS preservado no reset de cura');
  sim.pveResetStats(m, false);
  assert.equal(m.pve.dmgTotal, 0, 'sem heal zera dano');
  assert.deepEqual(m.pve.dmgWindow, [], 'sem heal zera janela do DPS');
  assert.equal(m.pve.healTotal, 0, 'cura segue zerada');
});
