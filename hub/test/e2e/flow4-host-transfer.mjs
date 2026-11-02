// F4: anfitrião sai -> outro assume; último a sair remove a sala da lista.
// PROOF: regras — transferência de anfitrião e limpeza pelas regras normais.
import { HubClient, uniqNick, delay, waitOnline, proofLine } from './e2e-helpers.mjs';

proofLine('f4', 'regras', 'host-transfer e remoção de sala vazia');

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f4] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

const nickA = uniqNick('HostA');
const nickB = uniqNick('HostB');
const A = new HubClient(); await A.connect(); await A.hello(nickA);
await waitOnline(A, 'arcade');
const B = new HubClient(); await B.connect(); await B.hello(nickB);
const W = new HubClient(); await W.connect(); await W.hello(uniqNick('Watch'));

const room = await A.createRoom('arcade', 4);
await B.joinRoom(room.code);
await delay(400);
let view = A.lastRoom();
check('A é anfitrião', view.members.find((m) => m.nick === nickA)?.isHost === true);

// A sai -> B assume.
A.send({ t: 'leave_room' });
await B.waitRoom((r) => r.members.length === 1 && r.members[0].isHost, 8000);
view = B.lastRoom();
check('B virou anfitrião', view.members[0].nick === nickB && view.hostId === view.members[0].id);

// Sala segue listada com novo host.
await delay(500);
let cat = W.lastCatalog();
check('sala segue na lista', cat.rooms.some((r) => r.code === room.code));

// B sai (último) -> sala some da lista.
B.send({ t: 'leave_room' });
await delay(1200);
cat = W.lastCatalog();
check('sala vazia removida da lista', !cat.rooms.some((r) => r.code === room.code),
  `salas=${cat.rooms.map((r) => r.code).join(',') || '(vazia)'}`);

for (const c of [A, B, W]) c.close();
console.log(pass ? '[f4] PASS' : '[f4] FAIL');
if (!pass) process.exitCode = 1;
