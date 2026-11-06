// R2: após a 1ª free_road em dev_road_building, a UI precisa permitir a 2ª
// (buildMode local é zerado pelo send e se perde no reload — a fase da view
// é a fonte da verdade). RED: isOwnFreeRoadPhase ainda não existe.
import { describe, expect, it } from 'vitest';
import * as realEngine from '../../src/engine';
import { legalBuildTargets } from '../../src/engine/legal';
import { buildGameView } from '../../src/server/views';
import type { Room } from '../../src/server/rooms';
import type { GameView, PendingView } from '../../src/shared/protocol';
import type { GameState } from '../../src/shared/types';
import { isOwnFreeRoadPhase } from '../../src/client/screens/Game';
import {
  act,
  finishSetup,
  legalFreeRoads,
  makeRng,
  newGame,
  resetBoard,
  toAction,
} from '../engine/helpers';

type ViewLike = Pick<GameView, 'phase' | 'pending'>;

function pendingRoad(playerId: string, roadsLeft: number): PendingView {
  return { type: 'road_building', yourAction: true, waitingOn: [playerId], playerId, roadsLeft };
}

/** Sala mínima p/ a projeção real do servidor (sem I/O; só monta o objeto). */
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
      state.players.map((p, i) => [
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

/** Cenário real do motor: p0 em action com 1 settlement + 1 estrada e carta antiga. */
function roadScenario() {
  let s = resetBoard(finishSetup(newGame(3, 'r2'), makeRng('r2')));
  const v0 = Object.keys(s.board.vertexEdges)[0];
  s.buildings.push({ vertexId: v0, playerId: 'p0', kind: 'settlement' });
  s.roads.push({ edgeId: s.board.vertexEdges[v0][0], playerId: 'p0' });
  s.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'rb', kind: 'roadBuilding' });
  s = toAction(s); // p0 em action (tabuleiro limpo => sem produção no roll)
  s = act(s, { type: 'play_road_building' }, makeRng('x'));
  return s;
}

describe('isOwnFreeRoadPhase (2ª estrada gratuita não se perde)', () => {
  it('após a 1ª free_road (roadsLeft 1, buildMode zerado/reload) => true', () => {
    const view: ViewLike = { phase: 'dev_road_building', pending: pendingRoad('p0', 1) };
    expect(isOwnFreeRoadPhase(view, 'p0')).toBe(true);
  });

  it('com 2 restantes => true', () => {
    const view: ViewLike = { phase: 'dev_road_building', pending: pendingRoad('p0', 2) };
    expect(isOwnFreeRoadPhase(view, 'p0')).toBe(true);
  });

  it('negativo: pendência de outro jogador => false (sem build gratuito alheio)', () => {
    const view: ViewLike = { phase: 'dev_road_building', pending: pendingRoad('p1', 2) };
    expect(isOwnFreeRoadPhase(view, 'p0')).toBe(false);
  });

  it('negativo: fora da fase (action) => false (build pago segue com gate)', () => {
    const view: ViewLike = { phase: 'action', pending: null };
    expect(isOwnFreeRoadPhase(view, 'p0')).toBe(false);
  });

  it('negativo: após a 2ª estrada / fim antecipado (fase de origem) => false', () => {
    const action: ViewLike = { phase: 'action', pending: null };
    expect(isOwnFreeRoadPhase(action, 'p0')).toBe(false);
    const preRoll: ViewLike = { phase: 'pre_roll', pending: null };
    expect(isOwnFreeRoadPhase(preRoll, 'p0')).toBe(false);
  });
});

describe('integração motor real (servidor/engine inalterados)', () => {
  it('1ª free_road mantém fase+pendência e há aresta legal p/ a 2ª; 2ª volta à origem sem gastar recursos', () => {
    let s = roadScenario();
    expect(s.phase).toBe('dev_road_building');
    const free = legalFreeRoads(s, 'p0');
    expect(free.length).toBeGreaterThanOrEqual(2);
    const resBefore = { ...s.players.find((p) => p.id === 'p0')!.resources };

    s = act(s, { type: 'place_free_road', edgeId: free[0] }, makeRng('x'));
    expect(s.phase).toBe('dev_road_building');
    expect(s.pending).toEqual({ type: 'road_building', playerId: 'p0', roadsLeft: 1 });
    // Reload/reconnect: o cliente novo recebe a projeção REAL do servidor —
    // fase + pendência com dono e roadsLeft (views.ts buildPendingView).
    const room = stubRoom(s);
    const reloaded = buildGameView(realEngine, s, room, 'p0', []);
    expect(reloaded.phase).toBe('dev_road_building');
    expect(reloaded.pending).toMatchObject({ type: 'road_building', playerId: 'p0', roadsLeft: 1 });
    expect(isOwnFreeRoadPhase(reloaded, 'p0')).toBe(true);
    // Adversário com a própria projeção não ganha o modo gratuito.
    const foe = buildGameView(realEngine, s, room, 'p1', []);
    expect(isOwnFreeRoadPhase(foe, 'p1')).toBe(false);
    // Motor real ainda oferece aresta p/ a 2ª (via projeção legal do cliente).
    expect(legalBuildTargets(s, 'p0').freeRoadEdges.length).toBeGreaterThanOrEqual(1);

    s = act(s, { type: 'place_free_road', edgeId: free[1] }, makeRng('x'));
    expect(s.phase).toBe('action');
    expect(s.pending).toBeNull();
    const done: ViewLike = { phase: s.phase, pending: null };
    expect(isOwnFreeRoadPhase(done, 'p0')).toBe(false);
    // Gratuitas: recursos intactos, só o estoque de peças caiu em 2.
    expect(s.players.find((p) => p.id === 'p0')!.resources).toEqual(resBefore);
    expect(s.players.find((p) => p.id === 'p0')!.pieces.roads).toBe(15 - 2);
  });

  it('fim antecipado: finish_road_building devolve à origem e fecha o modo gratuito', () => {
    let s = roadScenario();
    s = act(s, { type: 'finish_road_building' }, makeRng('x'));
    expect(s.phase).toBe('action');
    expect(s.pending).toBeNull();
    expect(isOwnFreeRoadPhase({ phase: s.phase, pending: null }, 'p0')).toBe(false);
  });

  it('pré-roll: carta jogada antes dos dados volta a pre_roll após as 2 gratuitas', () => {
    let s = resetBoard(finishSetup(newGame(3, 'r2pre'), makeRng('r2pre')));
    const me = s.players[s.activeIndex].id;
    const v0 = Object.keys(s.board.vertexEdges)[0];
    s.buildings.push({ vertexId: v0, playerId: me, kind: 'settlement' });
    s.roads.push({ edgeId: s.board.vertexEdges[v0][0], playerId: me });
    s.players.find((p) => p.id === me)!.devCards.push({ id: 'rb', kind: 'roadBuilding' });
    expect(s.phase).toBe('pre_roll');
    s = act(s, { type: 'play_road_building' }, makeRng('x'));
    expect(s.phase).toBe('dev_road_building');
    const free = legalFreeRoads(s, me);
    expect(free.length).toBeGreaterThanOrEqual(2);
    s = act(s, { type: 'place_free_road', edgeId: free[0] }, makeRng('x'));
    expect(isOwnFreeRoadPhase({ phase: s.phase, pending: { type: 'road_building', yourAction: true, waitingOn: [me], playerId: me, roadsLeft: 1 } }, me)).toBe(true);
    s = act(s, { type: 'place_free_road', edgeId: free[1] }, makeRng('x'));
    expect(s.phase).toBe('pre_roll');
    expect(isOwnFreeRoadPhase({ phase: s.phase, pending: null }, me)).toBe(false);
  });
});
