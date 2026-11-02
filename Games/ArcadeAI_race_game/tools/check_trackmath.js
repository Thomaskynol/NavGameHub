/**
 * tools/check_trackmath.js — validação de shared/trackMath.js (ARCHITECTURE.md §2).
 * Uso: node tools/check_trackmath.js   (exit != 0 em falha; imprime "OK ..." por teste)
 *
 * Define aqui dois tracks sintéticos (não importa shared/tracks.js):
 *  - oval:    retângulo 100x60 com cantos de raio 15, largura 12, 32 pontos;
 *  - círculo: raio 30, 64 pontos, largura 12.
 */
import { createSampler } from '../shared/trackMath.js';

// ---------------------------------------------------------------- helpers

let failed = 0;
function ok(name, cond, detail) {
  if (cond) {
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.error(`FALHA ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const circDist = (a, b, L) => Math.min(Math.abs(a - b), L - Math.abs(a - b));

function angDiff(a, b) {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return Math.abs(d);
}

// ------------------------------------------------------- tracks sintéticos

// Oval: retângulo 100x60 (meios 50x30) com 4 cantos de raio 15, 32 pontos.
// Sobre o contorno exato; trechos retos com pontos colineares (curvatura 0).
function ovalTrack() {
  const HW = 50;
  const HH = 30;
  const R = 15;
  const points = [];
  // straights: extremo final NÃO emitido (é o início do arco seguinte)
  const straight = (x0, z0, x1, z1, step) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    for (let d = 0; d < L - 1e-9; d += step) {
      points.push([x0 + ((x1 - x0) * d) / L, z0 + ((z1 - z0) * d) / L]);
    }
  };
  // arco: extremo inicial EMITIDO, final não (próxima primitiva começa lá)
  const arc = (cx, cz, a0, a1, parts) => {
    for (let i = 0; i < parts; i++) {
      const a = a0 + ((a1 - a0) * i) / parts;
      points.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]);
    }
  };
  straight(-HW + R, -HH, HW - R, -HH, 10); // topo (z=-30), heading leste
  arc(HW - R, -HH + R, -Math.PI / 2, 0, 3); // canto sup. direito
  straight(HW, -HH + R, HW, HH - R, 10); // direita, heading sul
  arc(HW - R, HH - R, 0, Math.PI / 2, 3); // canto inf. direito
  straight(HW - R, HH, -HW + R, HH, 10); // base, heading oeste
  arc(-HW + R, HH - R, Math.PI / 2, Math.PI, 3); // canto inf. esquerdo
  straight(-HW, HH - R, -HW, -HH + R, 10); // esquerda, heading norte
  arc(-HW + R, -HH + R, Math.PI, Math.PI * 1.5, 3); // canto sup. esquerdo
  return { points, widths: points.map(() => 12) };
}

const OVAL_PERIM = 2 * (2 * (50 - 15)) + 2 * (2 * (30 - 15)) + 2 * Math.PI * 15;

// Círculo de raio 30; sentido (x,z) que resulta em curva à esquerda (= k > 0).
function circleTrack() {
  const R = 30;
  const N = 64;
  const points = [];
  for (let i = 0; i < N; i++) {
    const a = -(2 * Math.PI * i) / N;
    points.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return { points, widths: points.map(() => 12) };
}

// ------------------------------------------------------------------ testes

const oval = createSampler(ovalTrack());
const circle = createSampler(circleTrack());

// 1) comprimento do oval
{
  const d = Math.abs(oval.length - OVAL_PERIM);
  ok(
    'oval: length > 200 e coerente com perímetro esperado (±10%)',
    oval.length > 200 && d <= OVAL_PERIM * 0.1,
    `length=${oval.length.toFixed(2)} esperado=${OVAL_PERIM.toFixed(2)} delta=${d.toFixed(2)}`,
  );
}

// 2) roundtrip project(pointAt(s)) ≈ s (300 valores, tol 0.5 m)
for (const [label, sm] of [['oval', oval], ['círculo', circle]]) {
  let worst = 0;
  let bad = -1;
  for (let i = 0; i < 300; i++) {
    const s = (i * sm.length) / 300;
    const p = sm.pointAt(s);
    const r = sm.project(p.x, p.z);
    const d = circDist(r.s, s, sm.length);
    if (d > worst) {
      worst = d;
      bad = s;
    }
  }
  ok(
    `${label}: roundtrip project(pointAt(s)) ≈ s em 300 valores (tol 0.5 m)`,
    worst < 0.5,
    `pior |Δs|=${worst.toFixed(4)} m em s=${bad.toFixed(2)}`,
  );
}

// 3) lat/heading consistentes entre pointAt+project (centro e deslocado ±2.5)
for (const [label, sm] of [['oval', oval], ['círculo', circle]]) {
  let worstLat = 0;
  let worstS = 0;
  let worstHd = 0;
  for (let i = 0; i < 100; i++) {
    const s = (i * sm.length) / 100;
    const p = sm.pointAt(s);
    for (const off of [-2.5, 2.5]) {
      const q = {
        x: p.x + off * Math.cos(p.heading),
        z: p.z - off * Math.sin(p.heading),
      };
      const r = sm.project(q.x, q.z);
      worstLat = Math.max(worstLat, Math.abs(r.lat - off));
      worstS = Math.max(worstS, circDist(r.s, s, sm.length));
      worstHd = Math.max(worstHd, angDiff(r.heading, p.heading));
    }
  }
  ok(
    `${label}: lat/heading de pointAt+project consistentes`,
    worstLat < 0.2 && worstS < 0.5 && worstHd < 0.05,
    `lat=${worstLat.toFixed(4)} s=${worstS.toFixed(4)} hd=${worstHd.toFixed(4)}`,
  );
}

// 4) projeto de pontos no centro da pista dá |lat| pequeno
{
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const s = (i * oval.length) / 300;
    const p = oval.pointAt(s);
    const r = oval.project(p.x, p.z);
    worst = Math.max(worst, Math.abs(r.lat));
  }
  ok('oval: projeto no centro da pista tem |lat| < 0.5', worst < 0.5, `pior |lat|=${worst.toFixed(4)}`);
}

// 5) ponto fora da pista: |lat| > largura/2 e inside = false
{
  let allOut = true;
  let detail = '';
  for (let i = 0; i < 40; i++) {
    const s = (i * oval.length) / 40;
    const p = oval.pointAt(s);
    const base = oval.project(p.x, p.z);
    const off = base.width / 2 + 2; // 2 m além da borda
    for (const dir of [-1, 1]) {
      const q = {
        x: p.x + dir * off * Math.cos(p.heading),
        z: p.z - dir * off * Math.sin(p.heading),
      };
      const r = oval.project(q.x, q.z);
      if (r.inside || !(Math.abs(r.lat) > r.width / 2)) {
        allOut = false;
        detail = `s=${s.toFixed(2)} lat=${r.lat.toFixed(2)} width=${r.width.toFixed(2)} inside=${r.inside}`;
      }
    }
  }
  ok('oval: ponto fora da pista tem |lat| > largura/2 e inside=false', allOut, detail);
}

// 6) grid(6): 6 slots, pairwise >= 4 m, todos inside
{
  const g = oval.grid(6);
  let minD = Infinity;
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) {
      minD = Math.min(minD, Math.hypot(g[i].x - g[j].x, g[i].z - g[j].z));
    }
  }
  const insides = g.map((sl) => oval.project(sl.x, sl.z).inside);
  ok(
    'oval: grid(6) tem 6 slots, distâncias pairwise >= 4 m e todos inside',
    g.length === 6 && minD >= 4 && insides.every(Boolean),
    `slots=${g.length} minD=${minD.toFixed(2)} inside=${insides.join(',')}`,
  );
}

// 7) checkpoints(8): cp0 = 0 e diffs iguais a length/8
{
  const cps = oval.checkpoints(8);
  const step = oval.length / 8;
  const diffsOk = cps.every((c, i) => Math.abs(c - i * step) < 1e-9);
  ok(
    'oval: checkpoints(8) começa em 0 e diffs iguais a length/8',
    cps.length === 8 && cps[0] === 0 && diffsOk,
    `cps=[${cps.map((c) => c.toFixed(3)).join(', ')}] step=${step.toFixed(3)}`,
  );
}

// 8) polyline(400) fecha e fica na pista
{
  const pl = oval.polyline(400);
  const close = Math.hypot(pl[0][0] - pl[pl.length - 1][0], pl[0][1] - pl[pl.length - 1][1]);
  let onTrack = true;
  for (let i = 0; i < pl.length; i += 40) {
    if (!oval.project(pl[i][0], pl[i][1]).inside) onTrack = false;
  }
  ok(
    'oval: polyline(400) fecha (<5 m) e pontos ficam na pista',
    close < 5 && onTrack,
    `fechamento=${close.toFixed(4)} m onTrack=${onTrack}`,
  );
}

// 9) curvatura em trecho reto ≈ 0 (meio da reta superior, s≈35)
{
  let worst = 0;
  for (const s of [30, 35, 40]) worst = Math.max(worst, Math.abs(oval.curvature(s)));
  ok('oval: curvatura em trecho reto ≈ 0 (|k| < 0.01)', worst < 0.01, `pior |k|=${worst.toFixed(6)}`);
}

// 9b) sinal da curvatura: canto sup. direito do oval é curva à direita (k < 0)
// (arco de R=15 ocupa s ∈ [70, 70+15π/2 ≈ 93.6]; testa o miolo do arco)
{
  let maxK = -Infinity;
  for (const s of [76, 80, 84, 88]) maxK = Math.max(maxK, oval.curvature(s));
  ok('oval: curvatura com sinal (canto à direita ⇒ k < -0.02)', maxK < -0.02, `pior k=${maxK.toFixed(4)}`);
}

// 10) círculo R=30: curvatura ≈ 1/30 com sinal positivo
{
  let worst = 0;
  let badS = -1;
  for (let i = 0; i < 12; i++) {
    const s = (i * circle.length) / 12;
    const k = circle.curvature(s);
    const d = Math.abs(k - 1 / 30);
    if (d > worst) {
      worst = d;
      badS = s;
    }
  }
  ok(
    'círculo R=30: |curvature(s) - 1/30| < 0.05 em vários s',
    worst < 0.05,
    `pior |k-1/30|=${worst.toFixed(5)} em s=${badS.toFixed(2)}`,
  );
}

// ------------------------------------------------------------------ saída

if (failed) {
  console.error(`\n${failed} teste(s) falharam.`);
  process.exit(1);
}
console.log('\nTodos os testes OK.');
