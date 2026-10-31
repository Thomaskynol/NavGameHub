// Asfalto Vivo — testes da corrida completa (server/race.js real) via rooms.js.
// DI: relógio fake compartilhado (rate limit de st), timings curtas, oval sintético.
//
// Nota de cenário: o grid fica 8 m atrás da linha, então a 1ª travessia da
// chegada NÃO conta volta (nextCp ainda é 1); `laps` voltas contadas exigem
// `laps + 1` wraps a partir do grid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../server/rooms.js';
import { createRace } from '../server/race.js';
import { createSampler } from '../shared/trackMath.js';
import { PHYSICS } from '../shared/constants.js';

// Oval sintético ~423 m (Catmull-Rom arredonda os cantos).
const OVAL = {
  id: 'oval',
  name: 'Oval Teste',
  points: [[0, 0], [120, 0], [120, 80], [0, 80]],
  widths: [16, 16, 16, 16],
};
const TRACKS = { oval: OVAL };
const sampler = createSampler(OVAL);
const L = sampler.length;

const C1 = '#e5484d', C2 = '#3b82f6';

function makeConn(id) {
  return {
    id,
    inbox: [],
    closed: false,
    player: null,
    room: null,
    send(obj) { this.inbox.push(obj); },
    close() { this.closed = true; },
    last(t) { return [...this.inbox].reverse().find((m) => m.t === t); },
    all(t) { return this.inbox.filter((m) => m.t === t); },
    count(t) { return this.inbox.filter((m) => m.t === t).length; },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: timeout');
    await sleep(5);
  }
}

// Prepara sala com 2 prontos e larga. waitForGo=false retorna após o cd n=3
// (útil p/ cancel durante a contagem).
async function setupRace({ laps = 2, timings = {}, waitForGo = true } = {}) {
  const clock = { t: 1_000_000 };
  const rooms = createRooms({
    tracks: TRACKS,
    timings: {
      reconnectMs: 500,
      finishGraceMs: 3000,
      countdownS: 0.09,
      readyTimeoutMs: 500,
      snapshotHz: 20,
      ...timings,
    },
    now: () => clock.t,
    raceFactory: createRace,
  });

  const a = makeConn('connA');
  rooms.handleMessage(a, { t: 'create', name: 'Ana', color: C1 });
  const code = a.last('joined').room;
  const youA = a.last('joined').you;
  const tokenA = a.last('joined').token;
  const b = makeConn('connB');
  rooms.handleMessage(b, { t: 'join', room: code, name: 'Bia', color: C2 });
  const youB = b.last('joined').you;

  if (laps !== 3) rooms.handleMessage(a, { t: 'set', laps });
  rooms.handleMessage(a, { t: 'set', ready: true });
  rooms.handleMessage(b, { t: 'set', ready: true });
  rooms.handleMessage(a, { t: 'start' });
  rooms.handleMessage(a, { t: 'ready_load' });
  rooms.handleMessage(b, { t: 'ready_load' });

  await waitFor(() => a.last('cd') && a.last('cd').n === (waitForGo ? 0 : 3));
  return { rooms, clock, a, b, code, youA, youB, tokenA };
}

const gridS = () => sampler.grid(2)[0].s;
const gridSB = () => sampler.grid(2)[1].s;

// Envia st seguindo a centerline por `meters` metros a partir de fromS.
// Avança o relógio 200 ms/st (≤8 m/200 ms = 40 m/s — cadência de jogador
// legítimo dentro do guard de salto forward de race.js; 40 ms/st seriam ~200
// m/s e disparariam o guard como se fosse teleporte).
// Retorna nº de wraps (s alto→baixo) observados no envio.
function driveMeters(ctx, conn, fromS, meters, { v = 40, step = 8 } = {}) {
  let s = ((fromS % L) + L) % L;
  const steps = Math.max(1, Math.ceil(Math.abs(meters) / step));
  const delta = meters / steps;
  let wraps = 0;
  for (let i = 1; i <= steps; i++) {
    const prev = s;
    s = ((s + delta) % L + L) % L;
    if (s < prev) wraps++;
    const p = sampler.pointAt(s);
    ctx.clock.t += 200;
    ctx.rooms.handleMessage(conn, {
      t: 'st', x: p.x, z: p.z, hd: p.heading, v,
      steer: 0, hb: 0, nit: 0, off: 0, dr: 0,
    });
  }
  return wraps;
}

function stAt(ctx, conn, s, v) {
  const p = sampler.pointAt(((s % L) + L) % L);
  // 250 ms de cadência: cobre o salto único de ~12.7 m (0.03 L) do teste de ré
  // sem trip do guard forward (limite = 52.5*0.25 + 5 = 18.1 m).
  ctx.clock.t += 250;
  ctx.rooms.handleMessage(conn, {
    t: 'st', x: p.x, z: p.z, hd: p.heading, v,
    steer: 0, hb: 0, nit: 0, off: 0, dr: 0,
  });
}

function cleanup(ctx) { ctx.rooms.destroy(); }

test('corrida completa: 2 clientes, 2 voltas, lap×2, fin e results ordenado', async () => {
  const ctx = await setupRace({ laps: 2 });
  try {
    // A: 3 wraps a partir do grid = 1 travessia inicial (não conta) + 2 voltas
    driveMeters(ctx, ctx.a, gridS(), 3 * L);
    const lapsA = ctx.a.all('lap').filter((m) => m.id === ctx.youA);
    assert.equal(lapsA.length, 2, 'A recebeu 2 laps');
    assert.ok(lapsA.every((m) => m.valid === true), 'laps válidos');
    assert.equal(lapsA[1].lap, 2);
    assert.ok(ctx.a.last('fin'), 'A emite fin');

    driveMeters(ctx, ctx.b, gridSB(), 3 * L);
    const lapsB = ctx.b.all('lap').filter((m) => m.id === ctx.youB);
    assert.equal(lapsB.length, 2, 'B recebeu 2 laps');
    assert.ok(ctx.b.last('fin'), 'B emite fin');

    const results = await waitFor(() => ctx.a.last('results') || ctx.b.last('results'));
    assert.equal(results.rows.length, 2);
    assert.equal(results.rows[0].place, 1);
    assert.equal(results.rows[0].id, ctx.youA, 'A terminou antes → 1º');
    assert.equal(results.rows[1].place, 2);
    assert.equal(results.rows[1].id, ctx.youB);
    assert.ok(results.rows.every((r) => r.dnf === false), 'ambos concluíram');
    assert.ok(results.rows[0].bestMs != null, 'melhor volta registrada');
  } finally { cleanup(ctx); }
});

test('corte de cps: cruzar a chegada sem colher cps não gera volta', async () => {
  const ctx = await setupRace({ laps: 2 });
  try {
    // 1 wrap a partir do grid: atravessa a linha com nextCp=1 → sem volta
    const wraps = driveMeters(ctx, ctx.a, gridS(), L);
    assert.equal(wraps, 1, 'cruzou a linha 1x');
    assert.equal(ctx.a.count('lap'), 0, 'sem volta por corte de cps');

    // mais 1 wrap completo: cps colhidos ao longo da volta → volta conta
    driveMeters(ctx, ctx.a, gridS(), L);
    assert.equal(ctx.a.count('lap'), 1, 'volta válida após colher cps');
  } finally { cleanup(ctx); }
});

test('ré na chegada não gera volta; avanço para frente depois conta', async () => {
  const ctx = await setupRace({ laps: 2 });
  try {
    // dirige até ~0.92 L colhendo todos os cps (nextCp = 0) sem cruzar de novo
    const metersToLine = L - gridS(); // grid → linha
    driveMeters(ctx, ctx.a, gridS(), metersToLine + 0.92 * L);
    const car = await waitFor(() => {
      const s = ctx.a.last('sn');
      if (!s) return null;
      const c = s.cars.find((x) => x.id === ctx.youA);
      return c && c.cp === 0 ? c : null;
    });
    assert.equal(car.cp, 0, 'todos os cps colhidos (próximo alvo = chegada)');

    // ré na zona de chegada (v negativo): sem volta
    stAt(ctx, ctx.a, L * 0.95, -6);
    stAt(ctx, ctx.a, L * 0.93, -6);
    assert.equal(ctx.a.count('lap'), 0, 'ré não gera volta');

    // avanço para frente cruzando a linha com nextCp==0 → volta 1
    driveMeters(ctx, ctx.a, L * 0.93, 0.1 * L);
    assert.equal(ctx.a.count('lap'), 1, 'cruzamento para frente conta');
  } finally { cleanup(ctx); }
});

test('away de um jogador: corrida encerra mesmo com não-finished (deadline curto)', async () => {
  const ctx = await setupRace({
    laps: 1,
    timings: { finishGraceMs: 150, reconnectMs: 60000 },
  });
  try {
    ctx.rooms.onClose(ctx.b); // B vai away
    driveMeters(ctx, ctx.a, gridS(), 2 * L); // 1 travessia inicial + 1 volta
    assert.ok(ctx.a.last('fin'), 'A concluiu');

    const results = await waitFor(() => ctx.a.last('results'), 2000);
    assert.equal(results.reason, 'deadline', 'encerrou no deadline');
    const rowA = results.rows.find((r) => r.id === ctx.youA);
    const rowB = results.rows.find((r) => r.id === ctx.youB);
    assert.equal(rowA.dnf, false);
    assert.equal(rowB.dnf, true, 'B não concluiu (away)');
    assert.equal(rowA.place, 1);
    assert.equal(rowB.place, 2);
  } finally { cleanup(ctx); }
});

test('reconexão em corrida preserva lap e progresso', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    driveMeters(ctx, ctx.a, gridS(), 2 * L); // 1 volta contada
    assert.equal(ctx.a.count('lap'), 1);

    ctx.rooms.onClose(ctx.a); // away mantém progresso
    const a2 = makeConn('connA2');
    ctx.rooms.handleMessage(a2, {
      t: 'join', room: ctx.code, name: 'Ana', color: C1, resume: ctx.tokenA,
    });
    const j = a2.last('joined');
    assert.ok(j, 'resume aceito durante a corrida');
    assert.equal(j.mode, 'race');
    assert.equal(j.you, ctx.youA, 'mesmo id');
    const car = j.state.race.cars.find((c) => c.id === ctx.youA);
    assert.ok(car, 'snapshot embutido em state.race');
    assert.equal(car.lap, 1, 'lap preservado');
    assert.ok(car.s > L * 0.7 || car.s < L * 0.1, 'progresso (s) preservado');
  } finally { cleanup(ctx); }
});

test('snap_self emitido quando |v| excede maxSpeed*1.25', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    stAt(ctx, ctx.a, gridS(), PHYSICS.maxSpeed * 3);
    const snap = await waitFor(() => ctx.a.last('snap_self'));
    assert.ok(Math.abs(snap.v) <= PHYSICS.maxSpeed * 1.25 + 1e-9, 'v clampado');
  } finally { cleanup(ctx); }
});

test('snapshot place coerente com progresso', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    driveMeters(ctx, ctx.a, gridS(), 0.7 * L);  // A ~70% da 1ª volta
    driveMeters(ctx, ctx.b, gridSB(), 0.2 * L); // B ~20%
    const sn = await waitFor(() => {
      const s = ctx.a.last('sn');
      if (!s) return null;
      const a = s.cars.find((c) => c.id === ctx.youA);
      return a && a.cp >= 5 ? s : null;
    });
    const a = sn.cars.find((c) => c.id === ctx.youA);
    const b = sn.cars.find((c) => c.id === ctx.youB);
    assert.equal(a.place, 1, 'maior progresso → 1º');
    assert.equal(b.place, 2);
    assert.ok(a.cp >= 5, 'A colheu cps pelo caminho');
  } finally { cleanup(ctx); }
});

test('colisão: par sobreposto gera collide + snap_self p/ envolvidos', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    // A termina em s≈92 (cruzou a linha); B termina 2 m atrás (s≈90), mais
    // lenta (v=10) p/ gerar velocidade relativa real: desde o fix do sfx,
    // collide exige |rel| >= 1 m/s (sobreposição a mesma velocidade não emite)
    driveMeters(ctx, ctx.a, gridS(), L + 92);
    driveMeters(ctx, ctx.b, gridSB(), (L - gridSB()) + 90, { v: 10 });
    const col = await waitFor(() => ctx.a.last('collide'));
    assert.equal(col.a, ctx.youA);
    assert.equal(col.b, ctx.youB);
    assert.ok(col.imp >= 0);
    assert.ok(ctx.a.last('snap_self'), 'A recebeu correção');
    assert.ok(ctx.b.last('snap_self'), 'B recebeu correção');
  } finally { cleanup(ctx); }
});

test('cancel: <2 conectados antes do GO → cancel + lobby', async () => {
  const ctx = await setupRace({
    laps: 3,
    timings: { countdownS: 0.3 },
    waitForGo: false, // cai durante a contagem
  });
  try {
    ctx.rooms.onClose(ctx.b);
    const cancel = await waitFor(() => ctx.a.last('cancel'), 2000);
    assert.ok(cancel.msg, 'cancel com explicação');
    assert.equal(ctx.a.last('state').status, 'lobby', 'volta ao lobby');
  } finally { cleanup(ctx); }
});

test('back_lobby: de results ao lobby com ready resetado', async () => {
  const ctx = await setupRace({
    laps: 1,
    timings: { finishGraceMs: 150, reconnectMs: 60000 },
  });
  try {
    ctx.rooms.onClose(ctx.b);
    driveMeters(ctx, ctx.a, gridS(), 2 * L);
    await waitFor(() => ctx.a.last('results'), 2000);

    ctx.rooms.handleMessage(ctx.a, { t: 'back_lobby' });
    assert.ok(ctx.a.last('back_lobby'), 'back_lobby emitido');
    const st = ctx.a.last('state');
    assert.equal(st.status, 'lobby');
    assert.ok(st.players.every((p) => !p.ready), 'ready resetado');
  } finally { cleanup(ctx); }
});

// ---------- regressões das correções do servidor (revisão independente) ----------

test('regressão #1 (BLOCK): correção de parede usa pointAt(s) → snap_self com x,z finitos', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    // 20 m fora da parede (wall = width/2 + wallMargin = 11.5 m)
    const p = sampler.pointAt(gridS());
    const x = p.x + 20 * Math.cos(p.heading);
    const z = p.z - 20 * Math.sin(p.heading);
    ctx.clock.t += 250;
    ctx.rooms.handleMessage(ctx.a, {
      t: 'st', x, z, hd: p.heading, v: 30,
      steer: 0, hb: 0, nit: 0, off: 1, dr: 0,
    });
    const snap = ctx.a.last('snap_self');
    assert.ok(snap, 'snap_self emitido para posição fora da parede');
    // bug: proj.x/proj.z não existem em project() → cx=NaN apagava o carro no
    // cliente (guard `typeof NaN === 'number'` passava)
    assert.ok(Number.isFinite(snap.x) && Number.isFinite(snap.z),
      'x/z do snap_self devem ser finitos');
    const back = sampler.project(snap.x, snap.z);
    assert.ok(Math.abs(back.lat) <= 11.5 + 1e-6, 'corrigido de volta para dentro da parede');
  } finally { cleanup(ctx); }
});

test('regressão #4 (MED): salto forward de 40 m em 60 ms não avança progresso (snap_self de volta)', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    const s0 = 100; // trecho sem wrap p/ isolar o guard forward do wrapCross
    stAt(ctx, ctx.a, s0, 30); // base legítima (1ª msg: dt=Infinity nunca dispara)
    const p0 = sampler.pointAt(s0);
    const snapsBefore = ctx.a.count('snap_self');

    const pj = sampler.pointAt(s0 + 40);
    ctx.clock.t += 60; // 40 m em 60 ms ≈ 667 m/s ≫ 52.5*0.06 + 5 = 8.15 m
    ctx.rooms.handleMessage(ctx.a, {
      t: 'st', x: pj.x, z: pj.z, hd: pj.heading, v: 40,
      steer: 0, hb: 0, nit: 0, off: 0, dr: 0,
    });

    assert.equal(ctx.a.count('snap_self'), snapsBefore + 1, 'snap_self de volta emitido');
    const snap = ctx.a.last('snap_self');
    assert.ok(Math.abs(snap.x - p0.x) < 0.01 && Math.abs(snap.z - p0.z) < 0.01,
      'snap volta para a última posição oficial');
    const car = ctx.rooms.getRoom(ctx.code).race.snapshotState().cars
      .find((c) => c.id === ctx.youA);
    assert.ok(Math.abs(car.s - s0) < 0.5,
      `progresso não avança (s=${car.s}, esperado ~${s0})`);
    assert.equal(car.rec, 1, 'teleporte contabilizado em rec');
  } finally { cleanup(ctx); }
});

test('regressão #5 (LOW): steer é clampado em [-1, 1] (1e308 não vaza)', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    const p = sampler.pointAt(gridS());
    ctx.clock.t += 250;
    ctx.rooms.handleMessage(ctx.a, {
      t: 'st', x: p.x, z: p.z, hd: p.heading, v: 20,
      steer: 1e308, hb: 0, nit: 0, off: 0, dr: 0,
    });
    const car = ctx.rooms.getRoom(ctx.code).race.snapshotState().cars
      .find((c) => c.id === ctx.youA);
    assert.equal(car.steer, 1, 'steer clampado no teto');
  } finally { cleanup(ctx); }
});

test('regressão #6 (MED): collide exige impacto (|rel| >= 1) e tem cooldown de 300 ms por par', async () => {
  const ctx = await setupRace({ laps: 3 });
  try {
    const sA = gridS();
    const sB = sA + 1.5; // sobrepostos (COLLIDE_MIN_D = 2*1.6 = 3.2 m)
    // mesma velocidade → sem impacto real → sem sfx (corrige ~30 emits/s)
    stAt(ctx, ctx.a, sA, 40);
    stAt(ctx, ctx.b, sB, 40);
    assert.equal(ctx.a.count('collide'), 0, 'sobreposição sem velocidade relativa não emite');

    stAt(ctx, ctx.b, sB, 10); // impacto real: 40 vs 10 m/s
    assert.equal(ctx.a.count('collide'), 1, 'primeiro impacto emite');

    stAt(ctx, ctx.a, sA, 40); // +250 ms < 300 ms → ainda no cooldown
    assert.equal(ctx.a.count('collide'), 1, 'cooldown de 300 ms por par');

    stAt(ctx, ctx.a, sA, 40); // +500 ms após o emit → janela venceu
    assert.equal(ctx.a.count('collide'), 2, 'após o cooldown volta a emitir');
  } finally { cleanup(ctx); }
});
