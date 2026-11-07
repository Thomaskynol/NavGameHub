// Lane F2 (FP com desejo ○ + perseguição) — TDD: mouse move o DESEJO em FP,
// nariz/arma perseguem com w_max (mesmas funções de shared/turn.js do TP),
// ○+◆ FP reais, E/D na tela com roll (convenção Lane B), sens/invertY/
// lock/pausa/blur/respawn preservados. Servidor: sem mudança — FP passa a
// enviar dyaw/dpitch (protocolo já aceita, opcional) e o ramo existente do
// servidor persegue autoritativo com TP_YAW/PITCH_RATE (idêntico ao TP).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TP_YAW_RATE, TP_PITCH_RATE, FP_RAD_PER_PX } from '../shared/constants.js';
import {
  TP_DESIRED_SPREAD, AIM_MAX_DIST,
  angDelta, stepNose, moveDesired, cursorFromError,
  ballWorld,
} from '../shared/turn.js';
import { forward } from '../shared/orient.js';
import { desiredSolution, gunSolution, clampAim } from '../client/camera.js';

let winH; let canvas; let settings;
let tNow = 1000;
const origNow = performance.now.bind(performance);

function installStubs() {
  winH = {};
  const docListeners = {};
  canvas = {
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
    requestPointerLock() {},
  };
  globalThis.addEventListener = (t, fn) => { (winH[t] ??= []).push(fn); };
  globalThis.innerWidth = 800;
  globalThis.innerHeight = 600;
  globalThis.document = {
    pointerLockElement: null, hidden: false,
    addEventListener(t, fn) { (docListeners[t] ??= []).push(fn); },
  };
  globalThis.__docListeners = docListeners;
  settings = { camMode: 'fp', sensitivity: 1, invertY: false };
  tNow = 1000;
  performance.now = () => (tNow += 16.67);
}
const fireWin = (t, e) => (winH[t] ?? []).forEach((fn) => fn(e));
const fireDoc = (t, e) => (globalThis.__docListeners[t] ?? []).forEach((fn) => fn(e));

async function freshFp() {
  const { createInput } = await import('../client/input.js');
  const input = createInput(canvas, () => settings);
  input.state.active = true;
  input.state.freeAim = true;
  input.snapActual(0, 0, 0);
  return input;
}

describe('fp-desire: parado (nada gira sozinho)', () => {
  beforeEach(installStubs);
  it('sem mouse: desejo == nariz, update não move nada', async () => {
    const input = await freshFp();
    for (let i = 0; i < 60; i++) input.update();
    assert.ok(Math.abs(input.state.yaw) < 1e-9 && Math.abs(input.state.pitch) < 1e-9);
    assert.ok(Math.abs(input.state.dyaw) < 1e-9 && Math.abs(input.state.dpitch) < 1e-9);
    performance.now = origNow;
  });
});

describe('fp-desire: eixos + inversão (igual ao TP por pixel)', () => {
  beforeEach(installStubs);
  it('dx puro move o DESEJO em yaw (E: dyaw+), nariz fica (lag de w_max)', async () => {
    const input = await freshFp();
    fireWin('mousemove', { movementX: -100, movementY: 0 }); // E (esquerda)
    assert.ok(input.state.dyaw > 0, `desejo à esquerda: dyaw=${input.state.dyaw}`);
    assert.ok(Math.abs(input.state.dyaw - 100 * FP_RAD_PER_PX) < 1e-9, 'mesmo ganho por pixel do TP');
    assert.equal(input.state.yaw, 0, 'nariz ainda não teleportou (persegue no update)');
    performance.now = origNow;
  });
  it('mouse p/ cima sobe o desejo (dpitch+); invertY troca o sinal', async () => {
    const input = await freshFp();
    fireWin('mousemove', { movementX: 0, movementY: -50 });
    assert.ok(input.state.dpitch > 0, `cima = sobe: dpitch=${input.state.dpitch}`);
    settings.invertY = true;
    fireWin('mousemove', { movementX: 0, movementY: -100 });
    assert.ok(input.state.dpitch < 0, `invertY: cima desce dpitch=${input.state.dpitch}`);
    performance.now = origNow;
  });
});

describe('fp-desire: cursor (○) antes do nariz; nariz persegue limitado', () => {
  beforeEach(installStubs);
  it('desejo muda no evento, nariz chega depois com teto w_max·dt', async () => {
    const input = await freshFp();
    fireWin('mousemove', { movementX: 200, movementY: 0 });
    const des = input.state.dyaw;
    assert.ok(des < 0, 'desejo à direita (D: dyaw−)');
    for (let i = 0; i < 5; i++) input.update();
    assert.ok(input.state.yaw < 0 && input.state.yaw > des,
      `persegue limitado: yaw=${input.state.yaw} rumo a ${des}`);
    // teto por frame: 1 update de 16.67ms anda ≤ w_max·dt
    const i2 = await freshFp();
    fireWin('mousemove', { movementX: 400, movementY: 0 });
    i2.update();
    assert.ok(Math.abs(i2.state.yaw) <= TP_YAW_RATE * 0.02 + 1e-9, `teto w_max: yaw=${i2.state.yaw}`);
    performance.now = origNow;
  });
  it('sample FP leva desejo + nariz predito (servidor persegue autoritativo)', async () => {
    const input = await freshFp();
    fireWin('mousemove', { movementX: 200, movementY: 0 });
    input.update();
    const m = input.sample();
    assert.ok(Number.isFinite(m.dyaw) && Number.isFinite(m.dpitch), 'FP envia desejo (dyaw/dpitch)');
    assert.ok(Math.abs(m.dyaw - input.state.dyaw) < 1e-12, 'desejo do sample == estado');
    assert.equal(m.yaw, input.state.yaw, 'nariz do sample == predito (não o final)');
    performance.now = origNow;
  });
});

describe('fp-desire: 180° exige curva no tempo (nunca flip)', () => {
  beforeEach(installStubs);
  it('giro total leva ~1.7s, erro decresce monótono, sem NaN/teleporte', async () => {
    const input = await freshFp();
    // vira o desejo 180° (vários eventos, clamp 400px respeitado)
    for (let i = 0; i < 4; i++) fireWin('mousemove', { movementX: 400, movementY: 0 });
    assert.ok(Math.abs(angDelta(0, input.state.dyaw)) > 2.5, `setup 180°: err=${Math.abs(angDelta(0, input.state.dyaw))}`);
    let prev = Math.abs(angDelta(input.state.yaw, input.state.dyaw));
    assert.ok(prev > 2, `desejo longe do nariz: err=${prev}`);
    let steps = 0;
    for (; steps < 500 && Math.abs(angDelta(input.state.yaw, input.state.dyaw)) > 1e-3; steps++) {
      input.update();
      const cur = Math.abs(angDelta(input.state.yaw, input.state.dyaw));
      assert.ok(Number.isFinite(input.state.yaw), 'sem NaN');
      assert.ok(cur <= prev + 1e-9, `erro voltou a crescer: ${prev} -> ${cur}`);
      prev = cur;
    }
    const expect = Math.ceil(Math.PI / (TP_YAW_RATE * (1 / 60)));
    assert.ok(steps >= expect - 15 && steps <= expect + 15, `180° em ${steps} frames (~${expect})`);
    // depois de convergir: parado (nada gira sozinho)
    const y = input.state.yaw, p = input.state.pitch;
    for (let i = 0; i < 30; i++) input.update();
    assert.ok(Math.abs(input.state.yaw - y) < 1e-12 && Math.abs(input.state.pitch - p) < 1e-12);
    performance.now = origNow;
  });
});

describe('fp-desire: ○ + ◆ FP (bolinha do desejo, arma do nariz)', () => {
  beforeEach(installStubs);
  it('○ usa o DESEJO (≠ nariz em curva); ◆ usa o NARIZ (tiro real)', async () => {
    const input = await freshFp();
    fireWin('mousemove', { movementX: 200, movementY: 0 });
    for (let i = 0; i < 3; i++) input.update();
    const o = { x: 0, y: 0, z: 0 };
    const ball = ballWorld(o, input.state.dyaw, input.state.dpitch, AIM_MAX_DIST);
    const noseF = forward(input.state.yaw, input.state.pitch);
    const ang = Math.acos(Math.max(-1, Math.min(1,
      ball.dx * noseF.x + ball.dy * noseF.y + ball.dz * noseF.z)));
    assert.ok(ang > 0.05, `○ à frente do nariz em curva: ${ang} rad`);
    // desejado ≠ nariz, mas converge ao parar o mouse
    const d0 = desiredSolution(o, input.state.dyaw, input.state.dpitch, []);
    const g0 = gunSolution(o, input.state.yaw, input.state.pitch, []);
    assert.ok(Math.hypot(d0.x - g0.point.x, d0.z - g0.point.z) > 1, '○ e ◆ separados em curva');
    performance.now = origNow;
  });
  it('main.js projeta ○ em FP (sem ball/cursor null) e prende na borda', async () => {
    const { readFileSync: rf } = await import('node:fs');
    const src = rf(new URL('../client/main.js', import.meta.url), 'utf8');
    assert.ok(!/FP: sem cursor ○/.test(src), 'doc inline FP-direto removida');
    assert.ok(src.includes('ball: { x: b.x'), 'FP publica ○ no mundo (ball)');
    // clamp partilhado: fora-da-tela prende na borda, nunca some
    const c = clampAim(900, -50, false, 800, 600);
    assert.ok(c.x <= 800 - 20 && c.y >= 20 && Number.isFinite(c.x + c.y));
  });
});

describe('fp-desire: E/D na tela com roll (Lane B vale em FP)', () => {
  beforeEach(installStubs);
  it('bank ±90° troca de eixo; 180° inverte — igual ao TP', async () => {
    const k = FP_RAD_PER_PX;
    const rR = moveDesired(0, 0, 100, 0, k, -Math.PI / 2);
    assert.ok(Math.abs(rR.yaw) < 1e-9 && rR.pitch < 0, `bank-dir: pitch cai (direita na tela)`);
    const rI = moveDesired(0, 0, 100, 0, k, Math.PI);
    assert.ok(rI.yaw > 0 && Math.abs(rI.pitch) < 1e-9, `invertido: yaw inverte (direita na tela)`);
    const input = await freshFp();
    input.snapActual(0, 0, -Math.PI / 2);
    fireWin('mousemove', { movementX: 100, movementY: 0 });
    assert.ok(input.state.dpitch < 0 && Math.abs(input.state.dyaw) < 1e-9, 'FP banqueado: mouse-direita = direita DA TELA');
    performance.now = origNow;
  });
  it('cursor ○ espelha o erro NA TELA com roll (nunca some)', async () => {
    const R = 200;
    const c = cursorFromError(0, 0, 0, -0.5, R, TP_DESIRED_SPREAD, -Math.PI / 2);
    assert.ok(c.cx > 0 && Math.abs(c.cx) > Math.abs(c.cy), `○ à direita na tela cx=${c.cx}`);
    assert.ok(Math.hypot(c.cx, c.cy) <= R + 1e-9, 'clamp no raio');
  });
});

describe('fp-desire: lock / foco / pausa / respawn preservados', () => {
  beforeEach(installStubs);
  it('blur/unlock recentra o desejo no nariz (sem giro ao voltar)', async () => {
    const input = await freshFp();
    globalThis.document.pointerLockElement = canvas;
    fireWin('mousemove', { movementX: 200, movementY: 0 });
    assert.ok(Math.abs(input.state.dyaw) > 0.1, 'desejo deslocado');
    fireWin('blur', {});
    assert.ok(Math.abs(input.state.dyaw - input.state.yaw) < 1e-12, 'blur: desejo == nariz');
    const m = input.sample();
    assert.equal(m.w + m.fire + m.boost, 0, 'nada ativo após blur');
    performance.now = origNow;
  });
  it('respawn/teleporte: desejo = nariz (voa reto)', async () => {
    const input = await freshFp();
    fireWin('mousemove', { movementX: 200, movementY: 0 });
    input.snapActual(1.0, 0.2, 0.1);
    assert.ok(Math.abs(input.state.dyaw - 1.0) < 1e-12 && Math.abs(input.state.dpitch - 0.2) < 1e-12);
    performance.now = origNow;
  });
  it('sensibilidade escala o desejo; A/D seguem rolagem manual', async () => {
    settings.sensitivity = 2.5;
    const input = await freshFp();
    fireWin('mousemove', { movementX: 100, movementY: 0 });
    assert.ok(Math.abs(input.state.dyaw - -100 * FP_RAD_PER_PX * 2.5) < 1e-9, `sens 2.5: dyaw=${input.state.dyaw}`);
    const r0 = input.state.roll;
    fireWin('keydown', { code: 'KeyD', preventDefault() {}, target: { tagName: 'CANVAS' }, repeat: false });
    input.update();
    assert.ok(input.state.roll < r0, 'D banca p/ direita (manual, sem auto-nivelar)');
    performance.now = origNow;
  });
});
