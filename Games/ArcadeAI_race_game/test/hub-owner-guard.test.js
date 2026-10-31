// Guarda de dono (Hub) — itens 1–2 da revisão: corrida verificação→criação e
// close atrasado. Contra o SERVIDOR REAL (startServer em porta efêmera).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';

const TRACKS = {
  teste: {
    id: 'teste',
    name: 'Circuito Teste',
    points: [[0, 0], [100, 0], [100, 100], [0, 100]],
    widths: [10, 10, 10, 10],
  },
};

const C1 = '#e5484d', C2 = '#3b82f6', C3 = '#30b566',
  C4 = '#f5a524', C5 = '#8b5cf6', C6 = '#f97316', C7 = '#14b8a6';
const COLORS = [C1, C2, C3, C4, C5, C6];

function wsOpen(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function wsSendRecv(ws, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout aguardando joined/err')), 3000);
    const onMsg = (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.t === 'joined' || msg.t === 'err') {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify(payload));
  });
}

async function httpState(base, headers, code) {
  const res = await fetch(`${base}/__hub/state?room=${code}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function httpClose(base, headers, code, htok) {
  const qs = htok == null ? `room=${code}` : `room=${code}&htok=${encodeURIComponent(htok)}`;
  const res = await fetch(`${base}/__hub/close?${qs}`, { method: 'POST', headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test('conflito verificação→criação: dono B ocupa, create A leva CODE_TAKEN, state mostra B, join A recusado sem entrada', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, secret: 't', timings: { reconnectMs: 5000 } });
  const sockets = [];
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const headers = { 'x-hub-secret': 't' };
    const CODE = 'AA22BB';

    // Dono B ocupa o código primeiro e MANTÉM a conexão aberta.
    const wsB = await wsOpen(srv.port);
    sockets.push(wsB);
    const joinedB = await wsSendRecv(wsB, { t: 'create', name: 'Bia', color: C1, room: CODE, htok: 'hub-b' });
    assert.equal(joinedB.t, 'joined', 'dono B cria a sala');

    // Verificação do Hub (state) já mostra o dono B.
    const st = await httpState(base, headers, CODE);
    assert.equal(st.status, 200);
    assert.equal(st.body.room.code, CODE);
    assert.equal(st.body.room.hubOwner, 'hub-b', 'state expõe o dono B');

    // Tentativa de criação do dono A no mesmo código → CODE_TAKEN.
    const wsA = await wsOpen(srv.port);
    sockets.push(wsA);
    const errCreate = await wsSendRecv(wsA, { t: 'create', name: 'Ana', color: C2, room: CODE, htok: 'hub-a' });
    assert.equal(errCreate.code, 'CODE_TAKEN', 'create com dono diferente recusado');

    // Join do dono A na sala alheia → recusado, SEM entrada.
    const errJoin = await wsSendRecv(wsA, { t: 'join', room: CODE, name: 'Ana', color: C2, htok: 'hub-a' });
    assert.equal(errJoin.code, 'CODE_TAKEN', 'join com dono diferente recusado');

    // Ninguém entrou na sala alheia: só Bia segue lá.
    const room = srv.rooms.getRoom(CODE);
    assert.ok(room, 'sala segue existindo');
    assert.equal(room.players.length, 1, 'nenhum intruso entrou');
    assert.equal(room.players[0].dname, 'Bia');
    const st2 = await httpState(base, headers, CODE);
    assert.equal(st2.body.room.players, 1);
    assert.equal(st2.body.room.hubOwner, 'hub-b');
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ok */ } }
    await srv.close();
  }
});

test('join com htok em sala sem dono é recusado (não mistura Hub com independente)', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, secret: 't', timings: { reconnectMs: 5000 } });
  const sockets = [];
  try {
    const CODE = 'CC33DD';
    const wsHost = await wsOpen(srv.port);
    sockets.push(wsHost);
    const j = await wsSendRecv(wsHost, { t: 'create', name: 'Solo', color: C1, room: CODE });
    assert.equal(j.t, 'joined');

    const wsHub = await wsOpen(srv.port);
    sockets.push(wsHub);
    const err = await wsSendRecv(wsHub, { t: 'join', room: CODE, name: 'Hub', color: C2, htok: 'hub-x' });
    assert.equal(err.code, 'CODE_TAKEN', 'htok em sala sem dono recusado');
    assert.equal(srv.rooms.getRoom(CODE).players.length, 1, 'sem entrada na sala independente');
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ok */ } }
    await srv.close();
  }
});

test('state expõe hubOwner (dono e null)', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, secret: 't', timings: { reconnectMs: 5000 } });
  const sockets = [];
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const headers = { 'x-hub-secret': 't' };
    const ws1 = await wsOpen(srv.port);
    sockets.push(ws1);
    await wsSendRecv(ws1, { t: 'create', name: 'A', color: C1, room: 'DD44EE', htok: 'hub-a' });
    const ws2 = await wsOpen(srv.port);
    sockets.push(ws2);
    await wsSendRecv(ws2, { t: 'create', name: 'B', color: C2, room: 'FF55GG' });

    const s1 = await httpState(base, headers, 'DD44EE');
    assert.equal(s1.body.room.hubOwner, 'hub-a');
    const s2 = await httpState(base, headers, 'FF55GG');
    assert.equal(s2.body.room.hubOwner, null);
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ok */ } }
    await srv.close();
  }
});

test('close: dono correto fecha; dono diferente/sem htok recusam; htok vs sala sem dono recusa', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, secret: 't', timings: { reconnectMs: 5000 } });
  const sockets = [];
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const headers = { 'x-hub-secret': 't', 'content-type': 'application/json' };
    const CODE = 'HH66JJ';
    const ws = await wsOpen(srv.port);
    sockets.push(ws);
    const j = await wsSendRecv(ws, { t: 'create', name: 'Host', color: C1, room: CODE, htok: 'hub-a' });
    assert.equal(j.t, 'joined');

    let r = await httpClose(base, headers, CODE, 'hub-b');
    assert.equal(r.status, 403, 'dono diferente recusa');
    assert.ok(srv.rooms.getRoom(CODE), 'sala intacta');

    r = await httpClose(base, headers, CODE, null);
    assert.equal(r.status, 403, 'sala com dono sem htok recusa');
    assert.ok(srv.rooms.getRoom(CODE), 'sala intacta');

    r = await httpClose(base, headers, CODE, 'hub-a');
    assert.equal(r.status, 200, 'dono fecha');
    assert.equal(srv.rooms.getRoom(CODE), null, 'sala fechada pelo dono');

    // Sala sem dono: sem htok fecha (legado); com htok recusa.
    const CODE2 = 'KK77LL';
    const ws2 = await wsOpen(srv.port);
    sockets.push(ws2);
    const j2 = await wsSendRecv(ws2, { t: 'create', name: 'Solo', color: C2, room: CODE2 });
    assert.equal(j2.room, CODE2);
    r = await httpClose(base, headers, CODE2, 'hub-old');
    assert.equal(r.status, 403, 'htok vs sala sem dono recusa');
    assert.ok(srv.rooms.getRoom(CODE2), 'sala sem dono intacta');
    r = await httpClose(base, headers, CODE2, null);
    assert.equal(r.status, 200, 'sem htok fecha sala sem dono (legado)');
    assert.equal(srv.rooms.getRoom(CODE2), null);
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ok */ } }
    await srv.close();
  }
});

test('reuso do código por partida nova não é atingido por close antigo', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, secret: 't', timings: { reconnectMs: 5000 } });
  const sockets = [];
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const headers = { 'x-hub-secret': 't', 'content-type': 'application/json' };
    const CODE = 'MM88NN';

    const ws1 = await wsOpen(srv.port);
    sockets.push(ws1);
    await wsSendRecv(ws1, { t: 'create', name: 'Velha', color: C1, room: CODE, htok: 'hub-old' });
    const r1 = await httpClose(base, headers, CODE, 'hub-old');
    assert.equal(r1.status, 200);

    // Partida nova reusa o código com outro dono.
    const ws2 = await wsOpen(srv.port);
    sockets.push(ws2);
    const j2 = await wsSendRecv(ws2, { t: 'create', name: 'Nova', color: C2, room: CODE, htok: 'hub-new' });
    assert.equal(j2.t, 'joined', 'código reusado pela partida nova');

    // Close atrasado da partida antiga não derruba a nova.
    const rOld = await httpClose(base, headers, CODE, 'hub-old');
    assert.equal(rOld.status, 403, 'close antigo recusado');
    assert.ok(srv.rooms.getRoom(CODE), 'partida nova intacta');
    assert.equal(srv.rooms.getRoom(CODE).htok, 'hub-new');

    // Nem close antigo sem htok derruba sala com dono.
    const rNoHtok = await httpClose(base, headers, CODE, null);
    assert.equal(rNoHtok.status, 403);
    assert.ok(srv.rooms.getRoom(CODE), 'partida nova intacta');
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ok */ } }
    await srv.close();
  }
});

test('resume legítimo com mesmo htok entra até em sala cheia; sem htok entra em sala com dono (independente)', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, secret: 't', timings: { reconnectMs: 5000 } });
  const sockets = [];
  try {
    const CODE = 'PP99QQ';
    // Host + 5 com o mesmo dono (sala cheia de 6).
    const conns = [];
    for (let i = 0; i < 6; i++) {
      const ws = await wsOpen(srv.port);
      sockets.push(ws);
      conns.push(ws);
      const payload = i === 0
        ? { t: 'create', name: `P${i}`, color: COLORS[i], room: CODE, htok: 'hub-a' }
        : { t: 'join', room: CODE, name: `P${i}`, color: COLORS[i], htok: 'hub-a' };
      const got = await wsSendRecv(ws, payload);
      assert.equal(got.t, 'joined', `P${i} entra com mesmo htok`);
    }
    const hostToken = srv.rooms.getRoom(CODE).players[0].token;
    // Desconecta o host (away retém a vaga) e retoma com o mesmo htok.
    conns[0].terminate();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(srv.rooms.getRoom(CODE).players.length, 6, 'vaga retida no away');

    const wsR = await wsOpen(srv.port);
    sockets.push(wsR);
    const resumed = await wsSendRecv(wsR, {
      t: 'join', room: CODE, name: 'P0', color: C7, resume: hostToken, htok: 'hub-a',
    });
    assert.equal(resumed.t, 'joined', 'resume legítimo entra em sala cheia');
    assert.equal(srv.rooms.getRoom(CODE).players.length, 6, 'sem duplicata');

    // Join novo com mesmo htok em sala cheia segue FULL (não fura fila).
    const wsFull = await wsOpen(srv.port);
    sockets.push(wsFull);
    const full = await wsSendRecv(wsFull, { t: 'join', room: CODE, name: 'Novo', color: C7, htok: 'hub-a' });
    assert.equal(full.code, 'FULL');

    // Modo independente preservado: join SEM htok entra em sala com dono.
    const CODE2 = 'RR22SS';
    const wsH = await wsOpen(srv.port);
    sockets.push(wsH);
    await wsSendRecv(wsH, { t: 'create', name: 'Dono', color: C1, room: CODE2, htok: 'hub-z' });
    const wsI = await wsOpen(srv.port);
    sockets.push(wsI);
    const jInd = await wsSendRecv(wsI, { t: 'join', room: CODE2, name: 'Livre', color: C2 });
    assert.equal(jInd.t, 'joined', 'independente sem htok entra em sala com dono');
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ok */ } }
    await srv.close();
  }
});
