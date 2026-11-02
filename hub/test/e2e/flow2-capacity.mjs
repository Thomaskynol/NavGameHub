// F2: regras de capacidade (servidor).
// PROOF: regras — validações de capacidade e corrida pela última vaga,
// sem hooks e sem partida (término pelas regras normais: erro esperado).
// 2a: capacity > game.max bloqueado (CAPACITY_GT_MAX). 2b: reduzir abaixo da
// ocupação bloqueado (CAPACITY_LT_OCCUPANCY). 2c: corrida pela última vaga.
import { HubClient, uniqNick, delay, waitOnline, proofLine } from './e2e-helpers.mjs';

proofLine('f2', 'regras', 'capacidade: limites e condição de corrida, sem partida');

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f2] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

const A = new HubClient();
await A.connect();
await A.hello(uniqNick('CapA'));
await waitOnline(A, 'arcade');

// 2a: arcade max=6; pedir 7 deve falhar.
A.send({ t: 'create_room', gameId: 'arcade', capacity: 7 });
{
  const m = await A.next((x) => x.t === 'room' || x.t === 'error', 8000);
  check('capacity>max bloqueado', m.t === 'error' && m.code === 'CAPACITY_GT_MAX', `-> ${m.t} ${m.code || ''}`);
}

// cria válida cap 3.
const room = await A.createRoom('arcade', 3);
const code = room.code;
console.log(`[f2] sala ${code} cap=3`);

// 2b: B e C entram (ocupação 3); tentar reduzir p/ 2 deve falhar.
const B = new HubClient();
await B.connect();
await B.hello(uniqNick('CapB'));
await B.joinRoom(code);
const C = new HubClient();
await C.connect();
await C.hello(uniqNick('CapC'));
await C.joinRoom(code);
A.send({ t: 'set_capacity', capacity: 2 });
{
  const m = await A.next((x) => (x.t === 'room' && x.room.capacity !== 3) || x.t === 'error', 8000);
  check('reduzir abaixo da ocupação bloqueado', m.t === 'error' && m.code === 'CAPACITY_LT_OCCUPANCY', `-> ${m.t} ${m.code || m.room?.capacity}`);
}
// capacidade válida (3->3 ou 3->4) funciona e reseta prontidão (só checa aceite).
A.send({ t: 'set_capacity', capacity: 4 });
{
  const m = await A.next((x) => (x.t === 'room' && x.room.capacity === 4) || x.t === 'error', 8000);
  check('aumentar capacidade ok', m.t === 'room', `-> ${m.t} ${m.code || ''}`);
}
// volta p/ 3 p/ corrida de 1 vaga (ocupação 3, cap 3 -> zero vagas? não: corrida precisa de vaga).
// Sai C -> ocupação 2, cap 3 -> 1 vaga.
C.send({ t: 'leave_room' });
await A.waitRoom((r) => r.members.length === 2, 8000);
A.send({ t: 'set_capacity', capacity: 2 }); // hmm ocupação=2, cap 2 -> zero vaga; usar cap 3.
A.send({ t: 'set_capacity', capacity: 3 });
await A.waitRoom((r) => r.capacity === 3, 8000);

// 2c: 5 clientes disputam a última vaga ao mesmo tempo.
const racers = [];
for (let i = 0; i < 5; i += 1) {
  const c = new HubClient();
  await c.connect();
  await c.hello(uniqNick(`Rac${i}`));
  c.send({ t: 'join_room', code });
  racers.push(c);
}
const results = await Promise.all(racers.map((c) =>
  c.next((x) => (x.t === 'room' && x.room.code === code) || x.t === 'error', 8000)
    .then((m) => ({ ok: m.t === 'room', code: m.code }))
    .catch(() => ({ ok: false, code: 'TIMEOUT' })),
));
await delay(800);
const wins = results.filter((r) => r.ok).length;
const last = A.lastRoom();
console.log(`[f2] corrida: ${wins} êxitos em 5; ocupação final=${last.members.length} cap=${last.capacity}`);
check('exatamente 1 vence a última vaga', wins === 1, JSON.stringify(results.map((r) => r.code || 'ok')));
check('ocupação nunca excede capacidade', last.members.length <= last.capacity, `${last.members.length}<=${last.capacity}`);

for (const c of [A, B, C, ...racers]) c.close();
console.log(pass ? '[f2] PASS' : '[f2] FAIL');
if (!pass) process.exitCode = 1;
