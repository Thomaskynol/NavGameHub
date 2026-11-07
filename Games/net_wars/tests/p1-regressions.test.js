// Regressões P1-7..P1-15 (lane C: server+physics+hub). Oracle: task spec + docs.
// RED→GREEN por item; contrato migado só com justificativa em progress.md + docs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { segSphereT } from '../shared/physics.js';
import { Room } from '../server/room.js';
import { STATION } from '../shared/constants.js';

// P1-8: placar conta kills de fantasma (disconnect não apaga pontos).
// Contrato: sair/desconectar nunca muda abates conquistados (vencedor estável).
describe('P1-8 scores incluem fantasmas (ghost-kills-count)', () => {
  it('killer que desconectou segue no scores até purge/leave', () => {
    const r = new Room('s', 300);
    r.join('a', 'a', '#ffffff');
    r.join('b', 'b', '#ffffff');
    r.start();
    const A = r.ships.get('a'), B = r.ships.get('b');
    Object.assign(B, { protectUntil: 0 });
    r.damage(B, 99999, 'a', Date.now(), []);
    assert.equal(A.kills, 1);
    r.disconnect('a', Date.now());
    const sc = r.scores();
    assert.equal(sc.a.kills, 1, 'kill do fantasma continua valendo');
  });
  it('purge transfere fantasma p/ leftScores (sem duplicar)', () => {
    const r = new Room('s', 300);
    r.join('a', 'a', '#ffffff');
    r.join('b', 'b', '#ffffff');
    r.start();
    const t0 = Date.now();
    const B = r.ships.get('b');
    B.protectUntil = 0;
    r.damage(B, 99999, 'a', t0, []);
    r.disconnect('a', t0);
    r.purge(t0 + 31 * 1000);
    assert.ok(!r.ships.has('a'), 'fantasma expirado sai');
    assert.equal(r.scores().a.kills, 1, 'leftScores preserva o kill');
    assert.equal(Object.keys(r.scores()).filter((k) => k === 'a').length, 1);
  });
});

// P1-7: reset (rematch) zera placar inclusive de fantasmas — reconectar
// depois da revanche volta zerado, sem ressuscitar stats da partida anterior.
describe('P1-7 reset zera fantasmas sem quebrar resume', () => {
  it('fantasma reconecta após rematch com kills zerados e token válido', () => {
    const r = new Room('t', 300);
    r.join('p1', 'a', '#ffffff');
    const s = r.ships.get('p1');
    s.kills = 3; s.deaths = 1;
    const tok = s.resumeToken;
    const t0 = Date.now();
    r.disconnect('p1', t0);
    r.reset();
    assert.ok(r.ships.get('p1').goneAt !== 0, 'fantasma segue fantasma');
    assert.equal(r.ships.get('p1').kills, 0, 'sem stat ressuscitado');
    assert.equal(r.ships.get('p1').deaths, 0);
    const res = r.join('p1b', 'a', '#ffffff', { resume: 'p1', resumeToken: tok });
    assert.ok(res.ok && res.resumed, 'resumeToken sobrevive ao rematch');
    assert.equal(r.ships.get('p1b').kills, 0);
    assert.ok(r.ships.get('p1b').alive);
  });
});


// P1-12: contrato segSphereT — menor t ∈ [0,1] de entrada; começar dentro NÃO
// é entrada (só conta a saída se ela cair no segmento); tocar (tangência,
// superfície, ponto degenerado sobre a esfera) conta como t=0.
describe('P1-12 segSphereT (oracle: spec)', () => {
  it('inside-start com saída além do segmento → null', () => {
    assert.equal(segSphereT(0, 0, 0, 1, 0, 0, 0, 0, 0, 10), null);
  });
  it('inside-start com saída no segmento → t de saída (0.5, não 0)', () => {
    assert.equal(segSphereT(0, 0, 0, 20, 0, 0, 0, 0, 0, 10), 0.5);
  });
  it('entrada externa normal → t0', () => {
    assert.equal(segSphereT(-20, 0, 0, 20, 0, 0, 0, 0, 0, 10), 0.25);
  });
  it('tangência no segmento → t do toque', () => {
    assert.equal(segSphereT(-10, 0, 10, 10, 0, 10, 0, 0, 0, 10), 0.5);
  });
  it('começo na superfície saindo → 0 (qualquer direção)', () => {
    const d = 7.0710678118654755; // 10/√2: ponto exato na superfície r=10
    for (const t of [
      segSphereT(10, 0, 0, 20, 0, 0, 0, 0, 0, 10),
      segSphereT(d, d, 0, 20, 20, 0, 0, 0, 0, 10),
      segSphereT(d, d, 0, 0, 0, 0, 0, 0, 0, 10),
    ]) assert.ok(Object.is(t, 0), `esperado +0, veio ${t}`);
  });
  it('degenerado: dentro/superfície → 0; fora → null', () => {
    assert.ok(Object.is(segSphereT(0, 0, 0, 0, 0, 0, 0, 0, 0, 10), 0));
    assert.ok(Object.is(segSphereT(10, 0, 0, 10, 0, 0, 0, 0, 0, 10), 0));
    assert.equal(segSphereT(50, 0, 0, 50, 0, 0, 0, 0, 0, 10), null);
  });
  it('erro claro (miss) → null', () => {
    assert.equal(segSphereT(0, 0, 0, 1, 0, 0, 0, 50, 0, 10), null);
  });
});

// P1-13: colisão ordenada e casos-limite (travas de contrato; impl já correta).
// "prediction-symmetry" é client-side (fora do lane); homing/antípodas/NaN aqui.
describe('P1-13 colisão ordenada + limites', () => {
  const aim = (r, id, x = 0, y = 0, z = 0) =>
    Object.assign(r.ships.get(id), { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, protectUntil: 0 });

  it('ordem por primeiro impacto: perto morre, longe sai ileso', () => {
    const r = new Room('o', 300);
    r.join('s', 's', '#ffffff'); r.join('n1', 'n', '#ffffff'); r.join('n2', 'n', '#ffffff');
    r.start();
    aim(r, 's'); aim(r, 'n1', 0, 0, -10); aim(r, 'n2', 0, 0, -20);
    const t0 = Date.now();
    r.fireLaser(r.ships.get('s'), t0, []);
    for (let i = 0; i < 20; i++) r.tick(0.05, t0 + i * 50);
    assert.ok(r.ships.get('n1').hp < 100, 'primeiro impacto fere o mais próximo');
    assert.equal(r.ships.get('n2').hp, 100, 'laser morreu no primeiro alvo');
  });

  it('aliado (FF off) atravessa e fere inimigo atrás', () => {
    const r = new Room('f', 300, { mode: 'teams' });
    r.join('s', 's', '#ffffff'); r.join('ally', 'a', '#ffffff'); r.join('en', 'e', '#ffffff');
    r.start();
    const S = r.ships.get('s');
    S.team = 'red'; r.ships.get('ally').team = 'red'; r.ships.get('en').team = 'blue';
    aim(r, 's'); aim(r, 'ally', 0, 0, -10); aim(r, 'en', 0, 0, -20);
    const t0 = Date.now();
    r.fireLaser(S, t0, []);
    for (let i = 0; i < 20; i++) r.tick(0.05, t0 + i * 50);
    assert.equal(r.ships.get('ally').hp, 100, 'aliado intacto');
    assert.ok(r.ships.get('en').hp < 100, 'inimigo atrás ferido');
  });

  it('protegido atravessa: tiro fere quem está atrás', () => {
    const r = new Room('p', 300);
    r.join('s', 's', '#ffffff'); r.join('prot', 'p', '#ffffff'); r.join('v', 'v', '#ffffff');
    r.start();
    const now = Date.now();
    aim(r, 's');
    Object.assign(r.ships.get('prot'), { x: 0, y: 0, z: -10, protectUntil: now + 60000 });
    aim(r, 'v', 0, 0, -20);
    r.fireLaser(r.ships.get('s'), now, []);
    for (let i = 0; i < 20; i++) r.tick(0.05, now + i * 50);
    assert.equal(r.ships.get('prot').hp, 100);
    assert.ok(r.ships.get('v').hp < 100);
  });

  it('míssil morre no obstáculo no meio do caminho', () => {
    const r = new Room('m', 300);
    r.join('s', 's', '#ffffff'); r.join('v', 'v', '#ffffff');
    r.start();
    const S = r.ships.get('s');
    S.x = STATION.x; S.y = STATION.y; S.z = STATION.z + STATION.r + 10;
    aim(r, 'v', STATION.x, STATION.y, STATION.z - STATION.r - 10);
    r.missiles.push({ id: 1, owner: 's', target: null, x: S.x, y: S.y, z: S.z, dx: 0, dy: 0, dz: -1, life: 6 });
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) r.tick(0.05, t0 + i * 50);
    assert.equal(r.missiles.length, 0, 'cenário bloqueia');
    assert.equal(r.ships.get('v').hp, 100);
  });

  it('nave×nave em sobreposição exata separa finito, sem dano', () => {
    const r = new Room('c', 300);
    r.join('a', 'a', '#ffffff'); r.join('b', 'b', '#ffffff');
    r.start();
    aim(r, 'a', 5, 5, 5); aim(r, 'b', 5, 5, 5);
    r.tick(0.05, Date.now());
    const A = r.ships.get('a'), B = r.ships.get('b');
    assert.ok(Number.isFinite(A.x) && Number.isFinite(B.x) && A.x !== B.x);
    assert.equal(A.hp, 100); assert.equal(B.hp, 100);
  });

  it('homing em antípodas exatos: sem NaN, sem travar', () => {
    const r = new Room('h', 300);
    r.join('s', 's', '#ffffff'); r.join('v', 'v', '#ffffff');
    r.start();
    aim(r, 's'); aim(r, 'v', 0, 0, -50);
    r.missiles.push({ id: 2, owner: 's', target: 'v', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, life: 6 });
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) r.tick(0.05, t0 + i * 50);
    for (const m of r.missiles) {
      assert.ok([m.x, m.y, m.z, m.dx, m.dy, m.dz].every(Number.isFinite), 'homing finito');
    }
  });
});

// P1-11: input velho é neutralizado (sem empuxo/tiro); disconnect/leave
// descartam input (sem replay pós-close). Blur é client-side (fora do lane).
describe('P1-11 input obsoleto neutralizado', () => {
  const stale = (over = {}) => ({
    t: 'input', seq: 1, w: 1, s: 0, a: 0, d: 0, yaw: 0, pitch: 0, fire: 1, ...over,
  });

  it('input de 60s atrás não empurra nem atira', () => {
    const r = new Room('t', 300);
    r.join('p1', 'a', '#ffffff');
    r.start();
    const s = r.ships.get('p1');
    Object.assign(s, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, protectUntil: 0 });
    const t0 = Date.now();
    r.inputs.set('p1', { ...stale(), _at: t0 - 60000 });
    for (let i = 0; i < 20; i++) r.tick(0.05, t0 + i * 50);
    assert.equal(s.z, 0, 'sem empuxo de input obsoleto');
    assert.equal(r.lasers.length, 0, 'sem tiro de input obsoleto');
  });

  it('input fresco (ou sem carimbo) continua valendo', () => {
    const r = new Room('t', 300);
    r.join('p1', 'a', '#ffffff');
    r.start();
    const s = r.ships.get('p1');
    Object.assign(s, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, protectUntil: 0 });
    const t0 = Date.now();
    r.inputs.set('p1', { ...stale(), _at: t0 }); // carimbo atual
    for (let i = 0; i < 20; i++) r.tick(0.05, t0 + i * 50);
    assert.ok(s.z < 0, 'input fresco empurra');
    assert.ok(r.lasers.length >= 1, 'input fresco atira');
  });

  it('disconnect/leave descartam input: sem replay pós-close', () => {
    const r = new Room('t', 300);
    r.join('p1', 'a', '#ffffff');
    r.start();
    r.inputs.set('p1', stale());
    r.disconnect('p1', Date.now());
    assert.ok(!r.inputs.has('p1'), 'disconnect limpa input');
    r.inputs.set('p1', stale());
    r.leave('p1');
    assert.ok(!r.inputs.has('p1'), 'leave limpa input');
  });
});

// P1-9: fim de partida idempotente — um único evento over, resultado estável,
// sem reemissão em reconnect/purge/tick tardio.
describe('P1-9 over idempotente', () => {
  it('finish/tick repetidos emitem over uma vez, chaves estáveis', () => {
    const r = new Room('t', 100);
    r.join('p1', 'a', '#ffffff');
    r.join('p2', 'b', '#ffffff');
    r.start();
    const t0 = Date.now();
    r.endsAt = t0;
    const ev1 = r.tick(0.05, t0);
    assert.equal(ev1.filter((e) => e.kind === 'over').length, 1);
    const over = ev1.find((e) => e.kind === 'over');
    assert.ok('winner' in over && 'draw' in over && 'scores' in over, 'chaves do over PvP');
    const ev2 = r.tick(0.05, t0 + 10);
    assert.equal(ev2.length, 0, 'pós-over: silêncio');
    const snap = r.snapshot(t0 + 20);
    assert.ok(snap.over && snap.state === 'over');
    assert.ok('winner' in snap.result && 'draw' in snap.result, 'chaves do result');
  });

  it('survival derrota: over único com defeat+wave, reconnect não reemite', () => {
    const r = new Room('s', 300, { mode: 'survival' });
    r.join('h', 'hum', '#ffffff');
    r.start();
    const t0 = Date.now();
    r.tick(0.05, t0);
    r.damage(r.ships.get('h'), 99999, null, t0 + 100, []);
    const ev = r.tick(0.05, t0 + 200);
    const overs = ev.filter((e) => e.kind === 'over');
    assert.equal(overs.length, 1);
    assert.ok(overs[0].defeat === true && 'wave' in overs[0], 'chaves do over survival');
    const tok = r.ships.get('h').resumeToken;
    r.disconnect('h', t0 + 300);
    const res = r.join('h2', 'hum', '#ffffff', { resume: 'h', resumeToken: tok });
    assert.ok(res.ok, 'resume após over da sala ainda funciona');
    assert.equal(r.tick(0.05, t0 + 400).filter((e) => e.kind === 'over').length, 0);
  });
});
