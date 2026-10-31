// F1: Arcade 2 clientes — criar, entrar (código), prontos, mesmo game code, finish, retorno.
// PROOF: hooks — o fim da corrida é forçado via hook (não é partida jogada).
import {
  HubClient, gameWs, wsNext, hubPost, gameCodeOf, htokOf, uniqNick, delay, waitOnline,
  E2E, proofLine,
} from './e2e-helpers.mjs';

proofLine('f1', 'hooks', 'transições Hub<->jogo; fim forçado por hook');

const nickA = uniqNick('ArqA');
const nickB = uniqNick('ArqB');
const A = new HubClient();
const B = new HubClient();
let arcadeA = null;
let arcadeB = null;

try {
  await A.connect();
  await A.hello(nickA);
await waitOnline(A, 'arcade');
  await B.connect();
  await B.hello(nickB);

  // A cria sala arcade (cap 2).
  const room = await A.createRoom('arcade', 2);
  const hubCode = room.code;
  console.log(`[f1] sala Hub criada: ${hubCode} jogo=${room.gameId} cap=${room.capacity}`);

  // Catálogo de B lista a sala (entrada "via lista" = mesmo join_room por código).
  await delay(500);
  const cat = B.lastCatalog();
  const listed = cat && cat.rooms.some((r) => r.code === hubCode);
  console.log(`[f1] sala aparece no catálogo de B: ${listed}`);
  if (!listed) throw new Error('sala não listada no catálogo');

  // B entra pelo código.
  const roomB = await B.joinRoom(hubCode);
  console.log(`[f1] B entrou: ocupação=${roomB.members.length}`);

  // Ambos prontos -> launching; criador (A) recebe play create=1.
  await A.setReady(true);
  const playAPromise = A.waitPlay(1);
  await B.setReady(true);
  const playA = await playAPromise;
  const gameCode = gameCodeOf(playA);
  const htok = htokOf(playA);
  console.log(`[f1] launching: gameCode=${gameCode} (A create=1)`);
  if (!gameCode || gameCode.length !== 6) throw new Error('game code inválido');

  // Lado do jogo: A cria a sala no Arcade com o código do Hub; B entra.
  // O htok do launch vai junto (como o cliente real ?hub=1&htok=): sem ele
  // a sala nasce sem dono e o Hub a trata como CONFLITO.
  arcadeA = await gameWs(E2E.arcadePort);
  arcadeA.send(JSON.stringify({ t: 'create', name: nickA, room: gameCode, htok }));
  await wsNext(arcadeA, (m) => m.t === 'joined');
  console.log('[f1] sala criada no Arcade (lado jogo)');

  // Hub detecta -> playing; B recebe play create=0 com o MESMO código.
  const playBPromise = B.waitPlay(0);
  const roomPlaying = await A.waitRoom((r) => r.phase === 'playing', 15000);
  const playB = await playBPromise;
  const gameCodeB = gameCodeOf(playB);
  console.log(`[f1] playing: B create=0 gameCode=${gameCodeB}`);
  if (gameCodeB !== gameCode) throw new Error('game codes divergentes entre A e B');

  arcadeB = await gameWs(E2E.arcadePort);
  arcadeB.send(JSON.stringify({ t: 'join', name: nickB, room: gameCode, htok }));
  await wsNext(arcadeB, (m) => m.t === 'joined');
  console.log('[f1] B entrou na sala do Arcade (lado jogo)');

  // Force-finish via hook -> Hub finished -> graça (15s) -> lobby.
  const fin = await hubPost(E2E.arcadePort, '/__hub/test/finish', gameCode);
  console.log(`[f1] hook finish: ${fin.status} ${JSON.stringify(fin.body)}`);
  if (fin.status !== 200) throw new Error('hook finish falhou (HUB_TEST_HOOKS?)');

  const finished = await A.waitRoom((r) => r.phase === 'finished', 15000);
  console.log(`[f1] Hub phase=finished (match ${finished.room.match?.gameCode})`);
  await B.waitRoom((r) => r.phase === 'finished', 15000);

  const pBackA = A.waitRoom((r) => r.phase === 'lobby', 30000);
  const pBackB = B.waitRoom((r) => r.phase === 'lobby', 30000);
  const backA = await pBackA;
  const backB = await pBackB;
  console.log(`[f1] retorno ao lobby: A sala=${backA.room.code} membros=${backA.room.members.length} | B sala=${backB.room.code}`);
  if (backA.room.code !== hubCode || backB.room.code !== hubCode) {
    throw new Error('não retornaram à mesma sala do Hub');
  }
  // Pós-graça de verdade: prontidão resetada (mensagem velha teria ready=true).
  const allUnready = [...backA.room.members, ...backB.room.members]
    .every((m) => m.ready === false);
  console.log(`[f1] prontidão resetada pós-graça: ${allUnready} match=${backA.room.match}`);
  if (!allUnready || backA.room.match !== null) throw new Error('lobby não é o retorno pós-graça');
  const roles = backB.room.members.map((m) => `${m.nick}:${m.role}`).join(',');
  console.log(`[f1] papéis pós-retorno: ${roles}`);
  console.log('[f1] PASS');
} catch (e) {
  console.error(`[f1] FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  try { arcadeA && arcadeA.close(); } catch { /* ok */ }
  try { arcadeB && arcadeB.close(); } catch { /* ok */ }
  A.close();
  B.close();
}
