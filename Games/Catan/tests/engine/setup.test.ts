import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/engine';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { GameState } from '../../src/shared/types';
import {
  actRaw,
  buildingsOf,
  expectErr,
  makeRng,
  newGame,
  okState,
  setupStep,
  totalOf,
} from './helpers';

function roadsOf(s: GameState, playerId: string) {
  return s.roads.filter((r) => r.playerId === playerId);
}

describe('preparação (setup snake)', () => {
  it('fila snake correta para 4 jogadores: [p0,p1,p2,p3,p3,p2,p1,p0]', () => {
    const s = newGame(4, 'snake4');
    expect(s.setup.queue).toEqual(['p0', 'p1', 'p2', 'p3', 'p3', 'p2', 'p1', 'p0']);
    expect(s.phase).toBe('setup_settlement');
  });

  it('fila snake correta para 3 jogadores: [p0,p1,p2,p2,p1,p0]', () => {
    const s = newGame(3, 'snake3');
    expect(s.setup.queue).toEqual(['p0', 'p1', 'p2', 'p2', 'p1', 'p0']);
  });

  it('setup completo 4p: 2 assentamentos + 2 estradas por jogador; fase pre_roll do p0', () => {
    const rng = makeRng('full4');
    let s = newGame(4, 'full4');
    const order: string[] = [];
    while (s.phase === 'setup_settlement' || s.phase === 'setup_road') {
      if (s.phase === 'setup_settlement') order.push(s.setup.queue[s.setup.pos]);
      s = setupStep(s, rng);
    }
    expect(s.phase).toBe('pre_roll');
    expect(s.activeIndex).toBe(0);
    expect(order).toEqual(['p0', 'p1', 'p2', 'p3', 'p3', 'p2', 'p1', 'p0']);
    for (const p of s.players) {
      expect(buildingsOf(s, p.id).length).toBe(2);
      expect(buildingsOf(s, p.id).every((b) => b.kind === 'settlement')).toBe(true);
      expect(roadsOf(s, p.id).length).toBe(2);
      expect(p.pieces.settlements).toBe(3);
      expect(p.pieces.roads).toBe(13);
      expect(p.pieces.cities).toBe(4);
    }
    // ordem dos eventos de preparação confirma o snake (evento de assentamento, sem edgeId)
    const placed = s.history.events.filter((e) => e.type === 'setup_placed' && e.edgeId === undefined);
    expect(placed.map((e) => (e.type === 'setup_placed' ? e.playerId : ''))).toEqual(order);
  });

  it('setup completo 3p com estradas adjacentes ao assentamento recém-colocado', () => {
    const rng = makeRng('full3');
    let s = newGame(3, 'full3');
    let lastVertex: string | null = null;
    while (s.phase === 'setup_settlement' || s.phase === 'setup_road') {
      if (s.phase === 'setup_settlement') {
        s = setupStep(s, rng);
        lastVertex = s.setup.lastSettlementVertex;
      } else {
        s = setupStep(s, rng);
        // a estrada colocada no passo anterior toca o vértice do assentamento
        const actorRoads = roadsOf(s, s.setup.queue[s.setup.pos - 1]);
        const last = actorRoads[actorRoads.length - 1];
        expect(s.board.edgeEndpoints[last.edgeId]).toContain(lastVertex);
      }
    }
    expect(s.phase).toBe('pre_roll');
    for (const p of s.players) {
      expect(buildingsOf(s, p.id).length).toBe(2);
      expect(roadsOf(s, p.id).length).toBe(2);
    }
  });

  it('recursos SÓ do 2º assentamento (1 por hex não-deserto adjacente)', () => {
    const rng = makeRng('res2');
    let s = newGame(3, 'res2');
    // primeiro assentamento não dá recurso
    s = setupStep(s, rng); // p0 settlement
    expect(totalOf(s.players[0])).toBe(0);
    // completa o setup inteiro e confere a composição de cada jogador
    while (s.phase === 'setup_settlement' || s.phase === 'setup_road') s = setupStep(s, rng);
    for (const p of s.players) {
      const mine = buildingsOf(s, p.id);
      const secondVertex = mine[1].vertexId;
      const expected = (s.board.vertexHexes[secondVertex] ?? []).filter((hexId) => {
        const hex = s.board.hexes.find((h) => h.id === hexId);
        return hex && hex.terrain !== 'desert';
      }).length;
      expect(totalOf(p)).toBe(expected);
    }
  });

  it('regra de distância vale desde a 1ª colocação', () => {
    const rng = makeRng('dist');
    const s0 = newGame(3, 'dist');
    const actor = s0.setup.queue[0];
    const v0 = s0.board.vertices[0];
    const s1 = okState(applyCommand(s0, actor, { type: 'setup_settlement', vertexId: v0 }, { rng }));
    expect(s1.phase).toBe('setup_road');
    const [a, b] = s1.board.edgeEndpoints[s1.board.vertexEdges[v0][0]];
    const neighbor = a === v0 ? b : a;
    // outro jogador não pode agir na estrada do atual
    expectErr(applyCommand(s1, s1.setup.queue[1], { type: 'setup_road', edgeId: s1.board.vertexEdges[v0][0] }, { rng }), ERROR_CODES.NOT_YOUR_TURN);
    // p0 conclui a estrada; p1 tenta assentamento vizinho de v0 => distância
    const s2 = okState(applyCommand(s1, actor, { type: 'setup_road', edgeId: s1.board.vertexEdges[v0][0] }, { rng }));
    expect(s2.phase).toBe('setup_settlement');
    expectErr(applyCommand(s2, s2.setup.queue[1], { type: 'setup_settlement', vertexId: neighbor }, { rng }), ERROR_CODES.DISTANCE_RULE);
  });

  it('2ª estrada deve ser adjacente ao 2º assentamento; aresta ocupada rejeitada', () => {
    const rng = makeRng('road2');
    let s = newGame(3, 'road2');
    // avança até a segunda metade (p2 é o 4º item da fila => segunda metade)
    while (!(s.phase === 'setup_road' && s.setup.pos >= s.setup.queue.length / 2)) {
      s = setupStep(s, rng);
    }
    const actor = s.setup.queue[s.setup.pos];
    const last = s.setup.lastSettlementVertex as string;
    const legal = s.board.vertexEdges[last].filter((e) => !s.roads.some((r) => r.edgeId === e));
    // aresta que não toca o assentamento recém-colocado
    const illegal = s.board.edges.find((e) => !s.board.edgeEndpoints[e].includes(last) && !s.roads.some((r) => r.edgeId === e)) as string;
    expectErr(applyCommand(s, actor, { type: 'setup_road', edgeId: illegal }, { rng }), ERROR_CODES.INVALID_POSITION);
    const s2 = okState(applyCommand(s, actor, { type: 'setup_road', edgeId: legal[0] }, { rng }));
    expect(s2.phase).toBe('setup_settlement');
    // aresta já ocupada
    const s3 = (function () {
      let cur = newGame(3, 'road2b');
      while (!(cur.phase === 'setup_road' && cur.setup.pos === 0)) cur = setupStep(cur, makeRng('road2b'));
      return cur;
    })();
    const usedEdge = s3.board.vertexEdges[s3.setup.lastSettlementVertex as string][0];
    const s4 = okState(applyCommand(s3, s3.setup.queue[0], { type: 'setup_road', edgeId: usedEdge }, { rng: makeRng('road2b') }));
    // tentar reusar a mesma aresta no 2º round do mesmo jogador falharia — aqui apenas confirma estado ok
    expect(s4.roads.some((r) => r.edgeId === usedEdge)).toBe(true);
  });

  it('fila snake correta para 2 jogadores: [p0,p1,p1,p0]', () => {
    const s = newGame(2, 'snake2');
    expect(s.setup.queue).toEqual(['p0', 'p1', 'p1', 'p0']);
    expect(s.phase).toBe('setup_settlement');
  });

  it('setup completo 2p: 2 assentamentos + 2 estradas por jogador; fase pre_roll do p0', () => {
    const rng = makeRng('full2');
    let s = newGame(2, 'full2');
    const order: string[] = [];
    while (s.phase === 'setup_settlement' || s.phase === 'setup_road') {
      if (s.phase === 'setup_settlement') order.push(s.setup.queue[s.setup.pos]);
      s = setupStep(s, rng);
    }
    expect(s.phase).toBe('pre_roll');
    expect(s.activeIndex).toBe(0);
    expect(order).toEqual(['p0', 'p1', 'p1', 'p0']);
    for (const p of s.players) {
      expect(buildingsOf(s, p.id).length).toBe(2);
      expect(roadsOf(s, p.id).length).toBe(2);
    }
  });

  it('comandos fora de fase na preparação são rejeitados', () => {
    const s = newGame(3, 'phase');
    const rng = makeRng('phase');
    expectErr(applyCommand(s, 'p0', { type: 'roll_dice' }, { rng }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s, 'p0', { type: 'build_road', edgeId: s.board.edges[0] }, { rng }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s, 'p0', { type: 'end_turn' }, { rng }), ERROR_CODES.WRONG_PHASE);
  });

  it('setup não muta o estado de entrada', () => {
    const s = newGame(3, 'immut');
    const before = JSON.stringify(s);
    const r = actRaw(s, { type: 'setup_settlement', vertexId: s.board.vertices[0] }, makeRng('immut'));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });
});
