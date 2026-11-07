import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, validInput } from '../shared/protocol.js';
import { Room, laserStats } from '../server/room.js';
import {
  EFFECT_LEN_S, MAX_PLAYERS, MISSILE_COOLDOWN_S, RECONNECT_S,
  BOOST_DRAIN, BOOST_REGEN,
} from '../shared/constants.js';

const baseInput = (seq, over = {}) => ({
  t: MSG.INPUT, seq, w: 0, s: 0, a: 0, d: 0, yaw: 0, pitch: 0, fire: 0, ...over,
});

function duel(mode = 'ffa') {
  const r = new Room('d', 300, { mode });
  r.join('shooter', 's', '#ffffff');
  r.join('victim', 'v', '#ffffff');
  r.start(); // lobby autoritativo: sem simulação até start()
  const a = r.ships.get('shooter'), b = r.ships.get('victim');
  Object.assign(a, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 });
  Object.assign(b, { x: 0, y: 0, z: -20, vx: 0, vy: 0, vz: 0, protectUntil: 0 });
  return { r, a, b, t0: Date.now() };
}

describe('laser: dano combinado ~2x', () => {
  it(' Cadência+Triplo+Sobrecarga ≈ 2x DPS base', () => {
    const run = (withBuffs) => {
      const { r, a, b, t0 } = duel();
      const H = 1e9;
      b.hp = H;
      if (withBuffs) {
        a.effects = {
          cadence: t0 + 3600e3, triple: t0 + 3600e3, overload: t0 + 3600e3,
        };
      }
      let t = t0;
      for (let i = 0; i < 120; i++) { // 6s de fogo contínuo
        r.inputs.set('shooter', baseInput(i, { fire: 1 }));
        r.tick(0.05, t); t += 50;
      }
      return H - b.hp;
    };
    const base = run(false);
    const buffed = run(true);
    const ratio = buffed / base;
    assert.ok(base > 0 && buffed > base);
    assert.ok(ratio > 1.7 && ratio < 2.5, `DPS combinado ratio=${ratio.toFixed(2)} (esperado ~2x)`);
  });

  it('laserStats reflete os multiplicadores', () => {
    const f = { cadence: Infinity, triple: Infinity, overload: Infinity };
    const st = laserStats(f, Date.now());
    assert.equal(st.damage, 10 * 1.2);
    assert.equal(st.cooldown, 0.5 * 0.8);
    const base = laserStats({}, Date.now());
    assert.equal(base.damage, 10);
    assert.equal(base.cooldown, 0.5);
  });
});

describe('míssil: lock, recarga 9s, troca de arma', () => {
  it('trava alvo na mira, avisa, recarga preservada no swap', () => {
    const { r, a, b, t0 } = duel();
    Object.assign(b, { x: 0, y: 0, z: -50 }); // na mira, dentro do alcance
    let t = t0;
    const fire = () => {
      r.inputs.set('shooter', baseInput(t, { w2: 1 }));
      const ev = r.tick(0.05, t); t += 50;
      return ev;
    };
    const ev1 = fire();
    assert.equal(r.missiles.length, 1);
    assert.equal(r.missiles[0].target, 'victim'); // lock breve próximo da mira
    assert.ok(ev1.some((e) => e.kind === 'lock' && e.b === 'victim')); // aviso
    const readyAt = a.missileReadyAt;
    assert.ok(readyAt - t0 >= MISSILE_COOLDOWN_S * 1000 - 100);
    fire(); // dentro da recarga: nada novo
    assert.equal(r.missiles.length, 1);
    r.inputs.set('shooter', baseInput(t, { swap: 1 })); // troca de arma
    r.tick(0.05, t); t += 50;
    assert.equal(a.weapon, 2);
    assert.equal(a.missileReadyAt, readyAt); // recarga preservada
    t = readyAt + 100; // após 9s
    r.inputs.set('shooter', baseInput(t, { w2: 1 }));
    r.tick(0.05, t);
    assert.equal(r.missiles.length, 2);
  });

  it('não trava aliado (teams FF off)', () => {
    const r = new Room('tm', 300, { mode: 'teams' });
    r.join('p1', 'a', '#ffffff');
    r.join('p2', 'b', '#ffffff');
    r.start();
    const p1 = r.ships.get('p1'), p2 = r.ships.get('p2');
    p2.team = p1.team; // força mesmo time
    Object.assign(p1, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectUntil: 0 });
    Object.assign(p2, { x: 0, y: 0, z: -50, protectUntil: 0 });
    const t0 = Date.now();
    r.inputs.set('p1', baseInput(1, { w2: 1 }));
    r.tick(0.05, t0);
    assert.equal(r.missiles.length, 1);
    assert.equal(r.missiles[0].target, null); // sem lock em aliado
    for (let i = 0; i < 40; i++) r.tick(0.05, t0 + i * 50); // laser não fere aliado
    r.inputs.set('p1', baseInput(2, { fire: 1 }));
    r.tick(0.05, t0 + 2100);
    assert.equal(p2.hp, 100);
  });
});

describe('power-ups: coleta única + renovação', () => {
  it('um beneficiário, respawn, sem acúmulo, remove ao morrer', () => {
    const r = new Room('p', 300);
    r.join('p1', 'a', '#ffffff');
    r.join('p2', 'b', '#ffffff');
    r.start();
    const s1 = r.ships.get('p1'), s2 = r.ships.get('p2');
    const spot = r.powerups.find((p) => p.type === 'overload');
    for (const s of [s1, s2]) {
      Object.assign(s, { x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0, protectUntil: 0 });
    }
    const t0 = Date.now();
    const ev = r.tick(0.05, t0);
    assert.equal(ev.filter((e) => e.kind === 'pickup').length, 1); // coleta única
    assert.ok(!spot.active);
    const got = s1.effects.overload ? s1 : s2;
    const other = got === s1 ? s2 : s1;
    assert.ok(got.effects.overload > t0);
    assert.ok(!other.effects.overload);
    const first = got.effects.overload;
    r.tick(0.05, t0 + 100); // sem respawn ainda: sem nova coleta
    assert.equal(got.effects.overload, first);
    // respawn após 20s renova os 15s sem acumular
    Object.assign(s1, { x: 200, y: 200, z: 200, vx: 0, vy: 0, vz: 0 });
    Object.assign(s2, { x: -200, y: -200, z: -200, vx: 0, vy: 0, vz: 0 });
    let t = t0 + 21_000;
    r.tick(0.05, t);
    assert.ok(spot.active);
    Object.assign(got, { x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0 });
    r.tick(0.05, t + 50);
    assert.ok(got.effects.overload > t); // renovado, não somado
    // morrer remove o efeito
    r.damage(got, 9999, 'x', t + 100, []);
    assert.deepEqual(got.effects, {});
  });
});

describe('boost: consome mais do que recupera', () => {
  it('drena com boost, regenera devagar, Propulsão acelera', () => {
    assert.ok(BOOST_DRAIN > BOOST_REGEN);
    const r = new Room('b', 300);
    r.join('p1', 'a', '#ffffff');
    r.start();
    const s = r.ships.get('p1');
    Object.assign(s, { protectUntil: 0 });
    const t0 = Date.now();
    let t = t0;
    for (let i = 0; i < 20; i++) { // 1s de boost
      r.inputs.set('p1', baseInput(i, { w: 1, boost: 1 }));
      r.tick(0.05, t); t += 50;
    }
    const afterDrain = s.boost;
    assert.ok(afterDrain < 100 && afterDrain > 60, `boost=${afterDrain}`);
    for (let i = 0; i < 20; i++) { // 1s parado recupera menos do que 1s drenou
      r.inputs.set('p1', baseInput(100 + i, {}));
      r.tick(0.05, t); t += 50;
    }
    assert.ok(s.boost - afterDrain < 100 - afterDrain + 0.01);
    assert.ok(s.boost < 100);
    s.effects = { propulsion: t + EFFECT_LEN_S * 1000 };
    const before = s.boost;
    for (let i = 0; i < 20; i++) {
      r.inputs.set('p1', baseInput(200 + i, {}));
      r.tick(0.05, t); t += 50;
    }
    assert.ok(s.boost - before > 15, 'Propulsão acelera a recuperação');
  });
});

describe('FFA: timer 5min + empate explícito', () => {
  it('encerra uma vez, empate sem winner', () => {
    const r = new Room('ffa', 300);
    r.join('p1', 'a', '#ffffff');
    r.join('p2', 'b', '#ffffff');
    r.start();
    const t0 = Date.now();
    r.endsAt = t0;
    const ev = r.tick(0.05, t0);
    const over = ev.find((e) => e.kind === 'over');
    assert.ok(over && over.draw === true && over.winner === null);
    assert.equal(r.tick(0.05, t0 + 10).length, 0);
  });
});

describe('survival: waves infinitas + derrota', () => {
  it('spawna bots (≤6), próxima wave após 5s, derrota sem humanos', () => {
    const r = new Room('s', 300, { mode: 'survival' });
    r.join('h', 'hum', '#ffffff');
    r.start();
    const h = r.ships.get('h');
    Object.assign(h, { protectUntil: 0 });
    let t = Date.now();
    const ev1 = r.tick(0.05, t);
    assert.equal(r.wave, 1);
    assert.ok(ev1.some((e) => e.kind === 'wave' && e.wave === 1));
    assert.ok(r.botsAlive() >= 1 && r.botsAlive() <= 6);
    for (const s of [...r.ships.values()]) {
      if (s.bot) r.damage(s, 99999, 'h', t, []);
    }
    assert.equal(r.botsAlive(), 0);
    r.tick(0.05, t + 10);
    const ev2 = r.tick(0.05, t + 5100); // intervalo 5s
    assert.ok(ev2.some((e) => e.kind === 'wave' && e.wave === 2));
    r.damage(h, 99999, null, t + 5200, []);
    const ev3 = r.tick(0.05, t + 5300);
    const over = ev3.find((e) => e.kind === 'over');
    assert.ok(over && over.defeat === true);
  });

  it('late-join espera a próxima wave', () => {
    const r = new Room('s2', 300, { mode: 'survival' });
    r.join('h1', 'a', '#ffffff');
    r.join('h2', 'b', '#ffffff');
    r.start();
    r.tick(0.05, Date.now());
    assert.ok(r.wave >= 1);
    const res = r.join('late', 'c', '#ffffff');
    assert.equal(res.waitNext, true);
    assert.equal(r.ships.get('late').alive, false);
  });
});

describe('sala: 12 vagas, reconnect 30s, proteção', () => {
  it('13ª conexão rejeitada', () => {
    const r = new Room('full', 300);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      assert.ok(r.join(`p${i}`, `n${i}`, '#ffffff').ok);
    }
    assert.equal(r.join('p13', 'x', '#ffffff').error, 'FULL');
  });

  it('reconexão retoma sem duplicar; purge após 30s', () => {
    const r = new Room('re', 300);
    r.join('p1', 'a', '#ffffff');
    r.ships.get('p1').kills = 3;
    const tok = r.ships.get('p1').resumeToken; // token imprevisível do WELCOME
    const t0 = Date.now();
    r.disconnect('p1', t0);
    assert.ok(r.ships.has('p1')); // fantasma segura a vaga
    assert.equal(r.join('x', 'a', '#ffffff', { resume: 'p1' }).error, 'DUP'); // id só não autoriza
    const res = r.join('p1b', 'a', '#ffffff', { resume: 'p1', resumeToken: tok });
    assert.ok(res.ok && res.resumed);
    assert.equal(r.ships.size, 1);
    assert.equal(r.ships.get('p1b').kills, 3);
    r.disconnect('p1b', t0);
    r.purge(t0 + RECONNECT_S * 1000 + 1);
    assert.equal(r.ships.size, 0);
  });

  it('proteção 2s bloqueia dano; atirar encerra', () => {
    const { r, a, b, t0 } = duel();
    b.protectUntil = t0 + 2000;
    r.inputs.set('shooter', baseInput(1, { fire: 1 }));
    for (let i = 0; i < 30; i++) r.tick(0.05, t0 + i * 50);
    assert.equal(b.hp, 100);
    a.protectUntil = t0 + 60_000;
    r.inputs.set('shooter', baseInput(2, { fire: 1 }));
    r.tick(0.05, t0 + 1500);
    assert.equal(a.protectUntil, 0); // atirar encerrou a proteção
  });
});

describe('protocolo: campos novos opcionais', () => {
  it('input com boost/w2/swap válido; inválidos seguem rejeitados', () => {
    const good = { t: 'input', seq: 1, w: 1, s: 0, a: 0, d: 0, yaw: 0, pitch: 0, fire: 1, boost: 1, w2: 0, swap: 1 };
    assert.ok(validInput(good));
    assert.ok(validInput({ ...good, boost: undefined }));
    assert.ok(!validInput({ ...good, boost: 2 }));
    assert.ok(!validInput({ ...good, w2: 2 }));
  });
});
