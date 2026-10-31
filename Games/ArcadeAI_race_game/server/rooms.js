// Asfalto Vivo — salas multiplayer, lobby, participantes e reconexão.
// Contrato: ARCHITECTURE.md §3 (protocolo) e §4 (autoridade de corrida — só a
// parte de salas nesta fase; a corrida é injetada via raceFactory).
//
// Decisão de compatibilidade (modo independente preservado): join/create SEM
// htok seguem as regras legadas — inclusive ENTRAR em sala com dono. Só join
// COM htok apresentado é afiliado ao Hub e exige dono igual (dono diferente
// ou sala sem dono → CODE_TAKEN, sem entrada). Isso mantém o uso independente
// fora do Hub exatamente como antes; o isolamento entre partidas do Hub é
// garantido porque o cliente Hub sempre apresenta o htok do launch.
//
// API pública:
//   createRooms({ tracks, timings?, now?, raceFactory?, log? }) => {
//     handleMessage(conn, msg),  // conn = { id, send(obj), close() }
//     onClose(conn),
//     getRoom(code),             // p/ inspeção e testes
//     closeRoom(code),           // encerra sala + conexões (endpoint /__hub/close)
//     forceFinish(code),         // encerra corrida c/ results (hook de teste)
//     roomCount(),
//     destroy(),                 // cancela timers (shutdown/testes)
//   }
// DI de timing: timings.{reconnectMs, finishGraceMs, countdownS, readyTimeoutMs,
// snapshotHz} (defaults de shared/constants.js) e now() — p/ testes rápidos.
import { randomBytes } from 'node:crypto';
import { createSampler } from '../shared/trackMath.js';
import {
  MAX_PLAYERS, LAPS_DEFAULT, LAPS_MIN, LAPS_MAX, RECONNECT_MS,
  FINISH_GRACE_MS, COUNTDOWN_S, READY_TIMEOUT_MS, SNAPSHOT_HZ,
  MAX_STATE_PER_SEC, ROOM_CODE_CHARS, COLORS,
} from '../shared/constants.js';

const MAX_NAME = 16;

function genCode(rooms) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += ROOM_CODE_CHARS[bytes[i] % ROOM_CODE_CHARS.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('rooms: esgotaram-se códigos disponíveis');
}

// Nome: trim + colapsa espaços; vazio ou >16 → null (BAD_NAME).
function sanitizeName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_NAME) return null;
  return name;
}

// Cor: hex de COLORS (case-insensitive) ou id; não ocupada na sala.
function normalizeColor(raw) {
  const s = String(raw ?? '').toLowerCase();
  const hit = COLORS.find((c) => c.hex.toLowerCase() === s || c.id === s);
  return hit ? hit.hex : null;
}

// Código de sala pedido pelo Hub: 6 chars do alfabeto (case-insensitive).
function normalizeRequestedCode(raw) {
  if (raw == null || raw === '') return null;
  const code = String(raw).trim().toUpperCase();
  if (code.length !== 6) return '';
  for (const ch of code) if (!ROOM_CODE_CHARS.includes(ch)) return '';
  return code;
}

// Token de dono da partida (htok): opaco, gerado pelo Hub e repassado no
// launch (`?htok=`). O jogo só guarda e compara (igualdade exata) — nunca
// interpreta. Inválido/ausente → null (sala sem dono: sem retry afiliado).
function normalizeHtok(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) return null;
  return s;
}

export function createRooms({
  tracks,
  timings = {},
  now = () => Date.now(),
  raceFactory = null,
  log = () => {},
} = {}) {
  const T = {
    reconnectMs: timings.reconnectMs ?? RECONNECT_MS,
    finishGraceMs: timings.finishGraceMs ?? FINISH_GRACE_MS,
    countdownS: timings.countdownS ?? COUNTDOWN_S,
    readyTimeoutMs: timings.readyTimeoutMs ?? READY_TIMEOUT_MS,
    snapshotHz: timings.snapshotHz ?? SNAPSHOT_HZ,
  };
  if (!raceFactory) throw new Error('rooms: raceFactory é obrigatório');

  const rooms = new Map(); // code -> room
  const trackIds = new Set(Object.keys(tracks || {}));
  const defaultTrack = trackIds.values().next().value;
  const samplers = new Map(); // trackId -> sampler (cache)

  function samplerFor(trackId) {
    if (!samplers.has(trackId)) samplers.set(trackId, createSampler(tracks[trackId]));
    return samplers.get(trackId);
  }

  function send(conn, obj) {
    if (!conn) return;
    try { conn.send(obj); } catch { /* conexão já morrendo */ }
  }
  function sendErr(conn, code, msg) { send(conn, { t: 'err', code, msg: msg || code }); }

  // Cor livre na sala (ou primeira da paleta quando não há sala). O Hub pode
  // criar/entrar sem cor; o servidor escolhe uma livre.
  function pickFreeColor(room) {
    const used = new Set(room ? room.players.map((p) => p.color) : []);
    const hit = COLORS.find((c) => !used.has(c.hex));
    return hit ? hit.hex : null;
  }

  // ---------- state / broadcast ----------

  function recomputeDnames(room) {
    const groups = new Map();
    for (const p of room.players) {
      const list = groups.get(p.name) || [];
      list.push(p);
      groups.set(p.name, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.enteredAt - b.enteredAt);
      list.forEach((p, i) => { p.dname = i === 0 ? p.name : `${p.name} #${i + 1}`; });
    }
  }

  function stateOf(room) {
    return {
      t: 'state',
      status: room.status,
      hostId: room.hostId,
      track: room.track,
      laps: room.laps,
      players: room.players.map((p) => ({
        id: p.id, dname: p.dname, color: p.color, ready: p.ready,
        conn: p.conn ? 'on' : 'away',
      })),
      max: MAX_PLAYERS,
      seats: room.players.length,
    };
  }

  function broadcastState(room) {
    const msg = stateOf(room);
    for (const p of room.players) if (p.conn) send(p.conn, msg);
  }

  function broadcastRace(room, msg) {
    for (const p of room.players) if (p.conn) send(p.conn, msg);
  }

  // ---------- lifecycle de jogador ----------

  let enterSeq = 0;

  function addPlayer(room, conn, name, color) {
    const p = {
      id: randomBytes(4).toString('hex'),
      name,
      dname: name,
      color,
      ready: false,
      token: randomBytes(16).toString('hex'),
      conn,
      awayTimer: null,
      enteredAt: ++enterSeq,
      // rate limit de st (janela deslizante 1 s)
      stWindowStart: 0,
      stCount: 0,
      stWarned: false,
    };
    room.players.push(p);
    conn.player = p;
    conn.room = room;
    recomputeDnames(room);
    return p;
  }

  function clearAwayTimer(p) {
    if (p.awayTimer) { clearTimeout(p.awayTimer); p.awayTimer = null; }
  }

  // Remove jogador de fato (janela de reconexão venceu ou room vazia).
  function removePlayer(room, p) {
    clearAwayTimer(p);
    const i = room.players.indexOf(p);
    if (i < 0) return;
    room.players.splice(i, 1);
    if (p.conn) { p.conn.player = null; p.conn.room = null; }
    if (room.race && typeof room.race.onPlayerRemoved === 'function') {
      try { room.race.onPlayerRemoved(p); } catch { /* race encerrando */ }
    }
    if (room.hostId === p.id) migrateHost(room);
    recomputeDnames(room);
    if (room.players.length === 0) destroyRoom(room.code);
    else broadcastState(room);
  }

  function migrateHost(room) {
    const connected = room.players.filter((p) => p.conn);
    const pool = connected.length ? connected : room.players;
    pool.sort((a, b) => a.enteredAt - b.enteredAt);
    room.hostId = pool.length ? pool[0].id : null;
  }

  // Jogador perde a conexão (ou saiu explicitamente) → away com deadline.
  function markAway(room, p) {
    if (p.conn) {
      if (p.conn.player === p) { p.conn.player = null; p.conn.room = null; }
      p.conn = null;
    }
    clearAwayTimer(p);
    p.awayTimer = setTimeout(() => {
      p.awayTimer = null;
      // remove mesmo se a sala já tiver mudado; removePlayer é idempotente p/ index
      removePlayer(room, p);
      log(`rooms: away expirou ${p.dname} na sala ${room.code}`);
    }, T.reconnectMs);
    if (typeof p.awayTimer.unref === 'function') p.awayTimer.unref();
    if (room.hostId === p.id) migrateHost(room);
    broadcastState(room);
  }

  function destroyRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    for (const p of room.players) clearAwayTimer(p);
    if (room.race && typeof room.race.dispose === 'function') {
      try { room.race.dispose(); } catch { /* ok */ }
    }
    rooms.delete(code);
    log(`rooms: sala ${code} destruída (vazia)`);
  }

  function leaveRoom(conn) {
    const room = conn.room;
    const p = conn.player;
    if (!room || !p) return;
    if (room.race && typeof room.race.onDisconnect === 'function') {
      try { room.race.onDisconnect(p); } catch { /* ok */ }
    }
    markAway(room, p);
  }

  // ---------- joined ----------

  function modeFor(room, p) {
    if (!room.race) return 'lobby';
    if (typeof room.race.modeFor === 'function') return room.race.modeFor(p.id);
    return 'waiting';
  }

  function sendJoined(room, p) {
    const state = stateOf(room);
    if (room.race && typeof room.race.snapshotState === 'function') {
      try { state.race = room.race.snapshotState(); } catch { /* ok */ }
    }
    send(p.conn, { t: 'joined', room: room.code, you: p.id, token: p.token, mode: modeFor(room, p), state });
  }

  // ---------- handlers C2S ----------

  function handleCreate(conn, msg) {
    const name = sanitizeName(msg.name);
    if (!name) { sendErr(conn, 'BAD_NAME', 'Apelido inválido (vazio ou longo demais).'); return; }
    const color = normalizeColor(msg.color);
    if (msg.color != null && msg.color !== '' && !color) {
      sendErr(conn, 'BAD_COLOR', 'Cor inválida.'); return;
    }
    // Código opcional solicitado pelo Hub; valida antes de sair da sala atual.
    const requested = normalizeRequestedCode(msg.room);
    if (requested === '') { sendErr(conn, 'INVALID', 'Código de sala inválido.'); return; }
    if (requested && rooms.has(requested)) {
      // Contrato htok (R2): código ocupado + mesmo dono → retentativa legítima
      // da mesma partida (retry/reload do launch): entra/resume em vez de
      // CODE_TAKEN. Dono diferente/ausente → CODE_TAKEN; o cliente Hub NÃO
      // faz join cego (erro honesto) para não misturar grupos.
      const room = rooms.get(requested);
      const htok = normalizeHtok(msg.htok);
      if (room.htok && htok && room.htok === htok) {
        handleJoin(conn, { ...msg, t: 'join', room: requested });
        return;
      }
      sendErr(conn, 'CODE_TAKEN', 'Código de sala já está em uso.'); return;
    }
    if (conn.room) leaveRoom(conn);
    const code = requested || genCode(rooms);
    const room = {
      code,
      status: 'lobby',
      hostId: null,
      track: defaultTrack,
      laps: LAPS_DEFAULT,
      players: [],
      race: null,
      seq: 0,
      // Dono (htok) da partida quando criada a pedido do Hub; null = sem dono
      // (sala manual/legada: sem retry afiliado, close só exige segredo do Hub).
      htok: normalizeHtok(msg.htok),
    };
    rooms.set(code, room);
    const p = addPlayer(room, conn, name, color || pickFreeColor(room));
    room.hostId = p.id;
    log(`rooms: sala ${code} criada por ${p.dname}`);
    sendJoined(room, p);
    broadcastState(room);
  }

  function handleJoin(conn, msg) {
    const code = String(msg.room ?? '').toUpperCase();
    const room = rooms.get(code);
    if (!room) { sendErr(conn, 'NOT_FOUND', 'Sala não encontrada.'); return; }

    // Guarda de dono (Hub): join COM htok só entra com dono igual. Dono
    // diferente ou sala sem dono → CODE_TAKEN, SEM entrada (impede que o
    // jogador caia na sala alheia na corrida verificação→criação). Sem htok
    // → regras legadas (modo independente preservado, inclusive em sala
    // com dono). Resume legítimo (mesmo htok + token válido) passa aqui e
    // entra até em sala cheia pelo caminho de resume abaixo.
    const htok = normalizeHtok(msg.htok);
    if (htok) {
      if (!room.htok || room.htok !== htok) {
        sendErr(conn, 'CODE_TAKEN', 'Código de sala já está em uso.');
        return;
      }
    }

    // Rejoin idempotente: mesmo socket já nesta sala → só reenvia joined.
    // Sem isso, join de novo (ex.: cor diferente) criava um 2º player no mesmo
    // socket (ghost ready:false travava o start em NOT_READY e inflava seats).
    if (conn.room === room) {
      if (conn.player) sendJoined(room, conn.player);
      return;
    }

    // Reconexão por token (resume)
    if (msg.resume) {
      const p = room.players.find((x) => x.token === msg.resume);
      if (!p) { sendErr(conn, 'RECONNECT_EXPIRED', 'Sessão expirada; entre novamente.'); return; }
      if (p.conn) {
        // Token já ativo: conexão mais recente vence; antiga recebe bye.
        const old = p.conn;
        if (old !== conn) {
          send(old, { t: 'bye', reason: 'replaced' });
          old.player = null;
          old.room = null;
          try { old.close(); } catch { /* ok */ }
        }
      } else {
        clearAwayTimer(p);
      }
      if (conn.room && conn.room !== room) leaveRoom(conn);
      p.conn = conn;
      conn.player = p;
      conn.room = room;
      if (room.race && typeof room.race.onReconnect === 'function') {
        try { room.race.onReconnect(p); } catch { /* ok */ }
      }
      log(`rooms: ${p.dname} reconectou na sala ${code}`);
      sendJoined(room, p);
      broadcastState(room);
      return;
    }

    // Join normal
    if (room.players.length >= MAX_PLAYERS) { sendErr(conn, 'FULL', 'Sala cheia.'); return; }
    const name = sanitizeName(msg.name);
    if (!name) { sendErr(conn, 'BAD_NAME', 'Apelido inválido (vazio ou longo demais).'); return; }
    const color = normalizeColor(msg.color);
    if (msg.color != null && msg.color !== '' && !color) { sendErr(conn, 'BAD_COLOR', 'Cor inválida.'); return; }
    if (color && room.players.some((x) => x.color === color)) {
      sendErr(conn, 'BAD_COLOR', 'Cor já ocupada nesta sala.');
      return;
    }
    if (conn.room && conn.room !== room) leaveRoom(conn);
    const p = addPlayer(room, conn, name, color || pickFreeColor(room));
    log(`rooms: ${p.dname} entrou na sala ${code}`);
    sendJoined(room, p);
    broadcastState(room);
  }

  function handleSet(conn, msg) {
    const room = conn.room;
    const p = conn.player;
    if (!room || !p) { sendErr(conn, 'INVALID', 'Você não está em uma sala.'); return; }
    if (room.status !== 'lobby') { sendErr(conn, 'RACING', 'Corrida em andamento.'); return; }
    let changed = false;

    if ('color' in msg && msg.color != null) {
      const color = normalizeColor(msg.color);
      if (!color) { sendErr(conn, 'BAD_COLOR', 'Cor inválida.'); return; }
      if (room.players.some((x) => x !== p && x.color === color)) {
        sendErr(conn, 'BAD_COLOR', 'Cor já ocupada nesta sala.');
        return;
      }
      if (p.color !== color) { p.color = color; changed = true; }
    }
    if ('ready' in msg && msg.ready != null) {
      const ready = !!msg.ready;
      if (p.ready !== ready) { p.ready = ready; changed = true; }
    }
    if ('track' in msg && msg.track != null) {
      if (p.id !== room.hostId) { sendErr(conn, 'NOT_HOST', 'Só o organizador altera a pista.'); return; }
      const trackId = String(msg.track);
      if (!trackIds.has(trackId)) { sendErr(conn, 'INVALID', 'Pista inválida.'); return; }
      if (room.track !== trackId) {
        room.track = trackId;
        for (const x of room.players) x.ready = false; // reset de prontidão
        changed = true;
      }
    }
    if ('laps' in msg && msg.laps != null) {
      if (p.id !== room.hostId) { sendErr(conn, 'NOT_HOST', 'Só o organizador altera as voltas.'); return; }
      const laps = Number(msg.laps);
      if (!Number.isInteger(laps) || laps < LAPS_MIN || laps > LAPS_MAX) {
        sendErr(conn, 'INVALID', `Voltas devem estar entre ${LAPS_MIN} e ${LAPS_MAX}.`);
        return;
      }
      if (room.laps !== laps) {
        room.laps = laps;
        for (const x of room.players) x.ready = false;
        changed = true;
      }
    }
    if (changed) broadcastState(room);
  }

  function handleStart(conn) {
    const room = conn.room;
    const p = conn.player;
    if (!room || !p) { sendErr(conn, 'INVALID', 'Você não está em uma sala.'); return; }
    if (p.id !== room.hostId) { sendErr(conn, 'NOT_HOST', 'Só o organizador inicia a corrida.'); return; }
    if (room.status !== 'lobby' || room.race) { sendErr(conn, 'RACING', 'Corrida já em andamento.'); return; }
    const connected = room.players.filter((x) => x.conn);
    if (connected.length < 2) { sendErr(conn, 'NOT_READY', 'Precisa de pelo menos 2 jogadores conectados.'); return; }
    if (connected.some((x) => !x.ready)) { sendErr(conn, 'NOT_READY', 'Nem todos os jogadores estão prontos.'); return; }

    // Roster congela no prepare (só conectados; quem entrar depois espera).
    const roster = connected.map((x) => ({
      id: x.id, dname: x.dname, color: x.color,
      get conn() { return x.conn; },
    }));
    room.status = 'countdown';
    room.seq = 0;
    const track = tracks[room.track];
    const race = raceFactory({
      track,
      sampler: samplerFor(room.track),
      laps: room.laps,
      players: roster,
      timings: T,
      now,
      emit: (msg) => broadcastRace(room, msg),
      endRace: (info) => endRace(room, info),
      setPhase: (status) => setPhase(room, status),
    });
    room.race = race;
    log(`rooms: sala ${room.code} iniciando (${room.track}, ${room.laps} voltas)`);
    broadcastState(room);
  }

  // Race pede mudança de status da sala (ex.: 'race' no GO).
  function setPhase(room, status) {
    if (room.status === status) return;
    room.status = status;
    broadcastState(room);
  }

  // Race terminou: com results → status 'results' (aguarda back_lobby);
  // sem results (cancel) → lobby direto.
  function endRace(room, info) {
    room.race = null;
    if (info && Array.isArray(info.rows)) {
      room.status = 'results';
      broadcastRace(room, { t: 'results', rows: info.rows, reason: info.reason || 'finished' });
      broadcastState(room);
      log(`rooms: sala ${room.code} results (${info.reason})`);
    } else {
      room.status = 'lobby';
      for (const p of room.players) p.ready = false;
      broadcastState(room);
      log(`rooms: sala ${room.code} voltou ao lobby`);
    }
  }

  // C2S back_lobby (extensão): resultados → lobby, prontidão reiniciada.
  function handleBackLobby(conn) {
    const room = conn.room;
    if (!room || room.status !== 'results') return;
    room.status = 'lobby';
    for (const p of room.players) p.ready = false;
    broadcastRace(room, { t: 'back_lobby' });
    broadcastState(room);
    log(`rooms: sala ${room.code} de results ao lobby`);
  }

  function handleSt(conn, msg) {
    const p = conn.player;
    const room = conn.room;
    if (!p || !room || !room.race) return;
    // Rate limit: > MAX_STATE_PER_SEC st/s por conexão → ignora extras (err 1x/janela).
    const t = now();
    if (t - p.stWindowStart >= 1000) {
      p.stWindowStart = t;
      p.stCount = 0;
      p.stWarned = false;
    }
    p.stCount += 1;
    if (p.stCount > MAX_STATE_PER_SEC) {
      if (!p.stWarned) { p.stWarned = true; sendErr(conn, 'RATE', 'Muitas atualizações por segundo.'); }
      return;
    }
    try { room.race.onSt(p, msg); } catch { /* race não pode derrubar o servidor */ }
  }

  function handleReadyLoad(conn) {
    const p = conn.player;
    const room = conn.room;
    if (!p || !room || !room.race) return;
    try { room.race.onReadyLoad(p); } catch { /* ok */ }
  }

  function handleLeave(conn) {
    const room = conn.room;
    const p = conn.player;
    if (!room || !p) return;
    // Saída explícita remove DE FATO (mesmos hooks do caminho de expiração:
    // race.onDisconnect → removePlayer→race.onPlayerRemoved), sem a janela de
    // away de 30 s — fantasma travava vaga/cor e levava BAD_COLOR contra si.
    // Away continua SÓ para desconexão de socket (onClose).
    if (room.race && typeof room.race.onDisconnect === 'function') {
      try { room.race.onDisconnect(p); } catch { /* ok */ }
    }
    removePlayer(room, p);
  }

  // ---------- entrada ----------

  function handleMessage(conn, msg) {
    switch (msg.t) {
      case 'create': handleCreate(conn, msg); break;
      case 'join': handleJoin(conn, msg); break;
      case 'leave': handleLeave(conn); break;
      case 'set': handleSet(conn, msg); break;
      case 'start': handleStart(conn); break;
      case 'ready_load': handleReadyLoad(conn); break;
      case 'back_lobby': handleBackLobby(conn); break;
      case 'st': handleSt(conn, msg); break;
      default: break; // ping/welcome tratados no index
    }
  }

  function onClose(conn) {
    const room = conn.room;
    const p = conn.player;
    if (!room || !p) return;
    if (p.conn !== conn) return; // conexão já substituída por token
    if (room.race && typeof room.race.onDisconnect === 'function') {
      try { room.race.onDisconnect(p); } catch { /* ok */ }
    }
    markAway(room, p);
    log(`rooms: ${p.dname} desconectou da sala ${room.code} (away)`);
  }

  // Encerra a sala (endpoint /__hub/close): notifica e fecha conexões, cancela
  // timers e descarta a corrida. Idempotente.
  function closeRoom(rawCode) {
    const code = String(rawCode ?? '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return false;
    for (const p of room.players) {
      clearAwayTimer(p);
      if (p.conn) {
        send(p.conn, { t: 'bye', reason: 'closed' });
        if (p.conn.player === p) p.conn.player = null;
        if (p.conn.room === room) p.conn.room = null;
        try { p.conn.close(); } catch { /* ok */ }
        p.conn = null;
      }
    }
    if (room.race && typeof room.race.dispose === 'function') {
      try { room.race.dispose(); } catch { /* ok */ }
    }
    room.race = null;
    rooms.delete(code);
    log(`rooms: sala ${code} fechada pelo Hub`);
    return true;
  }

  // Hook de teste (HUB_TEST_HOOKS=1): encerra a corrida com rows coerentes.
  function forceFinish(rawCode) {
    const code = String(rawCode ?? '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return false;
    if (room.race && typeof room.race.dispose === 'function') {
      try { room.race.dispose(); } catch { /* ok */ }
    }
    room.race = null;
    const rows = room.players.map((p, i) => ({
      id: p.id,
      dname: p.dname,
      color: p.color,
      place: i + 1,
      rank: i + 1,
      timeMs: null,
      bestMs: null,
      dnf: true,
      progress: 0,
    }));
    endRace(room, { rows, reason: 'hub' });
    return true;
  }

  function destroy() {
    for (const code of [...rooms.keys()]) destroyRoom(code);
  }

  return {
    handleMessage,
    onClose,
    getRoom: (code) => rooms.get(String(code ?? '').toUpperCase()) || null,
    closeRoom,
    forceFinish,
    roomCount: () => rooms.size,
    destroy,
  };
}
