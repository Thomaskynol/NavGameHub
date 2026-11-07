// Smoke WS multi-cliente: 2 salas isoladas + 12 conexões + hub protegido.
// Uso: node tests/ws-check.mjs  (sobe/d Derruba servidores próprios nas portas 18091/18092)
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

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

function connect(port, room, name, extra = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const snaps = [];
    let welcome = null;
    const timer = setTimeout(() => reject(new Error('timeout welcome')), 5000);
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(String(buf));
        if (m.t === 'welcome') { welcome = m; clearTimeout(timer); resolve({ ws, snaps, welcome }); }
        else if (m.t === 'snapshot') snaps.push(m);
        else if (m.t === 'event') snaps.push(m);
      } catch { /* ignora */ }
    });
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, room, ...extra })));
  });
}

const hubState = async (port) => (await fetch(`http://127.0.0.1:${port}/__hub/state`)).json();

// Fase 1: sem HUB_SECRET — jogo independente ok, close protegido recusa.
{
  const port = 18091;
  const srv = startServer(port);
  await ready(port, srv);
  const a1 = await connect(port, 'ra', 'a1');
  const a2 = await connect(port, 'ra', 'a2');
  const b1 = await connect(port, 'rb', 'b1');
  // voa + atira na sala A (input com campos novos)
  a1.ws.send(JSON.stringify({ t: 'input', seq: 1, w: 1, s: 0, a: 0, d: 0, yaw: 0.5, pitch: 0, fire: 1, boost: 1, w2: 0, swap: 0 }));
  await wait(1200);
  const st = await hubState(port);
  const ra = st.rooms.find((r) => r.room === 'ra');
  const rb = st.rooms.find((r) => r.room === 'rb');
  check(ra && ra.players === 2, `2 salas isoladas: ra tem 2 players (hub=${JSON.stringify(ra)})`);
  check(rb && rb.players === 1, `2 salas isoladas: rb tem 1 player (hub=${JSON.stringify(rb)})`);
  const snapA = a1.snaps.filter((m) => m.t === 'snapshot').at(-1);
  const snapB = b1.snaps.filter((m) => m.t === 'snapshot').at(-1);
  check(snapA && snapA.room === 'ra' && snapA.ships.length === 2, 'snapshot A contém só a sala A');
  check(snapB && snapB.room === 'rb' && snapB.ships.length === 1, 'snapshot B contém só a sala B');
  const idsA = new Set(snapA.ships.map((s) => s.id));
  check(!snapB.ships.some((s) => idsA.has(s.id)), 'salas isoladas: nenhum ship compartilhado');
  check(snapA.obstacles && snapA.missiles !== undefined && snapA.powerups?.length === 6, 'snapshot tem missiles/powerups/obstacles');
  void a2;

  // 12 vagas: completa ra (2) + 10, 13ª rejeitada
  const extra = [];
  for (let i = 0; i < 10; i++) extra.push(await connect(port, 'ra', `x${i}`));
  let denied = null, closedCode = null;
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const timer = setTimeout(resolve, 5000);
    ws.on('message', (buf) => {
      try { const m = JSON.parse(String(buf)); if (m.kind === 'denied') denied = m.reason; } catch { /* noop */ }
    });
    ws.on('close', (code) => { closedCode = code; clearTimeout(timer); resolve(); });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'lotado', room: 'ra' })));
  });
  check(denied === 'full', `13ª conexão rejeitada (denied=${denied} close=${closedCode})`);
  const st2 = await hubState(port);
  check(st2.rooms.find((r) => r.room === 'ra').players === 12, 'sala ra manteve 12 vagas');

  // hub sem segredo: close recusado, jogo segue
  const closeRes = await fetch(`http://127.0.0.1:${port}/__hub/close`, {
    method: 'POST', body: JSON.stringify({ room: 'ra' }),
  });
  check(closeRes.status === 403, `POST /__hub/close sem HUB_SECRET → 403 (${closeRes.status})`);

  for (const c of [a1, b1, ...extra]) c.ws.close();
  srv.kill();
  await wait(300);
}

// Fase 2: com HUB_SECRET — close autenticado, 404 vs idempotente.
{
  const port = 18092;
  const srv = startServer(port, { HUB_SECRET: 's3cr3t' });
  await ready(port, srv);
  const c = await connect(port, 'tmp', 'h');
  check((await hubState(port)).rooms.some((r) => r.room === 'tmp'), 'sala tmp criada');
  c.ws.close();
  const noAuth = await fetch(`http://127.0.0.1:${port}/__hub/close`, {
    method: 'POST', body: JSON.stringify({ room: 'tmp' }),
  });
  check(noAuth.status === 403, `close sem header → 403 (${noAuth.status})`);
  const nf = await fetch(`http://127.0.0.1:${port}/__hub/close`, {
    method: 'POST', headers: { 'x-hub-secret': 's3cr3t' }, body: JSON.stringify({ room: 'nope' }),
  });
  check(nf.status === 200, `close sala inexistente → 200 idempotente (${nf.status})`);
  const ok1 = await (await fetch(`http://127.0.0.1:${port}/__hub/close`, {
    method: 'POST', headers: { 'x-hub-secret': 's3cr3t' }, body: JSON.stringify({ room: 'tmp' }),
  })).json();
  check(ok1.ok === true && ok1.closed === true, `close fecha sala (${JSON.stringify(ok1)})`);
  const ok2 = await (await fetch(`http://127.0.0.1:${port}/__hub/close`, {
    method: 'POST', headers: { 'x-hub-secret': 's3cr3t' }, body: JSON.stringify({ room: 'tmp' }),
  })).json();
  check(ok2.ok === true && ok2.closed === false, `close idempotente: 2º → {ok:true,closed:false} (${JSON.stringify(ok2)})`);
  srv.kill();
}

// Fase 3: revisão cavecrew — rematch com auth (1), allowlist estática (9), LEAVE (11).
{
  const port = 18093;
  const srv = startServer(port);
  await ready(port, srv);

  // 9. allowlist: jogo ok, resto 403 (sem vazar server/tests)
  check((await fetch(`http://127.0.0.1:${port}/`)).status === 200, 'estática: / → 200');
  check((await fetch(`http://127.0.0.1:${port}/client/main.js`)).status === 200, 'estática: /client/main.js → 200');
  check((await fetch(`http://127.0.0.1:${port}/shared/protocol.js`)).status === 200, 'estática: /shared/protocol.js → 200');
  check((await fetch(`http://127.0.0.1:${port}/server/room.js`)).status === 403, 'estática: /server/room.js → 403');
  check((await fetch(`http://127.0.0.1:${port}/package.json`)).status === 403, 'estática: /package.json → 403');
  check((await fetch(`http://127.0.0.1:${port}/__hub/state`)).status === 200, 'estática: /__hub/state segue 200');

  // 1. rematch com auth: não-host antes do fim é ignorado; host funciona
  const host = await connect(port, 'rm', 'host');
  const intr = await connect(port, 'rm', 'intr');
  check(typeof host.welcome.resumeToken === 'string' && host.welcome.resumeToken.length >= 8, 'welcome traz resumeToken (4)');
  await wait(400);
  intr.ws.send(JSON.stringify({ t: 'rematch' }));
  await wait(600);
  check(![...host.snaps, ...intr.snaps].some((m) => m.kind === 'rematch'), 'rematch de não-host antes do fim é ignorado (1)');
  host.ws.send(JSON.stringify({ t: 'rematch' }));
  await wait(600);
  check([...host.snaps, ...intr.snaps].some((m) => m.kind === 'rematch'), 'rematch do host funciona (1)');

  // 11. LEAVE libera a vaga na hora (sem fantasma 30s)
  intr.ws.send(JSON.stringify({ t: 'leave' }));
  intr.ws.close();
  await wait(600);
  check((await hubState(port)).rooms.find((r) => r.room === 'rm').players === 1, 'LEAVE libera vaga imediato (11)');
  host.ws.close();
  srv.kill();
  await wait(300);
}

// Fase 4: MATCH_LEN_S inválido cai p/ default e o server sobe (10).
{
  const port = 18094;
  const srv = startServer(port, { MATCH_LEN_S: 'banana' });
  await ready(port, srv);
  const st = await hubState(port);
  check(Array.isArray(st.rooms), 'MATCH_LEN_S=banana: server sobe (default 300) (10)');
  const c = await connect(port, 'zz', 'z', {});
  check(!!c.welcome.id, 'MATCH_LEN_S=banana: hello funciona (10)');
  c.ws.close();
  srv.kill();
  await wait(300);
}

// Fase 5: P1-10 start/ready/rematch (auth, lobby→playing) + P1-14 hub conta
// humanos (bots fora) + corpo multibyte conta bytes p/ o teto 413.
{
  const port = 18095;
  const srv = startServer(port, { HUB_SECRET: 's3cr3t' });
  await ready(port, srv);

  const host = await connect(port, 'lz', 'host');
  const p2 = await connect(port, 'lz', 'p2');
  p2.ws.send(JSON.stringify({ t: 'start' })); // não-host: ignorado
  await wait(400);
  let st = await hubState(port);
  check(st.rooms.find((r) => r.room === 'lz').state === 'lobby', 'start de não-host ignorado (P1-10)');
  p2.ws.send(JSON.stringify({ t: 'ready', v: 1 }));
  await wait(600);
  const snap = [...host.snaps, ...p2.snaps].filter((m) => m.t === 'snapshot').at(-1);
  check(snap && snap.ships.find((s) => s.id === p2.welcome.id)?.ready === true, 'ready aparece no snapshot (P1-10)');
  host.ws.send(JSON.stringify({ t: 'start' }));
  await wait(600);
  st = await hubState(port);
  check(st.rooms.find((r) => r.room === 'lz').state === 'playing', 'host inicia a partida (P1-10)');
  host.ws.send(JSON.stringify({ t: 'start' })); // 2º start: ignorado
  await wait(400);
  st = await hubState(port);
  check(st.rooms.find((r) => r.room === 'lz').state === 'playing', '2º start ignorado (P1-10)');

  const hs = await connect(port, 'sv', 'solo', { mode: 'survival' });
  hs.ws.send(JSON.stringify({ t: 'start' }));
  await wait(1200);
  st = await hubState(port);
  const sv = st.rooms.find((r) => r.room === 'sv');
  check(sv && sv.players === 1, `hub players exclui bots (players=${sv && sv.players}) (P1-14)`);

  const big = await fetch(`http://127.0.0.1:${port}/__hub/close`, {
    method: 'POST', headers: { 'x-hub-secret': 's3cr3t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: 'é'.repeat(5000) }), // 5000 chars, ~10k bytes > 8192
  });
  check(big.status === 413, `corpo multibyte > teto → 413 (${big.status}) (P1-14)`);

  for (const c of [host, p2, hs]) c.ws.close();
  srv.kill();
  await wait(300);
}

console.log(failures === 0 ? 'WS-CHECK OK' : `WS-CHECK ${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
