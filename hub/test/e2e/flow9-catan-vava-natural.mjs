// F9: progressão NATURAL de Catan e VAVA (sem hooks, sem fixture).
// (C) Catan: tabuleiro ALEATÓRIO do servidor (sem boardSeed — seed/fixture
// NÃO é natural), setup completo droveado por geometria fixa da ilha (forma
// pública e determinística — os recursos/dados continuam aleatórios), dados
// rolados e turnos avançados de verdade via protocolo socket.io.
// (V) VAVA: 2 jogadores trocam inputs reais por ~70s (movimento+tiro),
// atravessam a rodada de cartas dos 60s (cardSelection → chooseCard reais) e
// a partida segue — relógio (timeLeft) como evidência.
// NÃO COBERTO aqui (declarado): Catan até game_over (10 PV exigem dezenas de
// turnos, trocas, dev cards — inviável na suíte) e VAVA até 'ended' (300s —
// longo demais); as transições Hub desses fins seguem cobertas por hooks
// (f6/cb p/ Catan, ui-smoke/flow3 p/ VAVA).
// PROOF: play-real — ações e progresso pelas regras normais, sem hook, mas
// SEM fim natural (ver README).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
  gameWs, wsNext, uniqNick, delay, E2E, REPO_ROOT, proofLine,
} from './e2e-helpers.mjs';

proofLine('f9', 'play-real', 'Catan setup+turnos e VAVA 70s+carta, tudo real sem hook; fins naturais declarados abaixo');

const requireCatan = createRequire(pathToFileURL(join(REPO_ROOT, 'Games', 'Catan', 'package.json')));
const { io } = requireCatan('socket.io-client');

let pass = true;
function check(name, cond, extra = '') {
  console.log(`[f9] ${cond ? 'ok' : 'FALHOU'}: ${name} ${extra}`);
  if (!cond) pass = false;
}

// ---------- geometria fixa da ilha (raio 2; forma pública, não fixture) ----------
const DIRS = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
const vid = (c) => `${c[0]}:${c[1]}:${c[2]}`;
function buildIsland() {
  const hexes = [];
  for (let q = -2; q <= 2; q += 1) for (let r = -2; r <= 2; r += 1) {
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2) hexes.push([q, -q - r, r]);
  }
  const verts = new Set(); const edges = new Set(); const ends = {}; const vEdges = {};
  const corner = (h, i) => {
    const a = DIRS[i]; const b = DIRS[(i + 1) % 6];
    return [3 * h[0] + a[0] + b[0], 3 * h[1] + a[1] + b[1], 3 * h[2] + a[2] + b[2]];
  };
  for (const h of hexes) {
    const cs = []; for (let i = 0; i < 6; i += 1) cs.push(vid(corner(h, i)));
    for (let i = 0; i < 6; i += 1) {
      const v1 = cs[i]; const v2 = cs[(i + 1) % 6];
      verts.add(v1); verts.add(v2);
      const e = v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`;
      edges.add(e);
      ends[e] = v1 < v2 ? [v1, v2] : [v2, v1];
      for (const v of [v1, v2]) { (vEdges[v] = vEdges[v] || []).push(e); }
    }
  }
  for (const v of Object.keys(vEdges)) vEdges[v] = [...new Set(vEdges[v])];
  return { verts: [...verts], ends, vEdges };
}
const ISLAND = buildIsland();

let rid = 0;
const ridOf = () => `f9-${Date.now().toString(36)}-${(rid += 1)}`;
function lobbyAck(s, payload) {
  return new Promise((resolve, reject) => {
    s.emit('lobby', { requestId: ridOf(), payload }, (res) => resolve(res));
    setTimeout(() => reject(new Error('timeout lobby ack')), 10000);
  });
}
function cmdAck(s, payload, baseVersion) {
  return new Promise((resolve, reject) => {
    s.emit('cmd', { requestId: ridOf(), baseVersion, payload }, (res) => resolve(res));
    setTimeout(() => reject(new Error('timeout cmd ack')), 10000);
  });
}
function catanConnect() {
  return new Promise((resolve, reject) => {
    const s = io(E2E.gameBase(E2E.catanPort), { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
async function waitView(get, pred, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = get();
    if (v && pred(v)) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout esperando GameView');
    await delay(150);
  }
}

const conns = [];
try {
  // ================= (C) CATAN NATURAL =================
  const nicks = [uniqNick('NatC'), uniqNick('NatC'), uniqNick('NatC')];
  const g = [];
  for (const n of nicks) {
    const s = await catanConnect();
    conns.push(s);
    g.push(s);
  }
  let latest = [null, null, null];
  g.forEach((s, i) => s.on('state', (v) => { latest[i] = v; }));

  // Tabuleiro ALEATÓRIO do servidor: sem roomCode pedido e sem boardSeed.
  let res = await lobbyAck(g[0], { type: 'create_room', nickname: nicks[0] });
  check('catan create_room natural (sem fixture)', res.ok === true, JSON.stringify(res).slice(0, 120));
  const sess0 = res.session;
  const roomCode = sess0.roomCode;
  for (let i = 1; i < 3; i += 1) {
    res = await lobbyAck(g[i], { type: 'join_room', code: roomCode, nickname: nicks[i] });
    check(`catan join natural ${nicks[i]}`, res.ok === true, res.ok ? '' : JSON.stringify(res).slice(0, 120));
  }
  const pids = [sess0.playerId];
  // playerIds dos demais vêm nas próximas views; por ora usa índice do socket.
  for (let i = 0; i < 3; i += 1) {
    res = await lobbyAck(g[i], { type: 'set_ready', ready: true });
    if (!res.ok) check(`catan ready ${i}`, false, JSON.stringify(res).slice(0, 120));
  }
  res = await lobbyAck(g[0], { type: 'start_game' }); // SEM boardSeed: mesa aleatória
  check('catan start_game natural (sem seed)', res.ok === true, res.ok ? '' : JSON.stringify(res).slice(0, 200));

  let view = await waitView(() => latest[0], (v) => v.phase === 'setup_settlement', 15000);
  check('setup iniciado (fase real)', true, `seed=${view.board.seed}`);
  console.log(`[f9] catan board.seed do servidor (aleatória, não fixture): ${view.board.seed}`);
  // Descobre os sockets pela ordem dos jogadores na view (create + joins em ordem).
  const sockOf = (pid) => {
    const idx = view.players.findIndex((p) => p.id === pid);
    return idx >= 0 ? g[idx] : null;
  };

  // Setup snake: 6 assentamentos + 6 estradas, posições legais de verdade.
  let setupOk = true;
  for (let step = 0; step < 12; step += 1) {
    view = await waitView(() => latest[0], (v) => v.phase === 'setup_settlement' || v.phase === 'setup_road' || (v.phase !== 'setup_settlement' && v.phase !== 'setup_road' && step > 0), 15000);
    if (view.phase !== 'setup_settlement' && view.phase !== 'setup_road') break;
    const cur = view.setupCurrentPlayerId;
    const s = sockOf(cur);
    if (!s) { setupOk = false; console.log('[f9] setup: jogador corrente sem socket'); break; }
    if (view.phase === 'setup_settlement') {
      const taken = new Set(view.board.buildings.map((b) => b.vertexId));
      const blocked = new Set(taken);
      for (const t of taken) for (const e of (ISLAND.vEdges[t] || [])) for (const v of ISLAND.ends[e]) blocked.add(v);
      const pick = ISLAND.verts.find((v) => !blocked.has(v));
      if (!pick) { setupOk = false; console.log('[f9] setup: sem vértice livre'); break; }
      res = await cmdAck(s, { type: 'setup_settlement', vertexId: pick }, view.version);
      if (!res.ok) { setupOk = false; console.log(`[f9] setup_settlement recusado: ${JSON.stringify(res).slice(0, 160)}`); break; }
    } else {
      const last = view.setupLastSettlementVertex;
      const opts = (ISLAND.vEdges[last] || []).filter((e) => !view.board.roads.some((r) => r.edgeId === e));
      if (!opts.length) { setupOk = false; console.log('[f9] setup: sem aresta livre'); break; }
      res = await cmdAck(s, { type: 'setup_road', edgeId: opts[0] }, view.version);
      if (!res.ok) { setupOk = false; console.log(`[f9] setup_road recusado: ${JSON.stringify(res).slice(0, 160)}`); break; }
    }
    await delay(150);
  }
  view = await waitView(() => latest[0], (v) => v.phase !== 'setup_settlement' && v.phase !== 'setup_road', 20000);
  const nSet = view.board.buildings.length; const nRoad = view.board.roads.length;
  check('setup natural completo (6+6, regras reais)', setupOk && nSet === 6 && nRoad === 6, `sett=${nSet} road=${nRoad} fase=${view.phase}`);

  // Turnos reais: rolar dados + (ladrão/descarte se sair 7) + passar o turno.
  let diceSeen = 0; let turnsDone = 0; let lastVersion = view.version;
  for (let turn = 0; turn < 8; turn += 1) {
    view = latest[0];
    if (!view || view.phase === 'game_over') break;
    if (view.phase === 'pre_roll') {
      const cur = view.activePlayerId; const s = sockOf(cur);
      if (!s) break;
      res = await cmdAck(s, { type: 'roll_dice' }, view.version);
      if (!res.ok) { console.log(`[f9] roll recusado: ${JSON.stringify(res).slice(0, 140)}`); break; }
      await delay(250);
      view = latest[0];
      if (view.dice) { diceSeen += 1; console.log(`[f9] dados: ${view.dice.d1}+${view.dice.d2} (turno ${turn + 1})`); }
    } else if (view.phase === 'await_discards') {
      // Descarta excedente arbitrário (mão própria, escolha qualquer — legal).
      let acted = false;
      for (let i = 0; i < 3; i += 1) {
        const lv = latest[i];
        if (lv && lv.pending && lv.pending.type === 'discard' && lv.pending.waitingOn.includes(lv.you.id)) {
          const total = Object.values(lv.you.resources).reduce((a, b) => a + b, 0);
          const drop = total - 7;
          if (drop > 0) {
            const cards = {}; let rest = drop;
            for (const [k, v] of Object.entries(lv.you.resources)) {
              if (rest <= 0) break;
              const take = Math.min(v, rest); if (take > 0) { cards[k] = take; rest -= take; }
            }
            res = await cmdAck(g[i], { type: 'discard', cards }, lv.version);
            console.log(`[f9] descarte ${lv.you.name}: ${res.ok ? 'ok' : JSON.stringify(res).slice(0, 100)}`);
            acted = true;
          }
        }
      }
      if (!acted) await delay(400);
    } else if (view.phase === 'robber') {
      const cur = view.activePlayerId; const s = sockOf(cur);
      if (!s) break;
      // Ladrão: qualquer outro hex; se houver construção adversa, o servidor
      // exige vítima válida — tenta os demais jogadores (tudo validado).
      const others = view.players.map((p) => p.id).filter((id) => id !== cur);
      let okRob = false;
      for (const hex of view.board.hexes) {
        if (hex.id === latest[0].board.robberHexId) continue;
        res = await cmdAck(s, { type: 'move_robber', hexId: hex.id }, latest[0].version);
        if (res.ok) { okRob = true; break; }
        if (res.error && /vítima/.test(res.error.message || '')) {
          for (const oid of others) {
            res = await cmdAck(s, { type: 'move_robber', hexId: hex.id, victimId: oid }, latest[0].version);
            if (res.ok) { okRob = true; break; }
          }
          if (okRob) break;
        }
      }
      console.log(`[f9] ladrão movido: ${okRob ? 'ok' : JSON.stringify(res).slice(0, 100)}`);
      await delay(250);
    } else if (view.phase === 'action') {
      const cur = view.activePlayerId; const s = sockOf(cur);
      if (!s) break;
      res = await cmdAck(s, { type: 'end_turn' }, view.version);
      if (!res.ok) { console.log(`[f9] end_turn recusado: ${JSON.stringify(res).slice(0, 140)}`); break; }
      turnsDone += 1;
      await delay(250);
      view = latest[0];
      if (view.version > lastVersion) lastVersion = view.version;
    } else {
      await delay(400);
    }
  }
  check('dados rolados de verdade (>=1)', diceSeen >= 1, `rolls=${diceSeen}`);
  check('turnos avançados de verdade (>=3 end_turn)', turnsDone >= 3, `turnos=${turnsDone}`);
  console.log(`[f9] NÃO COBERTO (Catan): partida completa até game_over (10 PV) — exige dezenas de turnos, trocas, dev cards e estratégia; fora do tempo da suíte. Fim Hub (game_over→finished→lobby) segue coberto por hooks (f6/cb).`);

  for (const s of g) s.disconnect();

  // ================= (V) VAVA NATURAL =================
  const vA = await gameWs(E2E.vavaPort);
  const vB = await gameWs(E2E.vavaPort);
  conns.push(vA, vB);
  const send = (w, o) => w.send(JSON.stringify(o));
  send(vA, { t: 'create', name: uniqNick('NvA') });
  const jA = await wsNext(vA, (m) => m.t === 'joined', 8000);
  check('vava create (protocolo real)', !!jA.roomCode || !!jA.code, jA.roomCode || jA.code || '');
  const vCode = jA.roomCode || jA.code;
  send(vB, { t: 'join', name: uniqNick('NvB'), code: vCode });
  await wsNext(vB, (m) => m.t === 'joined', 8000);
  check('vava join (protocolo real)', true);

  let snaps = 0; let firstClock = null; let lastClock = null;
  let me0 = null; let me1 = null;
  let cardSeen = null;
  const onSnap = (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m.t === 'snapshot' && m.snap) {
        snaps += 1;
        if (m.snap.timeLeft != null) {
          if (firstClock == null) firstClock = m.snap.timeLeft;
          lastClock = m.snap.timeLeft;
        }
        if (snaps === 5) me0 = m.snap.you;
        me1 = m.snap.you;
      }
      if (m.t === 'cardSelection' && !cardSeen) {
        cardSeen = m;
        setTimeout(() => {
          const pick = m.cards && m.cards[0];
          if (pick) { send(vA, { t: 'chooseCard', card: pick }); send(vB, { t: 'chooseCard', card: pick }); }
        }, 500);
      }
    } catch { /* ignora */ }
  };
  vA.on('message', onSnap);
  vB.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m.t === 'cardSelection' && !cardSeen) {
        cardSeen = m;
        setTimeout(() => {
          const pick = m.cards && m.cards[0];
          if (pick) { send(vA, { t: 'chooseCard', card: pick }); send(vB, { t: 'chooseCard', card: pick }); }
        }, 500);
      }
    } catch { /* ignora */ }
  });

  // ~70s de inputs reais (movimento + tiro), atravessando a carta dos 60s.
  const tEnd = Date.now() + 72_000;
  let seqA = 0; let seqB = 0; let nIn = 0;
  const moves = [8, 8, 4, 8, 2, 8, 1, 8]; // direita/cima/baixo alternando
  let mi = 0;
  while (Date.now() < tEnd) {
    seqA += 1; seqB += 1; mi += 1;
    const mv = moves[mi % moves.length];
    send(vA, { t: 'input', input: { seq: seqA, move: mv, aim: 0.5, shoot: mi % 3 === 0, reload: false, dash: false, grenade: false } });
    send(vB, { t: 'input', input: { seq: seqB, move: (mv * 2) % 16, aim: -0.5, shoot: mi % 4 === 0, reload: false, dash: false, grenade: false } });
    nIn += 2;
    await delay(120);
  }
  const moved = me0 && me1 && Math.hypot(me1.x - me0.x, me1.y - me0.y) > 1;
  check('vava snapshots fluindo (simulação real)', snaps > 50, `n=${snaps}`);
  check('vava relógio da partida correndo (timeLeft caiu)', firstClock != null && lastClock != null && lastClock < firstClock, `${firstClock}->${lastClock}`);
  check('vava input real desloca o jogador', !!moved, me0 && me1 ? `(${me0.x.toFixed(0)},${me0.y.toFixed(0)})->(${me1.x.toFixed(0)},${me1.y.toFixed(0)})` : 'sem snapshots');
  check('vava rodada de cartas natural atravessada (chooseCard real)', !!cardSeen && snaps > 0, cardSeen ? `cartas=${cardSeen.cards.length}` : 'sem cardSelection');
  console.log(`[f9] NÃO COBERTO (VAVA): partida completa até 'ended' (300s) — longa demais p/ a suíte; retorno Hub do fim natural segue coberto por hook (ui-smoke/flow3).`);
} catch (e) {
  console.error(`[f9] FAIL: ${e.message?.slice(0, 400)}`);
  pass = false;
} finally {
  for (const w of conns) { try { w.close ? w.close() : w.disconnect(); } catch { /* ok */ } }
}
console.log(pass ? '[f9] PASS' : '[f9] FAIL');
if (!pass) process.exitCode = 1;
