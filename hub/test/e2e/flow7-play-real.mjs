// F7: ações reais de jogo, sem hooks e sem jogar a partida até o fim.
// (A) Arcade: create/join/ready/start pelo protocolo normal do jogo e a
// simulação responde (countdown + snapshots `sn` com carros) — progresso real
// pelas regras normais, sem hook.
// (B) VAVA: create/join pelo protocolo normal, snapshots fluem, um `input` de
// movimento real desloca o jogador entre snapshots — física normal, sem hook.
// PROOF: play-real — evidência de jogabilidade real (ações + progresso pelas
// regras); NÃO é partida completa (o fim natural — corrida inteira, arena de
// 5min, Catan inteiro — é longo demais p/ a suíte; ver README).
import {
  gameWs, wsNext, uniqNick, delay, E2E, proofLine,
} from './e2e-helpers.mjs';

proofLine('f7', 'play-real', 'inputs reais; progresso pelas regras, sem hook e sem fim natural');

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f7] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

const conns = [];
function track(ws) { conns.push(ws); return ws; }
function send(ws, o) { ws.send(JSON.stringify(o)); }

function listen(ws) {
  const box = [];
  ws.on('message', (data) => {
    try { box.push(JSON.parse(data.toString())); } catch { /* ignora */ }
  });
  return box;
}

try {
  // ---------- Parte A: Arcade real ----------
  // Código de sala válido p/ o Arcade: 6 chars do alfabeto do jogo.
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let aCode = '';
  for (let i = 0; i < 6; i += 1) aCode += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  const wA = track(await gameWs(E2E.arcadePort));
  const boxA = listen(wA);
  send(wA, { t: 'create', name: uniqNick('PlA'), room: aCode });
  const joinedA = await wsNext(wA, (m) => m.t === 'joined', 8000);
  check('arcade create (protocolo real)', joinedA.room === aCode, `room=${joinedA.room}`);

  const wB = track(await gameWs(E2E.arcadePort));
  listen(wB);
  send(wB, { t: 'join', name: uniqNick('PlB'), room: aCode });
  await wsNext(wB, (m) => m.t === 'joined', 8000);
  check('arcade join (protocolo real)', true);

  send(wA, { t: 'set', ready: true });
  send(wB, { t: 'set', ready: true });
  await delay(500);
  send(wA, { t: 'start' });
  // Sem hook: a largada acontece pelas regras (2 prontos + host inicia).
  const cd = await wsNext(wA, (m) => m.t === 'state' && (m.status === 'countdown' || m.status === 'race'), 10000)
    .catch(() => null);
  check('arcade largada real (countdown/race)', !!cd, `status=${cd?.status}`);
  // Como o cliente real após carregar a cena: ambos avisam ready_load,
  // senão a corrida esperaria o timeout de carregamento (20s).
  send(wA, { t: 'ready_load' });
  send(wB, { t: 'ready_load' });
  const sn = await wsNext(wA, (m) => m.t === 'sn' && Array.isArray(m.cars) && m.cars.length >= 2, 15000)
    .catch(() => null);
  check('arcade snapshots reais da simulação (2 carros)', !!sn, sn ? `cars=${sn.cars.length}` : 'sem sn');
  const errRace = boxA.find((m) => m.t === 'err');
  check('arcade sem erro de protocolo', !errRace, errRace ? JSON.stringify(errRace).slice(0, 120) : '');

  // ---------- Parte B: VAVA real ----------
  const vA = track(await gameWs(E2E.vavaPort));
  send(vA, { t: 'create', name: uniqNick('VvA') });
  const jA = await wsNext(vA, (m) => m.t === 'joined', 8000);
  check('vava create (protocolo real)', !!jA.roomCode || !!jA.code, jA.roomCode || jA.code || '');
  const vCode = jA.roomCode || jA.code;

  const vB = track(await gameWs(E2E.vavaPort));
  send(vB, { t: 'join', name: uniqNick('VvB'), code: vCode });
  await wsNext(vB, (m) => m.t === 'joined', 8000);
  check('vava join (protocolo real)', true);

  const snaps = [];
  vA.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m.t === 'snapshot') snaps.push(m.snap);
    } catch { /* ignora */ }
  });
  await delay(1500);
  check('vava snapshots fluindo (simulação real)', snaps.length > 0, `n=${snaps.length}`);
  const me0 = snaps.length ? snaps[snaps.length - 1].you : null;

  // Input real de movimento (direita, bit 8) com seq crescente válida.
  for (let i = 1; i <= 10; i += 1) {
    send(vA, { t: 'input', input: { seq: i, move: 8, aim: 0, shoot: false, reload: false, dash: false, grenade: false } });
    await delay(120);
  }
  await delay(1200);
  const me1 = snaps.length ? snaps[snaps.length - 1].you : null;
  const moved = me0 && me1 && (Math.hypot(me1.x - me0.x, me1.y - me0.y) > 1);
  check('vava input real desloca o jogador', !!moved,
    me0 && me1 ? `(${me0.x.toFixed(0)},${me0.y.toFixed(0)})->(${me1.x.toFixed(0)},${me1.y.toFixed(0)})` : 'sem snapshots');
} catch (e) {
  console.error(`[f7] FAIL: ${e.message?.slice(0, 300)}`);
  pass = false;
} finally {
  for (const w of conns) { try { w.close(); } catch { /* ok */ } }
}
console.log(pass ? '[f7] PASS' : '[f7] FAIL');
if (!pass) process.exitCode = 1;
