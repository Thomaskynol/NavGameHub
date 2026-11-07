// P0-1/P0-2 regressão: wrapPi + eulerFromQuat YXZ (shared/orient.js).
// Oracle: forward() trigonométrico vs rotateVec(q, -Z) — caminhos independentes
// (nenhum dos dois usa eulerFromQuat), mais three vendor como referência YXZ.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAU, wrapPi, forward, quatFromEuler, quatAxis, quatMul, rotateVec,
  eulerFromQuat, applyMouseTurn, normalizeAngles,
} from '../shared/orient.js';

const NOSE = { x: 0, y: 0, z: -1 };
const noseOf = (q) => rotateVec(q, NOSE);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// nariz reconstruído do euler extraído precisa coincidir com o nariz real
const noseErr = (yaw, pitch, roll) =>
  dist(forward(eulerFromQuat(quatFromEuler(yaw, pitch, roll)).yaw,
    eulerFromQuat(quatFromEuler(yaw, pitch, roll)).pitch), noseOf(quatFromEuler(yaw, pitch, roll)));

describe('P0-1 wrapPi caminho mais curto', () => {
  it('fixos: 0->0, não teleporta para 2π', () => {
    assert.equal(wrapPi(0), 0);
    assert.ok(Math.abs(wrapPi(6.283185307179586)) < 1e-9);
    assert.equal(wrapPi(-3.0), -3.0);
  });
  it('±π fronteira: contínuo, sem salto 2π', () => {
    assert.ok(Math.abs(wrapPi(Math.PI + 0.1) - (-Math.PI + 0.1)) < 1e-12);
    assert.ok(Math.abs(wrapPi(-Math.PI - 0.1) - (Math.PI - 0.1)) < 1e-12);
    assert.ok(Math.abs(Math.abs(wrapPi(Math.PI)) - Math.PI) < 1e-12);
  });
  it('multiframes sem input: roll fica parado (não 0→2π→deriva)', () => {
    let roll = 0;
    for (let i = 0; i < 120; i++) roll = wrapPi(roll + (0 - roll) * 0.02);
    assert.ok(Math.abs(roll) < 1e-9, `roll derivou para ${roll}`);
  });
  it('diferença angular sempre caminho mais curto (|Δ|≤π)', () => {
    for (const [a, b] of [[0, 1], [3.0, -3.0], [Math.PI, -Math.PI + 0.01], [6.0, 0.2], [-6.0, -0.2]]) {
      assert.ok(Math.abs(wrapPi(a - b)) <= Math.PI + 1e-12, `${a},${b}`);
    }
  });
  it('normalizeAngles preserva período 2π', () => {
    const n = normalizeAngles(7.0, -7.0, 0);
    assert.ok(Math.abs(dist(forward(n.yaw, n.pitch), forward(7.0, -7.0))) < 1e-9);
  });
});

describe('P0-2 eulerFromQuat YXZ canônico', () => {
  it('caso do bug: (yaw 0, pitch 0.3, roll 0) não troca eixo', () => {
    const eu = eulerFromQuat(quatFromEuler(0, 0.3, 0));
    assert.ok(Math.abs(eu.yaw) < 1e-9, `yaw=${eu.yaw}`);
    assert.ok(Math.abs(eu.pitch - 0.3) < 1e-9, `pitch=${eu.pitch}`);
    assert.ok(Math.abs(eu.roll) < 1e-9, `roll=${eu.roll}`);
  });
  it('isolados: yaw/pitch/roll puros voltam no próprio eixo', () => {
    for (const [y, p, r] of [[0.5, 0, 0], [0, -0.4, 0], [0, 0, 0.7], [-1.2, 0, 0]]) {
      const eu = eulerFromQuat(quatFromEuler(y, p, r));
      assert.ok(Math.abs(eu.yaw - y) < 1e-9, `yaw ${y} -> ${eu.yaw}`);
      assert.ok(Math.abs(eu.pitch - p) < 1e-9, `pitch ${p} -> ${eu.pitch}`);
      assert.ok(Math.abs(wrapPi(eu.roll - r)) < 1e-9, `roll ${r} -> ${eu.roll}`);
    }
  });
  it('combinados: nariz preservado (erro direção ~0, era 0.418)', () => {
    const cases = [[0.5, 0.3, 0.2], [-1.1, 0.4, -0.6], [2.5, -0.5, 1.0], [0, 0.3, 0], [0.3, 0, 0]];
    for (const [y, p, r] of cases) assert.ok(noseErr(y, p, r) < 1e-9, `${y},${p},${r} err=${noseErr(y, p, r)}`);
  });
  it('q e -q dão o mesmo nariz', () => {
    const q = quatFromEuler(0.6, -0.2, 0.4);
    const nq = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    const a = eulerFromQuat(q), b = eulerFromQuat(nq);
    assert.ok(dist(forward(a.yaw, a.pitch), forward(b.yaw, b.pitch)) < 1e-9);
  });
  it('polos ±90°: nariz vertical preservado, sem flip/NaN', () => {
    for (const p of [Math.PI / 2, -Math.PI / 2]) {
      const eu = eulerFromQuat(quatFromEuler(0.7, p, 0.3));
      assert.ok(Number.isFinite(eu.yaw + eu.pitch + eu.roll));
      assert.ok(dist(forward(eu.yaw, eu.pitch), noseOf(quatFromEuler(0.7, p, 0.3))) < 1e-6);
      assert.equal(eu.roll, 0);
    }
  });
  it('quat não-unitário (×3) normaliza sozinho', () => {
    const q = quatFromEuler(0.4, 0.2, -0.3);
    const big = { x: q.x * 3, y: q.y * 3, z: q.z * 3, w: q.w * 3 };
    const a = eulerFromQuat(q), b = eulerFromQuat(big);
    assert.ok(Math.abs(a.yaw - b.yaw) + Math.abs(a.pitch - b.pitch) + Math.abs(a.roll - b.roll) < 1e-9);
  });
  it('mouse repetido: guinada pura não vaza para pitch (sem troca de eixo)', () => {
    let q = quatFromEuler(0, 0, 0);
    for (let i = 0; i < 60; i++) q = applyMouseTurn(q, 2, 0, 0.0022);
    const eu = eulerFromQuat(q);
    assert.ok(Math.abs(eu.pitch) < 1e-9, `pitch vazou: ${eu.pitch}`);
    assert.ok(Math.abs(eu.yaw - -60 * 2 * 0.0022) < 1e-9, `yaw=${eu.yaw}`);
    assert.ok(dist(forward(eu.yaw, eu.pitch), noseOf(q)) < 1e-9);
  });
  it('quatMul/rotateVec coerentes: girar -Z pelo q dá o nariz', () => {
    const q = quatMul(quatAxis({ x: 0, y: 1, z: 0 }, 0.5), quatAxis({ x: 1, y: 0, z: 0 }, 0.2));
    assert.ok(dist(noseOf(q), forward(0.5, 0.2)) < 1e-9);
    void TAU;
  });
});
