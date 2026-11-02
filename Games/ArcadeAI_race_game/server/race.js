// Asfalto Vivo — corrida (autoridade do servidor). Fase 2.
//
// Contrato do raceFactory (consumido por server/rooms.js):
//   createRace({ track, sampler, laps, players, timings, now, emit, endRace, setPhase })
//     => { onSt(player, msg), onReadyLoad(player), onDisconnect(player),
//          onReconnect(player), onPlayerRemoved(player), modeFor(id),
//          snapshotState(), dispose() }
// emit(msg)        → broadcast p/ todos da sala (rooms cuida de quem recebe)
// endRace(info)    → rooms transiciona: {results} → status 'results'; sem args → lobby
// setPhase(status) → rooms aplica status da sala ('race' no GO) + broadcast state
//
// Garantias: construtor NÃO emite sincronamente (microtask p/ prepare).
// Autoridade: ARCHITECTURE.md §4 — servidor projeta (x,z) no sampler (não confia
// em s do cliente), valida |v| <= maxSpeed*1.25, checkpoints em sequência,
// cruzamento de chegada só com nextCp==0 e v>0, colisão carro-carro resolve
// separação + amortecimento, snapshot SNAPSHOT_HZ, encerramento p/ deadline.
import { CHECKPOINTS, PHYSICS, SNAPSHOT_HZ } from '../shared/constants.js';

const K = CHECKPOINTS;
const SPEED_LIMIT = PHYSICS.maxSpeed * 1.25;
const CP_REACH_M = 12;          // distância euclidiana p/ colher cp
const CP_LAT_MARGIN = 6;        // folga de |lat| p/ colher cp
const TELEPORT_DROP_M = 30;     // queda de s em <200 ms = teleport
const TELEPORT_MS = 200;
const COLLIDE_MIN_D = 2 * PHYSICS.carRadius;
const COLLIDE_PUSH_SNAP = 0.4;  // snap_self só se deslocamento > 0.4 m
const COLLIDE_DAMP = 0.5;       // amortecimento da velocidade relativa
const COLLIDE_EMIT_MIN_REL = 1; // m/s de velocidade relativa mínima p/ sfx (§20.16)
const COLLIDE_EMIT_MS = 300;    // cooldown do sfx collide por par (§20.16)
const FWD_SLACK_M = 5;          // folga p/ guard de salto forward (jitter/yank)

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function createRace({
  track,
  sampler,
  laps,
  players,
  timings,
  now = () => Date.now(),
  emit,
  endRace,
  setPhase = null,
}) {
  const T = {
    finishGraceMs: timings.finishGraceMs ?? 45000,
    countdownS: timings.countdownS ?? 3,
    readyTimeoutMs: timings.readyTimeoutMs ?? 20000,
    snapshotHz: timings.snapshotHz ?? SNAPSHOT_HZ,
  };
  const length = sampler.length;
  const cpS = sampler.checkpoints(K); // [0, L/K, ...] — cp0 = linha de chegada

  let phase = 'prepare'; // prepare | countdown | running | done
  let ended = false;
  let prepared = false;  // prepare já emitido (ready_load antes disso é pendurado)
  let raceStart = 0;    // now() no GO
  let deadlineAt = null;
  let seq = 0;
  const timers = [];
  let snapTimer = null;
  const collideAt = new Map(); // `${idA}|${idB}` → now() do último emit collide

  function raceNow() { return now() - raceStart; }

  function later(ms, fn) {
    const id = setTimeout(() => {
      if (ended) return;
      try { fn(); } catch { /* race não derruba o servidor */ }
    }, ms);
    if (typeof id.unref === 'function') id.unref();
    timers.push(id);
    return id;
  }

  // ---------- estado por carro ----------

  const grid = sampler.grid(players.length);
  const cars = new Map();
  players.forEach((p, i) => {
    const g = grid[i];
    cars.set(p.id, {
      player: p,
      id: p.id,
      dname: p.dname,
      color: p.color,
      x: g.x, z: g.z, hd: g.heading, v: 0,
      steer: 0, hb: 0, nit: 0, off: 0, dr: 0,
      s: g.s, lat: g.lat,
      nextCp: 1,
      lap: 0,
      lapStart: 0,
      bestMs: null,
      lastMs: null,
      fin: 0,
      ft: null,
      rec: 0,
      connected: true,
      readyLoad: false,
      removed: false,
      lastUpdateAt: 0,
      place: i + 1,
    });
  });

  function sendTo(car, msg) {
    const conn = car.player.conn;
    if (!conn) return;
    try { conn.send(msg); } catch { /* conexão morrendo */ }
  }

  function connectedCount() {
    let n = 0;
    for (const c of cars.values()) if (c.connected && !c.removed) n++;
    return n;
  }

  // ---------- ranking / place ----------

  function progressOf(c) { return c.lap * length + c.s; }

  function cmp(a, b) {
    if (a.fin !== b.fin) return b.fin - a.fin; // fin primeiro
    if (a.fin && b.fin) return a.ft - b.ft;    // menor tempo total
    const pa = progressOf(a);
    const pb = progressOf(b);
    if (pb !== pa) return pb - pa;             // progresso desc
    if (a.lap !== b.lap) return b.lap - a.lap;
    if (a.s !== b.s) return b.s - a.s;
    return a.id < b.id ? -1 : 1;               // desempate estável por id
  }

  function ranked() {
    const list = [...cars.values()].sort(cmp);
    list.forEach((c, i) => { c.place = i + 1; });
    return list;
  }

  // ---------- prepare / countdown / GO ----------

  function emitPrepare() {
    if (ended || phase !== 'prepare') return;
    prepared = true;
    emit({
      t: 'prepare',
      track: { id: track.id, name: track.name },
      laps,
      roster: [...cars.values()].map((c) => ({ id: c.id, dname: c.dname, color: c.color })),
      grid: grid.map((g, i) => ({ id: players[i].id, x: g.x, z: g.z, heading: g.heading })),
      startAt: null,
    });
    later(T.readyTimeoutMs, () => { if (phase === 'prepare') beginCountdown(); });
    if (allReady()) beginCountdown(); // ready_loads podem ter chegado antes do prepare
  }
  queueMicrotask(() => { if (!ended) emitPrepare(); });

  function allReady() {
    for (const c of cars.values()) if (!c.removed && !c.readyLoad) return false;
    return true;
  }

  function beginCountdown() {
    if (phase !== 'prepare') return;
    phase = 'countdown';
    const durationMs = T.countdownS * 1000;
    const t0 = now();
    emit({ t: 'cd', n: 3, at: t0 });
    later(durationMs / 3, () => { if (phase === 'countdown') emit({ t: 'cd', n: 2, at: now() }); });
    later((durationMs * 2) / 3, () => { if (phase === 'countdown') emit({ t: 'cd', n: 1, at: now() }); });
    later(durationMs, () => go());
  }

  function go() {
    if (phase !== 'countdown') return;
    if (connectedCount() < 2) { cancel('Não há jogadores suficientes para largar.'); return; }
    phase = 'running';
    raceStart = now();
    if (typeof setPhase === 'function') { try { setPhase('race'); } catch { /* ok */ } }
    emit({ t: 'cd', n: 0, at: raceStart });
    startSnapshots();
  }

  function cancel(msg) {
    emit({ t: 'cancel', msg });
    finish('cancel');
  }

  function checkConnectedPreRace() {
    if (phase !== 'prepare' && phase !== 'countdown') return;
    if (connectedCount() < 2) cancel('Participantes caíram abaixo de dois antes da largada.');
  }

  // ---------- snapshots ----------

  function carRow(c) {
    return {
      id: c.id, x: c.x, z: c.z, hd: c.hd, v: c.v, steer: c.steer,
      hb: c.hb, nit: c.nit, off: c.off, dr: c.dr,
      place: c.place, lap: c.lap, cp: c.nextCp,
      le: c.fin ? null : raceNow() - c.lapStart,
      bl: c.bestMs, ll: c.lastMs,
      fin: c.fin, ft: c.ft, rec: c.rec,
    };
  }

  function snapshot() {
    if (phase !== 'running') return;
    seq++;
    const list = ranked();
    emit({ t: 'sn', seq, raceNow: raceNow(), cars: list.map(carRow) });
  }

  function startSnapshots() {
    snapshot(); // primeiro sn imediato no GO
    snapTimer = setInterval(() => {
      if (ended || phase !== 'running') return;
      try { snapshot(); } catch { /* ok */ }
    }, Math.max(10, Math.round(1000 / T.snapshotHz)));
    if (typeof snapTimer.unref === 'function') snapTimer.unref();
  }

  // ---------- st (autoridade de movimento) ----------

  function onSt(player, msg) {
    if (phase !== 'running' || ended) return;
    const car = cars.get(player.id);
    if (!car || car.removed) return;

    const x = Number(msg.x);
    const z = Number(msg.z);
    const hd = Number(msg.hd);
    let v = Number(msg.v);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(hd) || !Number.isFinite(v)) return;

    const t = now();
    const proj = sampler.project(x, z); // oficial: servidor projeta, não confia em s

    // validação de velocidade + posição fora da pista → snap_self corrigido
    let corrected = false;
    if (Math.abs(v) > SPEED_LIMIT) {
      v = v > 0 ? SPEED_LIMIT : -SPEED_LIMIT;
      corrected = true;
    }
    let cx = x;
    let cz = z;
    const wall = proj.width / 2 + PHYSICS.wallMargin;
    if (Math.abs(proj.lat) > wall) {
      const latC = clamp(proj.lat, -wall, wall);
      // project() devolve SÓ {s,lat,heading,width,inside} (sem x/z) → ponto de
      // apoio via pointAt(proj.s); normal esquerda da tangente = (cos h, -sin h)
      const pt = sampler.pointAt(proj.s);
      cx = pt.x + latC * Math.cos(proj.heading);
      cz = pt.z - latC * Math.sin(proj.heading);
      corrected = true;
    }
    // defesa em profundidade: nunca emitir/armazenar NaN (guard `typeof NaN
    // === 'number'` passaria e apagaria o carro no cliente)
    if (corrected && !(Number.isFinite(cx) && Number.isFinite(cz))) corrected = false;
    if (corrected) {
      sendTo(car, { t: 'snap_self', x: cx, z: cz, hd, v });
    }

    // teleporte: queda de s > 30 m em < 200 ms sem ser o wrap de chegada
    const prevS = car.s;
    const dt = car.lastUpdateAt ? t - car.lastUpdateAt : Infinity;
    // wrap de chegada: s alto (> ~3/4 da volta ou últimos 30 m) → baixo (< 30 m)
    const wrapHi = Math.max(length - 30, length * 0.75);
    const wrapCross = v > 0 && prevS > wrapHi && proj.s < Math.min(30, length * 0.25);
    const teleport = !wrapCross
      && dt < TELEPORT_MS
      && prevS - proj.s > TELEPORT_DROP_M;
    if (teleport) {
      car.rec += 1; // estatística; sem progresso
      car.lastUpdateAt = t;
      // reposiciona oficialmente no novo s (sem avançar cps/volta)
      car.s = proj.s;
      car.lat = proj.lat;
      return;
    }

    // teleporte forward: avanço impossível > SPEED_LIMIT*dt + folga (o backward
    // acima só pega queda de s). dt=Infinity na 1ª msg nunca dispara; folga de
    // 5 m cobre jitter 15 Hz, yank de colisão (≤1.6 m) e clamp de v legítimo.
    const fwdM = proj.s - prevS;
    if (!wrapCross && dt !== Infinity && fwdM > SPEED_LIMIT * (dt / 1000) + FWD_SLACK_M) {
      car.rec += 1; // estatística; sem progresso
      car.lastUpdateAt = t;
      // volta p/ a última posição oficial; sem atualizar s/cps/volta
      sendTo(car, { t: 'snap_self', x: car.x, z: car.z, hd: car.hd, v: car.v });
      return;
    }

    car.x = corrected ? cx : x;
    car.z = corrected ? cz : z;
    car.hd = hd;
    car.v = v;
    car.steer = clamp(Number(msg.steer) || 0, -1, 1);
    car.hb = msg.hb ? 1 : 0;
    car.nit = clamp(Number(msg.nit) || 0, 0, 100);
    car.off = proj.inside ? (msg.off ? 1 : 0) : 1; // flag offtrack server-side
    car.dr = clamp(Number(msg.dr) || 0, 0, 1);
    car.s = proj.s;
    car.lat = proj.lat;
    car.lastUpdateAt = t;

    if (car.fin) return; // já terminou; sem progresso adicional

    // ré não conta nada (sem cps, sem volta)
    if (v <= 0) return;

    // nextCp == 0 (próximo alvo = linha de chegada): volta SÓ via wrapCross.
    // Proximidade/círculo na linha ou ré não contam (SPEC §11).
    if (car.nextCp === 0) {
      if (wrapCross) {
        car.lap += 1;
        car.nextCp = 1;
        const timeMs = raceNow() - car.lapStart;
        car.lastMs = timeMs;
        if (car.bestMs == null || timeMs < car.bestMs) car.bestMs = timeMs;
        car.lapStart = raceNow();
        emit({ t: 'lap', id: car.id, lap: car.lap, timeMs, bestMs: car.bestMs, valid: true });
        if (car.lap >= laps) {
          car.fin = 1;
          car.ft = raceNow();
          emit({ t: 'fin', id: car.id, place: car.place, timeMs: car.ft });
          onFirstFinish();
          checkAllDone();
        }
      }
      return;
    }

    // checkpoint de progresso (cp1..cp7): aproximação euclidiana < 12 m e
    // |lat| < width/2 + 6 avança nextCp
    const target = cpS[car.nextCp];
    const tp = sampler.pointAt(target);
    const dist = Math.hypot(car.x - tp.x, car.z - tp.z);
    if (dist < CP_REACH_M && Math.abs(car.lat) < proj.width / 2 + CP_LAT_MARGIN) {
      car.nextCp = (car.nextCp + 1) % K;
    }
  }

  // ---------- colisão carro-carro ----------

  function resolveCollisions(changed) {
    for (const a of cars.values()) {
      if (a.removed) continue;
      for (const b of cars.values()) {
        if (a === b || b.removed) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= COLLIDE_MIN_D) continue;

        // separar metade-cada ao longo da normal (d≈0 → normal arbitrária)
        const near0 = d < 1e-6;
        const nx = near0 ? 1 : dx / d;
        const nz = near0 ? 0 : dz / d;
        const push = (COLLIDE_MIN_D - d) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;

        // amortecer componente relativa ao longo da normal (fator 0.5, teto maxSpeed)
        const vax = Math.sin(a.hd) * a.v;
        const vaz = Math.cos(a.hd) * a.v;
        const vbx = Math.sin(b.hd) * b.v;
        const vbz = Math.cos(b.hd) * b.v;
        const rel = (vbx - vax) * nx + (vbz - vaz) * nz;
        const imp = clamp(rel * COLLIDE_DAMP, -PHYSICS.maxSpeed, PHYSICS.maxSpeed);
        a.v = clamp(a.v + imp * 0.5, -PHYSICS.reverseMax, PHYSICS.maxSpeed);
        b.v = clamp(b.v - imp * 0.5, -PHYSICS.reverseMax, PHYSICS.maxSpeed);

        if (push > COLLIDE_PUSH_SNAP) {
          sendTo(a, { t: 'snap_self', x: a.x, z: a.z, hd: a.hd, v: a.v });
          sendTo(b, { t: 'snap_self', x: b.x, z: b.z, hd: b.hd, v: b.v });
        }
        // sfx (§20.16): só com impacto real (|rel| >= 1 m/s) e no máx. 1x/300 ms
        // por par — separação/amortecimento e snap_self acima continuam imediatos
        if (Math.abs(rel) >= COLLIDE_EMIT_MIN_REL) {
          const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          const tEmit = now();
          if (tEmit - (collideAt.get(key) ?? -Infinity) >= COLLIDE_EMIT_MS) {
            collideAt.set(key, tEmit);
            emit({ t: 'collide', a: a.id, b: b.id, imp: Math.abs(rel) });
          }
        }
      }
    }
  }

  // ---------- encerramento ----------

  function onFirstFinish() {
    if (deadlineAt != null) return;
    deadlineAt = raceNow() + T.finishGraceMs;
    emit({ t: 'deadline', at: deadlineAt });
    later(T.finishGraceMs, () => finish('deadline'));
  }

  function checkAllDone() {
    if (phase !== 'running' || ended) return;
    const active = [...cars.values()].filter((c) => !c.removed);
    if (active.length > 0 && active.every((c) => c.fin === 1)) finish('finished');
    else if (active.length === 0) finish('abandoned');
  }

  function finish(reason) {
    if (ended) return;
    ended = true;
    phase = 'done';
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
    if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
    if (reason === 'cancel') { endRace(); return; }

    const list = ranked();
    const rows = list.map((c) => ({
      id: c.id,
      dname: c.dname,
      color: c.color,
      place: c.place,
      timeMs: c.fin ? c.ft : null,
      bestMs: c.bestMs,
      dnf: c.fin !== 1,
      progress: Math.round(progressOf(c)),
    }));
    endRace({ rows, reason });
  }

  // ---------- contrato com rooms ----------

  function onReadyLoad(player) {
    const car = cars.get(player.id);
    if (!car || phase !== 'prepare') return;
    car.readyLoad = true;
    if (prepared && allReady()) beginCountdown();
  }

  function onDisconnect(player) {
    const car = cars.get(player.id);
    if (!car) return;
    car.connected = false;
    checkConnectedPreRace();
  }

  function onReconnect(player) {
    const car = cars.get(player.id);
    if (!car) return;
    car.connected = true;
  }

  function onPlayerRemoved(player) {
    const car = cars.get(player.id);
    if (!car) return;
    car.removed = true;
    car.connected = false;
    checkConnectedPreRace();
    checkAllDone();
  }

  function modeFor(id) {
    const car = cars.get(id);
    return car && !car.removed ? 'race' : 'waiting';
  }

  function snapshotState() {
    const list = ranked();
    return {
      laps,
      track: { id: track.id, name: track.name },
      length,
      raceNow: phase === 'running' || phase === 'done' ? raceNow() : null,
      deadlineAt,
      cars: list.map((c) => ({ ...carRow(c), s: Math.round(c.s * 10) / 10, lat: c.lat })),
    };
  }

  function dispose() {
    ended = true;
    phase = 'done';
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
    if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
  }

  return {
    onSt: (player, msg) => { try { onSt(player, msg); resolveCollisions(); } catch { /* ok */ } },
    onReadyLoad,
    onDisconnect,
    onReconnect,
    onPlayerRemoved,
    modeFor,
    snapshotState,
    dispose,
  };
}
