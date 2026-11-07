const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');
const world = require('../lib/world');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}

// Armadilha de ponto flutuante: monstro ao sul do obstáculo {76,76,6x6} com
// y ~= 76-0.4 (raio de colisão) + épsilon de float. isBlocked() retorna true
// nas 3 tentativas de slide (diagonal, eixo-x, eixo-y) e o monstro trava
// para sempre — treino PvE nunca alcança/ataca (dmgTotal 0).
test('PvE: monstro na borda do obstáculo não trava — contorna e ataca', () => {
  const m = sim.createMatch('P', { mode: 'pve' });
  sim.joinPlayer(m, 'p1', 'Solo', B());
  sim.setReady(m, 'p1', true);
  assert.equal(m.state, 'playing');
  const p = m.players.get('p1');
  p.x = 82.5; p.y = 82.5; // parado a NE do obstáculo {x:76,y:76,w:6,h:6}
  const mo = m.monster;
  mo.x = 76.7;
  mo.y = (76 - 0.4) + 1e-7; // épsilon de float p/ dentro da borda expandida
  assert.ok(world.isBlocked(mo.x + 0.1, mo.y + 0.1, 0.4), 'pré-condição: diagonal bloqueada');
  const hp0 = p.hp;
  for (let i = 0; i < 600; i++) {
    sim.tick(m, 50);
    if (world.dist(mo.x, mo.y, p.x, p.y) <= 2 && p.hp < hp0) break; // alcançou e atacou
  }
  assert.equal(world.isBlocked(mo.x, mo.y, 0.4), false, `monstro termina em célula legal (pos=${mo.x.toFixed(4)},${mo.y.toFixed(4)})`);
  const d = world.dist(mo.x, mo.y, p.x, p.y);
  assert.ok(d <= 2 || p.hp < hp0, `monstro alcança/ataca o player (dist=${d.toFixed(2)} hp=${p.hp}/${hp0} pos=${mo.x.toFixed(2)},${mo.y.toFixed(2)})`);
});
