'use strict';

// Arena ~100x100 (§14), pedra medieval, obstáculos intransponíveis.
// Pontos de spawn acessíveis; obstáculos não prendem jogador.

const W = 100;
const H = 100;

// shortcut: geometria própria simples (muralha central + pilares); valores
// ajustáveis por teste (§13 pressupostos operacionais).
const OBSTACLES = [
  { x: 44, y: 44, w: 12, h: 12 }, // torre central
  { x: 18, y: 18, w: 6, h: 6 },
  { x: 76, y: 18, w: 6, h: 6 },
  { x: 18, y: 76, w: 6, h: 6 },
  { x: 76, y: 76, w: 6, h: 6 },
];

const SPAWNS = [
  [8, 8], [92, 8], [8, 92], [92, 92],
  [50, 8], [50, 92], [8, 50], [92, 50],
  [28, 50], [72, 50], [50, 28], [50, 72],
];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function insideObs(x, y, r) {
  for (const o of OBSTACLES) {
    if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return true;
  }
  return false;
}

function isBlocked(x, y, r = 0.4) {
  if (x < 0.5 || y < 0.5 || x > W - 0.5 || y > H - 0.5) return true;
  return insideObs(x, y, r);
}

// Amostra segmento para bloquear ataques através de parede (§4).
function segmentBlocked(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(d / 0.5));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isBlocked(x1 + dx * t, y1 + dy * t, 0.1)) return true;
  }
  return false;
}

function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

module.exports = { W, H, OBSTACLES, SPAWNS, clamp, isBlocked, segmentBlocked, dist };
