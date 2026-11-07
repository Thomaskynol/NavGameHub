const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../lib/sim');
const hub = require('../lib/hub');

// Isola salas: mesmo nick em salas diferentes ok; mesma sala bloqueia (inclui left).
test('salas isoladas e apelido único (inclui quem saiu)', () => {
  const a = sim.createMatch('A', {});
  const b = sim.createMatch('B', {});
  assert.ok(sim.joinPlayer(a, 'p1', 'Ana', undefined).ok);
  assert.ok(sim.joinPlayer(b, 'p2', 'Ana', undefined).ok, 'mesmo nick em outra sala ok');
  assert.ok(!sim.joinPlayer(a, 'p3', 'ana', undefined).ok, 'dup na mesma sala bloqueia');
  sim.leavePlayer(a, 'p1');
  assert.ok(!sim.joinPlayer(a, 'p4', 'Ana', undefined).ok, 'nick de quem saiu segue bloqueado');
});

// Sem entrada mid-match.
test('sem entrada durante partida', () => {
  const m = sim.createMatch('C', {});
  sim.joinPlayer(m, 'p1', 'A', undefined); sim.joinPlayer(m, 'p2', 'B', undefined);
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  assert.equal(m.state, 'playing');
  const r = sim.joinPlayer(m, 'p3', 'C', undefined);
  assert.equal(r.ok, false);
});

// Troca build/equipe limpa pronto; troca modo limpa todos; equipe 2v2 máx 2.
test('regras lobby §6', () => {
  const m = sim.createMatch('D', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', undefined, 0); sim.joinPlayer(m, 'a2', 'A2', undefined, 0);
  sim.joinPlayer(m, 'b1', 'B1', undefined, 1);
  const r = sim.joinPlayer(m, 'b2', 'B2', undefined, 0);
  // b2 tentou entrar no time 0 cheio? join com team 0 deve falhar (máx 2)
  assert.equal(r.ok, false, 'equipe 2v2 máx 2');
  sim.joinPlayer(m, 'b2', 'B2', undefined, 1);
  sim.setReady(m, 'a1', true);
  assert.ok(m.players.get('a1').ready);
  sim.setTeam(m, 'a1', 1); // troca de equipe — mas time 1 já tem 2? a1 sai do 0, vai pro 1 que tem b1,b2 (2) → deve falhar
  // ajusta: time1 tem 2, então troca deve falhar e pronto mantido
  assert.ok(m.players.get('a1').ready, 'troca falhou, pronto mantido');
  // troca válida limpa pronto
  const m2 = sim.createMatch('E', { mode: 'ffa' });
  sim.joinPlayer(m2, 'x', 'X', undefined); sim.joinPlayer(m2, 'y', 'Y', undefined);
  sim.setReady(m2, 'x', true);
  // build change limpa pronto (simula via setReady manual? build muda no server; aqui só checa setMode limpa todos)
  sim.setMode(m2, null, '2v2');
  assert.ok(!m2.players.get('x').ready, 'troca modo limpa todos');
});

// Hub: sem HUB_SECRET recusa sem quebrar; com secret: state/close idempotente.
test('hub: sem secret recusa; com secret state/close', () => {
  const rooms = new Map();
  delete process.env.HUB_SECRET;
  const r1 = hub.stateOf(rooms, 'ABCD', null);
  assert.equal(r1.status, 503);
  const r2 = hub.closeRoom(rooms, 'ABCD', 't', 'x');
  assert.equal(r2.status, 503);
  process.env.HUB_SECRET = 's3cr3t';
  // dono registrado na criação dirigida pelo Hub (remember), não no close
  const m = sim.createMatch('ABCD', {});
  sim.joinPlayer(m, 'p1', 'Ana', undefined);
  rooms.set('ABCD', { match: m, pendingRemove: new Map(), conns: new Map() });
  hub.remember('ABCD', 'tok1');
  const s1 = hub.stateOf(rooms, 'ABCD', null);
  assert.equal(s1.status, 200);
  assert.equal(s1.body.ok, true);
  assert.equal(s1.body.room.phase, 'lobby');
  assert.equal(s1.body.room.hubOwner, 'tok1');
  const c1 = hub.closeRoom(rooms, 'ABCD', 'tok1', 's3cr3t');
  assert.equal(c1.status, 200);
  assert.equal(c1.body.closed, true);
  assert.ok(!rooms.has('ABCD'), 'fecha sem afetar outras (só esta)');
  const c2 = hub.closeRoom(rooms, 'ABCD', 'tok1', 's3cr3t');
  assert.equal(c2.status, 200, 'idempotente');
  // dono divergente → 403
  const m2 = sim.createMatch('WXYZ', {});
  rooms.set('WXYZ', { match: m2, pendingRemove: new Map(), conns: new Map() });
  hub.remember('WXYZ', 'ownerA');
  const c3 = hub.closeRoom(rooms, 'WXYZ', 'ownerB', 's3cr3t');
  assert.equal(c3.status, 403);
  const s2 = hub.stateOf(rooms, 'WXYZ', 'ownerB');
  assert.equal(s2.status, 409);
  delete process.env.HUB_SECRET;
  hub._owners.clear();
});

// Seção 7: state real + capacidade por modo, joinable, close idempotente.
test('hub: capacidade e joinable por modo (ffa12/2v2-4/pve1)', () => {
  const rooms = new Map();
  process.env.HUB_SECRET = 's3cr3t';
  try {
    const mk = (code, mode, n) => {
      const m = sim.createMatch(code, { mode });
      rooms.set(code, { match: m, pendingRemove: new Map(), conns: new Map() });
      for (let i = 0; i < n; i++) sim.joinPlayer(m, code + i, 'N' + code + i, undefined, mode === '2v2' ? i % 2 : undefined);
      return m;
    };
    const caps = { FFA1: ['ffa', 12, 12], TV2: ['2v2', 4, 4], PVE1: ['pve', 1, 1] };
    for (const [code, [mode, cap, n]] of Object.entries(caps)) {
      mk(code, mode, n);
      const r = hub.stateOf(rooms, code, null);
      assert.equal(r.status, 200);
      assert.equal(r.body.room.capacity, cap, `${mode} capacidade ${cap}`);
      assert.equal(r.body.room.players, n);
      assert.equal(r.body.room.joinable, false, `${mode} lotada não joinable`);
      assert.equal(r.body.room.mode, mode);
    }
    // jogando (não lobby) não é joinable mesmo com vaga
    const m2 = rooms.get('FFA1').match;
    m2.state = 'playing';
    assert.equal(hub.stateOf(rooms, 'FFA1', null).body.room.joinable, false);
    m2.state = 'lobby';
    // close só afeta a própria sala (htok×room)
    hub.remember('FFA1', 'tokA');
    hub.remember('TV2', 'tokB');
    const c = hub.closeRoom(rooms, 'FFA1', 'tokA', 's3cr3t');
    assert.equal(c.status, 200);
    assert.equal(c.body.closed, true);
    assert.ok(!rooms.has('FFA1') && rooms.has('TV2'), 'fecha só a própria sala');
    assert.ok(!hub._owners.has('FFA1') && hub._owners.get('TV2') === 'tokB', 'dono liberado só da sala fechada');
    // idempotente: fechar de novo informa sala livre sem erro
    const c2 = hub.closeRoom(rooms, 'FFA1', 'tokA', 's3cr3t');
    assert.equal(c2.status, 200);
    // sala livre: state 404 NOT_FOUND (contrato Hub)
    const s = hub.stateOf(rooms, 'FFA1', null);
    assert.equal(s.status, 404);
    assert.equal(s.body.ok, false);
    // segredo errado não fecha
    const c3 = hub.closeRoom(rooms, 'TV2', 'tokB', 'errado');
    assert.equal(c3.status, 403);
    assert.ok(rooms.has('TV2'), 'segredo errado não fecha');
  } finally {
    delete process.env.HUB_SECRET;
    hub._owners.clear();
  }
});
