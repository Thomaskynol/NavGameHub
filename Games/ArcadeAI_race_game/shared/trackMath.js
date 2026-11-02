/**
 * shared/trackMath.js — sampler puro do centerline. Contrato: ARCHITECTURE.md §2.
 *
 * Entrada: track.points = [[x,z], ...] (fechado implícito, sem repetir o 1º),
 *          track.widths = [largura total, ...] (mesmo tamanho).
 * Implementação: Catmull-Rom uniforme fechado, pré-amostrado a ~4 amostras/m
 * (mínimo 2000 amostras do laço), distância acumulada por amostra e busca
 * binária para localizar s. Puro ESM, zero dependências, sem globals.
 *
 * Convenções (iguais em servidor e cliente):
 *  - heading = atan2(dx, dz) — yaw p/ frente +Z em Three.js; wrap em [-π, π].
 *  - lat > 0 = esquerda do sentido de corrida. Normal esquerda da tangente
 *    (dx,dz) é (dz,-dx) = (cos h, -sin h).
 *  - curvature > 0 = curva à esquerda (mesma convenção de lat).
 */

const TAU = Math.PI * 2;

function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

function wrapS(s, length) {
  return ((s % length) + length) % length;
}

// Catmull-Rom uniforme: segmento p1→p2 com vizinhos p0/p3; escreve em out.
function crPoint(p0x, p0z, p1x, p1z, p2x, p2z, p3x, p3z, t, out) {
  const t2 = t * t;
  const t3 = t2 * t;
  out.x = 0.5 *
    ((2 * p1x) +
      (-p0x + p2x) * t +
      (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 +
      (-p0x + 3 * p1x - 3 * p2x + p3x) * t3);
  out.z = 0.5 *
    ((2 * p1z) +
      (-p0z + p2z) * t +
      (2 * p0z - 5 * p1z + 4 * p2z - p3z) * t2 +
      (-p0z + 3 * p1z - 3 * p2z + p3z) * t3);
}

export function createSampler(track) {
  const pts = track && track.points;
  const widths = track && track.widths;
  if (!Array.isArray(pts) || pts.length < 3) {
    throw new Error('trackMath: track.points precisa de >= 3 pontos [x,z]');
  }
  if (!Array.isArray(widths) || widths.length !== pts.length) {
    throw new Error('trackMath: track.widths deve ter o mesmo tamanho que track.points');
  }
  const N = pts.length;

  // perímetro aproximado do polígono de controle (chute p/ densidade de amostras)
  let approx = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % N];
    approx += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  const stepsFor = (len) =>
    Math.max(4, Math.ceil(Math.max(2000, Math.ceil(len * 4)) / N));

  function build(steps) {
    const M = steps * N;
    const xs = new Float64Array(M);
    const zs = new Float64Array(M);
    const hd = new Float64Array(M);
    const wd = new Float64Array(M);
    const cum = new Float64Array(M + 1); // cum[M] = comprimento total
    const tmp = { x: 0, z: 0 };
    for (let i = 0; i < N; i++) {
      const p0 = pts[(i - 1 + N) % N];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % N];
      const p3 = pts[(i + 2) % N];
      const w1 = widths[i];
      const w2 = widths[(i + 1) % N];
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        crPoint(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], t, tmp);
        const j = i * steps + k;
        xs[j] = tmp.x;
        zs[j] = tmp.z;
        wd[j] = w1 + (w2 - w1) * t;
      }
    }
    for (let j = 0; j < M; j++) {
      const nx = (j + 1) % M;
      cum[j + 1] = cum[j] + Math.hypot(xs[nx] - xs[j], zs[nx] - zs[j]);
    }
    const length = cum[M];
    // tangente central com wrap no laço
    for (let j = 0; j < M; j++) {
      const a = (j - 1 + M) % M;
      const b = (j + 1) % M;
      let dx = xs[b] - xs[a];
      let dz = zs[b] - zs[a];
      const n = Math.hypot(dx, dz) || 1;
      hd[j] = Math.atan2(dx / n, dz / n);
    }
    return { M, xs, zs, hd, wd, cum, length };
  }

  // 2 passes: se a densidade real caiu abaixo de ~4 amostras/m, refaz
  let baked = build(stepsFor(approx));
  if (baked.length * 4 > baked.M) baked = build(stepsFor(baked.length));
  const M = baked.M;
  const xs = baked.xs;
  const zs = baked.zs;
  const hd = baked.hd;
  const wd = baked.wd;
  const cum = baked.cum;
  const length = baked.length;

  // maior j com cum[j] <= s (cum crescente e cum[0] = 0)
  function segAt(s) {
    let lo = 0;
    let hi = M - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function pointAt(sIn) {
    const s = wrapS(sIn, length);
    const j = segAt(s);
    const nx = (j + 1) % M;
    const s0 = cum[j];
    const seg = cum[j + 1] - s0;
    const t = seg > 0 ? (s - s0) / seg : 0;
    return {
      x: xs[j] + (xs[nx] - xs[j]) * t,
      z: zs[j] + (zs[nx] - zs[j]) * t,
      heading: wrapAngle(hd[j] + wrapAngle(hd[nx] - hd[j]) * t),
    };
  }

  function project(x, z) {
    // amostra mais próxima (varredura; M ~ milhares, barato)
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < M; j++) {
      const dx = x - xs[j];
      const dz = z - zs[j];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    // refina projetando sobre os dois segmentos vizinhos da amostra
    let bj = best;
    let bt = 0;
    let bd = Infinity;
    for (let n = 0; n < 2; n++) {
      const j = n === 0 ? (best - 1 + M) % M : best;
      const nx = (j + 1) % M;
      const ax = xs[j];
      const az = zs[j];
      const ex = xs[nx] - ax;
      const ez = zs[nx] - az;
      const len2 = ex * ex + ez * ez;
      let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = ax + ex * t - x;
      const pz = az + ez * t - z;
      const d = px * px + pz * pz;
      if (d < bd) {
        bd = d;
        bj = j;
        bt = t;
      }
    }
    const nx = (bj + 1) % M;
    const seg = cum[bj + 1] - cum[bj];
    const s = wrapS(cum[bj] + seg * bt, length);
    const heading = wrapAngle(hd[bj] + wrapAngle(hd[nx] - hd[bj]) * bt);
    const width = wd[bj] + (wd[nx] - wd[bj]) * bt;
    const cx = xs[bj] + (xs[nx] - xs[bj]) * bt;
    const cz = zs[bj] + (zs[nx] - zs[bj]) * bt;
    // normal esquerda = (cos h, -sin h); lat positivo = esquerda
    const lat = (x - cx) * Math.cos(heading) - (z - cz) * Math.sin(heading);
    return { s, lat, heading, width, inside: Math.abs(lat) <= width / 2 };
  }

  function curvature(sIn) {
    const s = wrapS(sIn, length);
    // diferenças finitas suavizadas: média de duas janelas de 3 pontos
    let acc = 0;
    let cnt = 0;
    const wins = [1.0, 1.75];
    for (let i = 0; i < wins.length; i++) {
      const h = wins[i];
      const a = pointAt(s - h);
      const b = pointAt(s);
      const c = pointAt(s + h);
      const d1x = b.x - a.x;
      const d1z = b.z - a.z;
      const d2x = c.x - b.x;
      const d2z = c.z - b.z;
      const l1 = Math.hypot(d1x, d1z);
      const l2 = Math.hypot(d2x, d2z);
      const l3 = Math.hypot(c.x - a.x, c.z - a.z);
      if (l1 < 1e-9 || l2 < 1e-9 || l3 < 1e-9) continue;
      // sinal: curva à esquerda = positivo (mesma convenção de lat)
      acc += (2 * (d1z * d2x - d1x * d2z)) / (l1 * l2 * l3);
      cnt++;
    }
    return cnt ? acc / cnt : 0;
  }

  function polyline(n = 400) {
    const steps = Math.max(2, Math.floor(n));
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const p = pointAt((i * length) / steps);
      out.push([p.x, p.z]);
    }
    return out; // último ponto == primeiro (laço fechado)
  }

  function checkpoints(k = 8) {
    const out = [];
    for (let i = 0; i < k; i++) out.push((i * length) / k);
    return out;
  }

  function grid(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = length - 8 - 7 * i; // 8, 15, 22... m atrás da linha
      const lat = i % 2 === 0 ? 2.5 : -2.5; // alterna esquerda/direita
      const p = pointAt(s);
      const nx = Math.cos(p.heading);
      const nz = -Math.sin(p.heading); // normal esquerda
      out.push({
        x: p.x + lat * nx,
        z: p.z + lat * nz,
        heading: p.heading,
        s: wrapS(s, length),
        lat,
      });
    }
    return out;
  }

  return { length, project, pointAt, curvature, polyline, checkpoints, grid };
}
