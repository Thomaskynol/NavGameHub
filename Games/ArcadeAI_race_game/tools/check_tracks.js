/**
 * tools/check_tracks.js — validação de shared/tracks.js (ARCHITECTURE.md §2).
 * Uso: node tools/check_tracks.js   (também: npm run check:tracks; exit != 0 em falha)
 *
 * Valida: estrutura exata (ids/nomes/themes), points >= 24 sem duplicatas e sem
 * fechar no primeiro, widths 9..18, laço fechado sem autointerseção no sampler,
 * raio minimo >= 8 m, roundtrip project(pointAt(s)) ≈ s, grid(6) pairwise >= 4 m,
 * checkpoints(8) começando em 0, decor com kinds conhecidos e fora da faixa
 * jogável (|lat| > largura/2 + 2), e que os dois traçados sao distintos
 * (hash do polyline). Imprime estatísticas por pista.
 */
import { createSampler } from '../shared/trackMath.js';
import { TRACKS } from '../shared/tracks.js';

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

function segInt(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

// FNV-1a de 32 bits sobre string (hash barato p/ comparar centerlines)
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- expectativas

const HEX = /^#[0-9a-fA-F]{6}$/;
const ENV_KEYS = ['sky', 'ground', 'groundFar', 'fog', 'fogNear', 'fogFar', 'sun', 'ambient'];
const KINDS = {
  coast: ['palm', 'rock', 'dune', 'parasol', 'hut', 'boat', 'lighthouse', 'buoy'],
  industrial: ['container', 'warehouse', 'crane', 'silo', 'pipe', 'fence', 'lightpole', 'smokestack', 'crate'],
  common: ['tree', 'barrier', 'stand', 'billboard', 'tirestack'],
};
const THEME_KINDS = {
  coast: new Set([...KINDS.coast, ...KINDS.common]),
  industrial: new Set([...KINDS.industrial, ...KINDS.common]),
};
const EXPECTED = {
  costeiro: { name: 'Circuito Costeiro', theme: 'coast', len: [900, 1400] },
  industrial: { name: 'Distrito Industrial', theme: 'industrial', len: [800, 1200] },
};

// --------------------------------------------------------------- por pista

ok('TRACKS tem exatamente os ids costeiro + industrial',
  Object.keys(TRACKS).length === 2 && TRACKS.costeiro && TRACKS.industrial,
  `ids=[${Object.keys(TRACKS).join(', ')}]`);

const hashes = {};

for (const [id, t] of Object.entries(TRACKS)) {
  const exp = EXPECTED[id];
  if (!exp) {
    ok(`${id}: id inesperado`, false, 'esperado apenas costeiro/industrial');
    continue;
  }

  // --- estrutura
  ok(`${id}: id/nome/theme corretos`,
    t.id === id && t.name === exp.name && t.theme === exp.theme,
    `id=${t.id} name=${t.name} theme=${t.theme}`);

  ok(`${id}: env completo (cores hex, fogNear < fogFar)`,
    ENV_KEYS.every((k) => t.env && t.env[k] !== undefined)
      && ['sky', 'ground', 'groundFar', 'fog', 'sun', 'ambient'].every((k) => HEX.test(t.env[k]))
      && Number.isFinite(t.env.fogNear) && Number.isFinite(t.env.fogFar) && t.env.fogFar > t.env.fogNear);

  // --- points
  const pts = t.points;
  const ptsOk = Array.isArray(pts) && pts.length >= 24
    && pts.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  ok(`${id}: points com >= 24 pares numéricos`, ptsOk, `n=${pts && pts.length}`);
  if (ptsOk) {
    const first = pts[0], last = pts[pts.length - 1];
    ok(`${id}: primeiro ponto != último (laço não repetido)`,
      first[0] !== last[0] || first[1] !== last[1],
      `first=[${first}] last=[${last}]`);
    let dup = null;
    for (let i = 0; i < pts.length && !dup; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (pts[i][0] === pts[j][0] && pts[i][1] === pts[j][1]) { dup = `${i}:${j}@${pts[i]}`; break; }
      }
    }
    ok(`${id}: sem pontos duplicados`, !dup, dup && `duplicado em ${dup}`);
  }

  // --- widths
  ok(`${id}: widths com mesmo tamanho de points e valores 9..18`,
    Array.isArray(t.widths) && ptsOk && t.widths.length === pts.length
      && t.widths.every((w) => Number.isFinite(w) && w >= 9 && w <= 18),
    `widths=${t.widths && t.widths.length} min=${t.widths && Math.min(...t.widths)} max=${t.widths && Math.max(...t.widths)}`);

  // --- decor
  const decor = t.decor;
  const decorArr = Array.isArray(decor);
  ok(`${id}: decor com >= 45 itens`, decorArr && decor.length >= 45, `n=${decorArr ? decor.length : 'n/a'}`);
  if (decorArr) {
    const themeKinds = THEME_KINDS[t.theme];
    const badKind = decor.find((d) => !themeKinds.has(d.kind));
    ok(`${id}: decor só com kinds conhecidos do tema`, !badKind, badKind && `kind=${badKind.kind}`);
    const badShape = decor.find((d) => !Number.isFinite(d.x) || !Number.isFinite(d.z));
    ok(`${id}: decor com x/z numéricos`, !badShape);
  }

  const sm = createSampler(t);

  // --- comprimento
  ok(`${id}: comprimento dentro da faixa do tema (> 500)`,
    sm.length > 500 && sm.length >= exp.len[0] && sm.length <= exp.len[1],
    `L=${sm.length.toFixed(1)}m esperado=${exp.len[0]}..${exp.len[1]}`);

  // --- roundtrip project(pointAt(s)) ≈ s
  {
    let worst = 0, badS = -1;
    for (let i = 0; i < 300; i++) {
      const s = (i * sm.length) / 300;
      const p = sm.pointAt(s);
      const r = sm.project(p.x, p.z);
      const d = circDist(r.s, s, sm.length);
      if (d > worst) { worst = d; badS = s; }
    }
    ok(`${id}: roundtrip project(pointAt(s)) ≈ s em 300 valores (tol 0.5 m)`,
      worst < 0.5, `pior |Δs|=${worst.toFixed(4)}m em s=${badS.toFixed(2)}`);
  }

  // --- raio minimo >= 8 m (|k| <= 1/8) em amostragem densa
  {
    let maxk = 0, at = 0, runs = 0, inRun = false;
    const N = 1200;
    for (let i = 0; i < N; i++) {
      const sv = (i * sm.length) / N;
      const k = Math.abs(sm.curvature(sv));
      if (k > maxk) { maxk = k; at = sv; }
      if (k > 1 / 20) { if (!inRun) { runs++; inRun = true; } } else inRun = false;
    }
    ok(`${id}: raio minimo >= 8 m (|k| <= 1/8 em 1200 amostras)`,
      maxk <= 1 / 8, `max|k|=${maxk.toFixed(4)} rmin=${(1 / maxk).toFixed(2)}m em s=${at.toFixed(1)}`);
    console.log(`     ${id}: comprimento=${sm.length.toFixed(1)}m curvas-fechadas(|k|>1/20)=${runs} decor=${decorArr ? decor.length : 0}`);
  }

  // --- sem autointersecao em polyline(1200)
  {
    const pl = sm.polyline(1200);
    const M = pl.length - 1; // pl[M] == pl[0]; segmentos 0..M-1
    let bad = 0, where = '';
    for (let i = 0; i < M; i++) {
      for (let j = i + 15; j < M; j++) {
        const gap = Math.min(j - i, M - (j - i));
        if (gap < 15) continue;
        if (segInt(pl[i], pl[i + 1], pl[j], pl[j + 1])) { bad++; if (!where) where = `seg ${i}/${j}`; }
      }
    }
    ok(`${id}: laço fechado sem autointerseção em polyline(1200)`,
      bad === 0, `${bad} interseção(ões) (${where})`);
  }

  // --- grid(6): pairwise >= 4 m e todos inside
  {
    const g = sm.grid(6);
    let minD = Infinity;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++)
      minD = Math.min(minD, Math.hypot(g[i].x - g[j].x, g[i].z - g[j].z));
    const insides = g.every((sl) => sm.project(sl.x, sl.z).inside);
    ok(`${id}: grid(6) pairwise >= 4 m e todos inside`,
      g.length === 6 && minD >= 4 && insides,
      `minD=${minD.toFixed(2)} inside=${insides}`);
  }

  // --- checkpoints(8): cp0 === 0
  {
    const cps = sm.checkpoints(8);
    ok(`${id}: checkpoints(8) começa em 0`,
      cps.length === 8 && cps[0] === 0,
      `cps=[${cps.map((c) => c.toFixed(3)).join(', ')}]`);
  }

  // --- decor fora da faixa jogavel (|lat| > largura/2 + 2)
  if (decorArr) {
    let worst = Infinity, worstKind = '';
    for (const d of decor) {
      const pr = sm.project(d.x, d.z);
      const clear = Math.abs(pr.lat) - pr.width / 2;
      if (clear < worst) { worst = clear; worstKind = d.kind; }
    }
    ok(`${id}: decor fora da faixa jogável (|lat| > largura/2 + 2)`,
      worst > 2, `menor folga=${worst.toFixed(2)}m (${worstKind})`);
    console.log(`     ${id}: bbox=${bboxStr(sm)} folga-min-decor=${worst.toFixed(2)}m`);
  }

  // --- hash do centerline p/ comparar pistas
  hashes[id] = fnv1a(sm.polyline(400).map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(';'));
}

// ------------------------------------------------------------- pistas distintas

if (hashes.costeiro && hashes.industrial) {
  ok('os dois traçados são distintos (hash do polyline)',
    hashes.costeiro !== hashes.industrial,
    `hash costeiro=${hashes.costeiro} industrial=${hashes.industrial}`);
}

// ------------------------------------------------------------------- saída

function bboxStr(sm) {
  const pl = sm.polyline(400);
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (const [x, z] of pl) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    minz = Math.min(minz, z); maxz = Math.max(maxz, z);
  }
  return `x[${minx.toFixed(0)},${maxx.toFixed(0)}] z[${minz.toFixed(0)},${maxz.toFixed(0)}]`;
}

if (failed) {
  console.error(`\n${failed} checagem(ns) falharam.`);
  process.exit(1);
}
console.log('\nTodas as checagens OK — pistas prontas para a lane shared/.');
