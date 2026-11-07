// Integração servidor-real: SÓ lacunas não cobertas por ws-check / room /
// arena / review-fix / p1-regressions (verificados por grep antes de escrever):
//   1. 2 crashes abruptos no meio da partida → health (state 200, sala viva,
//      novo hello aceito, placar intacto).
//   2. multisala playing: movimento/input na sala A não move a sala B;
//      over na A (len curto) não encerra a B; snapshots isolados.
//   3. races: 14 hellos concorrentes no cap de 12; 5 starts concorrentes;
//      rematch+leave concorrentes pós-over (sem crash, estado consistente).
// Meio: WS real contra `node server/main.js` em portas efêmeras (padrão
// copiado de ws-check.mjs; sem fixtures artificiais — servidor de produção).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, extraEnv = {}) {
  const child = spawn('node', ['server/main.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function ready(port, child) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/__hub/state`);
      if (r.ok) return;
    } catch { /* subindo */ }
    if (child.exitCode != null) throw new Error('server morreu ao subir');
    await wait(100);
  }
  throw new Error('server não subiu');
}

// hello → resolve { ws, snaps, welcome } ou { denied } (full/rejeitado).
function connect(port, room, name, extra = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const snaps = [];
    let welcome = null;
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => reject(new Error('timeout welcome/denied')), 8000);
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(String(buf));
        if (m.t === 'welcome') { welcome = m; finish({ ws, snaps, welcome }); }
        else if (m.t === 'snapshot' || m.t === 'event') {
          snaps.push(m);
          if (m.t === 'event' && m.kind === 'denied') finish({ ws, snaps, welcome, denied: m.reason });
        }
      } catch { /* ignora */ }
    });
    ws.on('error', () => { /* close trata */ });
    ws.on('close', (code) => {
      if (!welcome) finish({ ws, snaps, welcome, denied: `close-${code}` });
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, room, ...extra })));
  });
}

const lastSnap = (c) => c.snaps.filter((m) => m.t === 'snapshot').at(-1);
const hubState = async (port) => (await fetch(`http://127.0.0.1:${port}/__hub/state`)).json();
const closeAll = (cs) => { for (const c of cs) { try { c.ws.close(); } catch {} } };

// ---- 1. 2 crashes abruptos → health ----
describe('extras: 2 crashes abruptos no meio da partida → health', () => {
  const port = 18111;
  let srv;
  before(async () => { srv = startServer(port); await ready(port, srv); });
  after(() => { srv.kill(); });

  it('servidor sobrevive a 2 terminates e segue jogável com placar intacto', async () => {
    const host = await connect(port, 'hk', 'host');
    const p2 = await connect(port, 'hk', 'p2');
    host.ws.send(JSON.stringify({ t: 'start' }));
    await wait(700);
    let st = await hubState(port);
    assert.equal(st.rooms.find((r) => r.room === 'hk').state, 'playing');
    // p2 voa e atira por 1s, depois morre abruptamente (crash 1: sem leave)
    p2.ws.send(JSON.stringify({ t: 'input', seq: 1, w: 1, yaw: 0.7, fire: 1 }));
    await wait(1000);
    p2.ws.terminate();
    // host inunda inputs e também morre abrupto (crash 2)
    for (let i = 2; i < 20; i++) host.ws.send(JSON.stringify({ t: 'input', seq: i, w: 1, yaw: -0.3, fire: 1 }));
    host.ws.terminate();
    await wait(800);
    // health: processo vivo + state 200 + sala viva
    assert.equal(srv.exitCode, null, 'processo do servidor segue vivo');
    st = await hubState(port);
    assert.equal(st.rooms.find((r) => r.room === 'hk')?.state, 'playing', 'sala segue em playing');
    // jogável: novo hello aceito e recebendo snapshots
    const p3 = await connect(port, 'hk', 'p3');
    assert.ok(p3.welcome?.id, 'novo hello aceito após os crashes');
    await wait(800);
    assert.ok(lastSnap(p3), 'novo cliente recebe snapshots');
    assert.ok((await hubState(port)).rooms.some((r) => r.room === 'hk'), 'sala listada');
    closeAll([p3]);
  });
});

// ---- 2. multisala playing ----
describe('extras: multisala em playing (isolamento real)', () => {
  const port = 18112;
  let srv;
  before(async () => { srv = startServer(port); await ready(port, srv); });
  after(() => { srv.kill(); });

  it('input na sala A não move a sala B; over na A não encerra a B', async () => {
    // len mínimo do protocolo = 5 (validHello); A curta p/ over rápido.
    const a1 = await connect(port, 'rA', 'a1', { len: 5 });
    const b1 = await connect(port, 'rB', 'b1', { len: 60 });
    assert.ok(a1.welcome?.id && b1.welcome?.id, 'hellos aceitos');
    a1.ws.send(JSON.stringify({ t: 'start' }));
    b1.ws.send(JSON.stringify({ t: 'start' }));
    await wait(800);
    let st = await hubState(port);
    assert.equal(st.rooms.find((r) => r.room === 'rA').state, 'playing');
    assert.equal(st.rooms.find((r) => r.room === 'rB').state, 'playing');

    const bBefore = lastSnap(b1).ships.find((s) => s.id === b1.welcome.id);
    const bPos = [bBefore.x, bBefore.y, bBefore.z];
    // Só A pilota por ~1.5s (B parado: sem input, velocidade 0 → fica onde está)
    for (let i = 1; i <= 10; i++) {
      a1.ws.send(JSON.stringify({ t: 'input', seq: i, w: 1, yaw: 0.9, pitch: 0.1, fire: 1 }));
      await wait(150);
    }
    const snapA = lastSnap(a1);
    const snapB = lastSnap(b1);
    assert.ok(!snapA.ships.some((s) => s.id === b1.welcome.id), 'snapshot A não vaza ship de B');
    assert.ok(!snapB.ships.some((s) => s.id === a1.welcome.id), 'snapshot B não vaza ship de A');
    const bAfter = snapB.ships.find((s) => s.id === b1.welcome.id);
    assert.deepEqual([bAfter.x, bAfter.y, bAfter.z], bPos, 'B parado não se moveu com input de A');
    const aAfter = snapA.ships.find((s) => s.id === a1.welcome.id);
    assert.ok(
      Math.hypot(aAfter.x - bPos[0], aAfter.y - bPos[1], aAfter.z - bPos[2]) > 1,
      'A de fato se moveu (teste não é vazio)',
    );

    // Over na A (len=5): B segue playing
    await wait(6500);
    st = await hubState(port);
    assert.equal(st.rooms.find((r) => r.room === 'rA').state, 'over', 'A encerrou (len curto)');
    assert.equal(st.rooms.find((r) => r.room === 'rB').state, 'playing', 'B segue playing após over de A');
    closeAll([a1, b1]);
  });
});

// ---- 3. races ----
describe('extras: races (cap, start, rematch+leave)', () => {
  const port = 18113;
  let srv;
  before(async () => { srv = startServer(port); await ready(port, srv); });
  after(() => { srv.kill(); });

  it('14 hellos concorrentes no cap 12: exatamente 12 dentro, resto full', async () => {
    const all = await Promise.all(
      Array.from({ length: 14 }, (_, i) => connect(port, 'race', `r${i}`)));
    const inside = all.filter((c) => c.welcome?.id);
    const denied = all.filter((c) => !c.welcome?.id);
    assert.equal(inside.length, 12, `12 dentro (dentro=${inside.length})`);
    assert.equal(denied.length, 2, `2 negados (negados=${denied.length})`);
    assert.ok(denied.every((c) => c.denied === 'full' || String(c.denied).startsWith('close-')),
      `negados com motivo full (${denied.map((c) => c.denied).join(',')})`);
    await wait(800); // snapshots a 10Hz: dá tempo de chegarem antes de ler
    const snap = lastSnap(inside[0]);
    assert.equal(snap.ships.filter((s) => !s.bot).length, 12, 'snapshot tem 12 humanos');
    closeAll(all);
    await wait(400);
  });

  it('5 starts concorrentes: 1 transição, sem crash', async () => {
    const cs = await Promise.all([connect(port, 'rs', 'h'), connect(port, 'rs', 'p1'), connect(port, 'rs', 'p2')]);
    for (const c of cs) for (let i = 0; i < 5; i++) c.ws.send(JSON.stringify({ t: 'start' }));
    await wait(800);
    const st = await hubState(port);
    assert.equal(st.rooms.find((r) => r.room === 'rs').state, 'playing', 'playing após starts concorrentes');
    assert.equal(srv.exitCode, null, 'servidor vivo');
    assert.ok(lastSnap(cs[0]), 'snapshots fluindo');
    closeAll(cs);
  });

  it('rematch+leave concorrentes pós-over: consistente, sem crash', async () => {
    const host = await connect(port, 'rr', 'host', { len: 5 });
    const p2 = await connect(port, 'rr', 'p2');
    assert.ok(host.welcome?.id && p2.welcome?.id, 'hellos aceitos');
    host.ws.send(JSON.stringify({ t: 'start' }));
    await wait(6000); // len=5 → over
    let st = await hubState(port);
    assert.equal(st.rooms.find((r) => r.room === 'rr').state, 'over');
    // corrida: host pede revanche enquanto p2 sai (e vice-versa, várias vezes)
    for (let i = 0; i < 5; i++) {
      host.ws.send(JSON.stringify({ t: 'rematch' }));
      p2.ws.send(JSON.stringify({ t: 'leave' }));
    }
    p2.ws.close();
    await wait(1000);
    assert.equal(srv.exitCode, null, 'servidor vivo após a corrida');
    st = await hubState(port);
    const room = st.rooms.find((r) => r.room === 'rr');
    assert.ok(room, 'sala segue listada');
    assert.ok(['lobby', 'playing'].includes(room.state), `estado consistente (${room.state})`);
    assert.ok(room.players <= 12, `players dentro do cap (${room.players})`);
    host.ws.close();
  });
});
