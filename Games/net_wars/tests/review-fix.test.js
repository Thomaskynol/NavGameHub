// Regressão da revisão cavecrew-reviewer (recortes 3,4,7,8,12,13).
// Recortes 1,9,10,11 cobertos em tests/ws-check.mjs (integração WS/HTTP).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { STATION } from '../shared/constants.js';

describe('resume com token imprevisível (4)', () => {
  it('resume sem token é rejeitado (DUP); com token retoma sem duplicar', () => {
    const r = new Room('t', 300);
    r.join('p1', 'a', '#ffffff');
    const tok = r.ships.get('p1').resumeToken;
    assert.ok(typeof tok === 'string' && tok.length >= 8, 'token gerado no join');
    const t0 = Date.now();
    r.disconnect('p1', t0);
    const steal = r.join('evil', 'e', '#ffffff', { resume: 'p1' });
    assert.equal(steal.error, 'DUP', 'só o id sequencial não autoriza');
    const wrong = r.join('evil', 'e', '#ffffff', { resume: 'p1', resumeToken: 'chute' });
    assert.equal(wrong.error, 'DUP', 'token errado não autoriza');
    const ok = r.join('p1b', 'a', '#ffffff', { resume: 'p1', resumeToken: tok });
    assert.ok(ok.ok && ok.resumed);
    assert.equal(r.ships.size, 1);
  });

  it('sala com htok exige htok igual no resume', () => {
    const r = new Room('h', 300);
    r.join('p1', 'a', '#ffffff', { htok: 'segredo' });
    const tok = r.ships.get('p1').resumeToken;
    r.disconnect('p1', Date.now());
    assert.equal(
      r.join('x', 'a', '#ffffff', { resume: 'p1', resumeToken: tok }).error,
      'CODE_TAKEN', 'sem htok não retoma sala com dono',
    );
    assert.equal(
      r.join('x', 'a', '#ffffff', { resume: 'p1', resumeToken: tok, htok: 'errado' }).error,
      'CODE_TAKEN',
    );
    assert.ok(
      r.join('x', 'a', '#ffffff', { resume: 'p1', resumeToken: tok, htok: 'segredo' }).ok,
    );
  });

  it('snapshot nunca expõe resumeToken/htok', () => {
    const r = new Room('s', 300);
    r.join('p1', 'a', '#ffffff', { htok: 'segredo-do-hub' });
    const raw = JSON.stringify(r.snapshot(Date.now()));
    assert.ok(!raw.includes('resumeToken'), 'token fora do snapshot');
    assert.ok(!raw.includes('segredo-do-hub'), 'htok fora do snapshot');
  });
});

describe('fantasma fora do snapshot (3)', () => {
  it('disconnect esconde do snapshot; vaga segue presa até purge/LEAVE', () => {
    const r = new Room('g', 300);
    r.join('p1', 'a', '#ffffff');
    r.disconnect('p1', Date.now());
    assert.equal(r.snapshot(Date.now()).ships.length, 0, 'fantasma não aparece');
    assert.ok(r.ships.has('p1'), 'vaga presa p/ reconexão 30s');
  });
});

describe('disconnect limpa projéteis do fantasma (7)', () => {
  it('lasers/mísseis do dono somem; hit de dono fantasma é ignorado', () => {
    const r = new Room('d', 300);
    r.join('a', 'a', '#ffffff');
    r.join('b', 'b', '#ffffff');
    r.start(); // tick real (senão o lobby enganaria o teste de "ignorado")
    const A = r.ships.get('a'), B = r.ships.get('b');
    Object.assign(A, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectUntil: 0 });
    Object.assign(B, { x: 0, y: 0, z: -20, protectUntil: 0 });
    r.fireLaser(A, Date.now(), []);
    r.missiles.push({ id: 999, owner: 'a', target: null, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, life: 6 });
    assert.equal(r.lasers.length, 1);
    r.disconnect('a', Date.now());
    assert.equal(r.lasers.length, 0, 'laser do fantasma removido');
    assert.equal(r.missiles.length, 0, 'míssil do fantasma removido');
    // projétil órfão com dono fantasma não fere
    r.lasers.push({ id: 1000, owner: 'a', dmgMult: 1, x: 0, y: 0, z: -19, dx: 0, dy: 0, dz: -1, life: 1, base: 10 });
    const hp = B.hp;
    r.tick(0.05, Date.now());
    assert.equal(B.hp, hp, 'hit de dono fantasma ignorado');
  });
});

describe('reset limpa inputs e recargas (8)', () => {
  it('inputs zerados; lastShotAt/missileReadyAt/lock resetados', () => {
    const r = new Room('t', 300);
    r.join('p1', 'a', '#ffffff');
    r.inputs.set('p1', { t: 'input', seq: 1 });
    const s = r.ships.get('p1');
    s.lastShotAt = 123;
    s.missileReadyAt = Date.now() + 5000;
    s.warn = true;
    r.reset();
    assert.equal(r.inputs.size, 0, 'sem input herdado');
    assert.equal(s.lastShotAt, 0);
    assert.equal(s.missileReadyAt, 0);
    assert.equal(s.warn, false, 'sem lock herdado');
  });
});

describe('survival: derrota encerra de vez (12)', () => {
  it("state='over' junto com over=true", () => {
    const r = new Room('s', 300, { mode: 'survival' });
    r.join('h', 'hum', '#ffffff');
    r.start(); // lobby: waves só após start()
    const t = Date.now();
    r.tick(0.05, t);
    assert.ok(r.wave >= 1);
    r.damage(r.ships.get('h'), 99999, null, t + 100, []);
    const ev = r.tick(0.05, t + 200);
    assert.ok(ev.some((e) => e.kind === 'over' && e.defeat === true));
    assert.ok(r.over && r.state === 'over');
  });
});

describe('laser bloqueado pelo cenário (13)', () => {
  it('estação no caminho mata o laser; vítima atrás sai ilesa', () => {
    const r = new Room('t', 300);
    r.join('shooter', 's', '#ffffff');
    r.join('victim', 'v', '#ffffff');
    r.start();
    const a = r.ships.get('shooter'), b = r.ships.get('victim');
    // tiro em -Z atravessando a estação: atirador e vítima em lados opostos
    Object.assign(a, { x: STATION.x, y: STATION.y, z: STATION.z + STATION.r + 10, yaw: 0, pitch: 0, protectUntil: 0 });
    Object.assign(b, { x: STATION.x, y: STATION.y, z: STATION.z - STATION.r - 10, protectUntil: 0 });
    const t0 = Date.now();
    r.fireLaser(a, t0, []);
    assert.equal(r.lasers.length, 1);
    let t = t0;
    for (let i = 0; i < 60; i++) { r.tick(0.05, t); t += 50; }
    assert.equal(b.hp, 100, 'vítima protegida pelo cenário');
    assert.equal(r.lasers.length, 0, 'laser morreu no obstáculo');
  });
});
