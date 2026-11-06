// Loop de comandos: wiring de sockets, fila por sala, idempotência, lobby, chat, hooks.
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Server, Socket } from 'socket.io';
import { CHAT_RATE_LIMIT, CHAT_VIEW_LIMIT, LOBBY_RATE_LIMIT, MAX_PLAYERS, MIN_PLAYERS } from '../shared/constants';
import { ERROR_CODES } from '../shared/protocol';
import type { ClientEvents, CommandResponse, GameCommand, LobbyAck, LobbyCommand, ServerEvents, SessionPayload } from '../shared/protocol';
import { validateEnvelope, validateLobbyCommand, validateLobbyEnvelope } from '../shared/validate';
import type { EngineError, EngineResult, GameState, RandomSource } from '../shared/types';
import type { GameEngineApi } from './engine';
import {
  deleteMember,
  deleteRoomData,
  findProcessed,
  insertChatRow,
  insertMember,
  insertRoom,
  persistGameTransition,
  persistRoomUpdate,
  roomCodeExists,
  tx,
  updateMemberColor,
  updateMemberHosts,
  updateMemberReady,
} from './db';
import { generateRecoveryCode, generateRoomCode, hashPayload, hashRecovery, newChatId, newPlayerId } from './identity';
import { logError, logInfo } from './log';
import { cryptoRandomSource, makeGameRng, seededRandomSource } from './rng';
import { Store, type Member, type Room } from './rooms';
import { loadNearWinFixture, validateHook, type HookCommand } from './testHooks';
import type { ServerConfig } from './types';
import { buildRoomView } from './views';

export type SocketData = {
  binding: { roomCode: string; playerId: string } | null;
  /** Janelas de rate limit de lobby por conexão (create/join). */
  lobbyRate: { create: number[]; join: number[] };
};

/** Evento extra de hooks; existe no socket SOMENTE com CATAN_TEST_HOOKS=1 (gate em attachSocket). */
export interface HookClientEvents {
  hook: (payload: unknown, ack: (res: CommandResponse) => void) => void;
}

type SocketEvents = ClientEvents & HookClientEvents;

export type AppIo = Server<SocketEvents, ServerEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<SocketEvents, ServerEvents, Record<string, never>, SocketData>;
type LobbyAckFn = (res: CommandResponse | LobbyAck) => void;
type CmdAckFn = (res: CommandResponse) => void;

type BoundLobbyCommand = Exclude<LobbyCommand, { type: 'create_room' | 'join_room' | 'bind_session' }>;
type MutationResult = { ok: true } | { ok: false; error: EngineError };

export interface AppContext {
  config: ServerConfig;
  db: DatabaseSync;
  store: Store;
  engine: GameEngineApi;
  io: AppIo;
  /** Sessão ativa por (sala, jogador). */
  sessions: Map<string, AppSocket>;
  /** Fila de mutação por sala (promise-chain). */
  queues: Map<string, Promise<void>>;
  /** Janelas de rate limit de chat por jogador. */
  chatRate: Map<string, number[]>;
}

export function sessionKey(roomCode: string, playerId: string): string {
  return roomCode + ' ' + playerId;
}

function engineError(code: string, message: string): EngineError {
  return { code, message };
}

/** requestId de um payload inválido (apenas correlação; nunca validade). */
function reqIdOf(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null && typeof (raw as { requestId?: unknown }).requestId === 'string') {
    return (raw as { requestId: string }).requestId.slice(0, 80);
  }
  return 'unknown';
}

/** Serialização real de mutações por sala: toda mutação entra na cadeia de promessas. */
export function enqueue<T>(ctx: AppContext, roomCode: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = ctx.queues.get(roomCode) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  ctx.queues.set(roomCode, tail);
  void tail.then(() => {
    if (ctx.queues.get(roomCode) === tail) ctx.queues.delete(roomCode);
  });
  return run;
}

function roomRng(room: Room): RandomSource {
  if (!room.test.rng) room.test.rng = cryptoRandomSource();
  return room.test.rng;
}

function sendView(ctx: AppContext, socket: AppSocket, room: Room, playerId: string): void {
  socket.emit('state', buildRoomView(ctx.engine, room, playerId));
}

function broadcastRoom(ctx: AppContext, room: Room): void {
  for (const member of room.members.values()) {
    const socket = ctx.sessions.get(sessionKey(room.code, member.playerId));
    if (socket) socket.emit('state', buildRoomView(ctx.engine, room, member.playerId));
  }
}

function emitPresence(ctx: AppContext, room: Room, playerId: string, connected: boolean): void {
  for (const member of room.members.values()) {
    if (member.playerId === playerId) continue;
    const socket = ctx.sessions.get(sessionKey(room.code, member.playerId));
    if (socket) socket.emit('presence', { playerId, connected });
  }
}

function bindSocket(ctx: AppContext, socket: AppSocket, roomCode: string, playerId: string): void {
  const prev = socket.data.binding;
  if (prev) {
    const prevKey = sessionKey(prev.roomCode, prev.playerId);
    if (ctx.sessions.get(prevKey) === socket) ctx.sessions.delete(prevKey);
  }
  socket.data.binding = { roomCode, playerId };
  ctx.sessions.set(sessionKey(roomCode, playerId), socket);
}

function unbindSocket(ctx: AppContext, socket: AppSocket): void {
  const binding = socket.data.binding;
  if (!binding) return;
  const key = sessionKey(binding.roomCode, binding.playerId);
  if (ctx.sessions.get(key) === socket) ctx.sessions.delete(key);
  socket.data.binding = null;
}

function sessionPayload(room: Room, member: Member, recoveryCode: string): SessionPayload {
  return { roomCode: room.code, roomName: room.name, playerId: member.playerId, recoveryCode, isHost: member.isHost };
}

function checkChatRate(ctx: AppContext, playerId: string): boolean {
  const now = Date.now();
  const window = (ctx.chatRate.get(playerId) ?? []).filter((t) => now - t < CHAT_RATE_LIMIT.windowMs);
  if (window.length >= CHAT_RATE_LIMIT.max) {
    ctx.chatRate.set(playerId, window);
    return false;
  }
  window.push(now);
  ctx.chatRate.set(playerId, window);
  return true;
}

/** Rate limit de lobby por conexão (conta tentativas, sucesso ou não). */
function checkLobbyRate(socket: AppSocket, kind: 'create' | 'join'): boolean {
  const limit = LOBBY_RATE_LIMIT[kind];
  const now = Date.now();
  const window = (socket.data.lobbyRate?.[kind] ?? []).filter((t) => now - t < limit.windowMs);
  if (window.length >= limit.max) {
    socket.data.lobbyRate[kind] = window;
    return false;
  }
  window.push(now);
  socket.data.lobbyRate[kind] = window;
  return true;
}

function persistChat(ctx: AppContext, room: Room, member: Member, text: string): boolean {
  if (!checkChatRate(ctx, member.playerId)) return false;
  const msg = { id: newChatId(), playerId: member.playerId, name: member.name, color: member.color, text, at: Date.now() };
  tx(ctx.db, () => insertChatRow(ctx.db, { ...msg, roomCode: room.code }));
  room.chat.push(msg);
  if (room.chat.length > CHAT_VIEW_LIMIT) room.chat.splice(0, room.chat.length - CHAT_VIEW_LIMIT);
  for (const m of room.members.values()) {
    const socket = ctx.sessions.get(sessionKey(room.code, m.playerId));
    if (socket) socket.emit('chat', msg);
  }
  return true;
}

// ---------- Lobby ----------

async function handleLobby(ctx: AppContext, socket: AppSocket, raw: unknown, ack: LobbyAckFn): Promise<void> {
  const validated = validateLobbyEnvelope(raw);
  if (!validated.ok) {
    ack({ ok: false, error: validated.error });
    return;
  }
  const env = validated.value;
  const payload = env.payload;
  const binding = socket.data.binding;

  switch (payload.type) {
    case 'create_room': {
      if (!checkLobbyRate(socket, 'create')) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.RATE_LIMITED, 'Muitas tentativas de criar sala; aguarde um pouco.') });
        return;
      }
      if (binding) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ALREADY_IN_ROOM, 'Saia da sala atual antes de criar outra.') });
        return;
      }
      // Código solicitado (Hub): colisão => CODE_TAKEN, nunca gera outro em silêncio.
      // Identidade (htok): mesmo dono => retentativa legítima entra na sala
      // existente (nova vaga, sem CODE_TAKEN); dono diferente/ausente => CODE_TAKEN
      // honesto e o cliente NÃO faz join cego.
      let code: string;
      const requested = payload.roomCode?.toUpperCase().trim();
      const hubToken = (payload.hubToken ?? '').trim();
      if (requested) {
        const existing = ctx.store.getOpenRoom(requested);
        if (existing) {
          if (hubToken !== '' && existing.hubToken !== '' && hubToken === existing.hubToken) {
            if (existing.state !== null || existing.phase !== 'lobby') {
              ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ALREADY_STARTED, 'A partida já começou.') });
              return;
            }
            if (existing.members.size >= MAX_PLAYERS) {
              ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ROOM_FULL, 'Sala cheia.') });
              return;
            }
            const color = ctx.store.freeColor(existing);
            if (!color) {
              ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ROOM_FULL, 'Sala cheia.') });
              return;
            }
            const retryPlayerId = newPlayerId();
            const retryRecovery = generateRecoveryCode();
            const retryNow = Date.now();
            const retryMember: Member = {
              playerId: retryPlayerId,
              name: payload.nickname,
              color,
              recoveryHash: hashRecovery(retryRecovery),
              isHost: false,
              ready: false,
              joinedAt: retryNow,
              connected: true,
            };
            tx(ctx.db, () =>
              insertMember(ctx.db, {
                roomCode: existing.code,
                playerId: retryPlayerId,
                name: retryMember.name,
                color,
                recoveryHash: retryMember.recoveryHash,
                isHost: false,
                ready: false,
                joinedAt: retryNow,
              }),
            );
            ctx.store.indexMember(existing, retryMember);
            bindSocket(ctx, socket, existing.code, retryPlayerId);
            logInfo('room_rejoined_htok', { roomCode: existing.code, players: existing.members.size });
            emitPresence(ctx, existing, retryPlayerId, true);
            broadcastRoom(ctx, existing);
            ack({ ok: true, session: sessionPayload(existing, retryMember, retryRecovery), view: null });
            return;
          }
          ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.CODE_TAKEN, 'Código de sala já está em uso.') });
          return;
        }
        if (roomCodeExists(ctx.db, requested)) {
          ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.CODE_TAKEN, 'Código de sala já está em uso.') });
          return;
        }
        code = requested;
      } else {
        code = generateRoomCode();
        for (let guard = 0; guard < 50 && (ctx.store.rooms.has(code) || roomCodeExists(ctx.db, code)); guard += 1) {
          code = generateRoomCode();
        }
        if (ctx.store.rooms.has(code) || roomCodeExists(ctx.db, code)) {
          ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.INTERNAL, 'Não foi possível gerar um código de sala.') });
          return;
        }
      }
      const playerId = newPlayerId();
      const recoveryCode = generateRecoveryCode();
      const now = Date.now();
      const member: Member = {
        playerId,
        name: payload.nickname,
        color: 'red',
        recoveryHash: hashRecovery(recoveryCode),
        isHost: true,
        ready: false,
        joinedAt: now,
        connected: true,
      };
      const room: Room = {
        code,
        name: payload.roomName ?? `Sala de ${payload.nickname}`,
        hostPlayerId: playerId,
        hubToken,
        state: null,
        phase: 'lobby',
        boardSeed: '',
        members: new Map(),
        chat: [],
        closed: false,
        createdAt: now,
        updatedAt: now,
        test: { forceDice: null, rngSeed: null, rng: null },
      };
      const isRequested = !!requested;
      try {
        tx(ctx.db, () => {
          insertRoom(ctx.db, { code, name: room.name, hostPlayerId: playerId, phase: 'lobby', version: 0, boardSeed: '', createdAt: now, hubToken });
          insertMember(ctx.db, {
            roomCode: code,
            playerId,
            name: member.name,
            color: member.color,
            recoveryHash: member.recoveryHash,
            isHost: true,
            ready: false,
            joinedAt: now,
          });
        });
      } catch (err) {
        // Conflito (PK rooms.code: aberta ou histórico preservado) => CODE_TAKEN
        // para o Hub tentar outro; nunca gera outro em silêncio e nunca trava
        // sem ack. Erro não-conflito => INTERNAL com log, mesmo com código
        // explícito (CODE_TAKEN é só para conflito real).
        const msg = err instanceof Error ? err.message : String(err);
        const conflict = msg.includes('UNIQUE constraint failed') || msg.includes('PRIMARY KEY');
        if (conflict) {
          // Pedido explícito com histórico => CODE_TAKEN honesto (preserva dados).
          // Auto com conflito inesperado => tenta outro código uma vez antes de falhar.
          if (!isRequested) {
            const retry = generateRoomCode();
            if (!ctx.store.rooms.has(retry) && !roomCodeExists(ctx.db, retry)) {
              try {
                tx(ctx.db, () => {
                  insertRoom(ctx.db, {
                    code: retry,
                    name: room.name,
                    hostPlayerId: playerId,
                    phase: 'lobby',
                    version: 0,
                    boardSeed: '',
                    createdAt: now,
                    hubToken,
                  });
                  insertMember(ctx.db, {
                    roomCode: retry,
                    playerId,
                    name: member.name,
                    color: member.color,
                    recoveryHash: member.recoveryHash,
                    isHost: true,
                    ready: false,
                    joinedAt: now,
                  });
                });
                room.code = retry;
                code = retry;
                ctx.store.rooms.set(code, room);
                ctx.store.indexMember(room, member);
                bindSocket(ctx, socket, code, playerId);
                logInfo('room_created', { roomCode: code, players: 1 });
                broadcastRoom(ctx, room);
                ack({ ok: true, session: sessionPayload(room, member, recoveryCode), view: null });
                return;
              } catch {
                /* retry falhou; cai no erro claro abaixo */
              }
            }
          }
          ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.CODE_TAKEN, 'Código de sala já está em uso.') });
          return;
        }
        logError('room_create_failed', { roomCode: code, message: msg });
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.INTERNAL, 'Falha ao criar a sala.') });
        return;
      }
      ctx.store.rooms.set(code, room);
      ctx.store.indexMember(room, member);
      bindSocket(ctx, socket, code, playerId);
      logInfo('room_created', { roomCode: code, players: 1 });
      broadcastRoom(ctx, room);
      ack({ ok: true, session: sessionPayload(room, member, recoveryCode), view: null });
      return;
    }
    case 'join_room': {
      if (!checkLobbyRate(socket, 'join')) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.RATE_LIMITED, 'Muitas tentativas de entrar em sala; aguarde um pouco.') });
        return;
      }
      if (binding) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ALREADY_IN_ROOM, 'Saia da sala atual antes de entrar em outra.') });
        return;
      }
      const room = ctx.store.getOpenRoom(payload.code);
      if (!room) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ROOM_NOT_FOUND, 'Sala não encontrada.') });
        return;
      }
      // Identidade (htok) no join: join com htok explícito só entra se conferir
      // com o dono da sala. Divergente — ou htok em sala sem dono (legada) —
      // recusa com CODE_TAKEN sem criar entrada. Sem htok: legado preservado
      // (entra como antes); o guardião contra mistura de grupos no fluxo do Hub
      // é o create_room (create=1), que nunca faz join cego após CODE_TAKEN.
      const joinHtok = (payload.hubToken ?? '').trim();
      if (joinHtok !== '' && room.hubToken !== joinHtok) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.CODE_TAKEN, 'Código de sala já está em uso.') });
        return;
      }
      if (room.state !== null || room.phase !== 'lobby') {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ALREADY_STARTED, 'A partida já começou.') });
        return;
      }
      if (room.members.size >= MAX_PLAYERS) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ROOM_FULL, 'Sala cheia.') });
        return;
      }
      const color = ctx.store.freeColor(room);
      if (!color) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ROOM_FULL, 'Sala cheia.') });
        return;
      }
      const playerId = newPlayerId();
      const recoveryCode = generateRecoveryCode();
      const now = Date.now();
      const member: Member = {
        playerId,
        name: payload.nickname,
        color,
        recoveryHash: hashRecovery(recoveryCode),
        isHost: false,
        ready: false,
        joinedAt: now,
        connected: true,
      };
      tx(ctx.db, () =>
        insertMember(ctx.db, {
          roomCode: room.code,
          playerId,
          name: member.name,
          color,
          recoveryHash: member.recoveryHash,
          isHost: false,
          ready: false,
          joinedAt: now,
        }),
      );
      ctx.store.indexMember(room, member);
      bindSocket(ctx, socket, room.code, playerId);
      logInfo('room_joined', { roomCode: room.code, players: room.members.size });
      emitPresence(ctx, room, playerId, true);
      broadcastRoom(ctx, room);
      ack({ ok: true, session: sessionPayload(room, member, recoveryCode), view: null });
      return;
    }
    case 'bind_session': {
      const room = ctx.store.getOpenRoom(payload.code);
      if (!room) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.ROOM_NOT_FOUND, 'Sala não encontrada.') });
        return;
      }
      const ref = ctx.store.recoveryIndex.get(hashRecovery(payload.recoveryCode));
      const member = ref && ref.roomCode === room.code ? room.members.get(ref.playerId) : undefined;
      if (!member) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.INVALID_RECOVERY, 'Código de recuperação inválido para esta sala.') });
        return;
      }
      const key = sessionKey(room.code, member.playerId);
      const active = ctx.sessions.get(key);
      if (active && active !== socket) {
        if (payload.mode !== 'takeover') {
          socket.emit('bind_conflict', { roomCode: room.code, playerId: member.playerId });
          ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.SESSION_CONFLICT, 'Sessão ativa em outra conexão.') });
          return;
        }
        active.emit('session_replaced', { by: member.playerId });
        active.data.binding = null;
        ctx.sessions.delete(key);
      }
      bindSocket(ctx, socket, room.code, member.playerId);
      member.connected = true;
      logInfo('session_bound', { roomCode: room.code, mode: payload.mode });
      emitPresence(ctx, room, member.playerId, true);
      // Broadcast: presença (`connected`) + estado para todos, inclusive o binder
      // (o cliente descarta ack.view e depende do evento `state`).
      broadcastRoom(ctx, room);
      ack({ ok: true, session: sessionPayload(room, member, payload.recoveryCode), view: buildRoomView(ctx.engine, room, member.playerId) });
      return;
    }
    default: {
      if (!binding) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.AUTH_REQUIRED, 'Conecte-se a uma sala.') });
        return;
      }
      const room = ctx.store.getOpenRoom(binding.roomCode);
      const member = room?.members.get(binding.playerId);
      if (!room || !member) {
        ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.NOT_IN_ROOM, 'Sala não encontrada.') });
        return;
      }
      const bound = payload as BoundLobbyCommand;
      await enqueue(ctx, room.code, () => {
        const result = runLobbyMutation(ctx, socket, room, member, bound);
        ack(result.ok ? { ok: true, requestId: env.requestId } : { ok: false, requestId: env.requestId, error: result.error });
      });
    }
  }
}

/** Mutações de lobby que exigem vínculo (set_color..chat). Serializadas pela fila da sala. */
function runLobbyMutation(ctx: AppContext, socket: AppSocket, room: Room, member: Member, payload: BoundLobbyCommand): MutationResult {
  const inLobby = room.state === null && room.phase === 'lobby';
  switch (payload.type) {
    case 'set_color': {
      if (!inLobby) return { ok: false, error: engineError(ERROR_CODES.WRONG_PHASE, 'A partida já começou.') };
      if ([...room.members.values()].some((m) => m.playerId !== member.playerId && m.color === payload.color)) {
        return { ok: false, error: engineError(ERROR_CODES.COLOR_TAKEN, 'Cor já escolhida por outro jogador.') };
      }
      tx(ctx.db, () => updateMemberColor(ctx.db, room.code, member.playerId, payload.color));
      member.color = payload.color;
      broadcastRoom(ctx, room);
      return { ok: true };
    }
    case 'set_ready': {
      if (!inLobby) return { ok: false, error: engineError(ERROR_CODES.WRONG_PHASE, 'A partida já começou.') };
      tx(ctx.db, () => updateMemberReady(ctx.db, room.code, member.playerId, payload.ready));
      member.ready = payload.ready;
      broadcastRoom(ctx, room);
      return { ok: true };
    }
    case 'start_game': {
      if (room.state !== null) return { ok: false, error: engineError(ERROR_CODES.ALREADY_STARTED, 'A partida já começou.') };
      if (!member.isHost) return { ok: false, error: engineError(ERROR_CODES.NOT_HOST, 'Só o anfitrião inicia a partida.') };
      const members = [...room.members.values()];
      if (members.length < MIN_PLAYERS) return { ok: false, error: engineError(ERROR_CODES.NEED_PLAYERS, `São necessários ${MIN_PLAYERS} jogadores.`) };
      if (members.some((m) => !m.ready)) return { ok: false, error: engineError(ERROR_CODES.NOT_READY, 'Todos os jogadores precisam estar prontos.') };
      const boardSeed = payload.boardSeed ?? randomBytes(16).toString('hex');
      let created: GameState;
      try {
        created = ctx.engine.createGame({
          players: members.map((m) => ({ id: m.playerId, name: m.name, color: m.color })),
          boardSeed,
          rng: roomRng(room),
        });
      } catch (err) {
        logError('engine_create_failed', { roomCode: room.code, message: err instanceof Error ? err.message : String(err) });
        return { ok: false, error: engineError(ERROR_CODES.INTERNAL, 'Falha ao iniciar a partida.') };
      }
      const next: GameState = { ...created };
      tx(ctx.db, () =>
        persistRoomUpdate(ctx.db, {
          roomCode: room.code,
          phase: next.phase,
          version: next.version,
          boardSeed,
          stateJson: JSON.stringify(next),
          updatedAt: Date.now(),
        }),
      );
      room.state = next;
      room.phase = next.phase;
      room.boardSeed = boardSeed;
      room.updatedAt = Date.now();
      logInfo('game_started', { roomCode: room.code });
      broadcastRoom(ctx, room);
      return { ok: true };
    }
    case 'leave_room': {
      if (room.state !== null) {
        // Em partida: sair apenas desvincula a sessão (presença; jogador permanece no jogo).
        unbindSocket(ctx, socket);
        member.connected = false;
        emitPresence(ctx, room, member.playerId, false);
        return { ok: true };
      }
      const wasHost = member.isHost;
      ctx.store.unindexMember(room, member);
      unbindSocket(ctx, socket);
      if (room.members.size === 0) {
        // Sala vazia: remove por completo e libera o código para reutilização
        // segura (a identidade htok protege contra fechamento tardio).
        tx(ctx.db, () => {
          deleteRoomData(ctx.db, room.code);
        });
        ctx.store.rooms.delete(room.code);
        logInfo('room_closed', { roomCode: room.code });
        return { ok: true };
      }
      let newHostId = room.hostPlayerId;
      if (wasHost) {
        newHostId = [...room.members.values()][0].playerId;
        room.hostPlayerId = newHostId;
        for (const m of room.members.values()) m.isHost = m.playerId === newHostId;
      }
      tx(ctx.db, () => {
        deleteMember(ctx.db, room.code, member.playerId);
        if (wasHost) {
          updateMemberHosts(ctx.db, room.code, newHostId);
          persistRoomUpdate(ctx.db, { roomCode: room.code, hostPlayerId: newHostId, updatedAt: Date.now() });
        }
      });
      broadcastRoom(ctx, room);
      return { ok: true };
    }
    case 'kick_player': {
      if (!inLobby) return { ok: false, error: engineError(ERROR_CODES.WRONG_PHASE, 'A partida já começou.') };
      if (!member.isHost) return { ok: false, error: engineError(ERROR_CODES.NOT_HOST, 'Só o anfitrião expulsa jogadores.') };
      const target = room.members.get(payload.playerId);
      if (!target) return { ok: false, error: engineError(ERROR_CODES.INVALID_PAYLOAD, 'Jogador não está nesta sala.') };
      if (target.playerId === member.playerId) return { ok: false, error: engineError(ERROR_CODES.INVALID_PAYLOAD, 'Não é possível expulsar a si mesmo.') };
      ctx.store.unindexMember(room, target);
      tx(ctx.db, () => deleteMember(ctx.db, room.code, target.playerId));
      const key = sessionKey(room.code, target.playerId);
      const targetSocket = ctx.sessions.get(key);
      if (targetSocket) {
        ctx.sessions.delete(key);
        targetSocket.data.binding = null;
        targetSocket.emit('session_replaced', { by: member.playerId });
      }
      broadcastRoom(ctx, room);
      return { ok: true };
    }
    case 'transfer_host': {
      if (!inLobby) return { ok: false, error: engineError(ERROR_CODES.WRONG_PHASE, 'A partida já começou.') };
      if (!member.isHost) return { ok: false, error: engineError(ERROR_CODES.NOT_HOST, 'Só o anfitrião transfere o anfitriado.') };
      const target = room.members.get(payload.playerId);
      if (!target) return { ok: false, error: engineError(ERROR_CODES.INVALID_PAYLOAD, 'Jogador não está nesta sala.') };
      if (target.playerId === member.playerId) return { ok: false, error: engineError(ERROR_CODES.INVALID_PAYLOAD, 'Você já é o anfitrião.') };
      room.hostPlayerId = target.playerId;
      for (const m of room.members.values()) m.isHost = m.playerId === target.playerId;
      tx(ctx.db, () => {
        updateMemberHosts(ctx.db, room.code, target.playerId);
        persistRoomUpdate(ctx.db, { roomCode: room.code, hostPlayerId: target.playerId, updatedAt: Date.now() });
      });
      broadcastRoom(ctx, room);
      return { ok: true };
    }
    case 'chat': {
      if (persistChat(ctx, room, member, payload.text)) {
        // O cliente renderiza chat a partir de `view.chat` (não assina o evento `chat`):
        // sem este broadcast a mensagem só apareceria na próxima mutação da sala.
        broadcastRoom(ctx, room);
        return { ok: true };
      }
      return { ok: false, error: engineError(ERROR_CODES.RATE_LIMITED, 'Muitas mensagens; aguarde um pouco.') };
    }
    default:
      return { ok: false, error: engineError(ERROR_CODES.INVALID_PAYLOAD, 'Comando de lobby inválido.') };
  }
}

// ---------- Comandos de jogo ----------

async function handleCmd(ctx: AppContext, socket: AppSocket, raw: unknown, ack: CmdAckFn): Promise<void> {
  const validated = validateEnvelope(raw);
  if (!validated.ok) {
    ack({ ok: false, requestId: reqIdOf(raw), error: validated.error });
    return;
  }
  const env = validated.value;
  const binding = socket.data.binding;
  if (!binding) {
    ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.AUTH_REQUIRED, 'Conecte-se a uma sala antes de jogar.') });
    return;
  }
  const room = ctx.store.getOpenRoom(binding.roomCode);
  if (!room) {
    ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.NOT_IN_ROOM, 'Sala não encontrada.') });
    return;
  }
  if (!room.state) {
    ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.GAME_NOT_FOUND, 'A partida ainda não começou.') });
    return;
  }
  const playerId = binding.playerId;
  const payloadHash = hashPayload(env.payload);
  await enqueue(ctx, room.code, () => {
    // 1. Idempotência primeiro: um reenvio após sucesso devolve o ack armazenado,
    //    mesmo que a versão já tenha avançado.
    const processed = findProcessed(ctx.db, env.requestId, playerId);
    if (processed) {
      if (processed.payload_hash === payloadHash) {
        ack(JSON.parse(processed.response_json) as CommandResponse);
        return;
      }
      ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.REQUEST_CONFLICT, 'requestId já usado com outro payload.') });
      return;
    }
    const current = room.state;
    if (!current) {
      ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.GAME_NOT_FOUND, 'A partida ainda não começou.') });
      return;
    }
    // 2. Versão base.
    if (env.baseVersion !== current.version) {
      ack({
        ok: false,
        requestId: env.requestId,
        error: engineError(ERROR_CODES.STALE_VERSION, 'Estado desatualizado; reenvie com a versão atual.'),
        version: current.version,
      });
      sendView(ctx, socket, room, playerId);
      return;
    }
    // 3. Motor puro com RNG do servidor (dados forçados só em roll_dice).
    const forced = room.test.forceDice;
    const rng = makeGameRng(roomRng(room), forced, env.payload.type === 'roll_dice', () => {
      room.test.forceDice = null;
    });
    let result: EngineResult;
    try {
      // validateEnvelope já garantiu que o payload é GameCommand.
      result = ctx.engine.applyCommand(current, playerId, env.payload as GameCommand, { rng });
    } catch (err) {
      logError('engine_exception', { roomCode: room.code, message: err instanceof Error ? err.message : String(err) });
      ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.INTERNAL, 'Falha interna ao aplicar o comando.') });
      return;
    }
    if (!result.ok) {
      ack({ ok: false, requestId: env.requestId, error: result.error, version: current.version });
      return;
    }
    // 4. Persistência atômica ANTES do ack/broadcast; memória só troca após commit.
    const next: GameState = { ...result.state, version: current.version + 1 };
    const response: CommandResponse = { ok: true, requestId: env.requestId, version: next.version };
    try {
      persistGameTransition(ctx.db, {
        roomCode: room.code,
        stateJson: JSON.stringify(next),
        phase: next.phase,
        version: next.version,
        updatedAt: Date.now(),
        requestId: env.requestId,
        playerId,
        payloadHash,
        responseJson: JSON.stringify(response),
      });
    } catch (err) {
      logError('persist_failed', { roomCode: room.code, message: err instanceof Error ? err.message : String(err) });
      ack({ ok: false, requestId: env.requestId, error: engineError(ERROR_CODES.INTERNAL, 'Falha ao gravar a partida.') });
      return;
    }
    room.state = next;
    room.phase = next.phase;
    room.updatedAt = Date.now();
    ack(response);
    broadcastRoom(ctx, room);
  });
}

// ---------- Hooks de teste ----------

async function handleHook(ctx: AppContext, socket: AppSocket, raw: unknown, ack: CmdAckFn): Promise<void> {
  const validated = validateHook(raw);
  if (!validated.ok) {
    ack({ ok: false, requestId: reqIdOf(raw), error: validated.error });
    return;
  }
  const hook = validated.value;
  const binding = socket.data.binding;
  if (!binding) {
    ack({ ok: false, requestId: reqIdOf(raw), error: engineError(ERROR_CODES.AUTH_REQUIRED, 'Conecte-se a uma sala antes de usar hooks.') });
    return;
  }
  const room = ctx.store.getOpenRoom(binding.roomCode);
  if (!room) {
    ack({ ok: false, requestId: reqIdOf(raw), error: engineError(ERROR_CODES.NOT_IN_ROOM, 'Sala não encontrada.') });
    return;
  }
  await enqueue(ctx, room.code, () => {
    ack(runHook(ctx, room, hook));
  });
}

function runHook(ctx: AppContext, room: Room, hook: HookCommand): CommandResponse {
  const rid = 'hook';
  switch (hook.type) {
    case 'force_next_dice':
      room.test.forceDice = { d1: hook.d1, d2: hook.d2 };
      return { ok: true, requestId: rid };
    case 'seed_rng':
      room.test.rngSeed = hook.seed;
      room.test.rng = seededRandomSource(hook.seed);
      return { ok: true, requestId: rid };
    case 'load_near_win_fixture': {
      const current = room.state;
      if (!current) return { ok: false, requestId: rid, error: engineError(ERROR_CODES.GAME_NOT_FOUND, 'A partida ainda não começou.') };
      const res = loadNearWinFixture(current);
      if (!res.ok) return { ok: false, requestId: rid, error: res.error };
      const next: GameState = { ...res.state, version: current.version + 1 };
      try {
        tx(ctx.db, () =>
          persistRoomUpdate(ctx.db, { roomCode: room.code, phase: next.phase, version: next.version, stateJson: JSON.stringify(next), updatedAt: Date.now() }),
        );
      } catch (err) {
        logError('persist_failed', { roomCode: room.code, message: err instanceof Error ? err.message : String(err) });
        return { ok: false, requestId: rid, error: engineError(ERROR_CODES.INTERNAL, 'Falha ao gravar a fixture.') };
      }
      room.state = next;
      room.phase = next.phase;
      broadcastRoom(ctx, room);
      return { ok: true, requestId: rid };
    }
  }
}

// ---------- Hub (hub/PROTOCOLO.md) ----------

/** Fecha a sala a pedido do Hub (POST /__hub/close). Idempotente.
 * Com dono (hubToken não vazio): só fecha se o htok conferir; divergente ou
 * ausente => { forbidden: true } (HTTP 403 FORBIDDEN, sala intacta). Fechamento
 * tardio de uma partida antiga nunca atinge a partida nova que reutilizou o
 * código. Sem dono (legado, hubToken ''): só fecha sem htok (legítimo ao jogo);
 * COM htok => 403 e preserva (close afiliado atrasado de outra partida).
 * Sala inexistente => {ok:true, closed:false} (200 idempotente, nada a fazer).
 * Sucesso com sala => {ok:true, closed:true}. */
export function closeHubRoom(ctx: AppContext, rawCode: string, rawToken?: unknown): { ok: true; closed: boolean } | { ok: false; error: 'FORBIDDEN' } {
  const code = String(rawCode ?? '').toUpperCase().trim();
  const room = ctx.store.rooms.get(code);
  if (!room) return { ok: true, closed: false };
  // shortcut: dono confere por igualdade; sem dono, htok presente é de outra partida.
  const provided = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (room.hubToken !== '') {
    if (provided !== room.hubToken) return { ok: false, error: 'FORBIDDEN' };
  } else if (provided !== '') {
    return { ok: false, error: 'FORBIDDEN' };
  }
  // Coerência commit→memória→eventos: o banco confirma primeiro (só DB
  // dentro da tx); memória e eventos só após o commit. Falha no DELETE
  // desfaz o banco e preserva memória/sessões sem evento enganoso (retry ok).
  tx(ctx.db, () => {
    deleteRoomData(ctx.db, room.code);
  });
  const members = [...room.members.values()];
  const targets: { member: (typeof members)[number]; socket: AppSocket | undefined }[] = members.map((member) => ({
    member,
    socket: ctx.sessions.get(sessionKey(room.code, member.playerId)),
  }));
  for (const { member, socket } of targets) {
    if (socket) {
      const key = sessionKey(room.code, member.playerId);
      if (ctx.sessions.get(key) === socket) ctx.sessions.delete(key);
      socket.data.binding = null;
    }
    ctx.store.unindexMember(room, member);
  }
  ctx.store.rooms.delete(room.code);
  for (const { member, socket } of targets) {
    if (socket) socket.emit('session_replaced', { by: member.playerId });
  }
  logInfo('hub_room_closed', { roomCode: room.code });
  return { ok: true, closed: true };
}

/** Hook de teste do Hub (HUB_TEST_HOOKS=1): declara vitória e vai para game_over. */
export function forceHubWin(ctx: AppContext, rawCode: string): boolean {
  const code = String(rawCode ?? '').toUpperCase().trim();
  const room = ctx.store.getOpenRoom(code);
  const state = room?.state;
  if (!room || !state || state.phase === 'game_over') return false;
  const winner = state.players[state.activeIndex] ?? state.players[0];
  if (!winner) return false;
  const next: GameState = { ...state, phase: 'game_over', winnerId: winner.id, version: state.version + 1 };
  try {
    tx(ctx.db, () =>
      persistRoomUpdate(ctx.db, {
        roomCode: room.code,
        phase: next.phase,
        version: next.version,
        stateJson: JSON.stringify(next),
        updatedAt: Date.now(),
      }),
    );
  } catch (err) {
    logError('hub_win_failed', { roomCode: room.code, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
  room.state = next;
  room.phase = next.phase;
  room.updatedAt = Date.now();
  broadcastRoom(ctx, room);
  logInfo('hub_test_win', { roomCode: room.code, winnerId: winner.id });
  return true;
}

// ---------- Chat (evento direto, sem ack) ----------

function handleChatEvent(ctx: AppContext, socket: AppSocket, raw: unknown): void {
  const validated = validateLobbyCommand({ type: 'chat', text: raw });
  if (!validated.ok) {
    logInfo('chat_rejected', { reason: validated.error.message });
    return;
  }
  const binding = socket.data.binding;
  if (!binding) return;
  const room = ctx.store.getOpenRoom(binding.roomCode);
  const member = room?.members.get(binding.playerId);
  if (!room || !member) return;
  const text = validated.value.type === 'chat' ? validated.value.text : '';
  void enqueue(ctx, room.code, () => {
    try {
      persistChat(ctx, room, member, text);
    } catch (err) {
      logError('chat_persist_failed', { roomCode: room.code, message: err instanceof Error ? err.message : String(err) });
    }
  });
}

// ---------- Wiring ----------

function onDisconnect(ctx: AppContext, socket: AppSocket): void {
  const binding = socket.data.binding;
  if (!binding) return;
  const key = sessionKey(binding.roomCode, binding.playerId);
  socket.data.binding = null;
  if (ctx.sessions.get(key) !== socket) return;
  ctx.sessions.delete(key);
  const room = ctx.store.getOpenRoom(binding.roomCode);
  const member = room?.members.get(binding.playerId);
  if (!room || !member) return;
  member.connected = false;
  emitPresence(ctx, room, member.playerId, false);
}

export function attachSocket(ctx: AppContext): void {
  ctx.io.on('connection', (socket: AppSocket) => {
    socket.data.binding = null;
    socket.data.lobbyRate = { create: [], join: [] };
    socket.on('lobby', (raw: unknown, ack: LobbyAckFn) => {
      void handleLobby(ctx, socket, raw, typeof ack === 'function' ? ack : () => {}).catch((err) => {
        logError('lobby_handler_failed', { message: err instanceof Error ? err.message : String(err) });
      });
    });
    socket.on('cmd', (raw: unknown, ack: CmdAckFn) => {
      void handleCmd(ctx, socket, raw, typeof ack === 'function' ? ack : () => {}).catch((err) => {
        logError('cmd_handler_failed', { message: err instanceof Error ? err.message : String(err) });
      });
    });
    socket.on('chat', (raw: unknown) => {
      handleChatEvent(ctx, socket, raw);
    });
    if (ctx.config.testHooks) {
      socket.on('hook', (raw: unknown, ack: CmdAckFn) => {
        void handleHook(ctx, socket, raw, typeof ack === 'function' ? ack : () => {}).catch((err) => {
          logError('hook_handler_failed', { message: err instanceof Error ? err.message : String(err) });
        });
      });
    }
    socket.on('disconnect', () => {
      onDisconnect(ctx, socket);
    });
  });
}
