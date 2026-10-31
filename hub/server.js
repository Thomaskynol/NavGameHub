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
  BAD_PHASE: 'Esta ação não é permitida na fase atual da sala.',
  LAUNCH_FAILED: 'Não foi possível iniciar a partida. Tente novamente.',
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
  const gamesList = manifest.games;
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
  const closeTimers = new Set();
  let memberSeq = 0;
  let hubPort = Number(manifest.hubPort) || 8090;
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
    for (const key of ['launchTimer', 'playTimer', 'graceTimer', 'closeTimer']) {
      if (room[key]) {
        clearTimeout(room[key]);
        if (key === 'closeTimer') closeTimers.delete(room[key]);
        room[key] = null;
      }
    }
    if (room.launch && room.launch.timer) {
      clearTimeout(room.launch.timer);
      room.launch.timer = null;
    }
  }

  function destroyRoom(room) {
    if (rooms.get(room.code) !== room) return;
    rooms.delete(room.code);
    const code = room.match && room.match.gameCode;
    const game = games.get(room.gameId);
    clearRoomTimers(room);
    for (const member of room.members) {
      if (member.identity.roomCode === room.code) member.identity.roomCode = null;
    }
    room.members = [];
    // Sala sem ninguém não deve deixar partida órfã no servidor do jogo.
    if (code) void closeGameRoom(game, code);
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
      closeTimer: null,
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
    maybeAutoStart(room);
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
    const connectedPlayers = room.members.filter((m) => m.role === 'player' && m.connected);
    if (connectedPlayers.length < game.minPlayers) return false;
    if (!connectedPlayers.every((m) => m.ready)) return false;
    beginLaunch(room, game);
    return true;
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
    roomChanged(room);
    void runLaunch(room, game).catch((error) => {
      logAt('error', '[hub] falha no lançamento:', error);
      failLaunch(room);
    });
  }

  async function runLaunch(room, game) {
    const creator = pickLaunchCreator(room);
    if (!creator) {
      failLaunch(room);
      return;
    }
    room.launch.creatorId = creator.id;

    let code = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateGameCode(game);
      if (gameCodeInUse(candidate, game.id, room.code)) continue;
      const state = await fetchGameState(game, candidate);
      if (!rooms.has(room.code) || room.phase !== 'launching') return;
      if (state.kind === 'error') {
        failLaunch(room);
        return;
      }
      if (state.kind === 'free') {
        code = candidate;
        break;
      }
    }
    if (!code) {
      failLaunch(room);
      return;
    }

    const connectedPlayers = room.members.filter((m) => m.role === 'player' && m.connected);
    room.match = {
      gameCode: code,
      startedAt: now(),
      joinable: !!game.midMatchJoin,
      expect: Math.max(1, connectedPlayers.length),
      notFound: 0,
    };
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
      const state = await fetchGameState(game, code);
      if (!rooms.has(room.code) || room.phase !== 'launching') return;
      if (state.kind === 'error') {
        failLaunch(room);
        return;
      }
      if (state.kind === 'exists') {
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

  function failLaunch(room) {
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
        sendError(member.identity.conn, 'LAUNCH_FAILED');
      }
    }
    roomChanged(room);
    logAt('warn', `[hub] lançamento da sala ${room.code} falhou.`);
  }

  function schedulePlayingPoll(room, game) {
    if (!room.match) return;
    room.match.notFound = 0;
    const tick = async () => {
      room.playTimer = null;
      if (!rooms.has(room.code) || room.phase !== 'playing' || !room.match) return;
      const state = await fetchGameState(game, room.match.gameCode);
      if (!rooms.has(room.code) || room.phase !== 'playing' || !room.match) return;
      if (state.kind === 'free') {
        room.match.notFound += 1;
        if (room.match.notFound >= timings.playNotFoundLimit) {
          finishRoom(room, game);
          return;
        }
      } else if (state.kind === 'exists') {
        room.match.notFound = 0;
        if (state.room && typeof state.room.joinable === 'boolean') {
          const changed = room.match.joinable !== state.room.joinable;
          room.match.joinable = state.room.joinable;
          if (changed) roomChanged(room);
        }
        if (state.room && (state.room.phase === 'results' || state.room.phase === 'ended')) {
          finishRoom(room, game);
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
      room.phase = 'lobby';
      room.match = null;
      resetReadiness(room);
      for (const member of room.members) {
        if (member.role === 'waiting') member.role = 'player';
      }
      roomChanged(room);
      if (code) scheduleClose(room, game, code);
    }, grace);
  }

  function scheduleClose(room, game, code) {
    const timer = setTimeout(() => {
      closeTimers.delete(timer);
      if (room.closeTimer === timer) room.closeTimer = null;
      void closeGameRoom(game, code);
    }, timings.closeDelay);
    closeTimers.add(timer);
    room.closeTimer = timer;
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

  async function closeGameRoom(game, code) {
    if (!game || !code) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timings.stateTimeout);
    try {
      await fetch(
        `${gameBaseUrl(game)}/__hub/close?room=${encodeURIComponent(code)}`,
        {
          method: 'POST',
          headers: { 'x-hub-secret': secret },
          signal: controller.signal,
        },
      );
    } catch {
      // O jogo pode já ter encerrado a partida; a limpeza é best-effort.
    } finally {
      clearTimeout(timer);
    }
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
    for (const timer of closeTimers) clearTimeout(timer);
    closeTimers.clear();
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
          startedAt: room.match.startedAt,
          joinable: !!room.match.joinable,
          expect: room.match.expect,
        } : null,
      })),
    };
  }

  return { server, wss, listen, close, snapshot };
}

// ---------- helpers fora do hub ----------

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
