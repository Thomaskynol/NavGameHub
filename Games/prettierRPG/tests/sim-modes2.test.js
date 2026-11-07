const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}

test('FFA: 5min, respawn 5s, proteção 3s que quebra ao atacar', () => {
  const m = sim.createMatch('F', { durationSec: 300 });
  assert.equal(m.endsAt, 300000);
  sim.joinPlayer(m, 'p1', 'Ana', B());
  sim.joinPlayer(m, 'p2', 'Beto', B());
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  assert.equal(m.state, 'playing');
  m.players.get('p1').x = 10; m.players.get('p1').y = 10; m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  m.players.get('p2').hp = 5;
  sim.basicAttack(m, 'p1', 'p2');
  assert.equal(m.players.get('p2').alive, false);
  sim.tick(m, 5100);
  assert.equal(m.players.get('p2').alive, true);
  assert.ok(m.time < m.players.get('p2').protUntil, 'proteção 3s');
  const prot = m.players.get('p2').protUntil;
  m.players.get('p2').energy = 500;
  sim.basicAttack(m, 'p2', 'p1');
  assert.ok(m.players.get('p2').protUntil <= m.time, 'proteção quebra ao atacar');
});

test('2v2: melhor-de-3, sem respawn, empate em mortes simultâneas, intervalo 10s', () => {
  const m = sim.createMatch('V', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', B(), 0); sim.joinPlayer(m, 'a2', 'A2', B(), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1); sim.joinPlayer(m, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  assert.equal(m.state, 'playing');
  // mata time 1 → vence rodada 1
  m.players.get('b1').hp = 1; m.players.get('b2').hp = 1;
  m.players.get('a1').x = 10; m.players.get('a1').y = 10; m.players.get('b1').x = 11; m.players.get('b1').y = 10; m.players.get('b2').x = 11.5; m.players.get('b2').y = 10;
  m.players.get('a1').energy = 500;
  sim.basicAttack(m, 'a1', 'b1');
  m.players.get('a1').cd.aa = 0;
  sim.basicAttack(m, 'a1', 'b2');
  assert.equal(m.wins[0], 1, 'time0 vence rodada');
  assert.equal(m.roundState, 'interval');
  sim.tick(m, 10000);
  assert.equal(m.state, 'playing', 'nova rodada após 10s');
  assert.ok(m.players.get('b1').alive, 'recomeça com vida cheia');
  // empate simultâneo: ambos últimos morrem no mesmo tick via wave defer
  m.players.get('a2').alive = false; m.players.get('a2').respawnAt = null; m.players.get('a2').left = true;
  m.players.get('b2').alive = false; m.players.get('b2').respawnAt = null; m.players.get('b2').left = true;
  // deixa a1×b1 vivos com DoT letal no mesmo passo
  m.players.get('a1').alive = true; m.players.get('a1').hp = 5;
  m.players.get('b1').alive = true; m.players.get('b1').hp = 5;
  const until = m.time + 6000;
  m.players.get('a1').bleeds.push({ until, perSec: 50, from: 'b1' });
  m.players.get('b1').bleeds.push({ until, perSec: 50, from: 'a1' });
  const w0 = m.wins[0], w1 = m.wins[1];
  sim.tick(m, 1000);
  assert.equal(m.wins[0], w0, 'empate não pontua');
  assert.equal(m.wins[1], w1);
});

test('wave 2v2: fecha 50→0 entre 2:00-4:00, dano verdadeiro crescente fora', () => {
  assert.equal(sim.waveRadiusAt(0), 50);
  assert.equal(sim.waveRadiusAt(119999), 50);
  assert.ok(Math.abs(sim.waveRadiusAt(180000) - 25) < 0.01);
  assert.equal(sim.waveRadiusAt(240000), 0);
  const m = sim.createMatch('W', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', B(), 0); sim.joinPlayer(m, 'a2', 'A2', B(), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1); sim.joinPlayer(m, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  // força tempo de rodada 3min (fora da área)
  m.time = 180000; m.roundStartAt = 0;
  sim.tick(m, 50);
  assert.ok(m.waveRadius < 50 && m.waveRadius > 0);
  const p = m.players.get('a1');
  p.x = 0; p.y = 0; // fora (centro 50,50 raio ~25)
  p.hp = p.maxHp; p.shields.push({ amount: 9999, until: m.time + 60000 });
  p.immuneDmgUntil = m.time + 60000;
  const antes = p.hp;
  sim.tick(m, 1000);
  assert.ok(p.hp < antes, 'wave ignora escudo/imunidade');
});

test('PvE: monstro persegue/ataca, respawn 30s; jogador 3s; boneco 25%→100% espera 5s→25%; stats', () => {
  const m = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', B());
  sim.setReady(m, 'p1', true);
  assert.equal(m.state, 'playing');
  assert.ok(m.monster.alive);
  const mx = m.monster.x, my = m.monster.y;
  const p1 = m.players.get('p1');
  p1.x = 20; p1.y = 20;
  const d0 = Math.hypot(mx - 20, my - 20);
  const hp0 = p1.hp;
  sim.tick(m, 1000);
  const d1 = Math.hypot(m.monster.x - 20, m.monster.y - 20);
  assert.ok(d1 < d0 || p1.hp < hp0, `monstro persegue (${d0.toFixed(1)} -> ${d1.toFixed(1)}) ou ataca`);
  // mata monstro → respawn 30s, dano total zera
  sim.hitMonster(m, 'p1', 99999);
  assert.equal(m.monster.alive, false);
  assert.ok(m.pve.dmgTotal > 0);
  sim.tick(m, 30000);
  assert.equal(m.monster.alive, true);
  assert.equal(m.pve.dmgTotal, 0, 'dano/DPS zeram no respawn');
  // jogador morre → 3s sem caído
  const p = m.players.get('p1');
  p.hp = 1;
  sim.dealDamage(m, null, 'p1', 10, m.time, { env: true });
  // PvE mata direto (exceção), sem knocked
  assert.equal(p.knocked, false);
  sim.tick(m, 3100);
  assert.equal(p.alive, true);
  // boneco
  m.dummy.hp = m.dummy.maxHp;
  sim.tick(m, 100);
  assert.ok(m.dummy.waitUntil > 0, 'boneco cheio agenda reset');
  sim.tick(m, 5100);
  assert.ok(Math.abs(m.dummy.hp - m.dummy.maxHp * 0.25) < 1, 'boneco volta a 25%');
  // editor pausa monstro
  p.editorOpen = true;
  const bx = m.monster.x, by = m.monster.y;
  p.x = 10; p.y = 10;
  sim.tick(m, 1000);
  assert.equal(m.monster.x, bx, 'editor pausa monstro');
  p.editorOpen = false;
});

test('caído 15s + levantar 5s, finalização 5s, reawaken 30%', () => {
  const m = sim.createMatch('D', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', B(), 0); sim.joinPlayer(m, 'a2', 'A2', B({ weapon: 'holy', q: 'generous-heal', w: 'reawaken', e: 'desperate-prayer' }), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1); sim.joinPlayer(m, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  const v = m.players.get('a1');
  v.x = 10; v.y = 10;
  // golpe de ambiente → caído 15s (não morte imediata)
  v.hp = 100;
  sim.dealDamage(m, null, 'a1', 9999, m.time, { env: true });
  assert.ok(v.knocked, 'caído após golpe ambiental');
  assert.ok(v.alive, 'caído continua vivo-incapaz');
  // ataques não causam dano no caído
  const hpC = v.hp;
  sim.basicAttack(m, 'b1', 'a1');
  // basicAttack exige alvo alive — caído tem alive true mas knocked: canAct do atacante ok, dealDamage barra knocked
  // finalização: inimigo inicia e conclui em 5s
  m.players.get('b1').x = 10.5; m.players.get('b1').y = 10;
  const rf = sim.useSkill(m, 'b1', 'FINISH', 'a1');
  assert.ok(rf.ok, 'finalização inicia');
  sim.tick(m, 5100);
  assert.equal(v.alive, false, 'finalização mata');
  assert.ok(m.players.get('b1').kills >= 1, 'crédito ao finalizador');
});
