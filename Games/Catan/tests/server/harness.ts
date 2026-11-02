// Harness de testes do servidor: app real (HTTP+Socket.IO) em porta efetiva,
// engine fake via DI, helpers de socket/lobby/cmd.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { ROOM_CODE_ALPHABET } from '../../src/shared/constants';
import type { CommandResponse, GameCommand, GameView, LobbyAck, LobbyCommand, SessionPayload } from '../../src/shared/protocol';
import type { EngineResult, RandomSource } from '../../src/shared/types';
import type { GameEngineApi } from '../../src/server/engine';
import { createApp, type App } from '../../src/server/http';
import type { ServerConfig } from '../../src/server/types';

export interface FakeEngine extends GameEngineApi {
  calls: number;
}

/** Motor mínimo determinístico: histórico, dice via rng, dev cards, estradas. */
export function fakeEngine(): FakeEngine {
  let devSeq = 0;
  const engine: FakeEngine = {
    calls: 0,
    createGame({ players, boardSeed }) {
      const vertices = ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6'];
      const edges = ['v0|v1', 'v1|v2', 'v2|v3', 'v3|v4', 'v4|v5', 'v5|v6'];
      const edgeEndpoints: Record<string, [string, string]> = {};
      for (let i = 0; i < 6; i += 1) edgeEndpoints[edges[i]] = [vertices[i], vertices[i + 1]];
      return {
        phase: 'setup_settlement',
        players: players.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
          devCards: [],
          boughtThisTurn: [],
          playedActionCardThisTurn: false,
          knightsPlayed: 0,
          pieces: { roads: 15, settlements: 5, cities: 4 },
        })),
        activeIndex: 0,
        board: {
          hexes: [{ id: '0,0', terrain: 'forest', number: 5 }],
          vertices,
          edges,
          edgeEndpoints,
          vertexHexes: {},
          vertexEdges: {},
          hexEdges: {},
          hexNeighbors: {},
          ports: [],
        },
        buildings: [],
        roads: [],
        robberHexId: '0,0',
        bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 },
        devDeck: Array.from({ length: 25 }, (_, i) => ({ id: `deck${i}`, kind: 'knight' as const })),
        dice: null,
        returnPhase: null,
        setup: { queue: players.map((p) => p.id), pos: 0, lastSettlementVertex: null },
        pending: null,
        largestRoad: { playerId: null, value: 0 },
        largestArmy: { playerId: null, value: 0 },
        offers: [],
        history: { events: [], meta: {} },
        historySeq: 0,
        version: 0,
        winnerId: null,
        boardSeed,
      };
    },
    applyCommand(state, playerId, cmd, deps: { rng: RandomSource }): EngineResult {
      engine.calls += 1;
      if ((cmd as { edgeId?: string }).edgeId === 'throw') throw new Error('boom interno do motor');
      if ((cmd as { edgeId?: string }).edgeId === 'err') {
        return { ok: false, error: { code: 'INVALID_POSITION', message: 'posição inválida (fake)' } };
      }
      const s = structuredClone(state);
      const player = s.players.find((p) => p.id === playerId);
      if (!player) return { ok: false, error: { code: 'INVALID_STATE', message: 'jogador desconhecido' } };
      const push = (ev: object, visibility: 'public' | 'private' = 'public', audience?: string[]): void => {
        s.historySeq += 1;
        (s.history.events as unknown[]).push({ ...ev, seq: s.historySeq });
        s.history.meta[s.historySeq] = audience ? { visibility, audience } : { visibility };
      };
      switch (cmd.type) {
        case 'roll_dice': {
          const d1 = 1 + Math.floor(deps.rng.next() * 6);
          const d2 = 1 + Math.floor(deps.rng.next() * 6);
          s.dice = { d1, d2 };
          player.resources.brick += 1; // mão privada para teste de projeção
          push({ type: 'dice', playerId, d1, d2 });
          break;
        }
        case 'end_turn': {
          const nextIndex = (s.activeIndex + 1) % s.players.length;
          push({ type: 'turn_ended', playerId, nextPlayerId: s.players[nextIndex].id });
          s.activeIndex = nextIndex;
          break;
        }
        case 'buy_dev_card': {
          devSeq += 1;
          const card = { id: `dc${devSeq}`, kind: 'knight' as const };
          player.devCards.push(card);
          player.boughtThisTurn.push(card.id);
          push({ type: 'bought_dev_card', playerId });
          break;
        }
        case 'build_road': {
          s.roads.push({ edgeId: cmd.edgeId, playerId });
          player.pieces.roads -= 1;
          push({ type: 'built', playerId, kind: 'road', edgeId: cmd.edgeId });
          break;
        }
        default:
          push({ type: 'dice', playerId, d1: 1, d2: 1 });
      }
      return { ok: true, state: s };
    },
    publicVictoryPoints: (state, id) =>
      state.buildings.filter((b) => b.playerId === id).reduce((n, b) => n + (b.kind === 'city' ? 2 : 1), 0),
    totalVictoryPoints(state, id) {
      return this.publicVictoryPoints(state, id);
    },
    bestBankRate: () => 4,
    computeLongestRoad: (state, id) => state.roads.filter((r) => r.playerId === id).length,
  };
  return engine;
}

export interface Harness {
  app: App;
  url: string;
  dbPath: string;
  engine: FakeEngine;
  config: ServerConfig;
  connect(): Promise<ClientSocket>;
  close(opts?: { keepDb?: boolean }): Promise<void>;
}

export async function startHarness(opts: { hooks?: boolean; engine?: FakeEngine; dbPath?: string } = {}): Promise<Harness> {
  const reused = opts.dbPath !== undefined;
  const dir = reused ? dirname(opts.dbPath as string) : mkdtempSync(join(tmpdir(), 'catan-test-'));
  if (reused) mkdirSync(dir, { recursive: true });
  const dbPath = reused ? (opts.dbPath as string) : join(dir, 'catan.db');
  const engine = opts.engine ?? fakeEngine();
  const config: ServerConfig = {
    nodeEnv: 'development',
    port: 0,
    host: '127.0.0.1',
    dbPath,
    allowedOrigin: null,
    testHooks: opts.hooks ?? true,
  };
  const app = createApp({ config, engine });
  const port = await app.start();
  const url = `http://127.0.0.1:${port}`;
  return {
    app,
    url,
    dbPath,
    engine,
    config,
    connect: () =>
      new Promise<ClientSocket>((resolve, reject) => {
        const socket = ioc(url, { transports: ['websocket'], forceNew: true });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
      }),
    async close(closeOpts) {
      await app.stop();
      if (!closeOpts?.keepDb) rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------- Cliente ----------

let ridSeq = 0;
export function rid(): string {
  ridSeq += 1;
  return `req-${Date.now()}-${ridSeq}`;
}

export type LobbyResult = CommandResponse | LobbyAck;

export function isSessionAck(res: LobbyResult): res is Extract<LobbyAck, { ok: true }> {
  return res.ok === true && 'session' in res;
}

export function lobbyAckOk(res: LobbyResult): asserts res is Extract<LobbyAck, { ok: true }> {
  if (!res.ok) throw new Error(`lobby falhou: ${res.error.code} ${res.error.message}`);
  if (!('session' in res)) throw new Error('ack não é SessionPayload');
}

export function lobby(socket: ClientSocket, payload: LobbyCommand, requestId = rid()): Promise<LobbyResult> {
  return new Promise((resolve) => {
    socket.emit('lobby', { requestId, payload }, (res: LobbyResult) => resolve(res));
  });
}

export function cmd(socket: ClientSocket, payload: GameCommand, opts: { requestId?: string; baseVersion?: number } = {}): Promise<CommandResponse> {
  const envelope = opts.baseVersion === undefined ? { requestId: opts.requestId ?? rid(), payload } : { requestId: opts.requestId ?? rid(), baseVersion: opts.baseVersion, payload };
  return new Promise((resolve) => {
    socket.emit('cmd', envelope, (res: CommandResponse) => resolve(res));
  });
}

export function hook(socket: ClientSocket, payload: unknown): Promise<CommandResponse> {
  return new Promise((resolve) => {
    socket.emit('hook', payload, (res: CommandResponse) => resolve(res));
  });
}

export interface Collector {
  states: GameView[];
  chats: { text: string; playerId: string }[];
  presence: { playerId: string; connected: boolean }[];
  replaced: { by: string }[];
  conflicts: { roomCode: string; playerId: string }[];
}

export function collect(socket: ClientSocket): Collector {
  const c: Collector = { states: [], chats: [], presence: [], replaced: [], conflicts: [] };
  socket.on('state', (v: GameView) => c.states.push(v));
  socket.on('chat', (m: { text: string; playerId: string }) => c.chats.push(m));
  socket.on('presence', (i: { playerId: string; connected: boolean }) => c.presence.push(i));
  socket.on('session_replaced', (i: { by: string }) => c.replaced.push(i));
  socket.on('bind_conflict', (i: { roomCode: string; playerId: string }) => c.conflicts.push(i));
  return c;
}

export function nextView(socket: ClientSocket): Promise<GameView> {
  return new Promise((resolve) => {
    socket.once('state', (v: GameView) => resolve(v));
  });
}

/** Espera a primeira view que satisfaz o predicado (evita race com broadcasts anteriores). */
export function nextViewMatching(socket: ClientSocket, pred: (v: GameView) => boolean, timeoutMs = 5000): Promise<GameView> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('state', handler);
      reject(new Error('timeout esperando view'));
    }, timeoutMs);
    const handler = (v: GameView): void => {
      if (!pred(v)) return;
      clearTimeout(timer);
      socket.off('state', handler);
      resolve(v);
    };
    socket.on('state', handler);
  });
}

/** Emite 'hook' com timeout: { timeout: true } quando o servidor não tem o handler. */
export function emitHook(socket: ClientSocket, payload: unknown, ms = 800): Promise<{ timeout: boolean; res?: CommandResponse }> {
  return new Promise((resolve) => {
    socket.timeout(ms).emit('hook', payload, (err: Error | null, res?: CommandResponse) => {
      resolve(err ? { timeout: true } : { timeout: false, res });
    });
  });
}

export async function createRoom(h: Harness, nickname: string): Promise<{ socket: ClientSocket; session: SessionPayload }> {
  const socket = await h.connect();
  const res = await lobby(socket, { type: 'create_room', nickname });
  lobbyAckOk(res);
  return { socket, session: res.session };
}

export async function joinRoom(h: Harness, code: string, nickname: string): Promise<{ socket: ClientSocket; session: SessionPayload }> {
  const socket = await h.connect();
  const res = await lobby(socket, { type: 'join_room', code, nickname });
  lobbyAckOk(res);
  return { socket, session: res.session };
}

/** Sala com N jogadores prontos e partida iniciada (seed fixa). */
export async function startedRoom(
  h: Harness,
  n = 3,
): Promise<{ code: string; sockets: ClientSocket[]; sessions: SessionPayload[] }> {
  const host = await createRoom(h, 'Ana');
  const code = host.session.roomCode;
  const sockets = [host.socket];
  const sessions = [host.session];
  for (let i = 1; i < n; i += 1) {
    const j = await joinRoom(h, code, `P${i}`);
    sockets.push(j.socket);
    sessions.push(j.session);
  }
  for (const s of sockets) {
    const res = await lobby(s, { type: 'set_ready', ready: true });
    if (!res.ok) throw new Error(`set_ready falhou: ${res.error.code}`);
  }
  const start = await lobby(sockets[0], { type: 'start_game', boardSeed: 'seed-fixa' });
  if (!start.ok) throw new Error(`start_game falhou: ${start.error.code}`);
  return { code, sockets, sessions };
}

export function assertCodeValid(code: string): void {
  if (code.length !== 5) throw new Error(`código inválido: ${code}`);
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) throw new Error(`caractere inválido no código: ${ch}`);
  }
}
