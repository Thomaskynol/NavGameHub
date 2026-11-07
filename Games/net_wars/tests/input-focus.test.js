// P0-1/P0-4 regressão: wrapAngle temporal TP + clearKeys por caso (client/input.js).
// Stub mínimo de DOM: createInput só usa addEventListener global, document e
// canvas com addEventListener — tudo capturado aqui para disparar eventos.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let winH; let docH; let canvas; let settings;

function installStubs() {
  winH = {};
  docH = {};
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
    pointerLockElement: null,
    hidden: false,
    addEventListener(t, fn) { (docListeners[t] ??= []).push(fn); },
  };
  globalThis.__docListeners = docListeners;
  settings = { camMode: 'tp', sensitivity: 1 };
}

const fireWin = (t, e) => (winH[t] ?? []).forEach((fn) => fn(e));
const fireDoc = (t, e) => (globalThis.__docListeners[t] ?? []).forEach((fn) => fn(e));
const key = (code, extra = {}) => ({
  code, preventDefault() {}, target: { tagName: 'CANVAS' }, repeat: false, ...extra,
});

async function freshInput() {
  const { createInput } = await import('../client/input.js');
  const input = createInput(canvas, () => settings);
  input.state.active = true;
  return input;
}

describe('P0-1 wrapAngle temporal (via update, sem input)', () => {
  beforeEach(installStubs);

  it('TP sem input: roll/yaw/pitch parados por 120 frames', async () => {
    const input = await freshInput();
    input.snapActual(0.1, 0.05, 0);
    for (let i = 0; i < 120; i++) input.update();
    assert.ok(Math.abs(input.state.roll) < 1e-6, `roll=${input.state.roll}`);
    assert.ok(Math.abs(input.state.yaw - 0.1) < 1e-9, `yaw=${input.state.yaw}`);
    assert.ok(Math.abs(input.state.pitch - 0.05) < 1e-9, `pitch=${input.state.pitch}`);
  });

  it('FP sem input: roll parado por 120 frames', async () => {
    settings.camMode = 'fp';
    const input = await freshInput();
    input.snapActual(-0.2, 0.1, 0.3);
    for (let i = 0; i < 120; i++) input.update();
    assert.ok(Math.abs(input.state.roll - 0.3) < 1e-6, `roll=${input.state.roll}`);
  });

  it('fronteira ±π: sem teleporte para fora de [-π,π]; FP fica parado', async () => {
    settings.camMode = 'fp'; // FP não tem chase: roll fica exatamente parado
    const input = await freshInput();
    input.snapActual(0, 0, Math.PI - 0.01);
    for (let i = 0; i < 30; i++) input.update();
    assert.ok(Math.abs(input.state.roll - (Math.PI - 0.01)) < 1e-9, `roll=${input.state.roll}`);
  });

  it('TP cursor centrado: roll converge p/ 0 sem salto 2π (auto-bank por desenho)', async () => {
    const input = await freshInput();
    input.snapActual(0, 0, Math.PI - 0.01);
    let prev = input.state.roll;
    for (let i = 0; i < 30; i++) {
      input.update();
      const r = input.state.roll;
      assert.ok(Math.abs(r) <= Math.PI + 1e-9, `teleporte 2π: roll=${r}`);
      assert.ok(Math.abs(r - prev) < 0.5, `salto entre frames: ${prev} -> ${r}`);
      prev = r;
    }
    assert.ok(Math.abs(input.state.roll) < Math.PI - 0.01, 'convergiu em direção a 0');
  });

  it('FP mouse repetido: dx move o DESEJO (mesmo ganho do TP); nariz persegue no update', async () => {
    settings.camMode = 'fp';
    globalThis.document.pointerLockElement = canvas;
    const input = await freshInput();
    input.state.freeAim = true;
    for (let i = 0; i < 30; i++) fireWin('mousemove', { movementX: 2, movementY: 0 });
    // desejo move no evento (ganho idêntico ao TP); nariz fica (lag de w_max)
    assert.ok(Math.abs(input.state.dpitch) < 1e-9, `pitch desejo=${input.state.dpitch}`);
    assert.ok(Math.abs(input.state.dyaw - -30 * 2 * 0.0022) < 1e-9, `dyaw=${input.state.dyaw}`);
    assert.equal(input.state.yaw, 0, 'nariz ainda não teleportou');
    for (let i = 0; i < 30; i++) input.update();
    assert.ok(input.state.yaw < 0 && input.state.yaw > input.state.dyaw, `persegue: yaw=${input.state.yaw}`);
  });

  it('troca FP/TP: ângulos sobrevivem, sem salto', async () => {
    const input = await freshInput();
    input.snapActual(1.0, 0.2, 0.1);
    settings.camMode = 'fp';
    input.update();
    settings.camMode = 'tp';
    input.update();
    assert.ok(Math.abs(input.state.yaw - 1.0) < 1e-9, `yaw=${input.state.yaw}`);
  });
});

describe('P0-4 clearKeys por caso (contínuo + pendente)', () => {
  beforeEach(installStubs);

  async function heldInput() {
    const input = await freshInput();
    fireWin('keydown', key('KeyW'));
    fireWin('keydown', key('KeyA'));
    fireWin('keydown', key('ShiftLeft'));
    input.state.firing = true;
    input.state.missile = 1;
    input.state.swap = 1;
    return input;
  }
  function assertCleared(input) {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'KeyE']) {
      assert.equal(input.down(c), false, `${c} grudada`);
    }
    assert.equal(input.state.firing, false);
    assert.equal(input.state.missile, 0);
    assert.equal(input.state.swap, 0);
  }

  it('blur: keydown→blur→(sem keyup) limpa tudo; keyup tardio não regruda', async () => {
    settings.camMode = 'fp'; // FP: w vem das teclas (TP usa manete thr, que persiste por desenho)
    const input = await heldInput();
    fireWin('blur', {});
    assertCleared(input);
    fireWin('keyup', key('KeyW')); // keyup que chegou tarde não pode reativar nada
    const m = input.sample();
    assert.equal(m.w, 0); assert.equal(m.fire, 0); assert.equal(m.boost, 0);
  });

  it('hidden: limpa contínuo + pendente', async () => {
    const input = await heldInput();
    globalThis.document.hidden = true;
    fireDoc('visibilitychange', {});
    assertCleared(input);
  });

  it('pointerlock unlock: limpa contínuo + pendente', async () => {
    globalThis.document.pointerLockElement = canvas;
    const input = await heldInput();
    globalThis.document.pointerLockElement = null;
    fireDoc('pointerlockchange', {});
    assertCleared(input);
  });

  it('pós-blur refocus: tecla nova funciona, nada ativo em pausa', async () => {
    settings.camMode = 'fp'; // w por tecla; manete thr do TP persiste por desenho
    const input = await heldInput();
    fireWin('blur', {});
    input.state.active = false; // menu/pausa
    const m = input.sample();
    assert.equal(m.w + m.fire + m.boost, 0, 'nada ativo em pausa');
    input.state.active = true; // voltou ao jogo
    fireWin('keydown', key('KeyW'));
    assert.equal(input.down('KeyW'), true);
    assert.equal(input.sample().w, 1);
  });

  it('manete TP persiste ao blur (só tecla/pendente limpa)', async () => {
    const input = await heldInput(); // modo TP: thr inicial 0.65
    fireWin('blur', {});
    assert.equal(input.state.thr, 0.65, 'manete não é tecla segurada');
    assert.equal(input.down('KeyW'), false);
  });

  it('freeAim sem lock: mousedown dispara; sem freeAim 1º clique só captura', async () => {
    const fireMouse = (button) => (canvas.listeners['mousedown'] ?? []).forEach((fn) => fn({ button }));
    // freeAim via caminho real (pointerlockerror); sem lock
    const free = await freshInput();
    fireDoc('pointerlockerror', {});
    assert.equal(free.state.freeAim, true);
    fireMouse(0);
    assert.equal(free.state.firing, true, 'freeAim sem lock: botão 0 dispara');
    fireMouse(2);
    assert.equal(free.state.missile, 1, 'freeAim sem lock: botão 2 míssil');
    // não-freeAim: 1º clique sem lock só captura, sem tiro acidental
    installStubs();
    const plain = await freshInput();
    assert.equal(plain.state.freeAim, false);
    fireMouse(0);
    assert.equal(plain.state.firing, false, '1º clique sem lock não dispara');
    assert.equal(plain.state.missile, 0);
  });
});
