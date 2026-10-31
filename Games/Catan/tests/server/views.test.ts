// Projeções: privacidade de mãos alheias; erro interno sem vazamento de stack; lobby.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cmd, lobby, nextView, nextViewMatching, startedRoom, startHarness, type Harness } from './harness';
import * as realEngine from '../../src/engine';
import { buildGameView, buildLobbyView } from '../../src/server/views';
import type { Room } from '../../src/server/rooms';
import type { GameState } from '../../src/shared/types';
import type { PlayerColor } from '../../src/shared/constants';

describe('projeções', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('jogador A nao ve mao de B: sem resources/devCards alheios e sem ids de cartas', async () => {
    const { sockets } = await startedRoom(h, 3);
    // B (indice 1) compra dev card.
    const buy = await cmd(sockets[1], { type: 'buy_dev_card' }, { baseVersion: 0 });
    expect(buy.ok).toBe(true);
    // A (indice 0) rola dados (ganha 1 brick no fake); espera a view pós-roll.
    const viewP = nextViewMatching(sockets[0], (v) => v.version === 2);
    const roll = await cmd(sockets[0], { type: 'roll_dice' }, { baseVersion: 1 });
    expect(roll.ok).toBe(true);
    const view = await viewP;
    const b = view.players[1];
    expect(b.devCardsCount).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(b, 'devCards')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(b, 'resources')).toBe(false);
    expect(view.you.devCards.length).toBe(0); // mao propria vazia; a de B nao aparece
    expect(view.you.resources.brick).toBe(1); // proprio jogador ve a propria mao
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('dc1'); // id da carta privada de B
    expect(serialized).not.toContain('deck'); // ordem do baralho nunca sai
  });

  it('erro do motor nao vaza stack; INTERNAL mensagem generica', async () => {
    const { sockets } = await startedRoom(h, 3);
    const res = await cmd(sockets[0], { type: 'build_road', edgeId: 'throw' }, { baseVersion: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('INTERNAL');
      expect(res.error.message).not.toContain('boom');
      expect(JSON.stringify(res)).not.toMatch(/stack|\.ts:/);
    }
  });

  it('view de lobby antes do jogo: phase lobby, versao 0; apos inicio, phase do motor', async () => {
    const socket = await h.connect();
    const viewP = nextView(socket);
    const res = await lobby(socket, { type: 'create_room', nickname: 'Lia' });
    expect(res.ok).toBe(true);
    const lobbyView = await viewP;
    expect(lobbyView.phase).toBe('lobby');
    expect(lobbyView.version).toBe(0);
    expect(lobbyView.players.length).toBe(1);
    expect(lobbyView.players[0].isHost).toBe(true);

    const started = await startedRoom(h, 3);
    const inGameP = nextViewMatching(started.sockets[2], (v) => v.version === 1);
    const roll = await cmd(started.sockets[2], { type: 'roll_dice' }, { baseVersion: 0 });
    expect(roll.ok).toBe(true);
    const inGame = await inGameP;
    expect(inGame.phase).toBe('setup_settlement');
  });
});

// ---------- Campos novos da GameView: estado real de setup + pendências ----------

describe('view de setup e pendências (motor real)', () => {
  const players = [
    { id: 'p0', name: 'Ana', color: 'red' as PlayerColor },
    { id: 'p1', name: 'Bia', color: 'orange' as PlayerColor },
    { id: 'p2', name: 'Caio', color: 'white' as PlayerColor },
  ];
  const rng = { next: () => 0.1 };

  function stubRoom(state: GameState): Room {
    return {
      code: 'ABCDE',
      name: 'Sala',
      hostPlayerId: 'p0',
      hubToken: '',
      state,
      phase: state.phase,
      boardSeed: state.boardSeed,
      members: new Map(
        players.map((p, i) => [
          p.id,
          {
            playerId: p.id,
            name: p.name,
            color: p.color,
            recoveryHash: `hash-${p.id}`,
            isHost: i === 0,
            ready: true,
            joinedAt: 0,
            connected: true,
          },
        ]),
      ),
      chat: [],
      closed: false,
      createdAt: 0,
      updatedAt: 0,
      test: { forceDice: null, rngSeed: null, rng: null },
    };
  }

  it('expõe fila snake, posicao e ultimo vértice de setup; pendências trazem playerId/waitingOn', () => {
    let state = realEngine.createGame({ players, boardSeed: 'view-setup-seed', rng });
    const room = stubRoom(state);
    const you = 'p0';

    let view = buildGameView(realEngine, state, room, you, []);
    expect(view.setupQueue).toEqual(['p0', 'p1', 'p2', 'p2', 'p1', 'p0']);
    expect(view.setupPos).toBe(0);
    expect(view.setupLastSettlementVertex).toBeNull();
    expect(view.setupCurrentPlayerId).toBe('p0');
    expect(view.pending).toBeNull();

    // Assentamento de p0 => fase setup_road com o vértice real exposto.
    const hints = realEngine.legalBuildTargets(state, 'p0');
    const res = realEngine.applyCommand(state, 'p0', { type: 'setup_settlement', vertexId: hints.setupVertices[0] }, { rng });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.state;
    room.state = state;
    view = buildGameView(realEngine, state, room, you, []);
    expect(view.phase).toBe('setup_road');
    expect(view.setupPos).toBe(0);
    expect(view.setupLastSettlementVertex).toBe(hints.setupVertices[0]);
    expect(view.setupCurrentPlayerId).toBe('p0');

    // Pendência com dono: road_building carrega playerId + roadsLeft.
    const withPending = structuredClone(state);
    withPending.phase = 'dev_road_building';
    withPending.pending = { type: 'road_building', playerId: 'p1', roadsLeft: 2 };
    const v2 = buildGameView(realEngine, withPending, room, you, []);
    expect(v2.pending).toEqual({ type: 'road_building', yourAction: false, waitingOn: ['p1'], playerId: 'p1', roadsLeft: 2 });

    // Pendência global: discard carrega waitingOn (sem playerId).
    const withDiscard = structuredClone(state);
    withDiscard.phase = 'await_discards';
    withDiscard.pending = { type: 'discard', waitingOn: ['p1', 'p2'] };
    const v3 = buildGameView(realEngine, withDiscard, room, you, []);
    expect(v3.pending).toEqual({ type: 'discard', yourAction: false, waitingOn: ['p1', 'p2'] });
    expect(v3.pending?.playerId).toBeUndefined();
  });

  it('lobby view traz campos de setup vazios', () => {
    const state = realEngine.createGame({ players, boardSeed: 'view-lobby-seed', rng });
    const room = stubRoom(state);
    room.state = null;
    room.phase = 'lobby';
    const view = buildLobbyView(room, 'p0', []);
    expect(view.phase).toBe('lobby');
    expect(view.setupQueue).toEqual([]);
    expect(view.setupPos).toBe(0);
    expect(view.setupLastSettlementVertex).toBeNull();
    expect(view.setupCurrentPlayerId).toBeNull();
    expect(view.pending).toBeNull();
  });
});
