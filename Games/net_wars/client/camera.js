// Matemática pura da câmera (sem THREE/DOM) — testável em Node.
// client/render.js consome; tests/camera-invariants.test.js travam P0-6.
// Convenção (igual ao servidor): yaw=0 → nariz -Z; up da nave = +Y rotacionado.
// TP_SHIP_DROP NÃO existe aqui de propósito: é só visual do mesh (render.js);
// a câmera sempre deriva da posição VERDADEIRA da nave.
import { TP_CAM_DIST, FP_EYE_BACK, CAM_MARGIN, AIM_EDGE_MARGIN } from '../shared/constants.js';
import { freeDistAlongRay, distToBound, expLerp } from '../shared/physics.js';
import { quatFromEuler, rotateVec, forward } from '../shared/orient.js';
import { rayHitObstacle, ballWorld, AIM_MAX_DIST, AIM_MIN_DIST } from '../shared/turn.js';

export const TP_H = 4.2; // altura da câmera sobre a linha (mesma do render)
export const TP_LOOK_AHEAD = 40; // mira paralela ao nariz, à frente da câmera
export const TP_POS_RATE = 6; // suavização da posição (igual ao render)
export const TP_UP_RATE = 4; // suavização do up (igual ao render)

const clampB = (v, b) => Math.max(-b, Math.min(b, v));
const norm = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

// true se p está dentro de algum colisor real (sem margem: superfície = fora)
export function pointInSolid(p, colliders, extra = 0) {
  for (const c of colliders) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    if (dx * dx + dy * dy + dz * dz < (c.r + extra) * (c.r + extra)) return true;
  }
  return false;
}

// Alvo ideal TP: atrás/acima, encurtado por cenário/limite.
// P0-6: want = distância livre, SEM piso full*0.3 (o piso enfiava a câmera
// rocha adentro quando o livre era menor que 30% do offset).
export function tpIdeal(ship, yaw, pitch, roll, colliders, bound) {
  const q = quatFromEuler(yaw, pitch, roll);
  const off = rotateVec(q, { x: 0, y: TP_H, z: TP_CAM_DIST });
  const full = Math.hypot(off.x, off.y, off.z) || 1;
  const dir = { x: off.x / full, y: off.y / full, z: off.z / full };
  const maxD = Math.min(full,
    distToBound(ship, dir, full, bound),
    freeDistAlongRay(ship, dir, full, colliders, CAM_MARGIN));
  const want = maxD;
  return {
    pos: {
      x: clampB(ship.x + dir.x * want, bound),
      y: clampB(ship.y + dir.y * want, bound),
      z: clampB(ship.z + dir.z * want, bound),
    },
    fwd: rotateVec(q, { x: 0, y: 0, z: -1 }), // == forward(yaw,pitch) do servidor
    up: rotateVec(q, { x: 0, y: 1, z: 0 }),
    want, full,
  };
}

export function createTpCam() { return { pos: null, up: null }; }

// Frame TP com smoothing + re-teste.
// P0-6: o ponto suavizado é re-testado contra os colisores REAIS — se a
// interpolação entre dois pontos livres cortou rocha, volta ao ideal
// (sabidamente livre). lookAt ancorado na câmera SUAVIZADA e paralelo ao
// nariz (antes: ancorado no ideal → inclinava quando o smooth atrasava).
// snap=true em teleporte/respawn (sem voo longo).
export function tpFrame(ship, yaw, pitch, roll, dt, st, colliders, bound, snap = false) {
  const ideal = tpIdeal(ship, yaw, pitch, roll, colliders, bound);
  if (snap || !st.pos || !st.up) {
    st.pos = { ...ideal.pos };
    st.up = norm(ideal.up);
  } else {
    st.pos = {
      x: expLerp(st.pos.x, ideal.pos.x, dt, TP_POS_RATE),
      y: expLerp(st.pos.y, ideal.pos.y, dt, TP_POS_RATE),
      z: expLerp(st.pos.z, ideal.pos.z, dt, TP_POS_RATE),
    };
    st.up = norm({
      x: expLerp(st.up.x, ideal.up.x, dt, TP_UP_RATE),
      y: expLerp(st.up.y, ideal.up.y, dt, TP_UP_RATE),
      z: expLerp(st.up.z, ideal.up.z, dt, TP_UP_RATE),
    });
    if (pointInSolid(st.pos, colliders)) st.pos = { ...ideal.pos };
  }
  return {
    cam: st.pos,
    up: st.up,
    look: {
      x: st.pos.x + ideal.fwd.x * TP_LOOK_AHEAD,
      y: st.pos.y + ideal.fwd.y * TP_LOOK_AHEAD,
      z: st.pos.z + ideal.fwd.z * TP_LOOK_AHEAD,
    },
    want: ideal.want,
    full: ideal.full,
  };
}

// ---- Lane R: retículos × projeção (matemática pura, testável em Node) ----
// ◆ (arma real) e ○ (desejo) partilham as regras de shared/turn.js
// (vazio/oculto/muito-perto) via as MESMAS funções — sem reimplementar, sem
// divergir. render.js consome; main.js (Lane N) publica em window.__nw.aim.

// Laser do servidor nasce no nariz: s + fwd*3 (room.js fireLaser/fireMissile).
// O marcador ◆ usa a mesma origem (antes: centro da nave, 3m atrás do tiro).
export const NOSE_FWD = 3;

// ◆ = impacto do raio do NARIZ nos mesmos colisores do servidor.
// - vazio → ponto a AIM_MAX_DIST, blocked=false (fraco).
// - oculto → superfície, blocked=true (forte).
// - muito-perto (impacto < AIM_MIN_DIST do nariz, ou origem dentro da rocha:
//   fisicamente inalcançável) → ponto a AIM_MIN_DIST, near=true: indicador
//   coerente de tamanho constante em vez de blob gigante na cara da câmera.
export function gunSolution(ship, yaw, pitch, colliders) {
  const f = forward(yaw, pitch);
  const nose = { x: ship.x + f.x * NOSE_FWD, y: ship.y + f.y * NOSE_FWD, z: ship.z + f.z * NOSE_FWD };
  const at = (d) => ({ x: nose.x + f.x * d, y: nose.y + f.y * d, z: nose.z + f.z * d });
  // Nariz dentro da rocha (encostou com o nariz): já colidiu — fisicamente
  // inalcançável, indicador coerente em vez da superfície de SAÍDA distante.
  if (pointInSolid(nose, colliders)) {
    return { point: at(AIM_MIN_DIST), dist: AIM_MIN_DIST, blocked: true, near: true, dir: f };
  }
  const hit = rayHitObstacle(nose.x, nose.y, nose.z, f.x, f.y, f.z, AIM_MAX_DIST, colliders);
  if (!hit) return { point: at(AIM_MAX_DIST), dist: AIM_MAX_DIST, blocked: false, near: false, dir: f };
  if (hit.dist < AIM_MIN_DIST) {
    return { point: at(AIM_MIN_DIST), dist: AIM_MIN_DIST, blocked: true, near: true, dir: f };
  }
  return { point: { ...hit.point }, dist: hit.dist, blocked: true, near: false, dir: f };
}

// ○ = ponto do DESEJO no mundo, mesmas regras de turn.js (vazio/oculto/
// muito-perto). Espelha main.js updateAimHud (freeDist margem 0 → ballWorld):
// fonte única aqui p/ o stash de render.js e p/ a Lane N adotar sem divergir.
export function desiredSolution(ship, desYaw, desPitch, colliders) {
  const f = forward(desYaw, desPitch);
  const free = freeDistAlongRay(ship, f, AIM_MAX_DIST, colliders, 0);
  const b = ballWorld(ship, desYaw, desPitch, Math.min(free, AIM_MAX_DIST));
  const state = free >= AIM_MAX_DIST ? 'vazio' : (free < AIM_MIN_DIST ? 'muito-perto' : 'oculto');
  return { x: b.x, y: b.y, z: b.z, dx: b.dx, dy: b.dy, dz: b.dz, dist: b.dist, free, state };
}

// Fora-da-tela/atrás (regra turn.js: ○ continua no mundo, HUD prende na borda
// e nunca some). Mesma semântica do HUD: atrás espelha X e ancora Y no meio;
// clamp na borda com AIM_EDGE_MARGIN; edge=true = preso na borda (p/ a
// Lane N estilizar). Sempre finito.
export function clampAim(sx, sy, behind, w, h, margin = AIM_EDGE_MARGIN) {
  const X = behind ? w - sx : sx;
  const Y = behind ? h * 0.5 : sy;
  const x = Math.max(margin, Math.min(w - margin, X));
  const y = Math.max(margin, Math.min(h - margin, Y));
  return { x, y, edge: x !== X || y !== Y, behind };
}

// Radar relativo (plano XZ): rotação yaw, SEM espelho — E/D da tela valem no
// radar (direita do piloto = +x; frente = +z/abaixo, convenção do HUD).
// (Era x=-rx: contato à direita caía à esquerda — espelhado, corrigido.)
export function radarRel(yaw, dx, dz) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  return { x: dx * cy - dz * sy, z: -dx * sy - dz * cy };
}

// Olho FP: RÍGIDO sobre a linha do nariz (atrás da origem), olhando paralelo.
// Recuo limitado pelo cenário (nunca dentro de rocha); olho sempre no eixo.
export function fpFrame(ship, yaw, pitch, roll, colliders) {
  const q = quatFromEuler(yaw, pitch, roll);
  const back = rotateVec(q, { x: 0, y: 0, z: 1 });
  const fwd = rotateVec(q, { x: 0, y: 0, z: -1 });
  const eyeBack = Math.min(FP_EYE_BACK, freeDistAlongRay(ship, back, FP_EYE_BACK, colliders, CAM_MARGIN));
  const cam = { x: ship.x + back.x * eyeBack, y: ship.y + back.y * eyeBack, z: ship.z + back.z * eyeBack };
  return {
    cam,
    up: norm(rotateVec(q, { x: 0, y: 1, z: 0 })),
    look: { x: cam.x + fwd.x * TP_LOOK_AHEAD, y: cam.y + fwd.y * TP_LOOK_AHEAD, z: cam.z + fwd.z * TP_LOOK_AHEAD },
    eyeBack,
  };
}
