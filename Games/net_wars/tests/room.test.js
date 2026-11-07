import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validHello, validInput, MSG } from '../shared/protocol.js';
import { Room } from '../server/room.js';

describe('protocol', () => {
  it('aceita hello válido e rejeita inválidos', () => {
    assert.ok(validHello({ t: 'hello', name: 'a', room: 'ffa1', color: '#aabbcc' }));
    assert.ok(!validHello({ t: 'hello', name: '', room: 'ffa1' }));
    assert.ok(!validHello({ t: 'hello', name: 'a', room: 'ffa1', color: 'red' }));
    assert.ok(!validHello({ t: 'hello', name: 'a', room: 'ffa1', len: 2 }));
    assert.ok(validHello({ t: 'hello', name: 'a', room: 'ffa1', len: 30 }));
  });
  it('aceita input válido e rejeita fire=2 / yaw texto', () => {
    const good = { t: 'input', seq: 1, w: 1, s: 0, a: 0, d: 0, yaw: 0.1, pitch: 0, fire: 1 };
    assert.ok(validInput(good));
    assert.ok(!validInput({ ...good, fire: 2 }));
    assert.ok(!validInput({ ...good, yaw: 'x' }));
    assert.ok(!validInput({ ...good, t: 'hello' }));
  });
});

describe('room timer', () => {
  it('encerra uma única vez e congela estado', () => {
    const r = new Room('t', 100);
    r.join('p1', 'a', '#ffffff');
    r.start(); // sala nasce em lobby: simulação só após start()
    const t0 = Date.now();
    r.endsAt = t0; // força fim
    const ev1 = r.tick(0.05, t0);
    const ev2 = r.tick(0.05, t0 + 10);
    assert.equal(ev1.filter((e) => e.kind === 'over').length, 1);
    assert.equal(ev2.length, 0);
    assert.ok(r.over);
  });
  it('rematch limpa estado e reabre timer', () => {
    const r = new Room('t', 100);
    r.join('p1', 'a', '#ffffff');
    r.start();
    r.endsAt = Date.now();
    r.tick(0.05, Date.now() + 1);
    assert.ok(r.over);
    r.reset();
    assert.ok(!r.over && r.lasers.length === 0);
    assert.equal(r.ships.get('p1').hp, 100);
  });
});

describe('room laser', () => {
  it('laser com cadência mata com dano acumulado (~5s TTK)', () => {
    const r = new Room('t', 100);
    r.join('shooter', 's', '#ffffff');
    r.join('victim', 'v', '#ffffff');
    r.start(); // lobby: sem tick de simulação até o host iniciar
    const a = r.ships.get('shooter'), b = r.ships.get('victim');
    // mira direta: shooter em origem olhando -Z, vítima a 20m
    Object.assign(a, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    Object.assign(b, { x: 0, y: 0, z: -20, protectUntil: 0 });
    const t0 = Date.now();
    let t = t0, ticks = 0;
    while (b.alive && ticks++ < 500) {
      r.inputs.set('shooter', { t: MSG.INPUT, seq: ticks, w: 0, s: 0, a: 0, d: 0, yaw: 0, pitch: 0, fire: 1 });
      r.tick(0.05, t); t += 50;
    }
    assert.ok(!b.alive, 'vítima deveria morrer após 10 hits de 10dmg');
    assert.ok(ticks <= 140, `TTK base ~5s (ticks=${ticks})`);
    assert.equal(a.kills, 1);
  });
});
