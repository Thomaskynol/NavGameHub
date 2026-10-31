// F6: Catan (min 3) — criar/entrar/prontos/iniciar via Hub, win via hook, retorno.
// Lado do jogo via socket.io (mesmo protocolo do cliente Catan).
// PROOF: hooks — o fim (win) é forçado via hook; criação/entrada/ready/start
// seguem o protocolo normal do jogo (não é partida jogada até o fim).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
  HubClient, hubPost, gameCodeOf, uniqNick, waitOnline,
  E2E, REPO_ROOT, proofLine,
} from './e2e-helpers.mjs';

proofLine('f6', 'hooks', 'protocolo Catan real; win forçado por hook');

const requireCatan = createRequire(pathToFileURL(join(REPO_ROOT, 'Games', 'Catan', 'package.json')));
const { io } = requireCatan('socket.io-client');

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f6] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

let ridSeq = 0;
function lobby(socket, payload) {
  return new Promise((resolve) => {
    ridSeq += 1;
    socket.emit('lobby', { requestId: `e2e-${ridSeq}`, payload }, (res) => resolve(res));
  });
}
function catanConnect() {
  return new Promise((resolve, reject) => {
    const s = io(E2E.gameBase(E2E.catanPort), { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const nicks = [uniqNick('CatA'), uniqNick('CatB'), uniqNick('CatC')];
const hub = [];
for (const n of nicks) {
  const c = new HubClient();
  await c.connect();
  await c.hello(n);
  hub.push(c);
}
await waitOnline(hub[0], 'catan');
const room = await hub[0].createRoom('catan', 4);
console.log(`[f6] sala Hub ${room.code} catan cap=4`);
await hub[1].joinRoom(room.code);
await hub[2].joinRoom(room.code);

await hub[0].setReady(true);
await hub[1].setReady(true);
const playP = hub[0].waitPlay(1);
await hub[2].setReady(true);
const gameCode = gameCodeOf(await playP);
console.log(`[f6] launching gameCode=${gameCode} (len ${gameCode?.length})`);
check('game code catan tem 6 chars', gameCode && gameCode.length === 6);

// Lado do jogo: create_room com roomCode do Hub + joins + ready + start.
const g = [];
for (const n of nicks) g.push(await catanConnect());
let res = await lobby(g[0], { type: 'create_room', nickname: nicks[0], roomCode: gameCode });
check('catan create_room com roomCode do Hub', res.ok === true, JSON.stringify(res).slice(0, 160));
for (let i = 1; i < 3; i += 1) {
  res = await lobby(g[i], { type: 'join_room', code: gameCode, nickname: nicks[i] });
  check(`catan join ${nicks[i]}`, res.ok === true, res.ok ? '' : JSON.stringify(res).slice(0, 160));
}
for (let i = 0; i < 3; i += 1) {
  res = await lobby(g[i], { type: 'set_ready', ready: true });
  if (!res.ok) check(`catan ready ${i}`, false, JSON.stringify(res).slice(0, 160));
}
res = await lobby(g[0], { type: 'start_game', boardSeed: 'e2e-hub' });
check('catan start_game', res.ok === true, res.ok ? '' : JSON.stringify(res).slice(0, 200));

const plays = await Promise.all([hub[1].waitPlay(0), hub[2].waitPlay(0)]);
const codes = plays.map(gameCodeOf);
check('todos recebem o mesmo game code', codes.every((c) => c === gameCode), codes.join(','));
const playing = await hub[0].waitRoom((r) => r.phase === 'playing', 15000);
check('Hub playing', playing.room.phase === 'playing');

const win = await hubPost(E2E.catanPort, '/__hub/test/win', gameCode);
check('hook win catan', win.status === 200, `${win.status} ${JSON.stringify(win.body)}`);
await hub[0].waitRoom((r) => r.phase === 'finished', 15000);
check('Hub finished', true);
const backs = await Promise.all(hub.map((c) => c.waitRoom((r) => r.phase === 'lobby', 30000)));
check('3 clientes retornam à mesma sala', backs.every((b) => b.room.code === room.code),
  backs.map((b) => b.room.code).join(','));
const reset = backs[0].room.members.every((m) => m.ready === false) && backs[0].room.match === null;
check('prontidão resetada pós-graça (não é mensagem velha)', reset,
  backs[0].room.members.map((m) => `${m.nick}:${m.ready}`).join(','));

for (const c of hub) c.close();
for (const s of g) s.disconnect();
console.log(pass ? '[f6] PASS' : '[f6] FAIL');
if (!pass) process.exitCode = 1;
