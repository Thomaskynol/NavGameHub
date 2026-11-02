// Servidor do Game Hub: HTTP estático/API + WebSocket de coordenação.
// O contrato compartilhado está em PROTOCOLO.md; este arquivo implementa o lado do Hub.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const DEFAULT_TIMINGS = {
  disconnectGrace: 20_000,
  launchPollInterval: 300,
  launchTimeout: 12_000,
  playPollInterval: 1_500,
  playNotFoundLimit: 3,
  playErrorLimit: 6,
  playErrorTimeout: 30_000,
  graceVava: 6_000,
  graceDefault: 15_000,
  closeDelay: 5_000,
  healthInterval: 10_000,
  healthTimeout: 1_500,
  stateTimeout: 1_500,
  rateLimit: 30,
  rateWindow: 1_000,
  payloadLimit: 64 * 1024,
};
const DEFAULT_MANIFEST_URL = new URL('./games.json', import.meta.url);
const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

const ERROR_MESSAGES = {
  BAD_NICK: 'Apelido inválido: use de 2 a 16 caracteres, com letras, números, espaço, _ ou -.',
  NICK_TAKEN: 'Este apelido já está em uso no Hub. Escolha outro.',
  BAD_GAME: 'Jogo desconhecido.',
  GAME_OFFLINE: 'Este jogo está indisponível no momento.',
  BAD_CAPACITY: 'Capacidade inválida: informe um número inteiro de jogadores.',
  CAPACITY_GT_MAX: 'A capacidade não pode ultrapassar o máximo de jogadores do jogo.',
  CAPACITY_LT_OCCUPANCY: 'A capacidade não pode ficar abaixo do número de pessoas na sala.',
  ROOM_NOT_FOUND: 'Sala não encontrada. Confira o código.',
  ROOM_FULL: 'A sala está cheia.',
  ALREADY_IN_MATCH: 'Você já está em uma sala.',
  NOT_HOST: 'Somente o anfitrião pode fazer isso.',
  NOT_IN_ROOM: 'Você não está em uma sala.',
  NOT_READY: 'A partida ainda não pode começar.',
  LAUNCHING: 'A sala está iniciando uma partida. Tente novamente em instantes.',
  LAUNCH_CONFLICT: 'O código da partida conflitou com outra sala do jogo. Gerando um novo código — tente novamente.',
  BAD_PHASE: 'Esta ação não é permitida na fase atual da sala.',
  LAUNCH_FAILED: 'Não foi possível iniciar a partida. Tente novamente.',
  GAME_FAILED: 'A partida foi interrompida: o servidor do jogo parou de responder. A sala voltou ao lobby.',
  RATE: 'Muitas mensagens em pouco tempo. Aguarde um instante.',
  INVALID: 'Mensagem inválida.',
};

function errorMessage(code) {
  return ERROR_MESSAGES[code] || 'Não foi possível concluir a ação.';
}

function jsonResponse(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(data);
}

function textResponse(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

export function loadManifest(file = process.env.HUB_GAMES_FILE) {
  const target = file ? path.resolve(file) : fileURLToPath(DEFAULT_MANIFEST_URL);
  const manifest = JSON.parse(readFileSync(target, 'utf8'));
  if (!manifest || !Array.isArray(manifest.games)) {
    throw new Error(`Manifesto de jogos inválido: ${target}`);
  }
  return manifest;
}

export function createHub(options = {}) {
  const manifest = typeof options.manifest === 'string'
    ? loadManifest(options.manifest)
    : options.manifest || loadManifest();
  const gamesList = withEnvPorts(manifest.games);
  const games = new Map(gamesList.map((game) => [game.id, game]));
  const secret = options.secret || process.env.HUB_SECRET || randomBytes(32).toString('hex');
  const now = options.now || Date.now;
  const log = options.log === undefined ? console : options.log;
  const timings = { ...DEFAULT_TIMINGS, ...(options.timings || {}) };
  const publicHost = normalizePublicHost(
    options.publicHost ?? process.env.HUB_PUBLIC_HOST ?? null,
  );
  const probe = options.probe || defaultProbe;

  const players = new Set();
  const playersByToken = new Map();
  const playersByKey = new Map();
  const rooms = new Map();
  const health = new Map(gamesList.map((game) => [game.id, 'offline']));
  // Fechamentos de partida pendentes sobrevivem à sala do Hub: a chave é
  // gameId+gameCode+htok e a entrada vive aqui (fora da sala), executada no
  // prazo ou imediatamente se a sala for destruída antes.
  const pendingCloses = new Map();
  // Resultado dos últimos fechamentos (best-effort): exposto no snapshot para
  // diagnóstico — 403/409 (dono divergente) nunca é "fechado".
  const closeLog = [];
  const MAX_CLOSE_LOG = 20;
  // Conflitos de código (outro dono) por launch: até N novos códigos antes de
  // devolver a sala ao lobby com LAUNCH_CONFLICT.
  const MAX_CONFLICT_RETRIES = 3;
  // Lançamentos do mesmo jogo passam por um mutex (R2): a reserva do código
  // é síncrona, e a verificação é serializada por gameId.
  const launchLocks = new Map();
  let memberSeq = 0;
  let hubPort = Number(process.env.HUB_PORT) || Number(manifest.hubPort) || 8090;
  let healthTimer = null;
  let healthChecking = false;
  let closing = false;

  const server = createServer(handleHttp);
  const wss = new WebSocketServer({ noServer: true, maxPayload: timings.payloadLimit });
  wss.on('connection', handleConnection);
  server.on('upgrade', handleUpgrade);

  // ---------- utilidades ----------

  function logAt(level, ...args) {
    if (!log) return;
    if (typeof log === 'function') {
      log(...args);
      return;
    }
    const fn = log[level] || log.log;
    if (typeof fn === 'function') fn.call(log, ...args);
  }

  function send(ws, message) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      logAt('warn', '[hub] falha ao enviar mensagem:', error.message);
    }
  }

  function sendError(ws, code, message) {
    send(ws, { t: 'error', code, message: message || errorMessage(code) });
  }

  function broadcast(message) {
    for (const identity of players) {
      if (identity.connected && identity.conn) send(identity.conn, message);
    }
  }

  function roomView(room, identity) {
    const game = games.get(room.gameId);
    const member = memberOf(room, identity);
    const { canStart, startHint } = startState(room, game);
    return {
      code: room.code,
      phase: room.phase,
      gameId: room.gameId,
      gameName: game ? game.name : room.gameId,
      capacity: room.capacity,
      minPlayers: game ? game.minPlayers : 1,
      maxPlayers: game ? game.maxPlayers : room.capacity,
      midMatchJoin: !!(game && game.midMatchJoin),
      hostId: room.hostId,
      you: member ? {
        id: member.id,
        nick: member.nick,
        ready: member.ready,
        role: member.role,
        connected: member.connected,
      } : {
        id: identity.id,
        nick: identity.nick,
        ready: false,
        role: 'waiting',
        connected: identity.connected,
      },
      members: room.members.map((m) => ({
        id: m.id,
        nick: m.nick,
        ready: m.ready,
        role: m.role,
        connected: m.connected,
        isHost: m.id === room.hostId,
      })),
      match: room.match ? {
        gameCode: room.match.gameCode,
        startedAt: room.match.startedAt,
        joinable: !!room.match.joinable,
      } : null,
      canStart,
      startHint,
    };
  }

  function gameInfo(game) {
    return {
      id: game.id,
      name: game.name,
      tagline: game.tagline,
      description: game.description,
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
      midMatchJoin: !!game.midMatchJoin,
      accent: game.accent,
      tags: game.tags,
      status: health.get(game.id) || 'offline',
    };
  }

  function roomSummary(room) {
    const game = games.get(room.gameId);
    const host = room.members.find((m) => m.id === room.hostId);
    return {
      code: room.code,
      gameId: room.gameId,
      gameName: game ? game.name : room.gameId,
      capacity: room.capacity,
      occupancy: room.members.length,
      phase: room.phase,
      hostNick: host ? host.nick : '',
    };
  }

  function catalogMessage() {
    return {
      t: 'catalog',
      games: gamesList.map(gameInfo),
      rooms: [...rooms.values()].map(roomSummary),
    };
  }

  function broadcastCatalog() {
    broadcast(catalogMessage());
  }

  function broadcastRoom(room) {
    for (const member of room.members) {
      if (member.connected && member.identity.conn) {
        send(member.identity.conn, { t: 'room', room: roomView(room, member.identity) });
      }
    }
  }

  function roomChanged(room) {
    broadcastRoom(room);
    broadcastCatalog();
  }

  function memberOf(room, identity) {
    return room.members.find((m) => m.id === identity.id);
  }

  function oldestFirst(a, b) {
    return (a.joinedAt - b.joinedAt) || (a.seq - b.seq);
  }

  function oldestMember(room) {
    return room.members.slice().sort(oldestFirst)[0] || null;
  }

  function oldestConnectedPlayer(room) {
    return room.members
      .filter((m) => m.role === 'player' && m.connected)
      .sort(oldestFirst)[0] || null;
  }

  function resetReadiness(room) {
    for (const member of room.members) member.ready = false;
  }

  function clearRoomTimers(room) {
    for (const key of ['launchTimer', 'playTimer', 'graceTimer']) {
      if (room[key]) {
        clearTimeout(room[key]);
        room[key] = null;
      }
    }
    if (room.launch && room.launch.timer) {
      clearTimeout(room.launch.timer);
      room.launch.timer = null;
    }
    // Entradas de fechamento pendente vivem em pendingCloses (fora da sala)
    // e NÃO são canceladas aqui: destroyRoom as executa imediatamente.
  }

  function destroyRoom(room) {
    if (rooms.get(room.code) !== room) return;
    rooms.delete(room.code);
    // Reserva ainda não verificada no jogo: nunca foi criada, nada a fechar.
    const match = room.match && !room.match.reserved ? room.match : null;
    const game = games.get(room.gameId);
    clearRoomTimers(room);
    // Fechamento pendente (R3): a sala do Hub sumiu, a partida do jogo pode
    // continuar existindo — executa o close agora, com a identidade do launch.
    if (room.closeKeys) {
      for (const key of room.closeKeys) {
        const entry = pendingCloses.get(key);
        if (entry) {
          pendingCloses.delete(key);
          clearTimeout(entry.timer);
          void closeGameRoom(entry.game, entry.gameCode, entry.htok);
        }
      }
      room.closeKeys.clear();
    }
    for (const member of room.members) {
      if (member.identity.roomCode === room.code) member.identity.roomCode = null;
    }
    room.members = [];
    // Sala sem ninguém não deve deixar partida órfã no servidor do jogo.
    if (match) void closeGameRoom(game, match.gameCode, match.htok);
    broadcastCatalog();
  }

  function removeMember(room, identity) {
    const index = room.members.findIndex((m) => m.id === identity.id);
    if (index === -1) return false;
    room.members.splice(index, 1);
    if (identity.roomCode === room.code) identity.roomCode = null;
    if (room.members.length === 0) {
      destroyRoom(room);
      return true;
    }
    if (room.hostId === identity.id) {
      const successor = oldestMember(room);
      if (successor) room.hostId = successor.id;
    }
    roomChanged(room);
    maybeAutoStart(room);
    return true;
  }

  function startState(room, game) {
    if (room.phase !== 'lobby') {
      const hints = {
        launching: 'A partida está sendo preparada.',
        playing: 'A partida está em andamento.',
        finished: 'Aguardando o fim dos resultados.',
      };
      return { canStart: false, startHint: hints[room.phase] || 'A sala não está aguardando.' };
    }
    if (!game) return { canStart: false, startHint: 'Jogo inválido.' };
    if (health.get(game.id) !== 'online') {
      return { canStart: false, startHint: `${game.name} está indisponível no momento.` };
    }
    if (room.capacity < game.minPlayers) {
      return {
        canStart: false,
        startHint: `Capacidade insuficiente: ${game.name} exige pelo menos ${game.minPlayers} jogadores e a sala comporta ${room.capacity}.`,
      };
    }
    const connectedPlayers = room.members.filter((m) => m.role === 'player' && m.connected);
    if (connectedPlayers.length < game.minPlayers) {
      const missing = game.minPlayers - connectedPlayers.length;
      return {
        canStart: false,
        startHint: `Faltam ${missing} jogador(es) conectado(s) para o mínimo de ${game.minPlayers}.`,
      };
    }
    const notReady = connectedPlayers.filter((m) => !m.ready);
    if (notReady.length > 0) {
      return {
        canStart: false,
        startHint: `Aguardando ${notReady.length} jogador(es) ficar(em) pronto(s).`,
      };
    }
    return { canStart: true, startHint: 'Todos prontos! A partida vai começar.' };
  }

  // ---------- identidade ----------

  function normalizeNick(value) {
    if (typeof value !== 'string') return null;
    const nick = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!nick) return null;
    const length = [...nick].length;
    if (length < 2 || length > 16) return null;
    if (!/^[\p{L}\p{M}\p{N} _-]+$/u.test(nick)) return null;
    return nick;
  }

  function nickKey(nick) {
    return nick.normalize('NFKC').toLowerCase();
  }

  function createIdentity(nick, key) {
    const identity = {
      id: randomBytes(8).toString('hex'),
      token: randomBytes(32).toString('hex'),
      nick,
      key,
      conn: null,
      connected: false,
      roomCode: null,
      host: '127.0.0.1',
      disconnectTimer: null,
    };
    players.add(identity);
    playersByToken.set(identity.token, identity);
    playersByKey.set(key, identity);
    return identity;
  }

  function attachIdentity(ws, identity) {
    const old = identity.conn;
    if (identity.disconnectTimer) {
      clearTimeout(identity.disconnectTimer);
      identity.disconnectTimer = null;
    }
    identity.conn = ws;
    identity.connected = true;
    identity.host = ws.hubHost;
    ws.identity = identity;

    const room = identity.roomCode ? rooms.get(identity.roomCode) : null;
    if (!room) identity.roomCode = null;
    if (room) {
      const member = memberOf(room, identity);
      if (member) member.connected = true;
    }

    if (old && old !== ws) {
      try {
        old.close(4001, 'Substituída por uma nova conexão');
      } catch {
        // conexão antiga já encerrada
      }
    }
    return room;
  }

  function expireIdentity(identity) {
    identity.disconnectTimer = null;
    if (identity.connected) return;
    const room = identity.roomCode ? rooms.get(identity.roomCode) : null;
    if (room) removeMember(room, identity);
    players.delete(identity);
    if (playersByKey.get(identity.key) === identity) playersByKey.delete(identity.key);
    if (playersByToken.get(identity.token) === identity) playersByToken.delete(identity.token);
    identity.roomCode = null;
    broadcastCatalog();
  }

  function handleClose(ws) {
    const identity = ws.identity;
    if (!identity || identity.conn !== ws) return;
    identity.conn = null;
    identity.connected = false;
    const room = identity.roomCode ? rooms.get(identity.roomCode) : null;
    if (room) {
      const member = memberOf(room, identity);
      if (member) member.connected = false;
      broadcastRoom(room);
      broadcastCatalog();
      maybeAutoStart(room);
    } else {
      broadcastCatalog();
    }
    if (!closing) {
      identity.disconnectTimer = setTimeout(() => expireIdentity(identity), timings.disconnectGrace);
    }
  }

  function handleHello(ws, msg) {
    if (ws.identity) {
      sendError(ws, 'INVALID', 'Esta conexão já está identificada.');
      return;
    }
    const token = typeof msg.token === 'string' ? msg.token : null;
    const known = token ? playersByToken.get(token) : null;
    if (known) {
      const room = attachIdentity(ws, known);
      const hello = {
        t: 'hello_ok',
        token: known.token,
        you: { id: known.id, nick: known.nick },
      };
      if (room) hello.room = roomView(room, known);
      send(ws, hello);
      if (room) {
        broadcastRoom(room);
        const member = memberOf(room, known);
        if (member && member.role === 'player') {
          if (room.phase === 'playing' && room.match) {
            sendPlay(member, room, false);
          } else if (
            room.phase === 'launching' &&
            room.match &&
            room.launch &&
            room.launch.creatorId === known.id
          ) {
            sendPlay(member, room, true);
          }
        }
        maybeAutoStart(room);
      }
      broadcastCatalog();
      return;
    }

    if (msg.nick === undefined || msg.nick === null) {
      send(ws, { t: 'need_nick' });
      return;
    }
    const nick = normalizeNick(msg.nick);
    if (!nick) {
      sendError(ws, 'BAD_NICK');
      return;
    }
    const key = nickKey(nick);
    if (playersByKey.has(key)) {
      sendError(ws, 'NICK_TAKEN');
      return;
    }
    const identity = createIdentity(nick, key);
    attachIdentity(ws, identity);
    send(ws, {
      t: 'hello_ok',
      token: identity.token,
      you: { id: identity.id, nick: identity.nick },
    });
    broadcastCatalog();
  }

  // ---------- salas ----------

  function requireIdentity(ws) {
    if (!ws.identity) {
      sendError(ws, 'INVALID', 'Envie hello antes de qualquer outra mensagem.');
      return null;
    }
    return ws.identity;
  }

  function requireRoom(ws) {
    const identity = requireIdentity(ws);
    if (!identity) return null;
    const room = identity.roomCode ? rooms.get(identity.roomCode) : null;
    if (!room) {
      identity.roomCode = null;
      sendError(ws, 'NOT_IN_ROOM');
      return null;
    }
    const member = memberOf(room, identity);
    if (!member) {
      identity.roomCode = null;
      sendError(ws, 'NOT_IN_ROOM');
      return null;
    }
    return { identity, room, member };
  }

  function requireHost(ws) {
    const context = requireRoom(ws);
    if (!context) return null;
    if (context.room.hostId !== context.identity.id) {
      sendError(ws, 'NOT_HOST');
      return null;
    }
    return context;
  }

  function generateRoomCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
      }
    } while (rooms.has(code));
    return code;
  }

  function generateGameCode(game) {
    const length = Number.isInteger(game.codeLength) && game.codeLength > 0
      ? game.codeLength
      : ROOM_CODE_LENGTH;
    let code = '';
    for (let i = 0; i < length; i += 1) {
      code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    }
    return code;
  }

  function gameCodeInUse(code, gameId, ownRoomCode) {
    for (const room of rooms.values()) {
      if (room.code === ownRoomCode || room.gameId !== gameId) continue;
      if (room.match && room.match.gameCode === code) return true;
    }
    return false;
  }

  function handleCreateRoom(ws, msg) {
    const identity = requireIdentity(ws);
    if (!identity) return;
    if (identity.roomCode && rooms.has(identity.roomCode)) {
      sendError(ws, 'ALREADY_IN_MATCH');
      return;
    }
    const game = games.get(msg.gameId);
    if (!game) {
      sendError(ws, 'BAD_GAME');
      return;
    }
    if (health.get(game.id) !== 'online') {
      sendError(ws, 'GAME_OFFLINE');
      return;
    }
    let capacity = msg.capacity === undefined ? game.maxPlayers : msg.capacity;
    if (!Number.isInteger(capacity) || capacity < 1) {
      sendError(ws, 'BAD_CAPACITY');
      return;
    }
    if (capacity > game.maxPlayers) {
      sendError(ws, 'CAPACITY_GT_MAX', `A capacidade não pode passar de ${game.maxPlayers} para ${game.name}.`);
      return;
    }
    const room = {
      code: generateRoomCode(),
      gameId: game.id,
      capacity,
      phase: 'lobby',
      hostId: identity.id,
      members: [],
      match: null,
      launch: null,
      launchTimer: null,
      playTimer: null,
      graceTimer: null,
      closeKeys: new Set(),
    };
    const member = {
      id: identity.id,
      nick: identity.nick,
      identity,
      ready: false,
      role: 'player',
      connected: true,
      joinedAt: now(),
      seq: ++memberSeq,
    };
    room.members.push(member);
    rooms.set(room.code, room);
    identity.roomCode = room.code;
    send(ws, { t: 'room', room: roomView(room, identity) });
    broadcastCatalog();
  }

  function handleJoinRoom(ws, msg) {
    const identity = requireIdentity(ws);
    if (!identity) return;
    if (identity.roomCode && rooms.has(identity.roomCode)) {
      sendError(ws, 'ALREADY_IN_MATCH');
      return;
    }
    const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
    const room = rooms.get(code);
    if (!room) {
      sendError(ws, 'ROOM_NOT_FOUND');
      return;
    }
    if (room.phase === 'launching') {
      sendError(ws, 'LAUNCHING');
      return;
    }
    if (room.members.length >= room.capacity) {
      sendError(ws, 'ROOM_FULL');
      return;
    }
    const game = games.get(room.gameId);
    let role = 'player';
    if (room.phase === 'playing' && !(game && game.midMatchJoin)) role = 'waiting';
    if (room.phase === 'finished') role = 'waiting';

    const member = {
      id: identity.id,
      nick: identity.nick,
      identity,
      ready: false,
      role,
      connected: true,
      joinedAt: now(),
      seq: ++memberSeq,
    };
    room.members.push(member);
    identity.roomCode = room.code;
    send(ws, { t: 'room', room: roomView(room, identity) });
    broadcastRoom(room);
    broadcastCatalog();
    if (room.phase === 'playing' && role === 'player' && room.match) {
      sendPlay(member, room, false);
    }
    // Entrada tardia com jogo ainda no pregame (R5): o estado efetivo do jogo
    // decide — lobby + joinable + vaga → player com play; senão, waiting.
    if (room.phase === 'playing' && role === 'waiting' && room.match && game) {
      void reevaluateLateJoin(room, game, member, room.match);
    }
    maybeAutoStart(room);
  }

  // Reavalia uma entrada tardia contra o estado efetivo do jogo. Se a partida
  // ainda estiver no lobby/pregame e aceitar jogadores, promove a waiting
  // para player e envia play (join); senão mantém waiting.
  async function reevaluateLateJoin(room, game, member, match) {
    let state = null;
    try {
      state = await fetchGameState(game, match.gameCode);
    } catch {
      state = { kind: 'error' };
    }
    if (!rooms.has(room.code) || room.phase !== 'playing' || room.match !== match) return;
    if (!memberOf(room, member.identity)) return;
    if (member.role !== 'waiting') return;
    if (!state || state.kind !== 'exists' || !state.room) return;
    // Sala alheia (outro dono): nunca promove nem envia play para lá.
    if (!ownsRoomState(state, match.htok)) return;
    if (state.room.phase !== 'lobby' || state.room.joinable !== true) return;
    if (
      Number.isFinite(state.room.players)
      && Number.isFinite(state.room.capacity)
      && state.room.players >= state.room.capacity
    ) return;
    if (room.members.length > room.capacity) return;
    member.role = 'player';
    sendPlay(member, room, false);
    roomChanged(room);
  }

  function handleLeaveRoom(ws) {
    const context = requireRoom(ws);
    if (!context) return;
    removeMember(context.room, context.identity);
    send(ws, { t: 'left' });
  }

  function handleSetReady(ws, msg) {
    const context = requireRoom(ws);
    if (!context) return;
    if (context.room.phase !== 'lobby') {
      sendError(ws, 'BAD_PHASE');
      return;
    }
    if (typeof msg.ready !== 'boolean') {
      sendError(ws, 'INVALID', 'O campo ready deve ser booleano.');
      return;
    }
    context.member.ready = msg.ready;
    const launched = maybeAutoStart(context.room);
    if (!launched) roomChanged(context.room);
  }

  function handleSetGame(ws, msg) {
    const context = requireHost(ws);
    if (!context) return;
    const { room } = context;
    if (room.phase !== 'lobby') {
      sendError(ws, 'BAD_PHASE');
      return;
    }
    const game = games.get(msg.gameId);
    if (!game) {
      sendError(ws, 'BAD_GAME');
      return;
    }
    if (health.get(game.id) !== 'online') {
      sendError(ws, 'GAME_OFFLINE');
      return;
    }
    if (room.gameId === game.id) return;
    if (game.maxPlayers < room.capacity) {
      sendError(
        ws,
        'CAPACITY_GT_MAX',
        `A capacidade da sala (${room.capacity}) excede o máximo de ${game.name} (${game.maxPlayers}). Reduza a capacidade antes de trocar de jogo.`,
      );
      return;
    }
    room.gameId = game.id;
    resetReadiness(room);
    roomChanged(room);
  }

  function handleSetCapacity(ws, msg) {
    const context = requireHost(ws);
    if (!context) return;
    const { room } = context;
    if (room.phase !== 'lobby') {
      sendError(ws, 'BAD_PHASE');
      return;
    }
    const game = games.get(room.gameId);
    const capacity = msg.capacity;
    if (!Number.isInteger(capacity) || capacity < 1) {
      sendError(ws, 'BAD_CAPACITY');
      return;
    }
    if (game && capacity > game.maxPlayers) {
      sendError(ws, 'CAPACITY_GT_MAX', `A capacidade não pode passar de ${game.maxPlayers} para ${game.name}.`);
      return;
    }
    if (capacity < room.members.length) {
      sendError(
        ws,
        'CAPACITY_LT_OCCUPANCY',
        `A capacidade não pode ficar abaixo de ${room.members.length}, o número de pessoas na sala.`,
      );
      return;
    }
    if (capacity === room.capacity) return;
    room.capacity = capacity;
    resetReadiness(room);
    roomChanged(room);
  }

  function handleLeaveMatch(ws) {
    const context = requireRoom(ws);
    if (!context) return;
    const { room, member } = context;
    if (room.phase !== 'playing' && room.phase !== 'finished') {
      sendError(ws, 'BAD_PHASE');
      return;
    }
    member.ready = false;
    member.role = 'waiting';
    roomChanged(room);
  }

  // ---------- início e partida ----------

  function maybeAutoStart(room) {
    if (!room || room.phase !== 'lobby') return false;
    const game = games.get(room.gameId);
    if (!game || health.get(game.id) !== 'online') return false;
    if (room.capacity < game.minPlayers) return false;
    // Política conservadora (R6): enquanto um jogador ainda ocupar vaga sem
    // estar conectado (graça de desconexão), não inicia — mesmo que os
    // conectados estejam todos prontos. Reavaliado na saída/expiração.
    if (room.members.some((m) => m.role === 'player' && !m.connected)) return false;
    const connectedPlayers = room.members.filter((m) => m.role === 'player' && m.connected);
    if (connectedPlayers.length < game.minPlayers) return false;
    if (!connectedPlayers.every((m) => m.ready)) return false;
    beginLaunch(room, game);
    return true;
  }

  function acquireLaunchLock(gameId) {
    const entry = launchLocks.get(gameId);
    if (!entry || !entry.locked) {
      launchLocks.set(gameId, { locked: true, queue: [] });
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      entry.queue.push(resolve);
    });
  }

  function releaseLaunchLock(gameId) {
    const entry = launchLocks.get(gameId);
    if (!entry) return;
    const next = entry.queue.shift();
    if (next) {
      next();
    } else {
      launchLocks.delete(gameId);
    }
  }

  // Reserva síncrona do código (R2): gera e marca room.match ANTES de qualquer
  // await, então dois lançamentos simultâneos nunca recebem o mesmo código —
  // gameCodeInUse enxerga a reserva. Retorna o candidato ou null.
  function reserveLaunchCode(room, game) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateGameCode(game);
      if (gameCodeInUse(candidate, game.id, room.code)) continue;
      const htok = (room.match && room.match.htok) || randomBytes(16).toString('hex');
      const conflicts = (room.match && room.match.conflicts) || 0;
      const connectedPlayers = room.members.filter((m) => m.role === 'player' && m.connected);
      room.match = {
        gameCode: candidate,
        htok,
        conflicts,
        startedAt: now(),
        joinable: !!game.midMatchJoin,
        expect: Math.max(1, connectedPlayers.length),
        notFound: 0,
        errors: 0,
        errorSince: null,
        reserved: true,
      };
      return candidate;
    }
    return null;
  }

  function beginLaunch(room, game) {
    room.phase = 'launching';
    room.match = null;
    room.launch = {
      startedAt: now(),
      deadline: now() + timings.launchTimeout,
      creatorId: null,
      code: null,
      timer: null,
    };
    if (!reserveLaunchCode(room, game)) {
      failLaunch(room);
      return;
    }
    roomChanged(room);
    void runLaunch(room, game).catch((error) => {
      logAt('error', '[hub] falha no lançamento:', error);
      failLaunch(room);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runLaunch(room, game) {
    // Serializa lançamentos por jogo (R2): a verificação do código reservado
    // contra o servidor do jogo acontece com exclusão mútua por gameId.
    await acquireLaunchLock(game.id);
    try {
      await verifyLaunchCode(room, game);
    } finally {
      releaseLaunchLock(game.id);
    }
    if (!rooms.has(room.code) || room.phase !== 'launching' || !room.match) return;
    if (room.match.failed) {
      failLaunch(room, room.match.failed === 'conflict' ? 'LAUNCH_CONFLICT' : 'LAUNCH_FAILED');
      return;
    }
    room.match.reserved = false;

    const creator = pickLaunchCreator(room);
    if (!creator) {
      failLaunch(room);
      return;
    }
    room.launch.creatorId = creator.id;
    const code = room.match.gameCode;
    room.launch.code = code;

    let creatorMember = memberOf(room, creator);
    if (!creatorMember || !creatorMember.connected) {
      creatorMember = oldestConnectedPlayer(room);
      if (!creatorMember) {
        failLaunch(room);
        return;
      }
      room.launch.creatorId = creatorMember.id;
    }
    sendPlay(creatorMember, room, true);
    roomChanged(room);
    scheduleLaunchPoll(room, game, code);
  }

  // Confirma que o código reservado está livre no servidor do jogo. Em
  // colisão (sala existe), reserva outro candidato — ainda sob o mutex.
  // Com dono divergente (outro htok ou null) é CONFLITO: nunca adota a sala
  // alheia — gera novo código (até o limite) em vez de mandar o grupo para lá.
  // Código bloqueado por histórico (409 taken) é o mesmo caminho: conta como
  // conflito e tenta outro, sem apagar dados. Erro de rede/timeout é tolerado
  // aqui (tenta de novo até o prazo); se esgotar as tentativas, marca falha
  // para failLaunch fora do mutex.
  async function verifyLaunchCode(room, game) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!rooms.has(room.code) || room.phase !== 'launching' || !room.match) return;
      if (now() >= room.launch.deadline) {
        room.match.failed = true;
        return;
      }
      const state = await fetchGameState(game, room.match.gameCode);
      if (!rooms.has(room.code) || room.phase !== 'launching' || !room.match) return;
      if (state.kind === 'free') return;
      if (state.kind === 'taken') {
        room.match.conflicts = (room.match.conflicts || 0) + 1;
        logAt('warn', `[hub] código ${room.match.gameCode} (${game.id}) bloqueado por histórico: conflito ${room.match.conflicts}, tentando novo código.`);
        if (room.match.conflicts > MAX_CONFLICT_RETRIES) {
          room.match.failed = 'conflict';
          return;
        }
        if (!reserveLaunchCode(room, game)) {
          room.match.failed = 'conflict';
          return;
        }
        continue;
      }
      if (state.kind === 'exists') {
        if (!ownsRoomState(state, room.match.htok)) {
          room.match.conflicts = (room.match.conflicts || 0) + 1;
          logAt('warn', `[hub] código ${room.match.gameCode} (${game.id}) com outro dono: conflito ${room.match.conflicts}, tentando novo código.`);
          if (room.match.conflicts > MAX_CONFLICT_RETRIES) {
            room.match.failed = 'conflict';
            return;
          }
        }
        if (!reserveLaunchCode(room, game)) {
          room.match.failed = (room.match.conflicts || 0) > 0 ? 'conflict' : true;
          return;
        }
        continue;
      }
      await sleep(timings.launchPollInterval);
    }
    if (room.match) room.match.failed = (room.match.conflicts || 0) > 0 ? 'conflict' : true;
  }

  // Dono da partida (contrato htok): o jogo informa `hubOwner` no state
  // (string = htok do launch que criou a sala; null = sala sem dono).
  // Campo ausente ou não-string = resposta incompatível: NÃO aceitar como
  // própria (CONFLITO/ausência) — nunca enviar jogadores para lá.
  function ownsRoomState(state, htok) {
    if (!state || state.kind !== 'exists' || !state.room) return false;
    if (typeof state.room.hubOwner !== 'string') return false;
    return state.room.hubOwner === htok;
  }

  function pickLaunchCreator(room) {
    const host = room.members.find((m) => m.id === room.hostId);
    if (host && host.connected && host.role === 'player') return host.identity;
    const oldest = oldestConnectedPlayer(room);
    return oldest ? oldest.identity : null;
  }

  function scheduleLaunchPoll(room, game, code) {
    const tick = async () => {
      room.launchTimer = null;
      if (!rooms.has(room.code) || room.phase !== 'launching') return;
      if (now() >= room.launch.deadline) {
        failLaunch(room);
        return;
      }
      // Lê o código atual do match (conflitos reservam um novo no meio do poll).
      const current = room.match ? room.match.gameCode : code;
      const state = await fetchGameState(game, current);
      if (!rooms.has(room.code) || room.phase !== 'launching') return;
      // Erro transitório não encerra o lançamento: continua até o prazo (R8).
      if (state.kind === 'error') {
        if (now() >= room.launch.deadline) {
          failLaunch(room);
          return;
        }
        room.launchTimer = setTimeout(tick, timings.launchPollInterval);
        return;
      }
      // Histórico bloqueado após o create (409 taken): o create do criador
      // recebeu CODE_TAKEN. Mesmo caminho do conflito pós-create: novo código
      // com o mesmo htok, sem mandar ninguém à sala alheia.
      if (state.kind === 'taken') {
        room.match.conflicts = (room.match.conflicts || 0) + 1;
        logAt('warn', `[hub] código ${current} (${game.id}) bloqueado por histórico após create: conflito ${room.match.conflicts}, tentando novo código.`);
        if (room.match.conflicts > MAX_CONFLICT_RETRIES || now() >= room.launch.deadline) {
          failLaunch(room, 'LAUNCH_CONFLICT');
          return;
        }
        if (!reserveLaunchCode(room, game)) {
          failLaunch(room, 'LAUNCH_CONFLICT');
          return;
        }
        const nextTaken = room.match.gameCode;
        room.launch.code = nextTaken;
        let creatorTaken = room.members.find((m) => m.id === room.launch.creatorId);
        if (!creatorTaken || !creatorTaken.connected) {
          creatorTaken = oldestConnectedPlayer(room);
          if (!creatorTaken) {
            failLaunch(room, 'LAUNCH_CONFLICT');
            return;
          }
          room.launch.creatorId = creatorTaken.id;
        }
        sendPlay(creatorTaken, room, true);
        roomChanged(room);
        room.launchTimer = setTimeout(tick, timings.launchPollInterval);
        return;
      }
      if (state.kind === 'exists') {
        if (!ownsRoomState(state, room.match.htok)) {
          // CONFLITO pós-create: outro dono ocupou o código (o create do
          // criador recebeu CODE_TAKEN no jogo). Nunca envia play para a sala
          // alheia: reserva novo código e reemite play create=1 ao criador.
          room.match.conflicts = (room.match.conflicts || 0) + 1;
          logAt('warn', `[hub] código ${current} (${game.id}) com outro dono após create: conflito ${room.match.conflicts}, tentando novo código.`);
          if (room.match.conflicts > MAX_CONFLICT_RETRIES || now() >= room.launch.deadline) {
            failLaunch(room, 'LAUNCH_CONFLICT');
            return;
          }
          if (!reserveLaunchCode(room, game)) {
            failLaunch(room, 'LAUNCH_CONFLICT');
            return;
          }
          const nextCode = room.match.gameCode;
          room.launch.code = nextCode;
          let creatorMember = room.members.find((m) => m.id === room.launch.creatorId);
          if (!creatorMember || !creatorMember.connected) {
            creatorMember = oldestConnectedPlayer(room);
            if (!creatorMember) {
              failLaunch(room, 'LAUNCH_CONFLICT');
              return;
            }
            room.launch.creatorId = creatorMember.id;
          }
          sendPlay(creatorMember, room, true);
          roomChanged(room);
          room.launchTimer = setTimeout(tick, timings.launchPollInterval);
          return;
        }
        const creatorId = room.launch.creatorId;
        room.phase = 'playing';
        if (room.match && state.room && typeof state.room.joinable === 'boolean') {
          room.match.joinable = state.room.joinable;
        }
        room.launch = null;
        for (const member of room.members) {
          if (member.role === 'player' && member.connected && member.id !== creatorId) {
            sendPlay(member, room, false);
          }
        }
        roomChanged(room);
        schedulePlayingPoll(room, game);
        return;
      }
      if (now() >= room.launch.deadline) {
        failLaunch(room);
        return;
      }
      room.launchTimer = setTimeout(tick, timings.launchPollInterval);
    };
    room.launchTimer = setTimeout(tick, timings.launchPollInterval);
  }

  function failLaunch(room, code = 'LAUNCH_FAILED') {
    if (!rooms.has(room.code) || room.phase !== 'launching') return;
    if (room.launch && room.launch.timer) clearTimeout(room.launch.timer);
    if (room.launchTimer) {
      clearTimeout(room.launchTimer);
      room.launchTimer = null;
    }
    room.launch = null;
    room.phase = 'lobby';
    room.match = null;
    resetReadiness(room);
    for (const member of room.members) {
      if (member.connected && member.identity.conn) {
        sendError(member.identity.conn, code);
      }
    }
    roomChanged(room);
    logAt('warn', `[hub] lançamento da sala ${room.code} falhou (${code}).`);
  }

  // Falha persistente do servidor do jogo (R8): marca a sala como FALHA com
  // mensagem clara (não como fim normal) e devolve o grupo a um lobby
  // utilizável. Um erro transitório isolado nunca encerra nada.
  function failMatch(room, game) {
    if (!rooms.has(room.code) || room.phase !== 'playing' || !room.match) return;
    if (room.playTimer) {
      clearTimeout(room.playTimer);
      room.playTimer = null;
    }
    const code = room.match.gameCode;
    const htok = room.match.htok || null;
    room.phase = 'lobby';
    room.match = null;
    resetReadiness(room);
    for (const member of room.members) {
      if (member.role === 'waiting') member.role = 'player';
    }
    for (const member of room.members) {
      if (member.connected && member.identity.conn) {
        send(member.identity.conn, { t: 'error', code: 'GAME_FAILED', message: errorMessage('GAME_FAILED') });
      }
    }
    roomChanged(room);
    logAt('warn', `[hub] partida da sala ${room.code} falhou (jogo sem resposta).`);
    if (code) scheduleClose(room, game, code, htok);
  }

  function schedulePlayingPoll(room, game) {
    if (!room.match) return;
    room.match.notFound = 0;
    room.match.errors = 0;
    room.match.errorSince = null;
    const tick = async () => {
      room.playTimer = null;
      if (!rooms.has(room.code) || room.phase !== 'playing' || !room.match) return;
      const state = await fetchGameState(game, room.match.gameCode);
      if (!rooms.has(room.code) || room.phase !== 'playing' || !room.match) return;
      if (state.kind === 'free') {
        room.match.errors = 0;
        room.match.notFound += 1;
        if (room.match.notFound >= timings.playNotFoundLimit) {
          finishRoom(room, game);
          return;
        }
      } else if (state.kind === 'exists' && !ownsRoomState(state, room.match.htok)) {
        // Código reutilizado por outra partida: a nossa sumiu. Conta como
        // ausência (nunca adota a sala alheia) até encerrar pelo fluxo normal;
        // o close com nosso htok será recusado (403) sem destruir nada.
        room.match.errors = 0;
        room.match.notFound += 1;
        if (room.match.notFound >= timings.playNotFoundLimit) {
          finishRoom(room, game);
          return;
        }
      } else if (state.kind === 'exists') {
        room.match.notFound = 0;
        room.match.errors = 0;
        room.match.errorSince = null;
        if (state.room && typeof state.room.joinable === 'boolean') {
          const changed = room.match.joinable !== state.room.joinable;
          room.match.joinable = state.room.joinable;
          if (changed) roomChanged(room);
        }
        if (state.room && (state.room.phase === 'results' || state.room.phase === 'ended')) {
          finishRoom(room, game);
          return;
        }
      } else {
        room.match.errors += 1;
        if (room.match.errorSince === null) room.match.errorSince = now();
        const persistent = room.match.errors >= timings.playErrorLimit
          || (now() - room.match.errorSince) >= timings.playErrorTimeout;
        if (persistent) {
          failMatch(room, game);
          return;
        }
      }
      room.playTimer = setTimeout(tick, timings.playPollInterval);
    };
    room.playTimer = setTimeout(tick, timings.playPollInterval);
  }

  function finishRoom(room, game) {
    if (!rooms.has(room.code) || room.phase !== 'playing') return;
    if (room.playTimer) {
      clearTimeout(room.playTimer);
      room.playTimer = null;
    }
    room.phase = 'finished';
    if (room.match) room.match.joinable = false;
    roomChanged(room);

    const grace = game.id === 'vava' ? timings.graceVava : timings.graceDefault;
    room.graceTimer = setTimeout(() => {
      room.graceTimer = null;
      if (!rooms.has(room.code) || room.phase !== 'finished') return;
      const code = room.match ? room.match.gameCode : null;
      const htok = room.match && room.match.htok ? room.match.htok : null;
      room.phase = 'lobby';
      room.match = null;
      resetReadiness(room);
      for (const member of room.members) {
        if (member.role === 'waiting') member.role = 'player';
      }
      roomChanged(room);
      if (code) scheduleClose(room, game, code, htok);
    }, grace);
  }

  function pendingCloseKey(game, code, htok) {
    return `${game.id}:${code}:${htok || ''}`;
  }

  // Agenda o fechamento da partida no servidor do jogo. A entrada vive em
  // pendingCloses (fora da sala): sobrevive à destruição da sala do Hub e é
  // executada imediatamente nesse caso (R3). Repetida e idempotente.
  function scheduleClose(room, game, code, htok) {
    const key = pendingCloseKey(game, code, htok);
    if (pendingCloses.has(key)) return key;
    const timer = setTimeout(() => {
      pendingCloses.delete(key);
      if (room.closeKeys) room.closeKeys.delete(key);
      void closeGameRoom(game, code, htok);
    }, timings.closeDelay);
    pendingCloses.set(key, { timer, game, gameCode: code, htok });
    if (room.closeKeys) room.closeKeys.add(key);
    return key;
  }

  // ---------- URLs e chamadas aos jogos ----------

  function sendPlay(member, room, create) {
    if (!member.connected || !member.identity.conn || !room.match) return;
    const game = games.get(room.gameId);
    if (!game) return;
    send(member.identity.conn, {
      t: 'play',
      gameId: game.id,
      url: buildPlayUrl(member, room, game, create),
    });
  }

  function buildPlayUrl(member, room, game, create) {
    const host = publicHost || member.identity.host || '127.0.0.1';
    const authority = formatHost(host);
    const base = `http://${authority}:${game.port}/`;
    const players = room.members
      .filter((m) => m.role === 'player')
      .slice()
      .sort(oldestFirst);
    const slot = Math.max(0, players.findIndex((m) => m.id === member.id));
    const roomUrl = `http://${authority}:${hubPort}/?room=${encodeURIComponent(room.code)}`;
    const params = new URLSearchParams({
      hub: '1',
      room: room.match.gameCode,
      name: member.nick,
      create: create ? '1' : '0',
      expect: String(room.match.expect),
      slot: String(slot),
      hubUrl: roomUrl,
    });
    // Token opaco do launch (R2): o jogo guarda como dono da partida para
    // diferenciar retentativa legítima de colisão e conferir o fechamento.
    if (room.match.htok) params.set('htok', room.match.htok);
    return `${base}?${params.toString()}`;
  }

  function gameBaseUrl(game) {
    return `http://127.0.0.1:${game.port}`;
  }

  async function fetchGameState(game, code) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timings.stateTimeout);
    try {
      const response = await fetch(
        `${gameBaseUrl(game)}/__hub/state?room=${encodeURIComponent(code)}`,
        { headers: { 'x-hub-secret': secret }, signal: controller.signal },
      );
      if (response.status === 404) return { kind: 'free' };
      // 409 = código bloqueado por histórico (Catan preserva dados e responde
      // CODE_TAKEN no create). Não é livre e não é erro transitório: o Hub
      // deve tentar outro código, nunca mandar o grupo para lá. Erro de
      // leitura do banco no jogo responde 500 e cai em 'error' (tolerado até
      // o prazo), nunca como CODE_TAKEN.
      if (response.status === 409) return { kind: 'taken' };
      if (!response.ok) return { kind: 'error' };
      const body = await response.json().catch(() => null);
      if (body && body.ok && body.room) return { kind: 'exists', room: body.room };
      return { kind: 'error' };
    } catch {
      return { kind: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function closeGameRoom(gameOrId, code, htok) {
    const game = typeof gameOrId === 'string' ? games.get(gameOrId) : gameOrId;
    if (!game || !code) return null;
    const sendOnce = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timings.stateTimeout);
      try {
        const params = new URLSearchParams({ room: code });
        // Identidade do launch (R2): o jogo só fecha se o dono conferir —
        // protege reutilização do código por outra partida.
        if (htok) params.set('htok', htok);
        const response = await fetch(
          `${gameBaseUrl(game)}/__hub/close?${params.toString()}`,
          {
            method: 'POST',
            headers: { 'x-hub-secret': secret },
            signal: controller.signal,
          },
        );
        // Dono divergente: não é minha — registra e NÃO insiste (sem retry).
        if (response.status === 403 || response.status === 409) {
          return { status: response.status, closed: false, notMine: true };
        }
        if (response.ok) {
          const body = await response.json().catch(() => null);
          // Só conta como fechado com 200 {closed:true}.
          return { status: response.status, closed: !!(body && body.closed === true), notMine: false };
        }
        return { status: response.status, closed: false, notMine: false };
      } finally {
        clearTimeout(timer);
      }
    };
    const finish = (result) => {
      const entry = {
        gameId: game.id,
        gameCode: code,
        status: result.status,
        closed: !!result.closed,
        notMine: !!result.notMine,
        at: now(),
      };
      closeLog.push(entry);
      if (closeLog.length > MAX_CLOSE_LOG) closeLog.splice(0, closeLog.length - MAX_CLOSE_LOG);
      if (entry.notMine) {
        logAt('warn', `[hub] close de ${code} (${game.id}) recusado (dono divergente): não é minha, sem insistir.`);
      }
      return { status: entry.status, closed: entry.closed, notMine: entry.notMine };
    };
    let result = null;
    try {
      result = await sendOnce();
    } catch {
      result = null;
    }
    if (result && result.notMine) return finish(result);
    // Sucesso documentado (200, mesmo com closed:false) = confirmado, sem
    // retry. Recusa (403/409) = notMine sem retry. 404 = idempotente sem retry.
    // Só tenta de novo em falha de rede ou 5xx — uma falha isolada não derruba
    // a limpeza, mas sucesso e recusa nunca insistem.
    if (result && (result.status === 200 || result.status === 404)) return finish(result);
    if (!result || result.status === 0 || (result.status >= 500 && result.status < 600)) {
      // Uma falha isolada não derruba a limpeza: tenta de novo uma vez.
      await sleep(200);
      try {
        const second = await sendOnce();
        if (second.notMine) return finish(second);
        if (second.status === 200 || second.status === 404) return finish(second);
        result = second;
      } catch {
        if (!result) result = { status: 0, closed: false, notMine: false };
      }
    }
    return finish(result);
  }

  // ---------- saúde / catálogo ----------

  async function defaultProbe(game) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timings.healthTimeout);
    try {
      const response = await fetch(
        `${gameBaseUrl(game)}${game.healthPath || '/health'}`,
        { signal: controller.signal },
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkHealth() {
    if (healthChecking || closing) return;
    healthChecking = true;
    try {
      const results = await Promise.all(gamesList.map(async (game) => {
        let online = false;
        try {
          const value = await withTimeout(Promise.resolve().then(() => probe(game)), timings.healthTimeout);
          online = value && typeof value === 'object' ? !!value.online : !!value;
        } catch {
          online = false;
        }
        return [game.id, online ? 'online' : 'offline'];
      }));
      let changed = false;
      for (const [id, status] of results) {
        if (health.get(id) !== status) {
          health.set(id, status);
          changed = true;
          logAt('info', `[hub] jogo ${id}: ${status}`);
        }
      }
      if (changed) {
        broadcastCatalog();
        for (const room of rooms.values()) maybeAutoStart(room);
      }
    } finally {
      healthChecking = false;
    }
  }

  // ---------- WebSocket ----------

  function handleUpgrade(req, socket, head) {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  }

  function handleConnection(ws, req) {
    ws.hubHost = hostFromHeader(req.headers.host);
    ws.identity = null;
    ws.rate = { start: Date.now(), count: 0, warned: false };

    ws.on('message', (data, isBinary) => {
      if (!allowMessage(ws)) return;
      if (isBinary) {
        sendError(ws, 'INVALID', 'Envie mensagens JSON de texto.');
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString('utf8'));
      } catch {
        sendError(ws, 'INVALID', 'JSON inválido.');
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.t !== 'string') {
        sendError(ws, 'INVALID');
        return;
      }
      try {
        handleMessage(ws, message);
      } catch (error) {
        logAt('error', '[hub] erro ao processar mensagem:', error);
        sendError(ws, 'INVALID');
      }
    });

    ws.on('close', () => handleClose(ws));
    ws.on('error', () => {
      // erros de socket são tratados pelo evento close
    });
  }

  function allowMessage(ws) {
    const current = Date.now();
    if (current - ws.rate.start >= timings.rateWindow) {
      ws.rate.start = current;
      ws.rate.count = 0;
      ws.rate.warned = false;
    }
    ws.rate.count += 1;
    if (ws.rate.count > timings.rateLimit) {
      if (!ws.rate.warned) {
        ws.rate.warned = true;
        sendError(ws, 'RATE');
      }
      return false;
    }
    return true;
  }

  function handleMessage(ws, message) {
    switch (message.t) {
      case 'hello':
        handleHello(ws, message);
        break;
      case 'ping':
        send(ws, { t: 'pong', ts: message.ts });
        break;
      case 'create_room':
        handleCreateRoom(ws, message);
        break;
      case 'join_room':
        handleJoinRoom(ws, message);
        break;
      case 'leave_room':
        handleLeaveRoom(ws);
        break;
      case 'set_ready':
        handleSetReady(ws, message);
        break;
      case 'set_game':
        handleSetGame(ws, message);
        break;
      case 'set_capacity':
        handleSetCapacity(ws, message);
        break;
      case 'leave_match':
        handleLeaveMatch(ws);
        break;
      default:
        sendError(ws, 'INVALID', `Mensagem desconhecida: ${message.t}`);
    }
  }

  // ---------- HTTP ----------

  async function handleHttp(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          jsonResponse(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        jsonResponse(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/rooms') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          jsonResponse(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        jsonResponse(res, 200, { rooms: [...rooms.values()].map(roomSummary) });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        jsonResponse(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      await serveStatic(req, res, url.pathname);
    } catch (error) {
      logAt('error', '[hub] erro HTTP:', error);
      if (!res.headersSent) jsonResponse(res, 500, { ok: false, error: 'INTERNAL' });
      else res.end();
    }
  }

  async function serveStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      textResponse(res, 400, 'Requisição inválida.');
      return;
    }
    if (decoded.includes('\0')) {
      textResponse(res, 400, 'Requisição inválida.');
      return;
    }
    const relative = decoded.replace(/^\/+/, '');
    let filePath = path.resolve(PUBLIC_DIR, relative);
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
      textResponse(res, 403, 'Acesso negado.');
      return;
    }

    let info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info || !info.isFile()) {
      // Rotas da SPA caem no index.html; arquivos com extensão continuam 404.
      if (!path.extname(relative)) {
        filePath = path.join(PUBLIC_DIR, 'index.html');
        info = await stat(filePath).catch(() => null);
      }
    }
    if (!info || !info.isFile()) {
      textResponse(res, 404, 'Arquivo não encontrado.');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' || extension === '.htm'
        ? 'no-store'
        : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    const data = await readFile(filePath);
    headers['Content-Length'] = data.length;
    res.writeHead(200, headers);
    res.end(data);
  }

  // ---------- ciclo de vida ----------

  async function listen(port = hubPort, host = '0.0.0.0') {
    if (server.listening) return server.address();
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    hubPort = server.address().port;
    await checkHealth();
    if (timings.healthInterval > 0) {
      healthTimer = setInterval(() => {
        void checkHealth();
      }, timings.healthInterval);
    }
    return server.address();
  }

  async function close() {
    if (closing) return;
    closing = true;
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    // Descarrega fechamentos pendentes (best-effort, sem aguardar a rede).
    for (const [key, entry] of pendingCloses) {
      pendingCloses.delete(key);
      clearTimeout(entry.timer);
      void closeGameRoom(entry.game, entry.gameCode, entry.htok);
    }
    for (const room of rooms.values()) clearRoomTimers(room);
    rooms.clear();
    for (const identity of players) {
      if (identity.disconnectTimer) clearTimeout(identity.disconnectTimer);
      identity.disconnectTimer = null;
      identity.conn = null;
      identity.connected = false;
    }
    players.clear();
    playersByToken.clear();
    playersByKey.clear();

    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // conexão já encerrada
      }
    }
    await new Promise((resolve) => {
      wss.close(() => resolve());
    });
    if (server.listening) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    }
  }

  function snapshot() {
    return {
      players: [...players].map((identity) => ({
        id: identity.id,
        nick: identity.nick,
        key: identity.key,
        connected: identity.connected,
        roomCode: identity.roomCode,
      })),
      rooms: [...rooms.values()].map((room) => ({
        code: room.code,
        phase: room.phase,
        gameId: room.gameId,
        capacity: room.capacity,
        hostId: room.hostId,
        members: room.members.map((m) => ({
          id: m.id,
          nick: m.nick,
          ready: m.ready,
          role: m.role,
          connected: m.connected,
          isHost: m.id === room.hostId,
          joinedAt: m.joinedAt,
        })),
        match: room.match ? {
          gameCode: room.match.gameCode,
          htok: room.match.htok || null,
          startedAt: room.match.startedAt,
          joinable: !!room.match.joinable,
          expect: room.match.expect,
        } : null,
      })),
      closeLog: closeLog.map((entry) => ({ ...entry })),
    };
  }

  return { server, wss, listen, close, snapshot, closeGameRoom };
}

// ---------- helpers fora do hub ----------

// Portas efetivas (R7): HUB_PORT/ARCADE_PORT/VAVA_PORT/CATAN_PORT no ambiente
// prevalecem sobre o manifesto; usa-se em URLs, sondas (health) e catálogo.
// Nome genérico por jogo: <ID-MAIUSCULO>_PORT. Inválida/ausente → manifesto.
function envPort(name) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : null;
}

function withEnvPorts(games) {
  return (games || []).map((game) => {
    const override = game && game.id ? envPort(`${String(game.id).toUpperCase()}_PORT`) : null;
    if (override === null) return game;
    return { ...game, port: override };
  });
}

function hostFromHeader(value) {
  if (!value) return '127.0.0.1';
  const host = String(value).trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) return host.slice(1, end);
  }
  const firstColon = host.indexOf(':');
  if (firstColon !== -1 && firstColon === host.lastIndexOf(':')) {
    return host.slice(0, firstColon);
  }
  return host || '127.0.0.1';
}

function formatHost(host) {
  const clean = String(host).replace(/^\[/, '').replace(/\]$/, '');
  return clean.includes(':') ? `[${clean}]` : clean;
}

function normalizePublicHost(value) {
  if (!value) return null;
  const withoutScheme = String(value).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return hostFromHeader(withoutScheme) || null;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function startHub(options = {}) {
  const manifest = typeof options.manifest === 'string'
    ? loadManifest(options.manifest)
    : options.manifest || loadManifest(options.gamesFile || process.env.HUB_GAMES_FILE);
  const secretFromEnv = options.secret || process.env.HUB_SECRET;
  const generatedSecret = !secretFromEnv;
  const secret = secretFromEnv || randomBytes(32).toString('hex');
  const hub = createHub({
    ...options,
    manifest,
    secret,
    publicHost: options.publicHost ?? process.env.HUB_PUBLIC_HOST,
  });
  const port = Number(options.port ?? process.env.HUB_PORT ?? process.env.PORT ?? manifest.hubPort ?? 8090);
  const host = options.host ?? process.env.HUB_HOST ?? '0.0.0.0';
  const address = await hub.listen(port, host);

  const logger = options.log === undefined ? console : options.log;
  const write = (level, message) => {
    if (!logger) return;
    if (typeof logger === 'function') {
      logger(message);
      return;
    }
    const fn = logger[level] || logger.log;
    if (typeof fn === 'function') fn.call(logger, message);
  };
  write('info', `[hub] Game Hub em http://${formatHost(host)}:${address.port}`);
  if (generatedSecret) {
    write('info', '[hub] HUB_SECRET ausente; segredo gerado internamente '
      + `(${secret.length} caracteres). Defina HUB_SECRET para reutilizá-lo.`);
  }
  return { ...hub, secret, port: address.port, host };
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  let activeHub = null;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (activeHub) await activeHub.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  startHub()
    .then((hub) => {
      activeHub = hub;
    })
    .catch((error) => {
      console.error('[hub] Falha ao iniciar:', error);
      process.exit(1);
    });
}
