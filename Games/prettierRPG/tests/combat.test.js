const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createMatch, joinPlayer, setReady, basicAttack, useSkill, leavePlayer, snapshot, endMatch, tick } = require('../lib/sim');

function twoPlayersStarted() {
  const m = createMatch('SALA1', { durationSec: 300 });
  joinPlayer(m, 'p1', 'Ana');
  joinPlayer(m, 'p2', 'Beto');
  setReady(m, 'p1', true);
  setReady(m, 'p2', true);
  assert.equal(m.state, 'playing');
  // aproxima para alcance (após start, que reposiciona)
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  return m;
}

test('ataque básico reduz HP do alvo no servidor', () => {
  const m = twoPlayersStarted();
  const antes = m.players.get('p2').hp;
  const ok = basicAttack(m, 'p1', 'p2');
  assert.equal(ok.ok, true);
  assert.ok(m.players.get('p2').hp < antes, 'HP deveria cair');
});

test('morte gera placar (kill para atacante, death para vítima)', () => {
  const m = twoPlayersStarted();
  m.players.get('p2').hp = 5;
  basicAttack(m, 'p1', 'p2');
  const p1 = m.players.get('p1');
  const p2 = m.players.get('p2');
  assert.equal(p2.alive, false);
  assert.equal(p1.kills, 1);
  assert.equal(p2.deaths, 1);
  // respawn após 5s
  tick(m, 5100);
  assert.equal(m.players.get('p2').alive, true);
  assert.ok(m.players.get('p2').hp > 0);
});

// Blocker 1 (RED): self-target para dano deve ser rejeitado.
test('ataque básico em si mesmo é rejeitado (sem auto-dano)', () => {
  const m = twoPlayersStarted();
  const antes = m.players.get('p1').hp;
  const antesDmg = m.players.get('p1').dmgDealt;
  const r = basicAttack(m, 'p1', 'p1');
  assert.equal(r.ok, false);
  assert.equal(m.players.get('p1').hp, antes);
  assert.equal(m.players.get('p1').dmgDealt, antesDmg);
  assert.equal(m.players.get('p1').deaths, 0);
});

test('skills de dano em si mesmo são rejeitadas', () => {
  const m = twoPlayersStarted();
  const hpAntes = m.players.get('p1').hp;
  const enAntes = m.players.get('p1').energy;
  for (const slot of ['Q', 'W', 'E']) {
    m.players.get('p1').cd = { aa: 0, q: 0, w: 0, e: 0 };
    m.players.get('p1').eStage = null;
    m.players.get('p1').castUntil = 0;
    const r = useSkill(m, 'p1', slot, 'p1');
    assert.equal(r.ok, false, `slot ${slot} deveria rejeitar self-target`);
  }
  assert.equal(m.players.get('p1').hp, hpAntes);
  assert.equal(m.players.get('p1').energy, enAntes);
});

// Blocker 2 (RED): E etapa2 só cura em acerto válido.
test('E etapa2 não cura quando dano é bloqueado (proteção)', () => {
  const m = twoPlayersStarted();
  const p1 = m.players.get('p1');
  const p2 = m.players.get('p2');
  p1.hp = p1.maxHp - 300;
  const e1 = useSkill(m, 'p1', 'E', 'p2');
  assert.equal(e1.ok, true);
  assert.ok(p1.eStage, 'etapa1 deveria armar recast');
  // protege o alvo: etapa2 vai falhar no dano
  p2.protUntil = m.time + 10000;
  const hpAntes = p1.hp;
  const healAntes = p1.healDone;
  const r2 = useSkill(m, 'p1', 'E', 'p2');
  assert.equal(r2.ok, false);
  assert.equal(p1.hp, hpAntes, 'cura gratuita não deveria ocorrer');
  assert.equal(p1.healDone, healAntes);
});

// Blocker 3 (RED): saída voluntária mantém placar, sem vencer, sem reutilizar nick.
test('leavePlayer mantém no placar, fora dos vencedores e bloqueia nick', () => {
  const m = createMatch('SALA2', { durationSec: 300 });
  joinPlayer(m, 'p1', 'Ana');
  joinPlayer(m, 'p2', 'Beto');
  joinPlayer(m, 'p3', 'Cleo');
  setReady(m, 'p1', true);
  setReady(m, 'p2', true);
  setReady(m, 'p3', true);
  assert.equal(m.state, 'playing');
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  m.players.get('p3').x = 12; m.players.get('p3').y = 10;
  // dá kills para quem vai sair, para provar exclusão de vencedores
  m.players.get('p3').kills = 5;
  m.players.get('p1').kills = 1;
  const out = leavePlayer(m, 'p3');
  assert.equal(out, 'ok');
  assert.ok(m.players.has('p3'), 'deveria permanecer no Map/placar');
  assert.equal(m.players.get('p3').left, true);
  // nick não reutilizável na partida
  const dup = joinPlayer(m, 'p4', 'Cleo');
  assert.equal(dup.ok, false);
  // snapshot/placar ainda lista quem saiu
  const snap = snapshot(m);
  assert.ok(snap.players.some((p) => p.nick === 'Cleo'));
  // encerra e verifica que quem saiu não vence
  endMatch(m);
  assert.ok(!m.winnerIds.includes('p3'), 'quem saiu não conta como vencedor');
  const board = m.result.board;
  assert.ok(board.some((e) => e.nick === 'Cleo' && e.kills === 5));
});

test('mortes simultâneas no mesmo tick: ambas aplicadas antes de avaliar fim', () => {
  const m = twoPlayersStarted();
  const p1 = m.players.get('p1');
  const p2 = m.players.get('p2');
  p1.hp = 10; p2.hp = 10;
  const until = m.time + 6000;
  // DoT letal nos dois no mesmo passo
  p1.bleeds.push({ until, perSec: 50, from: 'p2' });
  p2.bleeds.push({ until, perSec: 50, from: 'p1' });
  tick(m, 1000);
  assert.equal(p1.alive, false, 'p1 deveria morrer no passo');
  assert.equal(p2.alive, false, 'p2 deveria morrer no mesmo passo (sem end mid-loop)');
  // FFA com respawn agendado: segue jogando, sem vencedor precoce
  assert.equal(m.state, 'playing');
});
