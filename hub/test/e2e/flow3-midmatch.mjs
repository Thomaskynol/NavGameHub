// F3: mid-match. (A) Arcade sem mid-match: quem entra com partida em andamento
// espera no Hub (role waiting, sem play). (B) Duas salas VAVA isoladas.
// PROOF: hooks — os fins de partida são forçados via hook (o isolamento entre
// salas é verificado pelas regras normais do servidor, sem hook).
import {
  HubClient, gameWs, wsNext, hubPost, hubState, gameCodeOf, htokOf, uniqNick, delay, waitOnline,
  E2E, proofLine,
} from './e2e-helpers.mjs';

proofLine('f3', 'hooks', 'waiting/isolamento; fins forçados por hook');

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f3] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}
const gameConns = [];
function track(ws) { gameConns.push(ws); return ws; }

// ---------- Parte A: Arcade ----------
// Contrato R5: entrada tardia com o jogo ainda no pregame (lobby+joinable)
// entra como player (com play); só vira waiting se a partida já começou.
const A = new HubClient('A'); await A.connect(); await A.hello(uniqNick('MidA'));
await waitOnline(A, 'arcade');
const B = new HubClient('B'); await B.connect(); await B.hello(uniqNick('MidB'));
let room = await A.createRoom('arcade', 4);
await B.joinRoom(room.code);
await A.setReady(true);
const playAP = A.waitPlay(1);
await B.setReady(true);
const playA = await playAP;
const gameCode = gameCodeOf(playA);
const htok = htokOf(playA);
const gA = track(await gameWs(E2E.arcadePort));
gA.send(JSON.stringify({ t: 'create', name: 'MidA', room: gameCode, htok }));
await wsNext(gA, (m) => m.t === 'joined');
const playBPromise = B.waitPlay(0);
const roomPlaying = await A.waitRoom((r) => r.phase === 'playing', 15000);
const playB = await playBPromise;
const gB = track(await gameWs(E2E.arcadePort));
gB.send(JSON.stringify({ t: 'join', name: 'MidB', room: gameCode, htok }));
await wsNext(gB, (m) => m.t === 'joined');
console.log(`[f3] arcade playing gameCode=${gameCode}`);

// Caso 1 — jogo ainda no lobby: late joiner entra (player + play), de verdade.
const L = new HubClient('L'); await L.connect(); await L.hello(uniqNick('MidL'));
const playLP = L.waitPlay(0, 20000);
const roomL = await L.joinRoom(room.code);
check('late joiner no pregame começa como waiting', roomL.members.find((m) => m.nick.startsWith('MidL'))?.role === 'waiting');
const playL = await playLP;
check('late joiner no pregame é promovido (recebe play)', gameCodeOf(playL) === gameCode, `gameCode=${gameCodeOf(playL)}`);
const gL = track(await gameWs(E2E.arcadePort));
gL.send(JSON.stringify({ t: 'join', name: 'MidL', room: gameCode, htok }));
await wsNext(gL, (m) => m.t === 'joined');
check('late joiner entra de verdade na sala do jogo', true);

// Caso 2 — corrida em andamento: quem chega agora espera (waiting, sem play).
gA.send(JSON.stringify({ t: 'set', ready: true }));
gB.send(JSON.stringify({ t: 'set', ready: true }));
gL.send(JSON.stringify({ t: 'set', ready: true }));
await delay(400);
gA.send(JSON.stringify({ t: 'start' }));
console.log('[f3] corrida iniciada no jogo');
// Aguarda o Hub observar o estado (poll): phase=playing + joinable=false.
{
  const t0 = Date.now();
  let st = null;
  for (;;) {
    st = await hubState(E2E.arcadePort, gameCode);
    if (st.body?.room?.phase === 'playing' && st.body?.room?.joinable === false) break;
    if (Date.now() - t0 > 15000) break;
    await delay(500);
  }
  check('jogo saiu do lobby (corrida em andamento)', st.body?.room?.phase === 'playing',
    `phase=${st.body?.room?.phase} joinable=${st.body?.room?.joinable}`);
  await delay(2500); // margem p/ o poll do Hub enxergar o mesmo estado
}
const M = new HubClient('M'); await M.connect(); await M.hello(uniqNick('MidM'));
const roomM = await M.joinRoom(room.code);
const selfM = roomM.members.find((m) => m.nick.startsWith('MidM'));
check('late joiner com corrida em andamento vira waiting', selfM && selfM.role === 'waiting', `role=${selfM?.role}`);
let gotPlay = false;
try {
  await M.waitPlay(0, 3000);
  gotPlay = true;
} catch { /* esperado */ }
check('late joiner com corrida em andamento NÃO recebe play', !gotPlay);
const occ = M.lastRoom();
check('quem espera ocupa vaga', occ.members.length === 4, `ocupação=${occ.members.length}`);

// Encerra: todos voltam ao lobby e L/M viram player.
const fin = await hubPost(E2E.arcadePort, '/__hub/test/finish', gameCode);
check('hook finish arcade', fin.status === 200, `${fin.status}`);
// Registra as esperas juntas: o broadcast chega quase ao mesmo tempo.
const pBackL = L.waitRoom((r) => r.phase === 'lobby', 30000);
const pBackM = M.waitRoom((r) => r.phase === 'lobby', 30000);
const pBackA = A.waitRoom((r) => r.phase === 'lobby', 30000);
const pBackB = B.waitRoom((r) => r.phase === 'lobby', 30000);
const backL = await pBackL;
const backM = await pBackM;
const selfBackL = backL.room.members.find((m) => m.nick.startsWith('MidL'));
const selfBackM = backM.room.members.find((m) => m.nick.startsWith('MidM'));
check('após fim, waiting vira player no lobby', selfBackL?.role === 'player' && selfBackM?.role === 'player',
  `roles=${selfBackL?.role},${selfBackM?.role}`);
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
  const play = await pp;
  const gc = gameCodeOf(play);
  const ghtok = htokOf(play);
  const w1 = track(await gameWs(E2E.vavaPort));
  w1.send(JSON.stringify({ t: 'create', name: nickBase + '1', code: gc, htok: ghtok }));
  await wsNext(w1, (m) => m.t === 'snapshot' || m.t === 'joined' || m.t === 'state', 8000).catch(() => null);
  await h1.waitRoom((x) => x.phase === 'playing', 15000);
  const w2 = track(await gameWs(E2E.vavaPort));
  w2.send(JSON.stringify({ t: 'join', name: nickBase + '2', code: gc, htok: ghtok }));
  return { h1, h2, hubCode: r.code, gameCode: gc };
}
const V1 = await vavaRoom('VavA');
const V2 = await vavaRoom('VavB');
console.log(`[f3] vava salas: Hub ${V1.hubCode}->jogo ${V1.gameCode} | Hub ${V2.hubCode}->jogo ${V2.gameCode}`);
check('salas VAVA têm códigos de jogo distintos', V1.gameCode !== V2.gameCode, `${V1.gameCode} vs ${V2.gameCode}`);
await delay(1000);
const s1 = await hubState(E2E.vavaPort, V1.gameCode);
const s2 = await hubState(E2E.vavaPort, V2.gameCode);
check('snapshots independentes (2 jogadores cada)', s1.body?.room?.players === 2 && s2.body?.room?.players === 2,
  `p1=${s1.body?.room?.players} p2=${s2.body?.room?.players}`);

// Encerra só V1; V2 segue jogando.
const end1 = await hubPost(E2E.vavaPort, '/__hub/test/end', V1.gameCode);
check('hook end vava V1', end1.status === 200, `${end1.status}`);
await V1.h1.waitRoom((r) => r.phase === 'lobby', 25000);
await delay(2000);
const still = await hubState(E2E.vavaPort, V2.gameCode);
check('V2 não afetada pelo fim de V1', still.body?.room?.phase !== 'results' && still.status === 200,
  `phase=${still.body?.room?.phase}`);
const v2hub = V2.h2.lastRoom();
check('Hub V2 segue playing', v2hub && v2hub.phase === 'playing', `phase=${v2hub?.phase}`);

for (const c of [A, B, L, M, V1.h1, V1.h2, V2.h1, V2.h2]) c.close();
for (const w of gameConns) { try { w.close(); } catch { /* ok */ } }
console.log(pass ? '[f3] PASS' : '[f3] FAIL');
if (!pass) process.exitCode = 1;
