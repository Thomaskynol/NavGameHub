// Geometria de colisão compartilhada (servidor + predição do cliente + testes).
// Esferas: STATION/ASTEROIDS de constants.js (mesma fonte da colisão real).
import { STATION, ASTEROIDS, SHIP_RADIUS, WORLD_BOUND } from './constants.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function obstacles() {
  return [STATION, ...ASTEROIDS];
}

// Menor t ∈ [0,1] em que o segmento p0→p1 toca a esfera (entrada); null se não toca.
// Resolve |p0 + t·(p1-p0) - c|² = r². Usado p/ ordenar impactos pelo primeiro
// ponto real do percurso (não pela ordem de iteração das naves).
export function segSphereT(x0, y0, z0, x1, y1, z1, cx, cy, cz, r) {
  const abx = x1 - x0, aby = y1 - y0, abz = z1 - z0;
  const ox = x0 - cx, oy = y0 - cy, oz = z0 - cz;
  const a = abx * abx + aby * aby + abz * abz;
  const b = 2 * (ox * abx + oy * aby + oz * abz);
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (a === 0) return c <= 0 ? 0 : null; // ponto dentro/sobre a esfera conta; fora não
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  // EPS: começo exatamente na superfície sofre poeira float (t0 ≈ -1e-17);
  // tocar conta, então valores ~0 colapsam para 0 (sem -0).
  const EPS = 1e-9;
  if (t0 >= -EPS && t0 <= 1) return Math.max(0, t0); // entra no segmento
  if (t1 >= -EPS && t1 <= 1) return c < 0 ? Math.max(0, t1) : 0; // começa dentro → conta saída
  return null;
}

// true se o segmento toca a esfera (compatível com o uso anterior).
export function segHitsSphere(x0, y0, z0, x1, y1, z1, cx, cy, cz, r) {
  return segSphereT(x0, y0, z0, x1, y1, z1, cx, cy, cz, r) !== null;
}

// Empurra p para fora de todos os obstáculos (mesma regra do servidor:
// minD = r + SHIP_RADIUS*0.4) e remove a componente de velocidade que aponta
// para dentro. d === 0 (posição exatamente no centro) usa normal determinística.
// Retorna true se houve correção (p/ medir a correção da predição local).
export function pushOutOfObstacles(p, v, list = obstacles()) {
  let moved = false;
  for (const o of list) {
    let dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
    let d = Math.hypot(dx, dy, dz);
    const minD = o.r + SHIP_RADIUS * 0.4;
    if (d >= minD) continue;
    let nx, ny, nz;
    if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; }
    else { nx = 0; ny = 1; nz = 0; } // fallback finito p/ d exatamente zero
    p.x = o.x + nx * minD; p.y = o.y + ny * minD; p.z = o.z + nz * minD;
    if (v) {
      const vn = v.x * nx + v.y * ny + v.z * nz;
      if (vn < 0) { v.x -= vn * nx; v.y -= vn * ny; v.z -= vn * nz; }
    }
    moved = true;
  }
  // limites da arena (mesmo clamp do servidor)
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(p[ax]) > WORLD_BOUND) { p[ax] = Math.sign(p[ax]) * WORLD_BOUND; moved = true; }
  }
  return moved;
}

// Distância livre ao longo do raio (unidade d) a partir de o, sem atravessar
// colisores (margem extra). Segmento amostrado de forma exata por esfera-raya:
// encurta até a entrada do obstáculo mais próximo; se a origem está dentro,
// retorna 0 (melhor que atravessar a rocha). Usado p/ câmera FP/TP.
export function freeDistAlongRay(o, d, maxDist, list = obstacles(), margin = 1.5) {
  let dist = maxDist;
  for (const c of list) {
    const R = c.r + margin;
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z; // dot(o-c, d)
    const cc = ox * ox + oy * oy + oz * oz - R * R;
    const disc = b * b - cc;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const t0 = -b - sq, t1 = -b + sq;
    if (cc < 0) return 0;          // origem dentro: não dá p/ encurtar
    if (t0 >= 0 && t0 < dist) dist = Math.max(0, t0 - 0.05);
    void t1;
  }
  return clamp(dist, 0, maxDist);
}

// Distância máxima ao longo de d até a caixa da arena (WORLD_BOUND).
export function distToBound(o, d, maxDist, bound = WORLD_BOUND) {
  let dist = maxDist;
  for (const ax of ['x', 'y', 'z']) {
    const s = d[ax];
    if (s > 1e-9) dist = Math.min(dist, (bound - o[ax]) / s);
    else if (s < -1e-9) dist = Math.min(dist, (-bound - o[ax]) / s);
  }
  return clamp(dist, 0, maxDist);
}

// Suavização exponencial independente de FPS: um passo de 2Δt = dois passos de Δt.
export function expLerp(a, b, dt, rate) {
  return a + (b - a) * (1 - Math.exp(-rate * Math.max(0, dt)));
}
