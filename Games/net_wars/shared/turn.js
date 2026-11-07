// TP instructor — lógica COMPARTILHADA client/server (fonte única).
// Contrato da missão: mouse = DESEJO (bolinha ○, estável no mundo), nariz
// PERSEGUE com velocidade angular limitada (w_max), bolinha ≠ arma.
// Servidor aplica o limite de forma autoritativa (nunca aceita orientação
// instantânea no modo TP); cliente prediz com a MESMA função, nunca impõe.
//
// Convenção E/D (documentada, testada em tests/turn.test.js):
// - E = esquerda da tela (cx<0): mouse p/ E → dyaw aumenta → nariz p/ -X
//   (esquerda de quem voa rumo -Z; direita da tela é +X — câmera chase olha
//   ao longo do nariz, então direita da tela = direita do nariz).
// - D = direita da tela (cx>0): dyaw diminui → nariz p/ +X (direita).
// - Mouse p/ cima (cy<0) → dpitch aumenta → sobe. Mouse parado (sem eventos)
//   → desejo fixo → nariz converge e PARA (nada gira sozinho).
//
// Regras da bolinha ○ (mira desejada, estável no mundo):
// - vazio (raio sem obstáculo até AIM_MAX_DIST): ponto a AIM_MAX_DIST.
// - oculto (raio bloqueado): ponto de entrada do obstáculo mais próximo
//   (rayHitObstacle) — o tiro morreria aqui; ○ indica o limite real.
// - fora-da-tela/atrás: ○ continua no mundo; o HUD prende o desenho na borda
//   (clamp) e nunca some.
// - muito-perto (< AIM_MIN_DIST do nariz): empurra p/ AIM_MIN_DIST.
//
// Marca arma (trajetória real): raio ao longo do NARIZ (não do desejo) com os
// MESMOS colisores do servidor (rayHitObstacle ≡ firstImpactAfter p/
// obstáculos); o laser do servidor nasce no nariz + morre no 1º impacto —
// estabilizada + alinhada ⇒ impacto real no estado do servidor (testado).
import { TP_YAW_RATE, TP_PITCH_RATE } from './constants.js';
import { wrapPi, forward } from './orient.js';
import { segSphereT } from './physics.js';

// Antecipação máx. bolinha↔nariz (rad): cursor no raio total = 1.0 rad de
// vantagem angular. Rate (w_max) vem de TP_YAW/PITCH_RATE (constants).
export const TP_DESIRED_SPREAD = 1.0;
// Alcance das marcas: laser chega a LASER_SPEED·LASER_LIFE ≈ 156m.
export const AIM_MAX_DIST = 150;
export const AIM_MIN_DIST = 6;

// Diferença angular caminho mais curto (teste orienta-se ao longo do tempo,
// nunca só normalização — ver tests/turn.test.js "180° exige curva").
export function angDelta(from, to) {
  return wrapPi(to - from);
}

// Um passo limitado: anda no máx. maxStep rumo ao desejo (ancora ao chegar).
export function stepToward(cur, des, maxStep) {
  const d = angDelta(cur, des);
  if (Math.abs(d) <= maxStep) return wrapPi(des);
  return wrapPi(cur + Math.sign(d) * maxStep);
}

// Nariz persegue o desejo com w_max por eixo (dt em segundos; dt≤0 = parado).
export function stepNose(curYaw, curPitch, desYaw, desPitch, dt, wYaw = TP_YAW_RATE, wPitch = TP_PITCH_RATE) {
  const t = Math.max(0, dt);
  return {
    yaw: stepToward(curYaw, desYaw, wYaw * t),
    pitch: stepToward(curPitch, desPitch, wPitch * t),
  };
}

// Desejo absoluto (estável no mundo): dx>0 (direita/D) diminui o yaw,
// dy>0 (baixo) diminui o pitch — igual ao FP por pixel (k), mas move o
// DESEJO, não o nariz. Mouse parado ⇒ desejo fixo ⇒ nariz converge e para.
// Screen-relative banqueado (Lane B, convenção War-Thunder mouse-aim): o
// vetor (dx,dy) é girado por −roll antes de integrar, de modo que
// cursor-direita move o nariz p/ a direita DA TELA em qualquer bank
// (roll=±90° troca de eixo, roll=180° inverte o sinal de mundo — o que é
// o correto na tela). roll=0 reproduz o comportamento antigo exato.
export function moveDesired(desYaw, desPitch, dxPx, dyPx, kPx, roll = 0) {
  const r = Number.isFinite(roll) ? roll : 0;
  const c = Math.cos(r), s = Math.sin(r);
  const ex = dxPx * c + dyPx * s;
  const ey = -dxPx * s + dyPx * c;
  return {
    yaw: wrapPi(desYaw - ex * kPx),
    pitch: wrapPi(desPitch - ey * kPx),
  };
}

// Cursor ○ (screen-space, px a partir do centro) como espelho do erro
// desejo−nariz: direita=D (+cx), esquerda=E (−cx), cima = −cy. Clamp circular
// no raio R: nunca some (regra fora-da-tela).
// Screen-relative (Lane B): o erro (nx,ny) de mundo é girado por +roll p/
// a tela — com bank a bolinha aparece onde o desejo está NA TELA (roll=0
// idêntico ao antigo). nx/ny retornados já são de tela (autoBank/deadzone
// no input.js passam a operar na tela sem mudar de código).
export function cursorFromError(noseYaw, nosePitch, desYaw, desPitch, R, spread = TP_DESIRED_SPREAD, roll = 0) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nxw = clamp(-angDelta(noseYaw, desYaw) / spread, -1, 1);
  const nyw = clamp(-angDelta(nosePitch, desPitch) / spread, -1, 1);
  const r = Number.isFinite(roll) ? roll : 0;
  const c = Math.cos(r), s = Math.sin(r);
  const nx = nxw * c - nyw * s;
  const ny = nxw * s + nyw * c;
  let cx = nx * R, cy = ny * R;
  const d = Math.hypot(cx, cy);
  if (d > R) { cx *= R / d; cy *= R / d; }
  return { cx, cy, nx, ny };
}

// Ponto da bolinha no mundo: ship + dir(desejo)·dist (direção absoluta ⇒
// estável no mundo com o mouse parado). dist já com regras aplicadas.
export function ballWorld(ship, desYaw, desPitch, dist) {
  const f = forward(desYaw, desPitch);
  const d = Math.max(AIM_MIN_DIST, dist);
  return { x: ship.x + f.x * d, y: ship.y + f.y * d, z: ship.z + f.z * d, dx: f.x, dy: f.y, dz: f.z, dist: d };
}

// Primeiro impacto do raio (origem + dir·maxDist) nos obstáculos — mesma
// matemática do servidor (segSphereT). null = vazio (regra do vazio).
export function rayHitObstacle(ox, oy, oz, dx, dy, dz, maxDist, obstacles) {
  const ex = ox + dx * maxDist, ey = oy + dy * maxDist, ez = oz + dz * maxDist;
  let bestT = null, best = null;
  for (const o of (obstacles || [])) {
    const t = segSphereT(ox, oy, oz, ex, ey, ez, o.x, o.y, o.z, o.r);
    if (t !== null && (bestT === null || t < bestT)) { bestT = t; best = o; }
  }
  if (bestT === null) return null;
  const dist = bestT * maxDist;
  return { dist, point: { x: ox + dx * dist, y: oy + dy * dist, z: oz + dz * dist }, obstacle: best };
}
