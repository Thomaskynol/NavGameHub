// Invariantes P0-6 da câmera (lane B). Fonte: client/camera.js (matemática pura,
// sem THREE/DOM) consumida por client/render.js.
// - TP nunca além da distância livre (sem piso full*0.3); fora de obstáculos
//   TODO frame (giro, teleporte/respawn); estável sem input; up/quaternion
//   contínuos incl. 180°/oposto; mira paralela ao nariz (TP) / colinear (FP).
// - TP_SHIP_DROP é só visual do mesh (camera.js nem referencia);
//   cursor virtual (cx/cy) não entra na câmera (integração vive em input.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STATION, ASTEROIDS, WORLD_BOUND, CAM_MARGIN, FP_EYE_BACK, TP_CAM_DIST,
} from '../shared/constants.js';
import { freeDistAlongRay } from '../shared/physics.js';
import { quatFromEuler, rotateVec, forward } from '../shared/orient.js';
import {
  tpIdeal, tpFrame, fpFrame, createTpCam, pointInSolid, TP_H, TP_POS_RATE,
} from '../client/camera.js';

const colliders = [{ x: STATION.x, y: STATION.y, z: STATION.z, r: STATION.r },
  ...ASTEROIDS.map((a) => ({ x: a.x, y: a.y, z: a.z, r: a.r }))];
const outside = (p) => !pointInSolid(p, colliders);
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const angDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180 / Math.PI;
// direção do offset da câmera (atrás/acima) p/ atitude dada
function backDir(yaw, pitch, roll) {
  return norm(rotateVec(quatFromEuler(yaw, pitch, roll), { x: 0, y: TP_H, z: TP_CAM_DIST }));
}

describe('P0-6 TP ideal: nunca além da distância livre', () => {
  it('colado na rocha, ré virada p/ ela: want ≤ free e câmera fora', () => {
    const A = ASTEROIDS[0];
    const ship = { x: A.x + A.r + 1.0, y: A.y, z: A.z }; // 1m fora da superfície
    assert.ok(outside(ship));
    // yaw=-π/2: nariz +X, ré (câmera) -X — direto p/ a rocha
    const dir = backDir(-Math.PI / 2, 0, 0);
    const free = freeDistAlongRay(ship, dir, Math.hypot(TP_H, TP_CAM_DIST), colliders, CAM_MARGIN);
    const ideal = tpIdeal(ship, -Math.PI / 2, 0, 0, colliders, WORLD_BOUND);
    assert.ok(ideal.want <= free + 1e-9, `want=${ideal.want} ≤ free=${free}`);
    assert.ok(outside(ideal.pos), 'alvo ideal fora da rocha (sem piso full*0.3)');
  });

  it('giro completo junto a cada obstáculo: fora TODO frame', () => {
    const spots = [STATION, ...ASTEROIDS].map((o) => ({ x: o.x + o.r + 2, y: o.y, z: o.z }));
    for (const ship of spots) {
      assert.ok(outside(ship));
      for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        for (const pitch of [0, 0.5, -0.5]) {
          const ideal = tpIdeal(ship, yaw, pitch, 0, colliders, WORLD_BOUND);
          const dir = backDir(yaw, pitch, 0);
          const free = freeDistAlongRay(ship, dir, ideal.full, colliders, CAM_MARGIN);
          assert.ok(ideal.want <= free + 1e-9, `yaw=${yaw.toFixed(2)} want≤free`);
          assert.ok(outside(ideal.pos), `yaw=${yaw.toFixed(2)} fora do obstáculo`);
        }
      }
    }
  });
});

describe('P0-6 suavização com re-teste (sem atravessar rocha)', () => {
  it('lerp que cortaria a rocha volta ao ideal livre', () => {
    const A = ASTEROIDS[0];
    const sideA = { x: A.x + A.r + 8, y: A.y, z: A.z }; // converge aqui
    const shipB = { x: A.x - A.r - 8, y: A.y, z: A.z }; // teleporte p/ cá
    const st = createTpCam();
    for (let i = 0; i < 120; i++) tpFrame(sideA, 0, 0, 0, 1 / 60, st, colliders, WORLD_BOUND);
    assert.ok(outside(st.pos), 'convergiu fora da rocha');
    // teleporte SEM snap: interpola do lado A ao ideal do lado B (corta a rocha)
    let snapped = false;
    const dt = 1 / 60, k = 1 - Math.exp(-TP_POS_RATE * dt);
    for (let i = 0; i < 120; i++) {
      const ideal = tpIdeal(shipB, 0, 0, 0, colliders, WORLD_BOUND);
      // onde o lerp PURO cairia (sem re-teste)
      const raw = {
        x: st.pos.x + (ideal.pos.x - st.pos.x) * k,
        y: st.pos.y + (ideal.pos.y - st.pos.y) * k,
        z: st.pos.z + (ideal.pos.z - st.pos.z) * k,
      };
      const rawInside = !outside(raw);
      const f = tpFrame(shipB, 0, 0, 0, dt, st, colliders, WORLD_BOUND);
      assert.ok(outside(f.cam), `frame ${i}: câmera fora da rocha`);
      if (rawInside) {
        snapped = true;
        assert.deepEqual(f.cam, ideal.pos, `frame ${i}: re-teste voltou ao ideal livre`);
      }
    }
    assert.ok(snapped, 'o caminho de lerp cruzou a rocha e o re-teste atuou');
  });

  it('teleporte/respawn com snap: 1 frame já no ideal', () => {
    const st = createTpCam();
    tpFrame({ x: 0, y: 0, z: 0 }, 0, 0, 0, 1 / 60, st, colliders, WORLD_BOUND);
    const ship = { x: 120, y: -40, z: 90 };
    const f = tpFrame(ship, 2.1, 0.3, 0.5, 1 / 60, st, colliders, WORLD_BOUND, true);
    assert.deepEqual(f.cam, tpIdeal(ship, 2.1, 0.3, 0.5, colliders, WORLD_BOUND).pos);
    assert.ok(outside(f.cam));
  });

  it('estável sem input: converge e up fica unitário', () => {
    const st = createTpCam();
    const ship = { x: 30, y: 10, z: -50 };
    let last = null, move = Infinity;
    for (let i = 0; i < 180; i++) {
      const f = tpFrame(ship, 0.7, -0.2, 0.4, 1 / 60, st, colliders, WORLD_BOUND);
      if (last) move = Math.hypot(f.cam.x - last.x, f.cam.y - last.y, f.cam.z - last.z);
      last = { ...f.cam };
      assert.ok(outside(f.cam));
      const ul = Math.hypot(f.up.x, f.up.y, f.up.z);
      assert.ok(Math.abs(ul - 1) < 1e-9, `up unitário (${ul})`);
    }
    assert.ok(move < 1e-9, `convergiu (último passo ${move})`);
  });
});

describe('P0-6 up/quaternion contínuos incl. 180°/oposto', () => {
  it('giro yaw 0→2π + pitch/roll extremos: sem NaN, sem salto, mira paralela', () => {
    const st = createTpCam();
    const ship = { x: 0, y: 40, z: 120 };
    let prev = null, prevUp = null;
    for (let i = 0; i <= 72; i++) {
      const yaw = (i / 72) * Math.PI * 2; // inclui π (180°)
      const pitch = i % 2 ? 1.2 : -1.2;   // extremos opostos
      const roll = i % 3 ? Math.PI : 0;   // rolagem oposta
      const f = tpFrame(ship, yaw, pitch, roll, 1 / 60, st, colliders, WORLD_BOUND);
      for (const v of [f.cam, f.up, f.look]) {
        assert.ok(Number.isFinite(v.x + v.y + v.z), `sem NaN (yaw=${yaw.toFixed(2)})`);
      }
      const fwd = forward(yaw, pitch);
      assert.ok(angDeg(sub(f.look, f.cam), fwd) < 0.5, 'look ∥ nariz mesmo em 180°/oposto');
      if (prev) {
        const step = Math.hypot(f.cam.x - prev.x, f.cam.y - prev.y, f.cam.z - prev.z);
        assert.ok(step < 4, `sem salto (passo ${step.toFixed(2)})`);
        assert.ok(dot(f.up, prevUp) > 0.9, 'up contínuo (sem flip)');
      }
      prevUp = { ...f.up };
      prev = { ...f.cam };
      assert.ok(outside(f.cam));
    }
  });
});

describe('P0-6 mira × tiro em várias distâncias; DROP só visual; cursor fora', () => {
  it('TP: raio da câmera ∥ nariz (offset constante ≤ TP_H+0.5); FP: colinear', () => {
    const ship = { x: -40, y: 20, z: 60 };
    const yaw = 0.9, pitch = -0.15, roll = 0.6;
    const st = createTpCam();
    for (let i = 0; i < 120; i++) tpFrame(ship, yaw, pitch, roll, 1 / 60, st, colliders, WORLD_BOUND);
    const f = tpFrame(ship, yaw, pitch, roll, 1 / 60, st, colliders, WORLD_BOUND);
    const fwd = norm(forward(yaw, pitch));
    assert.ok(angDeg(sub(f.look, f.cam), fwd) < 0.5, 'TP convergido olha ∥ nariz');
    // tiro do servidor: origem nariz+3m, direção nariz — distância perpendicular
    // ao raio da câmera fica constante (paralelas) em 10/40/80/130m
    const nose = { x: ship.x + fwd.x * 3, y: ship.y + fwd.y * 3, z: ship.z + fwd.z * 3 };
    for (const d of [10, 40, 80, 130]) {
      const shot = { x: nose.x + fwd.x * d, y: nose.y + fwd.y * d, z: nose.z + fwd.z * d };
      const rel = sub(shot, f.cam);
      const perp = Math.hypot(
        rel.y * fwd.z - rel.z * fwd.y, rel.z * fwd.x - rel.x * fwd.z, rel.x * fwd.y - rel.y * fwd.x);
      assert.ok(perp <= TP_H + 0.5, `TP d=${d}m: paralaxe ${perp.toFixed(2)} ≤ ${TP_H + 0.5}`);
    }
    const fp = fpFrame(ship, yaw, pitch, roll, colliders);
    const fpDir = norm(sub(fp.look, fp.cam));
    assert.ok(angDeg(fpDir, fwd) < 1e-6, 'FP olha exatamente ∥ nariz');
    // olho FP sobre o eixo do nariz: colinearidade exata em várias distâncias
    for (const d of [10, 40, 80, 130]) {
      const shot = { x: nose.x + fwd.x * d, y: nose.y + fwd.y * d, z: nose.z + fwd.z * d };
      const rel = sub(shot, fp.cam);
      const perp = Math.hypot(
        rel.y * fwd.z - rel.z * fwd.y, rel.z * fwd.x - rel.x * fwd.z, rel.x * fwd.y - rel.y * fwd.x);
      assert.ok(perp < 1e-6, `FP d=${d}m: colinear (perp=${perp})`);
    }
    assert.ok(outside(fp.cam), 'olho FP fora de obstáculo');
    assert.ok(fp.eyeBack <= FP_EYE_BACK + 1e-12 && fp.eyeBack >= 0, 'recuo do olho limitado');
  });

  it('TP_SHIP_DROP não entra na câmera (só visual do mesh em render.js)', () => {
    const src = readFileSync(new URL('../client/camera.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!code.includes('TP_SHIP_DROP'), 'camera.js não referencia DROP em código');
    const ship = { x: 90, y: 0, z: 0 };
    const a = tpIdeal(ship, 0.4, 0.1, 0, colliders, WORLD_BOUND);
    const b = tpIdeal({ x: ship.x, y: ship.y - 1.25, z: ship.z }, 0.4, 0.1, 0, colliders, WORLD_BOUND);
    assert.ok(Math.abs(a.pos.y - b.pos.y) > 0.5, 'câmera deriva da posição VERDADEIRA (chamador passa sem DROP)');
  });

  it('câmera é função pura do nariz (sem cursor cx/cy)', () => {
    const ship = { x: 10, y: -20, z: 30 };
    const st1 = createTpCam(), st2 = createTpCam();
    const a = tpFrame(ship, 0.5, 0.2, -0.3, 1 / 60, st1, colliders, WORLD_BOUND);
    const b = tpFrame(ship, 0.5, 0.2, -0.3, 1 / 60, st2, colliders, WORLD_BOUND);
    assert.deepEqual(a, b, 'mesmo nariz → mesma câmera (histórico de cursor irrelevante)');
    for (const fn of [tpIdeal, tpFrame, fpFrame]) {
      assert.ok(!/cx|cy|cursor/i.test(fn.toString()), `${fn.name} não recebe cursor`);
    }
  });
});
