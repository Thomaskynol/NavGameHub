/**
 * tools/check_carphysics.js — validação pura da física do carro (sem three,
 * sem browser). Uso: node tools/check_carphysics.js (exit != 0 em falha).
 * Importa carPhysics + createSampler(TRACKS.costeiro) e simula: aceleração,
 * frenagem, ré, nitro (vmax/drenagem/regen/tanque 0), linha reta, curva alta
 * com steer máximo, determinismo, parede, 1.1 voltas pelo centerline (= 1 lap),
 * sentido contrário (0 laps), recover + cooldown, off-track, desencalhe e
 * estabilidade com dt=1/30.
 */
import { createSampler } from '../shared/trackMath.js';
import { TRACKS } from '../shared/tracks.js';
import { PHYSICS, NITRO } from '../shared/constants.js';
import { createCar, stepCar, recover } from '../public/js/game/carPhysics.js';

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

/** fn retorna true (ok) ou string de falha; exceção vira falha. */
function test(name, fn) {
  try {
    const r = fn();
    ok(name, r === true, typeof r === 'string' ? r : undefined);
  } catch (err) {
    ok(name, false, err && err.message);
  }
}

const DT = 1 / 120;
const NEUTRAL = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
const FULL = { throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
const wrapS = (s, L) => ((s % L) + L) % L;
const wrapAngle = (a) => {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a <= -Math.PI) a += Math.PI * 2;
  return a;
};
const isFiniteCar = (car) =>
  [car.x, car.z, car.hd, car.v, car.vlat, car.s, car.lat].every(Number.isFinite);

const sampler = createSampler(TRACKS.costeiro);
const L = sampler.length;
const pAt = (s) => sampler.pointAt(s);
const mkCar = (s, v = 0) => { const p = pAt(s); return createCar(p.x, p.z, p.heading, v); };

/**
 * snap-follow: reposiciona no centerline a cada passo (isolamento
 * longitudinal/dinâmico). onStep(i, car, events) opcional p/ medições.
 */
function snapFollow(car, s0, steps, inputFn, { lat0 = 0, setV = null, onStep = null } = {}) {
  const ctx = { sampler };
  const all = [];
  let s = wrapS(s0, L);
  for (let i = 0; i < steps; i++) {
    const p = sampler.pointAt(s);
    const nx = Math.cos(p.heading), nz = -Math.sin(p.heading);
    car.x = p.x + lat0 * nx;
    car.z = p.z + lat0 * nz;
    car.hd = p.heading;
    if (setV != null) car.v = setV;
    const r = stepCar(car, inputFn(car, i), DT, ctx);
    for (const e of r.events) all.push(e);
    if (onStep) onStep(i, car, r);
    s = wrapS(s + car.v * DT, L);
  }
  return all;
}

// ------------------------------------------------------------------ testes

test('acelera do repouso e estabiliza em vmax coerente (~42 m/s), sem salto', () => {
  const car = mkCar(40);
  let vAt1s = null, prevV = 0, mono = true, maxDv = 0, off = 0;
  snapFollow(car, 40, 3600, () => FULL, {
    onStep: (i, c) => {
      if (i === 119) vAt1s = c.v;
      if (c.v < prevV - 1e-9) mono = false;
      if (c.v - prevV > maxDv) maxDv = c.v - prevV;
      prevV = c.v;
      if (c.offTrack) off++;
    },
  });
  if (vAt1s == null || vAt1s < 15 || vAt1s > 17) return `v(1s)=${vAt1s} esperado ~16`;
  if (car.v < 41.8 || car.v > 42.2) return `v final=${car.v.toFixed(3)} esperado ~42`;
  if (!mono) return 'velocidade não-monotônica com acelerador pleno';
  if (maxDv > 0.15) return `salto de v por step=${maxDv.toFixed(4)}`;
  if (off > 0) return `${off} steps off-track no snap-follow`;
  return true;
});

test('freia de 30 m/s até parar em <120 m, sem salto de velocidade', () => {
  const car = mkCar(40, 30);
  const ctx = { sampler };
  let dist = 0, maxDv = 0, prevV = car.v, steps = 0;
  while (car.v > 0.001 && steps < 1200) {
    const before = car.v;
    stepCar(car, { throttle: 0, brake: 1, steer: 0, handbrake: 0, nitro: 0 }, DT, ctx);
    dist += before * DT;
    const dv = Math.abs(car.v - prevV);
    if (dv > maxDv) maxDv = dv;
    prevV = car.v;
    steps++;
  }
  if (car.v > 0.05) return `não parou em 10 s (v=${car.v.toFixed(2)})`;
  if (dist > 120 || dist < 5) return `distância=${dist.toFixed(1)} m (esperado 5..120)`;
  if (maxDv > 0.25) return `salto de v por step=${maxDv.toFixed(4)}`;
  return true;
});

test('marcha à ré chega a ~-10 m/s, anda p/ trás e retoma p/ frente suave', () => {
  const car = mkCar(40);
  const s0 = 40;
  snapFollow(car, s0, 480, () => ({ throttle: 0, brake: 1, steer: 0, handbrake: 0, nitro: 0 }));
  if (car.v > -9.8 || car.v < -10.05) return `v ré=${car.v.toFixed(3)} esperado ~-10`;
  const backDist = wrapS(s0 - car.s, L);
  if (backDist < 20) return `andou só ${backDist.toFixed(1)} m para trás`;
  let maxDv = 0, prevV = car.v;
  snapFollow(car, car.s, 240, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: 0 }), {
    onStep: (i, c) => {
      const dv = Math.abs(c.v - prevV);
      if (dv > maxDv) maxDv = dv;
      prevV = c.v;
    },
  });
  if (car.v <= 10) return `não retomou p/ frente (v=${car.v.toFixed(2)})`;
  if (maxDv > 0.25) return `salto na retomada=${maxDv.toFixed(4)} m/s por step`;
  return true;
});

test('nitro: vmax ~49.5, drena a 28/s, regen 12/s após 900 ms, tanque 0 = sem efeito', () => {
  // drenagem
  const car = mkCar(40);
  snapFollow(car, 40, 120, () => ({ throttle: 0.5, brake: 0, steer: 0, handbrake: 0, nitro: 1 }));
  const drained = NITRO.tank - car.nitro;
  if (!car.nitroActive) return 'nitro não ficou ativo com tanque cheio';
  if (Math.abs(drained - 28) > 1) return `drenagem=${drained.toFixed(2)} em 1 s (esperado 28)`;
  const drainRate = drained;

  // vmax com nitro
  const carB = mkCar(40);
  let maxV = 0;
  snapFollow(carB, 40, 360, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: 1 }), {
    onStep: (i, c) => { if (c.v > maxV) maxV = c.v; },
  });
  const want = PHYSICS.maxSpeed * NITRO.speedBoost;
  if (maxV < want - 1 || maxV > want + 0.6) return `vmax c/ nitro=${maxV.toFixed(2)} (esperado ~${want.toFixed(2)})`;
  if (maxV < PHYSICS.maxSpeed + 5) return `nitro sem ganho perceptível (${maxV.toFixed(2)})`;

  // regen a partir do tanque drenado (72), sem uso
  const tankAfter = car.nitro;
  snapFollow(car, car.s, Math.round(0.85 * 120), () => NEUTRAL, { setV: 25 });
  if (Math.abs(car.nitro - tankAfter) > 0.5) return `regenou antes do delay (Δ=${(car.nitro - tankAfter).toFixed(2)})`;
  snapFollow(car, car.s, Math.round(2.0 * 120), () => NEUTRAL, { setV: 25 });
  const regen = car.nitro - tankAfter;
  const regenRate = regen / 2.0;
  if (regen < 20 || regen > 27) return `regen em 2 s=${regen.toFixed(2)} (esperado ~24)`;
  if (regenRate >= drainRate) return `regen (${regenRate.toFixed(1)}/s) >= drenagem (${drainRate.toFixed(1)}/s)`;
  if (car.nitro > NITRO.tank + 1e-6) return 'tanque acima do máximo';

  // tanque 0: sem boost, sem ativação
  const carC = mkCar(40);
  carC.nitro = 0;
  snapFollow(carC, 40, 720, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: 1 }));
  if (carC.nitroActive) return 'nitro ativo com tanque 0';
  if (Math.abs(carC.v - PHYSICS.maxSpeed) > 0.2) return `tanque 0 mas v=${carC.v.toFixed(2)} (esperado ~42)`;
  return true;
});

test('linha reta 10 s pela pista real: |lat| ~0 sem steer, cresce com steer', () => {
  const car = mkCar(30, 8);
  const ctx = { sampler };
  const input = () => ({
    throttle: car.v < 8 ? 1 : 0, brake: car.v > 9.5 ? 0.5 : 0,
    steer: 0, handbrake: 0, nitro: 0,
  });
  let maxLat = 0, walls = 0, off = 0;
  for (let i = 0; i < 1200; i++) {
    const r = stepCar(car, input(), DT, ctx);
    for (const e of r.events) if (e.type === 'wall') walls++;
    const pr = sampler.project(car.x, car.z);
    if (Math.abs(pr.lat) > maxLat) maxLat = Math.abs(pr.lat);
    if (!pr.inside) off++;
  }
  if (walls > 0) return `${walls} eventos de parede em linha reta`;
  if (off > 0) return `${off} steps off-track em linha reta`;
  if (maxLat > 0.5) return `|lat| chegou a ${maxLat.toFixed(3)} m sem steer`;
  // com steer máximo, |lat| precisa crescer
  const car2 = mkCar(30, 8);
  let maxLat2 = 0;
  for (let i = 0; i < 240; i++) {
    stepCar(car2, {
      throttle: car2.v < 8 ? 1 : 0, brake: 0, steer: 1, handbrake: 0, nitro: 0,
    }, DT, ctx);
    const pr = sampler.project(car2.x, car2.z);
    if (Math.abs(pr.lat) > maxLat2) maxLat2 = Math.abs(pr.lat);
  }
  if (maxLat2 < 3) return `com steer=1, |lat| só chegou a ${maxLat2.toFixed(2)} m`;
  return true;
});

test('steer máximo em curva alta: sem teleporto, |Δlat| < 20 m/step', () => {
  let bestS = 0, bestK = 0;
  for (let i = 0; i < 800; i++) {
    const sv = (i * L) / 800;
    const k = Math.abs(sampler.curvature(sv));
    if (k > bestK) { bestK = k; bestS = sv; }
  }
  const car = mkCar(bestS, PHYSICS.maxSpeed);
  const ctx = { sampler };
  let prevX = car.x, prevZ = car.z, prevLat = null, worstPos = 0, worstLat = 0;
  for (let i = 0; i < 360; i++) {
    stepCar(car, { throttle: 1, brake: 0, steer: 1, handbrake: 0, nitro: 0 }, DT, ctx);
    if (!isFiniteCar(car)) return `estado não-finito no step ${i}`;
    const pr = sampler.project(car.x, car.z);
    const dPos = Math.hypot(car.x - prevX, car.z - prevZ);
    if (dPos > worstPos) worstPos = dPos;
    if (prevLat != null) {
      const dLat = Math.abs(pr.lat - prevLat);
      if (dLat > worstLat) worstLat = dLat;
    }
    prevX = car.x; prevZ = car.z; prevLat = pr.lat;
    if (Math.abs(car.v) > PHYSICS.maxSpeed * NITRO.speedBoost + 1) return `v explodiu (${car.v.toFixed(1)})`;
  }
  if (worstPos > 2) return `deslocamento de ${worstPos.toFixed(2)} m em um step (teleporto?)`;
  if (worstLat > 20) return `|Δlat| de ${worstLat.toFixed(2)} m em um step`;
  return true;
});

test('determinismo: 2 carros idênticos = mesmo estado após 1000 steps', () => {
  const a = mkCar(60, 15), b = mkCar(60, 15);
  const ctxA = { sampler }, ctxB = { sampler };
  const input = (i) => ({
    throttle: 1, brake: 0, steer: Math.sin(i / 50),
    handbrake: (i % 300) < 60 ? 1 : 0, nitro: i > 400 ? 1 : 0,
  });
  for (let i = 0; i < 1000; i++) {
    stepCar(a, input(i), DT, ctxA);
    stepCar(b, input(i), DT, ctxB);
  }
  if (!isFiniteCar(a)) return 'carro A com estado não-finito';
  const keys = ['x', 'z', 'hd', 'v', 'vlat', 'steer01', 'nitro', 'nitroActive',
    'offTrack', 'drifting', 'lap', 'cpNext', 's', 'lat', 'progress', 'wrongWay'];
  for (const k of keys) {
    if (a[k] !== b[k]) return `campo ${k} divergiu: ${a[k]} != ${b[k]}`;
  }
  return true;
});

test('parede segura o carro: |lat| <= width/2+wallMargin e v cai no impacto', () => {
  const p = pAt(200);
  const car = createCar(p.x, p.z, p.heading + Math.PI / 2, 0); // aponta p/ fora (lat>0)
  const ctx = { sampler };
  let walls = 0, vPeak = 0, vAtFirstHit = null, overshoot = 0;
  for (let i = 0; i < 960; i++) {
    const vBefore = car.v;
    if (vAtFirstHit === null && vBefore > vPeak) vPeak = vBefore;
    const r = stepCar(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: 0 }, DT, ctx);
    if (r.events.some((e) => e.type === 'wall')) {
      walls++;
      if (vAtFirstHit == null) vAtFirstHit = vBefore;
    }
    const pr = sampler.project(car.x, car.z);
    const limit = pr.width / 2 + PHYSICS.wallMargin;
    if (Math.abs(pr.lat) - limit > overshoot) overshoot = Math.abs(pr.lat) - limit;
  }
  if (walls < 1) return 'nenhum evento de parede';
  if (overshoot > 0.15) return `lat ultrapassou o limite em ${overshoot.toFixed(3)} m`;
  if (vAtFirstHit == null || !(car.v < vAtFirstHit * 0.9)) {
    return `v não caiu no impacto (${vAtFirstHit == null ? 'n/a' : vAtFirstHit.toFixed(1)} → ${car.v.toFixed(1)})`;
  }
  const prF = sampler.project(car.x, car.z);
  if (Math.abs(prF.lat) > prF.width / 2 + PHYSICS.wallMargin + 0.15) return 'fora do limite ao final';
  if (vPeak < 8) return `nem ganhou velocidade antes do impacto (pico ${vPeak.toFixed(1)})`;
  return true;
});

test('seguir o centerline por 1.1 voltas ⇒ exatamente 1 evento de lap', () => {
  const car = mkCar(0, 25);
  const ctx = { sampler };
  let s = 0, dist = 0, laps = 0, maxLat = 0;
  while (dist < L * 1.1) {
    const pt = sampler.pointAt(s);
    car.x = pt.x; car.z = pt.z; car.hd = pt.heading; car.v = 25;
    const r = stepCar(car, NEUTRAL, DT, ctx);
    for (const e of r.events) if (e.type === 'lap') laps++;
    if (Math.abs(car.lat) > maxLat) maxLat = Math.abs(car.lat);
    dist += 25 * DT;
    s = wrapS(s + 25 * DT, L);
  }
  if (laps !== 1) return `${laps} eventos de lap (esperado exatamente 1)`;
  if (car.cpNext !== 1) return `cpNext=${car.cpNext} após a volta (esperado 1)`;
  if (car.lap !== 1) return `car.lap=${car.lap} (esperado 1)`;
  if (maxLat > 1) return `descolou do centerline (|lat| máx ${maxLat.toFixed(2)})`;
  return true;
});

test('sentido contrário (frente invertida e ré): 0 laps + aviso de contramão', () => {
  const ctx = { sampler };
  // A: heading invertido andando contra o fluxo
  const carA = mkCar(L * 0.2, 25);
  let s = L * 0.2, dist = 0, lapsA = 0, wrongOn = 0;
  while (dist < L * 1.1) {
    const pt = sampler.pointAt(s);
    carA.x = pt.x; carA.z = pt.z; carA.hd = pt.heading + Math.PI; carA.v = 25;
    const r = stepCar(carA, NEUTRAL, DT, ctx);
    for (const e of r.events) {
      if (e.type === 'lap') lapsA++;
      if (e.type === 'wrongway' && e.on) wrongOn++;
    }
    dist += 25 * DT;
    s = wrapS(s - 25 * DT, L);
  }
  if (lapsA !== 0) return `${lapsA} laps no sentido contrário (esperado 0)`;
  if (wrongOn < 1) return 'sem aviso de contramão com heading invertido';
  // B: heading correto, marcha à ré
  const carB = mkCar(L * 0.5, -25);
  let sB = L * 0.5, distB = 0, lapsB = 0;
  while (distB < L * 0.5) {
    const pt = sampler.pointAt(sB);
    carB.x = pt.x; carB.z = pt.z; carB.hd = pt.heading; carB.v = -25;
    const r = stepCar(carB, NEUTRAL, DT, ctx);
    for (const e of r.events) if (e.type === 'lap') lapsB++;
    distB += 25 * DT;
    sB = wrapS(sB - 25 * DT, L);
  }
  if (lapsB !== 0) return `${lapsB} laps de ré (esperado 0)`;
  return true;
});

test('recover() teleporta ao último cp, zera v e respeita o cooldown de 3 s', () => {
  const ctx = { sampler };
  const car = mkCar(0, 25);
  let s = 0;
  while (car.cpNext < 2) {
    const pt = sampler.pointAt(s);
    car.x = pt.x; car.z = pt.z; car.hd = pt.heading; car.v = 25;
    stepCar(car, NEUTRAL, DT, ctx);
    s = wrapS(s + 25 * DT, L);
    if (s > L * 0.5) return 'não colheu cp1 no percurso esperado';
  }
  // manda longe (simula encalhe)
  car.x += 50; car.z += 50; car.v = 33; car.vlat = 4;
  const r1 = recover(car, ctx);
  if (!r1.events.some((e) => e.type === 'recover')) return 'sem evento recover';
  const cp1 = sampler.pointAt(L / 8);
  if (Math.hypot(car.x - cp1.x, car.z - cp1.z) > 0.01) return 'não teleportou ao cp1';
  if (car.v !== 0 || car.vlat !== 0) return `v não zerou (v=${car.v}, vlat=${car.vlat})`;
  if (Math.abs(wrapAngle(car.hd - cp1.heading)) > 1e-6) return 'heading != tangente do cp';
  const pr = sampler.project(car.x, car.z);
  if (Math.abs(pr.lat) > 0.05) return `lat=${pr.lat.toFixed(3)} (esperado ~0)`;
  if (car.recTimer < 2.9) return `cooldown=${car.recTimer.toFixed(2)} s (esperado ~3)`;
  // dentro do cooldown: nada acontece
  const xB = car.x, zB = car.z;
  const r2 = recover(car, ctx);
  if (r2.events.length !== 0) return 'recover dentro do cooldown devolveu eventos';
  if (car.x !== xB || car.z !== zB) return 'recover dentro do cooldown moveu o carro';
  // expira o cooldown e recupera de novo
  for (let i = 0; i < Math.ceil(3.2 * 120); i++) stepCar(car, NEUTRAL, DT, ctx);
  if (car.recTimer > 0) return `cooldown não expirou (resta ${car.recTimer.toFixed(2)} s)`;
  const r3 = recover(car, ctx);
  if (!r3.events.some((e) => e.type === 'recover')) return 'recover após cooldown falhou';
  return true;
});

test('off-track: vmax off (18) menor que no asfalto, com arrasto, mas escapa andando', () => {
  const pr0 = sampler.project(...(() => { const p = pAt(100); return [p.x, p.z]; })());
  const lat0 = pr0.width / 2 + 1; // acostamento: inside=false
  const car = mkCar(100, 20);
  const ctx = { sampler };
  let s = 100, offAll = true;
  for (let i = 0; i < 720; i++) {
    const pt = sampler.pointAt(s);
    const nx = Math.cos(pt.heading), nz = -Math.sin(pt.heading);
    car.x = pt.x + lat0 * nx; car.z = pt.z + lat0 * nz; car.hd = pt.heading;
    stepCar(car, FULL, DT, ctx);
    if (!car.offTrack) offAll = false;
    s = wrapS(s + car.v * DT, L);
  }
  if (!offAll) return 'perdeu off-track no acostamento';
  if (car.v > PHYSICS.maxSpeedOff + 0.5) return `v off-track=${car.v.toFixed(2)} > ${PHYSICS.maxSpeedOff}`;
  if (car.v < 8) return `lento demais p/ escapar (v=${car.v.toFixed(2)})`;
  return true;
});

test('desencalhe: ré + esterçar sai da parede de volta p/ a pista', () => {
  const p = pAt(200);
  const pr0 = sampler.project(p.x, p.z);
  const limit = pr0.width / 2 + PHYSICS.wallMargin;
  const nx = Math.cos(pr0.heading), nz = -Math.sin(pr0.heading);
  const car = createCar(p.x + nx * limit, p.z + nz * limit, pr0.heading + Math.PI / 2, 0);
  const ctx = { sampler };
  for (let i = 0; i < 300; i++) {
    stepCar(car, { throttle: 0, brake: 1, steer: 0.4, handbrake: 0, nitro: 0 }, DT, ctx);
    if (!isFiniteCar(car)) return 'estado não-finito';
  }
  const pr = sampler.project(car.x, car.z);
  if (pr.lat > pr.width / 2) return `ainda fora (lat=${pr.lat.toFixed(2)}, halfW=${(pr.width / 2).toFixed(2)})`;
  if (limit - pr.lat < 4) return `só afastou ${(limit - pr.lat).toFixed(2)} m da parede`;
  return true;
});

test('stepCar estável com dt=1/30 (substeps internos, sem explodir)', () => {
  const car = mkCar(100, PHYSICS.maxSpeed);
  const ctx = { sampler };
  const dt = 1 / 30;
  let prevX = car.x, prevZ = car.z;
  for (let i = 0; i < 150; i++) {
    stepCar(car, { throttle: 1, brake: 0, steer: 1, handbrake: 1, nitro: 1 }, dt, ctx);
    if (!isFiniteCar(car)) return `estado não-finito no step ${i}`;
    const dPos = Math.hypot(car.x - prevX, car.z - prevZ);
    const budget = (Math.abs(car.v) + 10) * dt + 1.0;
    if (dPos > budget) return `deslocamento ${dPos.toFixed(2)} m > budget ${budget.toFixed(2)} m`;
    if (Math.abs(car.v) > PHYSICS.maxSpeed * NITRO.speedBoost + 1) return `v=${car.v.toFixed(1)} explodiu`;
    const pr = sampler.project(car.x, car.z);
    if (Math.abs(pr.lat) > pr.width / 2 + PHYSICS.wallMargin + 0.15) return 'ultrapassou a parede';
    prevX = car.x; prevZ = car.z;
  }
  return true;
});

// ------------------------------------------------------------------- saída

if (failed) {
  console.error(`\n${failed} checagem(ns) falharam.`);
  process.exit(1);
}
console.log('\nTodas as checagens OK — física do carro pronta p/ a fase 2 (engine).');
