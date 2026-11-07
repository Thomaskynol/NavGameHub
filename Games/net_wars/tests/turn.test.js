// Lane T (TP instructor) — TDD: curva/limite w_max, marcas, autoridade servidor.
// RED primeiro: importa shared/turn.js (inexistente até o GREEN).
// Oracle: missão (mouse=desejo, nariz persegue com w_max, bolinha≠arma,
// servidor autoritativo) + docs/CONTINUAR-2026-11-06.md §4B (TP joystick).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TP_YAW_RATE, TP_PITCH_RATE } from '../shared/constants.js';
import { forward } from '../shared/orient.js';
import {
  TP_DESIRED_SPREAD, AIM_MAX_DIST, AIM_MIN_DIST,
  angDelta, stepToward, stepNose, moveDesired, cursorFromError,
  ballWorld, rayHitObstacle,
} from '../shared/turn.js';
import { validInput } from '../shared/protocol.js';
import { Room } from '../server/room.js';
import { ASTEROIDS } from '../shared/constants.js';

const wrapOk = (a) => Math.abs(a) <= Math.PI + 1e-9;

// ---- curva / limite w_max (lógica compartilhada) ----
describe('turn: perseguição com w_max (nunca flip)', () => {
  it('1 passo respeita o teto por eixo', () => {
    const n = stepNose(0, 0, Math.PI, 0.5, 0.05);
    assert.ok(Math.abs(angDelta(0, n.yaw)) <= TP_YAW_RATE * 0.05 + 1e-12, `yaw=${n.yaw}`);
    assert.ok(Math.abs(angDelta(0, n.pitch)) <= TP_PITCH_RATE * 0.05 + 1e-12, `pitch=${n.pitch}`);
    assert.ok(Math.abs(angDelta(0, n.yaw)) > 0, 'andou (não travou)');
    assert.ok(wrapOk(n.yaw) && wrapOk(n.pitch), 'sem teleporte p/ fora de [-π,π]');
  });

  it('180° exige curva no tempo (sem flip, decréscimo monótono)', () => {
    let yaw = 0, steps = 0;
    let prev = Math.abs(angDelta(yaw, Math.PI));
    for (; steps < 500 && Math.abs(angDelta(yaw, Math.PI)) > 1e-6; steps++) {
      yaw = stepNose(yaw, 0, Math.PI, 0, 0.05).yaw;
      const cur = Math.abs(angDelta(yaw, Math.PI));
      assert.ok(cur <= prev + 1e-12, `erro voltou a crescer: ${prev} -> ${cur}`);
      assert.ok(Number.isFinite(yaw), 'sem NaN');
      prev = cur;
    }
    const expect = Math.ceil(Math.PI / (TP_YAW_RATE * 0.05));
    assert.ok(steps >= expect - 1 && steps <= expect + 1, `180° em ${steps} passos (esperado ~${expect})`);
    assert.ok(Math.abs(angDelta(yaw, Math.PI)) < 1e-6, 'convergiu');
  });

  it('alvo rápido: bolinha (desejo) muda antes do nariz', () => {
    const nose = stepNose(0, 0, 1.0, 0, 0.016); // 1 frame a 60fps
    assert.ok(Math.abs(angDelta(nose.yaw, 1.0)) > 0.9, `nariz lag: ${nose.yaw}`);
    // bolinha = direção desejada pura: dir de ballWorld == desejo imediato
    const b = ballWorld({ x: 0, y: 0, z: 0 }, 1.0, 0, 50);
    const f = forward(1.0, 0);
    const dot = b.dx * f.x + b.dy * f.y + b.dz * f.z;
    assert.ok(Math.abs(dot - 1) < 1e-9, `○ ao longo do desejo imediato (dot=${dot})`);
  });

  it('mouse parado: nada gira sozinho', () => {
    const d = moveDesired(0.4, -0.2, 0, 0, 0.0022);
    assert.ok(Math.abs(d.yaw - 0.4) < 1e-9 && Math.abs(d.pitch + 0.2) < 1e-9);
    const n = stepNose(0.4, -0.2, 0.4, -0.2, 0.05);
    assert.ok(Math.abs(n.yaw - 0.4) < 1e-9 && Math.abs(n.pitch + 0.2) < 1e-9);
  });

  it('stepToward ancora ao chegar (sem jitter)', () => {
    assert.ok(Math.abs(stepToward(0, 0.001, 0.09) - 0.001) < 1e-9);
  });
});

// ---- convenção E/D documentada (E=esquerda, D=direita da tela) ----
describe('turn: bolinha p/ E → nariz/trajetória p/ esquerda', () => {
  it('mouse p/ esquerda (dx<0) aumenta o yaw desejado; bola vai a -X (rumo -Z)', () => {
    const d = moveDesired(0, 0, -100, 0, 0.0022);
    assert.ok(d.yaw > 0, `dyaw=${d.yaw} (esquerda = yaw+)`);
    const b = ballWorld({ x: 0, y: 0, z: 0 }, d.yaw, d.pitch, 50);
    assert.ok(b.x < 0, `bola a -X (esquerda da tela rumo -Z): x=${b.x}`);
  });

  it('mouse p/ direita espelha; mouse p/ cima sobe', () => {
    const d = moveDesired(0, 0, 100, -50, 0.0022);
    assert.ok(d.yaw < 0 && d.pitch > 0, `dyaw=${d.yaw} dpitch=${d.pitch}`);
  });

  it('cursor espelha o erro (direita=D, esquerda=E), sempre visível', () => {
    const R = 200;
    const r = cursorFromError(0, 0, -0.5, 0.25, R);
    assert.ok(r.cx > 0, 'desejo à direita → ○ à direita');
    assert.ok(r.cy < 0, 'desejo acima → ○ acima');
    assert.ok(Math.hypot(r.cx, r.cy) <= R + 1e-9, 'clamp no raio (nunca some)');
  });
});

// ---- marcas: bolinha (desejo) vs arma (trajetória real servidor) ----
describe('turn: marcas (regras documentadas)', () => {
  it('vazio: sem obstáculo → ponto a AIM_MAX_DIST (nunca some)', () => {
    assert.equal(rayHitObstacle(0, 0, 0, 0, 0, -1, AIM_MAX_DIST, []), null);
    const b = ballWorld({ x: 0, y: 0, z: 0 }, 0, 0, AIM_MAX_DIST);
    assert.ok(Math.abs(b.z + AIM_MAX_DIST) < 1e-9, `z=${b.z}`);
  });

  it('oculto: raio bloqueado → impacto na superfície (tiro morreria aqui)', () => {
    const o = [{ x: 0, y: 0, z: -100, r: 10 }];
    const hit = rayHitObstacle(0, 0, 0, 0, 0, -1, AIM_MAX_DIST, o);
    assert.ok(hit && Math.abs(hit.dist - 90) < 1e-6, `dist=${hit && hit.dist}`);
    assert.ok(Math.abs(hit.point.z + 90) < 1e-6, `z=${hit.point.z}`);
  });

  it('muito-perto: distância mínima AIM_MIN_DIST', () => {
    assert.ok(AIM_MIN_DIST > 0 && AIM_MIN_DIST < AIM_MAX_DIST);
  });
});

// ---- protocolo: desejo (FP e TP enviam; servidor persegue autoritativo) ----
describe('turn: protocolo dyaw/dpitch', () => {
  it('aceita desejo + rejeita lixo', () => {
    const good = { t: 'input', seq: 1, w: 0, s: 0, a: 0, d: 0, yaw: 0, pitch: 0, fire: 0, dyaw: 1.2, dpitch: -0.3 };
    assert.ok(validInput(good));
    assert.ok(!validInput({ ...good, dyaw: 'x' }));
    assert.ok(validInput({ ...good, dyaw: undefined, dpitch: undefined }));
    // yaw verdadeiramente inválido é rejeitado (999 é VÁLIDO: |999|≤1e4, ver ramo dyaw abaixo)
    assert.ok(!validInput({ ...good, yaw: 1e9 }), 'yaw absurdo rejeitado');
    assert.ok(!validInput({ ...good, yaw: NaN }), 'yaw NaN rejeitado');
  });
});

// ---- autoridade do servidor ----
describe('turn: servidor autoritativo (ignora orientação instantânea)', () => {
  const mkRoom = () => {
    const r = new Room('auth', 300);
    r.join('p1', 'a', '#ffffff');
    r.start();
    const s = r.ships.get('p1');
    Object.assign(s, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, roll: 0, protectUntil: 0 });
    return { r, s };
  };

  it('TP: yaw instantâneo mentiroso é ignorado; nariz anda ≤ w_max·dt até o desejo', () => {
    const { r, s } = mkRoom();
    r.inputs.set('p1', {
      t: 'input', seq: 1, w: 0, s: 0, a: 0, d: 0,
      yaw: Math.PI, pitch: 0, roll: 0, dyaw: 0.2, dpitch: 0, fire: 0, // mente π, deseja 0.2
    });
    r.tick(0.05, Date.now());
    assert.ok(Math.abs(s.yaw) <= TP_YAW_RATE * 0.05 + 1e-9, `yaw=${s.yaw} (π instantâneo rejeitado)`);
    assert.ok(Math.abs(s.yaw - 0.09) < 1e-9, `yaw=${s.yaw} (1 passo de 0.09 rumo a 0.2)`);
  });

  it('FP sem desejo: cópia direta preservada (não quebra)', () => {
    const { r, s } = mkRoom();
    r.inputs.set('p1', { t: 'input', seq: 1, w: 0, s: 0, a: 0, d: 0, yaw: 1.0, pitch: 0.2, fire: 0 });
    r.tick(0.05, Date.now());
    assert.ok(Math.abs(s.yaw - 1.0) < 1e-9 && Math.abs(s.pitch - 0.2) < 1e-9);
  });
});

// ---- mira = impacto (servidor): estabilizada + alinhada ACERTA asteroide ----
describe('turn: tiro estabilizado+alinhado acerta asteroide (estado servidor)', () => {
  it('persegue até alinhar e o laser morre na rocha (vítima atrás ilesa)', () => {
    const A = ASTEROIDS[2]; // (40,60,110,r12)
    const r = new Room('hit', 300);
    r.join('shooter', 's', '#ffffff');
    r.join('victim', 'v', '#ffffff');
    r.start();
    const a = r.ships.get('shooter'), b = r.ships.get('victim');
    Object.assign(a, { x: A.x, y: A.y, z: A.z + 100, vx: 0, vy: 0, vz: 0, yaw: Math.PI, pitch: 0, roll: 0, protectUntil: 0 });
    Object.assign(b, { x: A.x, y: A.y, z: A.z - 40, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, protectUntil: 0 });
    // desejo: rumo -Z (yaw=0) direto à rocha; nariz começa oposto (π)
    let t = Date.now(), ticks = 0;
    for (; ticks < 200 && Math.abs(angDelta(a.yaw, 0)) > 0.02; ticks++) {
      r.inputs.set('shooter', {
        t: 'input', seq: ticks + 1, w: 0, s: 0, a: 0, d: 0,
        yaw: 999, pitch: 0, roll: 0, dyaw: 0, dpitch: 0, fire: 0, // yaw=999 válido (≤1e4) mas ignorado: com dyaw o servidor persegue o desejo
      });
      r.tick(0.05, t); t += 50;
    }
    assert.ok(Math.abs(angDelta(a.yaw, 0)) <= 0.02, `estabilizou (yaw=${a.yaw} em ${ticks} ticks)`);
    assert.ok(ticks >= 30, `curva levou tempo real (${ticks} ticks p/ ~180°)`);
    // alinhada: dispara 1 rajada contra a rocha a ~88m
    r.inputs.set('shooter', {
      t: 'input', seq: 999, w: 0, s: 0, a: 0, d: 0,
      yaw: 999, pitch: 0, roll: 0, dyaw: 0, dpitch: 0, fire: 1, // yaw válido mas ignorado (ramo dyaw)
    });
    r.tick(0.05, t); t += 50;
    assert.equal(r.lasers.length, 1, 'laser saiu ao longo do nariz estabilizado');
    r.inputs.set('shooter', {
      t: 'input', seq: 1000, w: 0, s: 0, a: 0, d: 0,
      yaw: 999, pitch: 0, roll: 0, dyaw: 0, dpitch: 0, fire: 0, // idem
    });
    for (let i = 0; i < 40 && r.lasers.length > 0; i++) { r.tick(0.05, t); t += 50; }
    assert.equal(r.lasers.length, 0, 'laser morreu NO obstáculo (impacto real servidor)');
    assert.equal(b.hp, 100, 'vítima atrás da rocha ilesa (cenário bloqueou)');
  });
});

// ---- cliente prediz (mesma função, nunca impõe) ----
describe('turn: cliente TP prediz com o mesmo passo', () => {
  let winH; let docH; let canvas; let settings;
  function installStubs() {
    winH = {};
    docH = {};
    const docListeners = {};
    canvas = { listeners: {}, addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }, requestPointerLock() {} };
    globalThis.addEventListener = (t, fn) => { (winH[t] ??= []).push(fn); };
    globalThis.innerWidth = 800;
    globalThis.innerHeight = 600;
    globalThis.document = { pointerLockElement: null, hidden: false, addEventListener(t, fn) { (docListeners[t] ??= []).push(fn); } };
    globalThis.__docListeners = docListeners;
    settings = { camMode: 'tp', sensitivity: 1 };
  }
  const fireWin = (t, e) => (winH[t] ?? []).forEach((fn) => fn(e));
  let tNow = 1000;
  let origNow = null;

  beforeEach(() => {
    installStubs();
    tNow = 1000;
    origNow = performance.now.bind(performance);
    performance.now = () => (tNow += 16.67);
  });

  it('TP: mouse move o desejo; nariz persegue limitado; sample leva os dois', async () => {
    const { createInput } = await import('../client/input.js');
    const input = createInput(canvas, () => settings);
    input.state.active = true;
    input.state.freeAim = true;
    input.snapActual(0, 0, 0);
    fireWin('mousemove', { movementX: 200, movementY: 0 }); // D (direita)
    assert.ok(input.state.dyaw < 0, `desejo à direita: dyaw=${input.state.dyaw}`);
    assert.equal(input.state.yaw, 0, 'nariz ainda não teleportou');
    for (let i = 0; i < 5; i++) input.update();
    assert.ok(input.state.yaw < 0 && input.state.yaw > input.state.dyaw,
      `persegue limitado: yaw=${input.state.yaw} rumo a ${input.state.dyaw}`);
    const m = input.sample();
    assert.ok(Number.isFinite(m.dyaw) && Number.isFinite(m.dpitch), 'sample leva o desejo');
    assert.equal(m.yaw, input.state.yaw, 'sample leva o nariz predito (não o final)');
    performance.now = origNow;
  });

  it('FP: desejo no sample (perseguição autoritativa, como no TP)', async () => {
    settings.camMode = 'fp';
    const { createInput } = await import('../client/input.js');
    const input = createInput(canvas, () => settings);
    input.state.active = true;
    input.state.freeAim = true;
    input.snapActual(0, 0, 0);
    fireWin('mousemove', { movementX: 200, movementY: 0 });
    assert.ok(input.state.dyaw < 0, 'mouse move o desejo em FP');
    assert.equal(input.state.yaw, 0, 'nariz não teleporta no evento');
    input.update();
    assert.ok(input.state.yaw < 0, 'nariz persegue no update (w_max)');
    const m = input.sample();
    assert.ok(Number.isFinite(m.dyaw) && Number.isFinite(m.dpitch), 'FP envia desejo');
    performance.now = origNow;
  });

  it('TP banqueado: mouse-direita move o desejo p/ a direita DA TELA (rollambre)', async () => {
    const { createInput } = await import('../client/input.js');
    const input = createInput(canvas, () => settings);
    input.state.active = true;
    input.state.freeAim = true;
    // bank total p/ direita (roll=-90°): tela-direita = mundo-baixo → pitch cai, yaw parado
    input.snapActual(0, 0, -Math.PI / 2);
    fireWin('mousemove', { movementX: 100, movementY: 0 });
    assert.ok(Math.abs(input.state.dyaw) < 1e-9, `bank-90°dir: yaw parado dyaw=${input.state.dyaw}`);
    assert.ok(input.state.dpitch < 0, `bank-90°dir: mouse-direita desce no mundo (=direita na tela) dpitch=${input.state.dpitch}`);
    // invertido: mouse-direita inverte o yaw de mundo (=direita na tela)
    input.snapActual(0, 0, Math.PI);
    fireWin('mousemove', { movementX: 100, movementY: 0 });
    assert.ok(input.state.dyaw > 0, `invertido: mouse-direita aumenta yaw (=direita na tela) dyaw=${input.state.dyaw}`);
    performance.now = origNow;
  });

  it('TP banqueado: leme A/D screen-relative (bank-90°: mexe pitch, não yaw)', async () => {
    const { createInput } = await import('../client/input.js');
    const input = createInput(canvas, () => settings);
    input.state.active = true;
    input.state.freeAim = true;
    input.snapActual(0, 0, -Math.PI / 2); // bank direita: tela-direita = mundo-baixo
    fireWin('keydown', { code: 'KeyD', preventDefault() {}, target: { tagName: 'CANVAS' }, repeat: false });
    input.update();
    assert.ok(Math.abs(angDelta(0, input.state.dyaw)) < 1e-6, `bank-90°dir: leme não mexe yaw dyaw=${input.state.dyaw}`);
    assert.ok(Math.abs(input.state.dpitch) > 0, `leme screen-relative mexe pitch dpitch=${input.state.dpitch}`);
    performance.now = origNow;
  });
});

// ---- Lane B: desejo screen-relative banqueado (War-Thunder mouse-aim) ----
describe('turn: banqueado screen-relative (roll)', () => {
  const k = 0.0022;
  it('mouse-direita com roll ±90° troca de eixo (vai p/ pitch), 180° inverte yaw', () => {
    const r0 = moveDesired(0, 0, 100, 0, k, 0);
    assert.ok(r0.yaw < 0 && Math.abs(r0.pitch) < 1e-12, `nivelado: yaw cai yaw=${r0.yaw}`);
    const rR = moveDesired(0, 0, 100, 0, k, -Math.PI / 2); // bank direita
    assert.ok(Math.abs(rR.yaw) < 1e-9 && rR.pitch < 0, `bank-90°dir: pitch cai pitch=${rR.pitch} yaw=${rR.yaw}`);
    const rL = moveDesired(0, 0, 100, 0, k, Math.PI / 2); // bank esquerda
    assert.ok(Math.abs(rL.yaw) < 1e-9 && rL.pitch > 0, `bank+90°esq: pitch sobe pitch=${rL.pitch}`);
    const rI = moveDesired(0, 0, 100, 0, k, Math.PI); // invertido
    assert.ok(rI.yaw > 0 && Math.abs(rI.pitch) < 1e-9, `invertido: yaw inverte yaw=${rI.yaw}`);
  });

  it('mouse-cima com roll ±90°/180° sobe NA TELA (+invertY conferido)', () => {
    const up = moveDesired(0, 0, 0, -50, k, -Math.PI / 2); // cima (dy<0), bank direita
    assert.ok(up.yaw < 0 && Math.abs(up.pitch) < 1e-9, `bank-90°dir + cima: yaw cai (=cima na tela) yaw=${up.yaw}`);
    const upI = moveDesired(0, 0, 0, -50, k, Math.PI); // invertido: cima na tela = mundo-baixo
    assert.ok(upI.pitch < 0, `invertido + cima: pitch cai (=cima na tela) pitch=${upI.pitch}`);
    const dn = moveDesired(0, 0, 0, 60, k, Math.PI / 2); // baixo (dy>0), bank esquerda
    assert.ok(dn.yaw < 0, `bank+90°esq + baixo: yaw cai (=baixo na tela) yaw=${dn.yaw}`);
  });

  it('cursor espelha o erro NA TELA quando banqueado (roll=0 intacto)', () => {
    const R = 200;
    const c0 = cursorFromError(0, 0, -0.5, 0.25, R); // nívelado: direita+cima
    assert.ok(c0.cx > 0 && c0.cy < 0, `nivelado intacto cx=${c0.cx} cy=${c0.cy}`);
    // bank-90°dir: mundo-baixo (desPitch<0) = direita na tela → ○ à direita dominante
    const c = cursorFromError(0, 0, 0, -0.5, R, undefined, -Math.PI / 2);
    assert.ok(c.cx > 0 && Math.abs(c.cx) > Math.abs(c.cy), `bank-90°dir tela-direita cx=${c.cx} cy=${c.cy}`);
    // invertido: mundo-esquerda (dyaw>0) = direita na tela
    const ci = cursorFromError(0, 0, 0.5, 0, R, undefined, Math.PI);
    assert.ok(ci.cx > 0, `invertido tela-direita cx=${ci.cx} cy=${ci.cy}`);
  });

  it('180°/360° com roll: sem salto/NaN, wrap em [-π,π], w_max preservado, parado para', () => {
    for (const roll of [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI * 2]) {
      const d = moveDesired(Math.PI - 0.1, 0, 500, 0, k, roll);
      assert.ok(Math.abs(d.yaw) <= Math.PI + 1e-9 && Number.isFinite(d.yaw) && Number.isFinite(d.pitch), `wrap roll=${roll} yaw=${d.yaw}`);
    }
    let yaw = 0; let prev = Math.abs(angDelta(yaw, Math.PI));
    for (let i = 0; i < 300 && Math.abs(angDelta(yaw, Math.PI)) > 1e-6; i++) {
      yaw = stepNose(yaw, 0, Math.PI, 0, 1 / 60).yaw;
      const cur = Math.abs(angDelta(yaw, Math.PI));
      assert.ok(Number.isFinite(yaw) && cur <= prev + 1e-12, `monótono i=${i} ${prev}→${cur}`);
      prev = cur;
    }
    assert.ok(Math.abs(angDelta(yaw, Math.PI)) < 1e-3, `convergiu yaw=${yaw}`);
    const still = moveDesired(0.4, -0.2, 0, 0, k, 1.1);
    assert.ok(Math.abs(still.yaw - 0.4) < 1e-12 && Math.abs(still.pitch + 0.2) < 1e-12, 'parado para');
  });
});
