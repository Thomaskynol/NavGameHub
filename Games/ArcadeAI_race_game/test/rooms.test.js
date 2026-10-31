// Asfalto Vivo — testes da camada de salas (server/rooms.js) + smoke WS.
// node:test; sem dependência de shared/tracks.js (trilho sintético p/ start).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createRooms } from '../server/rooms.js';
import { startServer } from '../server/index.js';

// Trilho sintético mínimo (>= 3 pontos + widths igual).
const TRACKS = {
  teste: {
    id: 'teste',
    name: 'Circuito Teste',
    points: [[0, 0], [100, 0], [100, 100], [0, 100]],
    widths: [10, 10, 10, 10],
  },
  outro: {
    id: 'outro',
    name: 'Outro',
    points: [[0, 0], [50, 0], [50, 50]],
    widths: [8, 8, 8],
  },
};

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
    count(t) { return this.inbox.filter((m) => m.t === t).length; },
  };
}

function makeRooms(opts = {}) {
  const raceCalls = [];
  const rooms = createRooms({
    tracks: TRACKS,
    timings: { reconnectMs: 25 },
    raceFactory(args) {
      const race = {
        onSt() {}, onReadyLoad() {}, onDisconnect() {}, onReconnect() {},
        onPlayerRemoved() {}, modeFor: () => 'race', snapshotState: () => ({ race: true }),
        dispose() {},
        _emit: args.emit,
        _endRace: args.endRace,
        laps: args.laps,
        players: args.players,
      };
      raceCalls.push(race);
      return race;
    },
    ...opts,
  });
  return { rooms, raceCalls };
}

function createAndJoin(rooms, name, color, id = name) {
  const conn = makeConn(id);
  rooms.handleMessage(conn, { t: 'create', name, color });
  return conn;
}

function join(rooms, code, name, color, id = name, extra = {}) {
  const conn = makeConn(id);
  rooms.handleMessage(conn, { t: 'join', room: code, name, color, ...extra });
  return conn;
}

// Hexes reais de shared/constants.js COLORS (validação é case-insensitive).
const C1 = '#e5484d', C2 = '#3b82f6', C3 = '#30b566';

test('create: joined + state com host e sala registrada', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const j = a.last('joined');
  assert.ok(j, 'deve enviar joined');
  assert.equal(j.mode, 'lobby');
  assert.equal(j.state.hostId, j.you);
  assert.equal(j.state.status, 'lobby');
  assert.equal(j.state.max, 6);
  assert.equal(j.state.seats, 1);
  assert.equal(rooms.roomCount(), 1);
  const room = rooms.getRoom(j.room);
  assert.ok(room, 'sala registrada pelo código');
  assert.equal(room.players[0].dname, 'Ana');
  rooms.destroy();
});

test('join: segundo jogador entra e vê state de 2; isolamento entre salas', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const codeA = a.last('joined').room;
  const b = createAndJoin(rooms, 'Bia', C2);
  const codeB = b.last('joined').room;
  assert.notEqual(codeA, codeB, 'create gera códigos distintos');

  const c = join(rooms, codeA, 'Caio', C3);
  const j = c.last('joined');
  assert.equal(j.room, codeA);
  assert.equal(j.state.players.length, 2, 'sala A tem Ana + Caio');
  const stateB = b.last('state');
  assert.equal(stateB.players.length, 1, 'sala B isolada (só Bia)');
  assert.equal(c.last('state').players.length, 2);
  rooms.destroy();
});

test('join: NOT_FOUND, FULL, BAD_NAME, BAD_COLOR', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;

  const nf = join(rooms, 'XXXXXX', 'Zé', C2);
  assert.equal(nf.last('err').code, 'NOT_FOUND');

  // validações de entrada (sala ainda não cheia)
  const badName = join(rooms, code, '   ', '#777777');
  assert.equal(badName.last('err').code, 'BAD_NAME');
  const longName = join(rooms, code, 'x'.repeat(17), '#777777');
  assert.equal(longName.last('err').code, 'BAD_NAME');
  const badColor = join(rooms, code, 'Novo', '#123456');
  assert.equal(badColor.last('err').code, 'BAD_COLOR');
  const usedColor = join(rooms, code, 'Novo', C1.toUpperCase());
  assert.equal(usedColor.last('err').code, 'BAD_COLOR', 'cor ocupada rejeitada (case-insensitive)');

  // preenche até MAX_PLAYERS=6 (Ana + 5) com cores válidas restantes
  const colors = ['#f5a524', '#8b5cf6', '#f97316', '#14b8a6', '#ec4899'];
  colors.forEach((col, i) => {
    const c = join(rooms, code, `P${i}`, col);
    assert.equal(c.last('err'), undefined, `P${i} deve entrar`);
  });
  const full = join(rooms, code, 'Extra', '#222222');
  assert.equal(full.last('err').code, 'FULL');
  rooms.destroy();
});

test('dname: nomes duplicados recebem sufixo #2 e recalculam na saída', async () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Racer', C1);
  const code = a.last('joined').room;
  const b = join(rooms, code, 'Racer', C2);
  const state = b.last('state');
  const names = state.players.map((p) => p.dname).sort();
  assert.deepEqual(names, ['Racer', 'Racer #2']);

  rooms.handleMessage(a, { t: 'leave' });
  // FIX #3: `leave` explícito remove o jogador NA HORA — a janela de away de
  // 30 s ficou só p/ desconexão de socket (onClose). Este trecho do teste
  // pressupunha o bug (fantasma ainda ocupando vaga/slot de nome).
  const awayState = b.last('state');
  assert.equal(awayState.players.length, 1, 'leave remove na hora (sem fantasma ocupando vaga)');
  assert.equal(awayState.players[0].dname, 'Racer', 'sufixo #2 recalculado imediatamente');

  // nada ressurgiu após a antiga janela de reconexão (reconnectMs = 25)
  await new Promise((r) => setTimeout(r, 60));
  const state2 = b.last('state');
  assert.equal(state2.players.length, 1, 'sem fantasma após a janela');
  assert.equal(state2.players[0].dname, 'Racer', 'sufixo segue recalculado');
  rooms.destroy();
});

test('set: cor/ready próprios; track/laps só host; troca zera ready', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const b = join(rooms, code, 'Bia', C2);

  rooms.handleMessage(b, { t: 'set', color: C3 });
  assert.equal(b.last('state').players.find((p) => p.dname === 'Bia').color, C3);
  rooms.handleMessage(b, { t: 'set', ready: true });
  assert.equal(b.last('state').players.find((p) => p.dname === 'Bia').ready, true);

  rooms.handleMessage(b, { t: 'set', track: 'outro' });
  assert.equal(b.last('err').code, 'NOT_HOST');
  rooms.handleMessage(b, { t: 'set', laps: 5 });
  assert.equal(b.last('err').code, 'NOT_HOST');

  rooms.handleMessage(a, { t: 'set', laps: 99 });
  assert.equal(a.last('err').code, 'INVALID');
  rooms.handleMessage(a, { t: 'set', track: 'nao-existe' });
  assert.equal(a.last('err').code, 'INVALID');

  rooms.handleMessage(a, { t: 'set', track: 'outro' });
  const st = a.last('state');
  assert.equal(st.track, 'outro');
  assert.ok(st.players.every((p) => !p.ready), 'troca de track zera ready de todos');
  rooms.handleMessage(a, { t: 'set', laps: 5 });
  assert.equal(a.last('state').laps, 5);
  rooms.destroy();
});

test('start: valida host, nº de jogadores e prontidão; cria race', () => {
  const { rooms, raceCalls } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;

  rooms.handleMessage(a, { t: 'start' });
  assert.equal(a.last('err').code, 'NOT_READY', 'só 1 jogador conectado');

  const b = join(rooms, code, 'Bia', C2);
  rooms.handleMessage(b, { t: 'start' });
  assert.equal(b.last('err').code, 'NOT_HOST');

  rooms.handleMessage(a, { t: 'start' });
  assert.equal(a.last('err').code, 'NOT_READY', 'Bia não pronta');

  rooms.handleMessage(a, { t: 'set', ready: true });
  rooms.handleMessage(b, { t: 'set', ready: true });
  rooms.handleMessage(a, { t: 'start' });
  assert.equal(raceCalls.length, 1, 'raceFactory chamado 1x');
  assert.equal(raceCalls[0].laps, 3);
  assert.equal(raceCalls[0].players.length, 2);
  assert.equal(a.last('state').status, 'countdown');

  rooms.handleMessage(a, { t: 'start' });
  assert.equal(a.last('err').code, 'RACING', 'corrida já ativa');
  rooms.destroy();
});

test('set durante corrida é rejeitado (RACING); endRace volta ao lobby', () => {
  const { rooms, raceCalls } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const b = join(rooms, code, 'Bia', C2);
  rooms.handleMessage(a, { t: 'set', ready: true });
  rooms.handleMessage(b, { t: 'set', ready: true });
  rooms.handleMessage(a, { t: 'start' });
  const race = raceCalls[0];

  rooms.handleMessage(a, { t: 'set', track: 'outro' });
  assert.equal(a.last('err').code, 'RACING');

  race._endRace();
  const lobby = rooms.getRoom(code);
  assert.equal(lobby.status, 'lobby');
  assert.equal(lobby.race, null);
  assert.ok(a.last('state').players.every((p) => !p.ready), 'ready resetado no lobby');
  rooms.destroy();
});

test('leave: remove o jogador na hora (sem fantasma away); sala vazia é destruída', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const b = join(rooms, code, 'Bia', C2);

  rooms.handleMessage(a, { t: 'leave' });
  // FIX #3: saída explícita remove DE FATO (mesmos hooks da expiração: race
  // .onDisconnect → removePlayer→onPlayerRemoved), sem a janela de 30 s — que
  // prendia vaga+cor e fazia reingresso <30 s levar BAD_COLOR contra o próprio
  // fantasma. Este teste pressupunha o bug (away ainda ocupando vaga).
  const st = b.last('state');
  assert.equal(st.players.length, 1, 'leave remove na hora (vaga liberada)');
  assert.equal(st.players.find((p) => p.dname === 'Ana'), undefined, 'Ana não é fantasma');

  // token morreu junto com o player (não há mais o que resumir)
  const a2 = join(rooms, code, 'Ana', C1, 'Ana2', { resume: a.last('joined').token });
  assert.equal(a2.last('err').code, 'RECONNECT_EXPIRED');

  // reconecta de fato (cor liberada) e todos saem → sala destruída sem esperar janela
  const a3 = join(rooms, code, 'Ana', C1, 'Ana3');
  assert.ok(a3.last('joined'), 'cor liberada após o leave');
  rooms.handleMessage(a3, { t: 'leave' });
  rooms.handleMessage(b, { t: 'leave' });
  assert.equal(rooms.roomCount(), 0, 'sala vazia destruída');
  rooms.destroy();
});

test('join na MESMA sala é idempotente: reenvia joined sem criar 2º player', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const you = a.last('joined').you;
  const joinedBefore = a.count('joined');

  // FIX #2: rejoin (ex.: com cor diferente) não cria ghost ready:false no
  // mesmo socket — travava o start em NOT_READY e inflava seats
  rooms.handleMessage(a, { t: 'join', room: code, name: 'Ana', color: C2 });
  const room = rooms.getRoom(code);
  assert.equal(room.players.length, 1, 'sem 2º player no mesmo socket');
  assert.equal(room.players[0].id, you, 'mesmo jogador preservado');
  assert.equal(a.count('joined'), joinedBefore + 1, 'joined reenviado');
  assert.equal(a.last('joined').you, you);
  rooms.destroy();
});

test('create com código pedido repetido → CODE_TAKEN; join no mesmo código entra (fallback do Hub)', () => {
  const { rooms } = makeRooms();
  const a = makeConn('hub-a');
  rooms.handleMessage(a, { t: 'create', name: 'Host', color: C1, room: 'HUB234' });
  assert.equal(a.last('joined').room, 'HUB234');

  // Criador repete o create (retry/iframe reload com ?create=1): sala já existe.
  const b = makeConn('hub-b');
  rooms.handleMessage(b, { t: 'create', name: 'Host', color: C2, room: 'HUB234' });
  assert.equal(b.last('err').code, 'CODE_TAKEN');

  // Fallback do cliente Hub: join com o mesmo código/nome entra na sala existente.
  rooms.handleMessage(b, { t: 'join', room: 'HUB234', name: 'Host' });
  assert.ok(b.last('joined'), 'fallback join entra na sala existente');
  assert.equal(b.last('joined').room, 'HUB234');
  assert.equal(rooms.getRoom('HUB234').players.length, 2);
  rooms.destroy();
});

test('desconexão (onClose) vira away; resume expirado → RECONNECT_EXPIRED', async () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const b = join(rooms, code, 'Bia', C2);
  const tokenB = b.last('joined').token;

  rooms.onClose(b);
  assert.equal(rooms.getRoom(code).players.find((p) => p.dname === 'Bia').conn, null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(rooms.getRoom(code).players.length, 1, 'Bia removida após janela');

  const late = join(rooms, code, 'Bia', C2, 'Bia2', { resume: tokenB });
  assert.equal(late.last('err').code, 'RECONNECT_EXPIRED');
  rooms.destroy();
});

test('resume de token ativo: conexão mais recente vence; antiga recebe bye', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const token = a.last('joined').token;
  const you = a.last('joined').you;

  const a2 = join(rooms, code, 'Ana', C1, 'Ana2', { resume: token });
  assert.ok(a2.last('joined'), 'nova conexão assumiu');
  assert.equal(a2.last('joined').you, you, 'mesmo id de jogador');
  assert.equal(a.last('bye').reason, 'replaced');
  assert.equal(a.closed, true, 'conexão antiga fechada');
  rooms.destroy();
});

test('rate limit de st: >30/s ignorado, err RATE uma vez', () => {
  const { rooms, raceCalls } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const b = join(rooms, code, 'Bia', C2);
  rooms.handleMessage(a, { t: 'set', ready: true });
  rooms.handleMessage(b, { t: 'set', ready: true });
  rooms.handleMessage(a, { t: 'start' });
  const race = raceCalls[0];
  let seen = 0;
  race.onSt = () => { seen += 1; };

  for (let i = 0; i < 40; i++) {
    rooms.handleMessage(a, { t: 'st', p: { x: i, y: 0, z: 0 } });
  }
  assert.equal(seen, 30, 'exatos 30 st/s passam');
  assert.equal(a.count('err'), 1, 'aviso RATE único');
  assert.equal(a.last('err').code, 'RATE');
  rooms.destroy();
});

test('ready_load e st chegam na race ativa', () => {
  const { rooms, raceCalls } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  const code = a.last('joined').room;
  const b = join(rooms, code, 'Bia', C2);
  rooms.handleMessage(a, { t: 'set', ready: true });
  rooms.handleMessage(b, { t: 'set', ready: true });
  rooms.handleMessage(a, { t: 'start' });
  const race = raceCalls[0];
  let loads = 0, sts = 0;
  race.onReadyLoad = () => { loads += 1; };
  race.onSt = () => { sts += 1; };
  rooms.handleMessage(a, { t: 'ready_load' });
  rooms.handleMessage(a, { t: 'st', p: { x: 0, y: 0, z: 0 } });
  assert.equal(loads, 1);
  assert.equal(sts, 1);
  rooms.destroy();
});

test('st sem race ativa é ignorado sem erro', () => {
  const { rooms } = makeRooms();
  const a = createAndJoin(rooms, 'Ana', C1);
  rooms.handleMessage(a, { t: 'st', p: { x: 0, y: 0, z: 0 } });
  assert.equal(a.count('err'), 0);
  rooms.destroy();
});

test('rate limit global: >50 msgs/s por conexão → excedente descartado + err RATE', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, timings: { reconnectMs: 25 } });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const inbox = [];
    ws.on('message', (data) => inbox.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // FIX #7: sem limite global, 1 socket criava salas infinitas/amplificava
    // msgs (o de rooms cobria só `st`). Janela de 1 s, teto 50, err 1x/janela.
    for (let i = 0; i < 80; i++) ws.send(JSON.stringify({ t: 'ping', ts: i }));
    await new Promise((r) => setTimeout(r, 150));
    ws.close(); // fecha antes de asserir: falha não pode deixar srv.close() pendurado

    const pongs = inbox.filter((m) => m.t === 'pong');
    const rates = inbox.filter((m) => m.t === 'err' && m.code === 'RATE');
    assert.ok(rates.length >= 1, 'err RATE emitido por janela');
    assert.ok(pongs.length <= 51, `excedente descartado (${pongs.length} pongs de 80)`);
    assert.ok(pongs.length >= 45, 'dentro da janela ainda processa a maior parte');
  } finally {
    await srv.close();
  }
});

test('smoke WS: servidor real, welcome + criar sala por WebSocket', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, timings: { reconnectMs: 25 } });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const inbox = [];
    ws.on('message', (data) => inbox.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const waitFor = (t) => new Promise((resolve) => {
      const found = inbox.find((m) => m.t === t);
      if (found) { resolve(found); return; }
      const onMsg = () => {
        const hit = inbox.find((m) => m.t === t);
        if (hit) { ws.off('message', onMsg); resolve(hit); }
      };
      ws.on('message', onMsg);
    });

    const welcome = await waitFor('welcome');

    ws.send(JSON.stringify({ t: 'create', name: 'WS', color: C1 }));
    const joined = await waitFor('joined');

    // ping/pong direto do index
    ws.send(JSON.stringify({ t: 'ping', ts: 777 }));
    const pong = await waitFor('pong');
    ws.close(); // fecha antes de asserir: falha não pode deixar srv.close() pendurado

    assert.equal(typeof welcome.protocol, 'number');
    assert.ok(welcome.you, 'conn id atribuída');
    assert.equal(typeof welcome.serverNow, 'number', 'FIX #8: contrato §3 pede serverNow no welcome');

    assert.equal(joined.mode, 'lobby');
    assert.equal(joined.state.hostId, joined.you);

    assert.ok(pong.now > 0);
    assert.equal(pong.ts, 777, 'FIX #8: contrato §3 ecoa o ts (alias `now` mantém cliente antigo)');
    assert.equal(typeof pong.serverNow, 'number', 'FIX #8: contrato §3 pede serverNow no pong');
  } finally {
    await srv.close();
  }
});
