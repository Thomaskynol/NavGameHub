import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/engine';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { GameState } from '../../src/shared/types';
import {
  act,
  expectErr,
  finishSetup,
  giveCards,
  legalFreeRoads,
  makeRng,
  newGame,
  resetBoard,
  setBank,
  toAction,
} from './helpers';

/** Estado em action do p0 com mãos zeradas e banco cheio (produção do roll descartada). */
function devScenario(): GameState {
  const setup = finishSetup(newGame(3, 'dev'), makeRng('dev'));
  const rolled = toAction(setup); // p0 em action
  const s = structuredClone(rolled);
  for (const p of s.players) {
    for (const k of Object.keys(p.resources) as (keyof typeof p.resources)[]) p.resources[k] = 0;
    p.devCards = [];
    p.boughtThisTurn = [];
    p.playedActionCardThisTurn = false;
  }
  setBank(s, { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
  return s;
}

describe('cartas de desenvolvimento', () => {
  it('compra: paga custo, tira do topo, registra boughtThisTurn e evento oculto', () => {
    const s = devScenario();
    s.devDeck = [
      { id: 'd1', kind: 'knight' },
      { id: 'd2', kind: 'monopoly' },
      { id: 'd3', kind: 'victoryPoint' },
    ];
    giveCards(s, 'p0', { wool: 1, grain: 1, ore: 1 });
    const r = applyCommand(s, 'p0', { type: 'buy_dev_card' }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p0 = r.state.players.find((p) => p.id === 'p0')!;
    expect(p0.devCards).toEqual([{ id: 'd3', kind: 'victoryPoint' }]); // topo = fim do array
    expect(p0.boughtThisTurn).toEqual(['d3']);
    expect(p0.resources).toEqual({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
    expect(r.state.devDeck).toEqual([
      { id: 'd1', kind: 'knight' },
      { id: 'd2', kind: 'monopoly' },
    ]);
    expect(r.state.history.events.some((e) => e.type === 'bought_dev_card')).toBe(true);
  });

  it('monte vazio => DEV_DECK_EMPTY; sem recursos => INSUFFICIENT_RESOURCES', () => {
    let s = devScenario();
    s.devDeck = [];
    giveCards(s, 'p0', { wool: 1, grain: 1, ore: 1 });
    expectErr(applyCommand(s, 'p0', { type: 'buy_dev_card' }, { rng: makeRng('x') }), ERROR_CODES.DEV_DECK_EMPTY);
    s = devScenario();
    s.devDeck = [{ id: 'd1', kind: 'knight' }];
    expectErr(applyCommand(s, 'p0', { type: 'buy_dev_card' }, { rng: makeRng('x') }), ERROR_CODES.INSUFFICIENT_RESOURCES);
  });

  it('compra antes do roll (pre_roll) rejeitada', () => {
    const s = finishSetup(newGame(3, 'prebuy'), makeRng('prebuy'));
    const actor = s.players[s.activeIndex].id;
    giveCards(s, actor, { wool: 1, grain: 1, ore: 1 });
    expectErr(applyCommand(s, actor, { type: 'buy_dev_card' }, { rng: makeRng('x') }), ERROR_CODES.WRONG_PHASE);
  });

  it('várias compras por turno permitidas; todas bloqueadas para jogar no mesmo turno', () => {
    let s = devScenario();
    s.devDeck = [
      { id: 'a', kind: 'roadBuilding' },
      { id: 'b', kind: 'roadBuilding' },
    ];
    giveCards(s, 'p0', { wool: 2, grain: 2, ore: 2 });
    s = act(s, { type: 'buy_dev_card' }, makeRng('x'));
    s = act(s, { type: 'buy_dev_card' }, makeRng('x'));
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.devCards.length).toBe(2);
    expect(p0.boughtThisTurn.sort()).toEqual(['a', 'b']);
    expectErr(applyCommand(s, 'p0', { type: 'play_road_building' }, { rng: makeRng('x') }), ERROR_CODES.DEV_BOUGHT_THIS_TURN);
  });

  it('construção de estradas: 2 estradas gratuitas, retorna à fase de origem', () => {
    let s = resetBoard(devScenario());
    // p0 com rede mínima: settlement + estradas legais
    const verts = Object.keys(s.board.vertexEdges);
    const v0 = verts[0];
    s.buildings.push({ vertexId: v0, playerId: 'p0', kind: 'settlement' });
    const e0 = s.board.vertexEdges[v0][0];
    s.roads.push({ edgeId: e0, playerId: 'p0' });
    s.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'rb', kind: 'roadBuilding' }); // compra de turno anterior
    const free = legalFreeRoads(s, 'p0');
    expect(free.length).toBeGreaterThanOrEqual(2);
    s = act(s, { type: 'play_road_building' }, makeRng('x'));
    expect(s.phase).toBe('dev_road_building');
    expect(s.pending).toEqual({ type: 'road_building', playerId: 'p0', roadsLeft: 2 });
    const roadsBefore = s.roads.length;
    const giveBefore = { ...s.players.find((p) => p.id === 'p0')!.resources };
    s = act(s, { type: 'place_free_road', edgeId: free[0] }, makeRng('x'));
    expect(s.roads.length).toBe(roadsBefore + 1);
    expect(s.pending).toEqual({ type: 'road_building', playerId: 'p0', roadsLeft: 1 });
    s = act(s, { type: 'place_free_road', edgeId: free[1] }, makeRng('x'));
    expect(s.roads.length).toBe(roadsBefore + 2);
    expect(s.phase).toBe('action');
    expect(s.pending).toBeNull();
    // gratuitas: não consumiram recursos
    expect(s.players.find((p) => p.id === 'p0')!.resources).toEqual(giveBefore);
  });

  it('construção de estradas: encerra cedo e não coloca em aresta ocupada', () => {
    let s = resetBoard(devScenario());
    const verts = Object.keys(s.board.vertexEdges);
    const v0 = verts[0];
    s.buildings.push({ vertexId: v0, playerId: 'p0', kind: 'settlement' });
    s.roads.push({ edgeId: s.board.vertexEdges[v0][0], playerId: 'p0' });
    s.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'rb', kind: 'roadBuilding' });
    s = act(s, { type: 'play_road_building' }, makeRng('x'));
    // aresta ocupada
    expectErr(applyCommand(s, 'p0', { type: 'place_free_road', edgeId: s.roads[0].edgeId }, { rng: makeRng('x') }), ERROR_CODES.INVALID_POSITION);
    // encerra cedo
    s = act(s, { type: 'finish_road_building' }, makeRng('x'));
    expect(s.phase).toBe('action');
    expect(s.pending).toBeNull();
  });

  it('monopólio: adversários entregam todas as cartas do tipo', () => {
    let s = devScenario();
    s.players.find((p) => p.id === 'p1')!.resources.lumber = 3;
    s.players.find((p) => p.id === 'p2')!.resources.lumber = 2;
    s.bank.lumber -= 5;
    s.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'm', kind: 'monopoly' }); // compra de turno anterior
    const bankBefore = s.bank.lumber;
    s = act(s, { type: 'play_monopoly', resource: 'lumber' }, makeRng('x'));
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.lumber).toBe(5);
    expect(s.players.find((p) => p.id === 'p1')!.resources.lumber).toBe(0);
    expect(s.players.find((p) => p.id === 'p2')!.resources.lumber).toBe(0);
    expect(s.bank.lumber).toBe(bankBefore); // transferência entre jogadores, banco intacto
    expect(s.phase).toBe('action');
    expect(p0.devCards.length).toBe(0);
  });

  it('fartura: banco limitado toma o que houver (0–2)', () => {
    let s = devScenario();
    s.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'y', kind: 'yearOfPlenty' });
    // banco tem 1 grão e 0 lã
    s.bank.grain = 1;
    s.bank.wool = 0;
    s = act(s, { type: 'play_year_of_plenty', resources: ['grain', 'wool'] }, makeRng('x'));
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.grain).toBe(1);
    expect(p0.resources.wool).toBe(0);
    expect(s.bank.grain).toBe(0);
    expect(s.phase).toBe('action');
    const ev = s.history.events.find((e) => e.type === 'played_dev_card' && e.card === 'yearOfPlenty');
    expect(ev).toBeDefined();
    // banco totalmente esgoto: consome a carta e toma 0
    let s2 = devScenario();
    s2.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'y2', kind: 'yearOfPlenty' });
    s2.bank.grain = 0;
    s2.bank.wool = 0;
    const g0 = s2.players.find((p) => p.id === 'p0')!.resources.grain;
    s2 = act(s2, { type: 'play_year_of_plenty', resources: ['grain', 'wool'] }, makeRng('x'));
    expect(s2.players.find((p) => p.id === 'p0')!.resources.grain).toBe(g0);
    expect(s2.players.find((p) => p.id === 'p0')!.devCards.length).toBe(0);
  });

  it('fartura: recurso inválido e quantidade inválida rejeitados', () => {
    const s = devScenario();
    s.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'y', kind: 'yearOfPlenty' });
    expectErr(
      applyCommand(s, 'p0', { type: 'play_year_of_plenty', resources: ['grain', 'wool', 'ore'] as never }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it('comprar a VP final vence na hora', () => {
    const s = devScenario();
    //9 pontos públicos: 4 cidades + 1 assentamento
    for (let i = 0; i < 5; i++) {
      const v = s.board.vertices[i * 3];
      s.buildings.push({ vertexId: v, playerId: 'p0', kind: i < 4 ? 'city' : 'settlement' });
    }
    s.devDeck = [{ id: 'vp', kind: 'victoryPoint' }];
    giveCards(s, 'p0', { wool: 1, grain: 1, ore: 1 });
    const r = applyCommand(s, 'p0', { type: 'buy_dev_card' }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winnerId).toBe('p0');
    // qualquer comando após o fim é rejeitado
    expectErr(applyCommand(r.state, 'p0', { type: 'end_turn' }, { rng: makeRng('x') }), ERROR_CODES.INVALID_STATE);
    expectErr(applyCommand(r.state, 'p1', { type: 'roll_dice' }, { rng: makeRng('x') }), ERROR_CODES.INVALID_STATE);
  });
});
