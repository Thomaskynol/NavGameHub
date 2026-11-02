/**
 * public/js/game/carPhysics.js — matemática pura da física arcade do carro.
 * Sem three.js; roda em node (tools/check_carphysics.js) e no navegador.
 * Contratos: ARCHITECTURE.md §2 (trackMath), §4 (cps/voltas/paredes), §5
 * (PHYSICS/NITRO = fonte única), SPEC.md §5–§7, §9.
 *
 * API:
 *   createCar(x, z, heading, v = 0) => car
 *   stepCar(car, input, dt, ctx) => { events: [{type:'wall'|'lap'|'wrongway'|
 *                                               'nitro'|'recover', ...}] }
 *   recover(car, ctx) => { events: [...] }
 *
 * Convenções (shared/trackMath.js): heading = atan2(dx, dz); lat > 0 = esquerda;
 * velocidade v assinada (+frente, −ré). ctx = { sampler, steerSensitivity?,
 * recoverAt?(s0) }. stepCar é chamado a 120 Hz pelo engine, mas aceita dt ≤ 1/30
 * (substeps internos de no máx 1/120 mantêm a integração estável).
 *
 * Nota de import: '../../../shared/...' resolve para shared/ do projeto no node
 * e é clamped na raiz do servidor para /shared/... no navegador (§1).
 */
import { PHYSICS, NITRO, CHECKPOINTS } from '../../../shared/constants.js';

// Feel locais (não copiados p/ constants.js nesta fase; se virarem tuning
// oficial, mover p/ PHYSICS na fase 2):
const FEEL = {
  aLatMax: 19,        // m/s² — cap de aceleração lateral (curvas largas a alta v)
  aLatMinV: 7,        // abaixo disso o cap de yaw não limita (saída de box/quinas)
  steerLerp: 8,       // 1/s — suavização da esterçada (steer01)
  reverseAccel: 0.5,  // fração de PHYSICS.accel p/ marcha à ré
  wallHitSec: 0.2,    // duração de car.wallHit após impacto (feedback)
  wallVnHit: 2.0,     // m/s de componente p/ fora que conta como impacto
  wallLoss: 0.15,     // perda de |v| no impacto (SPEC §7)
  wrongWaySec: 0.8,   // s de dot < -0.3 p/ marcar contramão
  driftSlipRef: 0.6,  // deriva (rad) que zera/lotas drift01
  driftOn: 0.35,      // drift01 p/ marcar drifting
  overVmaxFade: 0.15, // fade de yaw entre vmax e vmax*1.15 (~0 acima de vmax)
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;
function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

// checkpoints(8) memoizados por sampler (fraco, sem state no car/ctx)
const cpsCache = new WeakMap();
function cpsOf(sampler) {
  let c = cpsCache.get(sampler);
  if (!c) {
    c = sampler.checkpoints(CHECKPOINTS);
    cpsCache.set(sampler, c);
  }
  return c;
}

/** Estado inicial do carro (grid/TT): posição, heading e velocidade. */
export function createCar(x, z, heading, v = 0) {
  return {
    x, z, hd: heading, v,     // hd = yaw; v assinado (+frente)
    vlat: 0,                  // componente lateral da velocidade
    steer01: 0,               // esterçada suavizada -1..1 (mesh/rede)
    nitro: NITRO.tank,        // tanque em unidades do tanque (0..tank)
    nitroActive: false,
    nitroTimer: 0,            // s desde o último uso (regen > regenDelayMs/1000)
    boostEnv: 0,              // envelope 0..1 do boost (suaviza o fim do nitro)
    offTrack: false,
    drifting: false,
    drift01: 0,               // 0..1 p/ HUD 'dr'
    s: null, lat: 0,          // projeção atual no centerline
    sPrev: null,              // s do passo anterior (detecção de cruzamento)
    cpNext: 1,                // próximo checkpoint (0 = chegada; inicia 1, §4)
    lastCpS: 0,               // s do último cp alcançado (alvo do recover)
    lap: 0, progress: 0,      // progress = lap*L + s (§4)
    wallHit: 0,               // s restantes de feedback de parede (0 = livre)
    recTimer: 0,              // s restantes do cooldown de recover
    wrongWayT: 0, wrongWay: false,
  };
}

/**
 * Um passo de simulação. ctx = { sampler, steerSensitivity?, recoverAt? }.
 * Retorna { events } — tipos: 'wall', 'lap' {lap}, 'wrongway' {on},
 * 'nitro' {on}. Coleta de cps/voltas idêntica ao servidor (§4).
 */
export function stepCar(car, input, dt, ctx) {
  const events = [];
  if (!car) return { events };
  if (!ctx || !ctx.sampler) throw new Error('stepCar: ctx.sampler obrigatório');
  if (!(dt > 0)) return { events };
  const n = Math.max(1, Math.min(8, Math.ceil(dt * 120))); // substeps ≤ 1/120
  const h = dt / n;
  for (let i = 0; i < n; i++) substep(car, input, h, ctx, events);
  return { events };
}

/** Teleporta ao último cp alcançado (lat 0, heading tangente); cooldown 3 s. */
export function recover(car, ctx) {
  const events = [];
  if (!car || !ctx || !ctx.sampler) return { events };
  if (car.recTimer > 0) return { events }; // cooldown ativo: sem efeito
  const sampler = ctx.sampler;
  const s0 = car.lastCpS || 0;
  let x, z, hd, placed = false;
  if (typeof ctx.recoverAt === 'function') {
    const r = ctx.recoverAt(s0);
    if (r && Number.isFinite(r.x) && Number.isFinite(r.z) && Number.isFinite(r.heading)) {
      x = r.x; z = r.z; hd = r.heading; placed = true;
    }
  }
  if (!placed) {
    const p = sampler.pointAt(s0);
    x = p.x; z = p.z; hd = p.heading;
  }
  car.x = x; car.z = z; car.hd = hd;
  car.v = 0; car.vlat = 0; car.steer01 = 0; car.boostEnv = 0;
  car.wallHit = 0; car.drifting = false; car.drift01 = 0;
  if (car.wrongWay) { car.wrongWay = false; events.push({ type: 'wrongway', on: false }); }
  car.wrongWayT = 0;
  const pr = sampler.project(x, z);
  car.s = pr.s; car.lat = pr.lat; car.sPrev = pr.s; car.offTrack = !pr.inside;
  car.progress = car.lap * sampler.length + pr.s;
  car.recTimer = PHYSICS.recoverCooldownMs / 1000;
  events.push({ type: 'recover' });
  return { events };
}

// ------------------------------------------------------------------ substep

function substep(car, input, h, ctx, events) {
  const P = PHYSICS, N = NITRO;
  const sampler = ctx.sampler;
  const thr = +input.throttle || 0;
  const brk = +input.brake || 0;
  const str = +input.steer || 0;
  const hb = input.handbrake ? 1 : 0;

  if (car.recTimer > 0) car.recTimer = Math.max(0, car.recTimer - h);
  if (car.wallHit > 0) car.wallHit = Math.max(0, car.wallHit - h);

  // --- nitro (antes de usar o boost neste passo)
  const wasActive = car.nitroActive;
  if (input.nitro) {
    car.nitroTimer = 0;
    if (car.nitro > 0) {
      car.nitroActive = true;
      car.nitro = Math.max(0, car.nitro - N.drainPerSec * h);
      if (car.nitro <= 0) car.nitroActive = false; // sem carga o efeito para
    } else {
      car.nitroActive = false;
    }
  } else {
    car.nitroActive = false;
    car.nitroTimer += h;
    if (car.nitroTimer * 1000 >= N.regenDelayMs && car.nitro < N.tank) {
      car.nitro = Math.min(N.tank, car.nitro + N.regenPerSec * h);
    }
  }
  if (car.nitroActive !== wasActive) events.push({ type: 'nitro', on: car.nitroActive });
  const boost = car.nitroActive && car.nitro > 0;
  // --- envelope do boost: sem corte seco no fim do nitro; o mult efetivo
  // decai na mesma taxa que a velocidade sangra (coastDecel), então o fade
  // de yaw não zera a esterçada por segundos (R constante durante a sangria)
  if (boost) car.boostEnv = 1;
  else if (car.boostEnv > 0) car.boostEnv = Math.max(0, car.boostEnv - (P.coastDecel / (P.maxSpeed * (N.speedBoost - 1))) * h);
  const eB = 1 + (N.speedBoost - 1) * (car.boostEnv || 0); // 1 → speedBoost

  // --- esterçada suavizada
  const sens = clamp(ctx.steerSensitivity != null ? ctx.steerSensitivity : 1, 0.5, 1.5);
  const dS = FEEL.steerLerp * h;
  car.steer01 += clamp(str - car.steer01, -dS, dS);

  // --- yaw: curvature-free com cap de aceleração lateral; ~0 acima de vmax
  const vmax0 = (car.offTrack ? P.maxSpeedOff : P.maxSpeed) * eB;
  const sp = Math.abs(car.v);
  let yaw = (P.steerMax * car.steer01 * sens) / (1 + (sp * P.steerSpeedFalloff) / 25);
  // nitro: R=v²/aLat cresce com v²; eB² no cap preserva o raio de curva
  const cap = (FEEL.aLatMax * eB * eB) / Math.max(sp, FEEL.aLatMinV);
  yaw = clamp(yaw, -cap, cap);
  if (hb) yaw *= P.driftYawBoost; // freio de mão: derrapagem iniciável
  if (sp > vmax0) yaw *= Math.max(0, 1 - (sp - vmax0) / (vmax0 * FEEL.overVmaxFade));
  if (!(sp > 0.2 || thr > 0 || brk > 0)) yaw = 0; // sem pirueta em repouso
  const dHd = yaw * h;
  if (dHd !== 0) {
    // mundo invariante: heading gira ⇒ (v, vlat) rotacionam no frame do carro
    const c = Math.cos(dHd), s = Math.sin(dHd);
    const v = car.v, vl = car.vlat;
    car.v = v * c + vl * s;
    car.vlat = -v * s + vl * c;
    car.hd = wrapAngle(car.hd + dHd);
  }

  // --- longitudinal (v assinado; nunca salto instantâneo)
  const vmax = (car.offTrack ? P.maxSpeedOff : P.maxSpeed) * eB;
  const accel = (car.offTrack ? P.offAccel : P.accel) * (boost ? N.accelBoost : 1);
  if (car.v > vmax) {
    // vmax caiu (nitro acabou/saiu da pista): decai suavemente, não estoura
    const dec = (P.coastDecel + (brk > 0 ? P.brake * brk : 0)) * h;
    car.v = Math.max(vmax, car.v - dec);
  } else if (brk > 0) {
    if (car.v > 0) car.v = Math.max(0, car.v - P.brake * brk * h);
    else car.v = Math.max(-P.reverseMax, car.v - P.accel * FEEL.reverseAccel * brk * h);
  } else if (thr > 0) {
    if (car.v < 0) car.v = Math.min(0, car.v + accel * thr * h); // sai da ré suave
    else car.v = Math.min(vmax, car.v + accel * thr * h);
  } else {
    const c = P.coastDecel * h;
    if (car.v > 0) car.v = Math.max(0, car.v - c);
    else if (car.v < 0) car.v = Math.min(0, car.v + c);
  }
  // arrasto off-track: cresce com v, ~0 em repouso (ré ainda desgruda)
  if (car.offTrack && car.v !== 0) {
    const d = P.offDrag * Math.min(1, Math.abs(car.v) / P.maxSpeedOff) * h;
    car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), d);
  }

  // --- aderência: amortecimento da componente lateral (mundo → direção do hd)
  const grip = hb ? P.gripHandbrake : car.offTrack ? P.gripOff : P.gripBase;
  car.vlat *= Math.max(0, 1 - grip * h);

  // --- integração de posição (traseira-skid simplificado: slip natural no drift)
  const wx = Math.sin(car.hd) * car.v + Math.cos(car.hd) * car.vlat;
  const wz = Math.cos(car.hd) * car.v - Math.sin(car.hd) * car.vlat;
  car.x += wx * h;
  car.z += wz * h;

  // --- projeção, parede, checkpoints, contramão
  let pr = sampler.project(car.x, car.z);
  const halfW = pr.width * 0.5;
  const limit = halfW + P.wallMargin;
  if (Math.abs(pr.lat) > limit) {
    // clamp lateral (§4): reposiciona na borda e dampa a componente normal
    const sign = pr.lat > 0 ? 1 : -1;
    const cpt = sampler.pointAt(pr.s);
    const nx = Math.cos(pr.heading), nz = -Math.sin(pr.heading);
    const latC = sign * limit;
    car.x = cpt.x + nx * latC;
    car.z = cpt.z + nz * latC;
    let vx = Math.sin(car.hd) * car.v + Math.cos(car.hd) * car.vlat;
    let vz = Math.cos(car.hd) * car.v - Math.sin(car.hd) * car.vlat;
    const ox = sign * nx, oz = sign * nz; // normal p/ fora
    const vn = vx * ox + vz * oz;
    if (vn > 0) {
      if (vn > FEEL.wallVnHit && car.wallHit <= 0) {
        vx *= 1 - FEEL.wallLoss;
        vz *= 1 - FEEL.wallLoss;
        car.wallHit = FEEL.wallHitSec;
        events.push({ type: 'wall' });
      }
      vx -= ox * vn * (1 - P.wallLatKeep); // perde a componente p/ fora
      vz -= oz * vn * (1 - P.wallLatKeep);
    }
    const sh = Math.sin(car.hd), ch = Math.cos(car.hd);
    car.v = vx * sh + vz * ch;
    car.vlat = vx * ch - vz * sh;
    pr = sampler.project(car.x, car.z); // s/lat pós-clamp
  }

  // checkpoints/ voltas — MESMO algoritmo do servidor (§4)
  const cps = cpsOf(sampler);
  const L = sampler.length;
  if (car.cpNext !== 0) {
    const tgt = sampler.pointAt(cps[car.cpNext]);
    const dx = car.x - tgt.x, dz = car.z - tgt.z;
    if (dx * dx + dz * dz < 144 && Math.abs(pr.lat) < halfW + 6) { // <12 m
      car.lastCpS = cps[car.cpNext];
      car.cpNext = (car.cpNext + 1) % CHECKPOINTS;
    }
  }
  if (car.sPrev == null) car.sPrev = pr.s;
  if (car.cpNext === 0 && car.sPrev > L * 0.5 && pr.s < L * 0.5 && car.v > 0) {
    car.lap++;
    car.cpNext = 1;
    car.lastCpS = 0;
    events.push({ type: 'lap', lap: car.lap });
  }
  car.sPrev = pr.s;
  car.s = pr.s;
  car.lat = pr.lat;
  car.offTrack = !pr.inside;
  car.progress = car.lap * L + pr.s;

  // --- derrapagem (derivada da diferença entre mundo e heading)
  const speed = Math.hypot(car.v, car.vlat);
  const slip = Math.atan2(Math.abs(car.vlat), Math.abs(car.v) + 0.5);
  car.drift01 = speed > 3 ? Math.min(1, slip / FEEL.driftSlipRef) : 0;
  car.drifting = car.drift01 > FEEL.driftOn;

  // --- contramão: heading · tangent < -0.3 por > 0.8 s (só andando)
  const dot = Math.cos(car.hd - pr.heading);
  if (speed > 2) {
    if (dot < -0.3) car.wrongWayT += h;
    else car.wrongWayT = Math.max(0, car.wrongWayT - 2 * h);
  }
  if (!car.wrongWay && car.wrongWayT >= FEEL.wrongWaySec) {
    car.wrongWay = true;
    events.push({ type: 'wrongway', on: true });
  } else if (car.wrongWay && car.wrongWayT <= 0) {
    car.wrongWay = false;
    events.push({ type: 'wrongway', on: false });
  }
}
