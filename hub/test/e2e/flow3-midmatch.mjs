// F3: mid-match. (A) Arcade sem mid-match: quem entra com partida em andamento
// espera no Hub (role waiting, sem play). (B) Duas salas VAVA isoladas.
import {
  HubClient, gameWs, wsNext, hubPost, hubState, gameCodeOf, uniqNick, delay, waitOnline,
} from './e2e-helpers.mjs';

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f3] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}
const gameConns = [];
function track(ws) { gameConns.push(ws); return ws; }

// ---------- Parte A: Arcade ----------
const A = new HubClient('A'); await A.connect(); await A.hello(uniqNick('MidA'));
await waitOnline(A, 'arcade');
const B = new HubClient('B'); await B.connect(); await B.hello(uniqNick('MidB'));
let room = await A.createRoom('arcade', 3);
await B.joinRoom(room.code);
await A.setReady(true);
const playAP = A.waitPlay(1);
await B.setReady(true);
const gameCode = gameCodeOf(await playAP);
const gA = track(await gameWs(8091));
gA.send(JSON.stringify({ t: 'create', name: 'MidA', room: gameCode }));
await wsNext(gA, (m) => m.t === 'joined');
const playBPromise = B.waitPlay(0);
const roomPlaying = await A.waitRoom((r) => r.phase === 'playing', 15000);
const playB = await playBPromise;
const gB = track(await gameWs(8091));
gB.send(JSON.stringify({ t: 'join', name: 'MidB', room: gameCode }));
await wsNext(gB, (m) => m.t === 'joined');
console.log(`[f3] arcade playing gameCode=${gameCode}`);

// Late joiner L entra na sala do Hub com partida em andamento.
const L = new HubClient('L'); await L.connect(); await L.hello(uniqNick('MidL'));
const roomL = await L.joinRoom(room.code);
const selfL = roomL.members.find((m) => m.nick.startsWith('MidL'));
check('late joiner arcade vira waiting', selfL && selfL.role === 'waiting', `role=${selfL?.role}`);
let gotPlay = false;
try {
  await L.waitPlay(0, 3000);
  gotPlay = true;
} catch { /* esperado */ }
check('late joiner arcade NÃO recebe play', !gotPlay);
const occ = L.lastRoom();
check('quem espera ocupa vaga', occ.members.length === 3, `ocupação=${occ.members.length}`);

// Encerra: todos voltam ao lobby e L vira player.
const fin = await hubPost(8091, '/__hub/test/finish', gameCode);
check('hook finish arcade', fin.status === 200, `${fin.status}`);
// Registra as três esperas juntas: o broadcast chega quase ao mesmo tempo.
const pBackL = L.waitRoom((r) => r.phase === 'lobby', 30000);
const pBackA = A.waitRoom((r) => r.phase === 'lobby', 30000);
const pBackB = B.waitRoom((r) => r.phase === 'lobby', 30000);
const backL = await pBackL;
const selfBack = backL.room.members.find((m) => m.nick.startsWith('MidL'));
check('após fim, waiting vira player no lobby', selfBack && selfBack.role === 'player', `role=${selfBack?.role}`);
const backA = await pBackA;
const backB = await pBackB;
check('A e B também retornaram', backA.room.code === room.code && backB.room.code === room.code);

// ---------- Parte B: duas salas VAVA isoladas ----------
async function vavaRoom(nickBase) {
  const h1 = new HubClient('h1'); await h1.connect(); await h1.hello(uniqNick(nickBase + '1'));
  const h2 = new HubClient('h2'); await h2.connect(); await h2.hello(uniqNick(nickBase + '2'));
  const r = await h1.createRoom('vava', 4);
  await h2.joinRoom(r.code);
  await h1.setReady(true);
  const pp = h1.waitPlay(1);
  await h2.setReady(true);
  const gc = gameCodeOf(await pp);
  const w1 = track(await gameWs(8092));
  w1.send(JSON.stringify({ t: 'create', name: nickBase + '1', code: gc }));
  await wsNext(w1, (m) => m.t === 'snapshot' || m.t === 'joined' || m.t === 'state', 8000).catch(() => null);
  await h1.waitRoom((x) => x.phase === 'playing', 15000);
  const w2 = track(await gameWs(8092));
  w2.send(JSON.stringify({ t: 'join', name: nickBase + '2', code: gc }));
  return { h1, h2, hubCode: r.code, gameCode: gc };
}
const V1 = await vavaRoom('VavA');
const V2 = await vavaRoom('VavB');
console.log(`[f3] vava salas: Hub ${V1.hubCode}->jogo ${V1.gameCode} | Hub ${V2.hubCode}->jogo ${V2.gameCode}`);
check('salas VAVA têm códigos de jogo distintos', V1.gameCode !== V2.gameCode, `${V1.gameCode} vs ${V2.gameCode}`);
await delay(1000);
const s1 = await hubState(8092, V1.gameCode);
const s2 = await hubState(8092, V2.gameCode);
check('snapshots independentes (2 jogadores cada)', s1.body?.room?.players === 2 && s2.body?.room?.players === 2,
  `p1=${s1.body?.room?.players} p2=${s2.body?.room?.players}`);

// Encerra só V1; V2 segue jogando.
const end1 = await hubPost(8092, '/__hub/test/end', V1.gameCode);
check('hook end vava V1', end1.status === 200, `${end1.status}`);
await V1.h1.waitRoom((r) => r.phase === 'lobby', 25000);
await delay(2000);
const still = await hubState(8092, V2.gameCode);
check('V2 não afetada pelo fim de V1', still.body?.room?.phase !== 'results' && still.status === 200,
  `phase=${still.body?.room?.phase}`);
const v2hub = V2.h2.lastRoom();
check('Hub V2 segue playing', v2hub && v2hub.phase === 'playing', `phase=${v2hub?.phase}`);

for (const c of [A, B, L, V1.h1, V1.h2, V2.h1, V2.h2]) c.close();
for (const w of gameConns) { try { w.close(); } catch { /* ok */ } }
console.log(pass ? '[f3] PASS' : '[f3] FAIL');
if (!pass) process.exitCode = 1;
