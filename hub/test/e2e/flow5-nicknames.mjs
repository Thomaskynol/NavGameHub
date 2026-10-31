// F5: apelido único no Hub inteiro (entre salas) + liberação após grace (20s).
import { HubClient, uniqNick, delay, waitOnline } from './e2e-helpers.mjs';

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f5] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

const nick = uniqNick('Unico');
const A = new HubClient(); await A.connect(); await A.hello(nick);
await waitOnline(A, 'arcade');
const roomA = await A.createRoom('arcade', 4);
console.log(`[f5] A=${nick} sala=${roomA.code}`);

// B tenta o mesmo nick (variação de caixa) em outra sala -> NICK_TAKEN.
const B = new HubClient(); await B.connect();
B.send({ t: 'hello', nick: nick.toLowerCase() });
{
  const m = await B.next((x) => x.t === 'hello_ok' || x.t === 'error', 8000);
  check('nick duplicado (outra sala, case-insensitive) rejeitado',
    m.t === 'error' && m.code === 'NICK_TAKEN', `-> ${m.t} ${m.code || ''}`);
}
// B com nick diferente entra em outra sala OK.
const nickB = uniqNick('Outro');
const helloB = await B.hello(nickB);
check('nick diferente aceito', !!helloB, nickB);
await B.createRoom('vava', 4);

// A desconecta de vez; após o grace (20s) o nick libera.
A.close();
console.log('[f5] A desconectado; aguardando grace de 20s...');
await delay(24000);
const C = new HubClient(); await C.connect();
try {
  await C.hello(nick);
  check('nick liberado após desconexão+grace', true);
} catch (e) {
  check('nick liberado após desconexão+grace', false, e.message);
}

for (const c of [B, C]) c.close();
console.log(pass ? '[f5] PASS' : '[f5] FAIL');
if (!pass) process.exitCode = 1;
