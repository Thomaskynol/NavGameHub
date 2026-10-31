import { describe, expect, it } from 'vitest';
import { applyCommand, legalBuildTargets } from '../../src/engine';
import { checkRoadEdge, ownNetworkReaches } from '../../src/engine/legal';
import { ERROR_CODES } from '../../src/shared/protocol';
import {
  addBuilding,
  act,
  buildingsOf,
  diceRng,
  expectErr,
  finishSetup,
  giveCards,
  hexVertices,
  makeRng,
  newGame,
  resetBoard,
  toAction,
} from './helpers';

describe('construção (ação)', () => {
  it('estrada: custo, pagamento ao banco e evento built', () => {
    let s = toAction(finishSetup(newGame(3, 'build1'), makeRng('build1')));
    const actor = s.players[s.activeIndex].id;
    // sem recursos => insuficiente
    const target = legalBuildTargets(s, actor).roadEdges[0];
    expectErr(applyCommand(s, actor, { type: 'build_road', edgeId: target }, { rng: makeRng('x') }), ERROR_CODES.INSUFFICIENT_RESOURCES);
    giveCards(s, actor, { brick: 1, lumber: 1 });
    const bankBefore = { ...s.bank };
    const brickBefore = s.players.find((p) => p.id === actor)!.resources.brick;
    s = act(s, { type: 'build_road', edgeId: target }, makeRng('x'));
    const me = s.players.find((p) => p.id === actor);
    expect(me?.resources.brick).toBe(brickBefore - 1);
    expect(s.bank.brick).toBe(bankBefore.brick + 1);
    expect(s.roads.some((r) => r.edgeId === target && r.playerId === actor)).toBe(true);
    expect(s.history.events.some((e) => e.type === 'built' && e.kind === 'road')).toBe(true);
  });

  it('estrada: aresta ocupada e fora da rede rejeitadas; ladrão não bloqueia', () => {
    let s = toAction(finishSetup(newGame(3, 'build2'), makeRng('build2')));
    const actor = s.players[s.activeIndex].id;
    const hints = legalBuildTargets(s, actor);
    // ocupada
    expectErr(applyCommand(s, actor, { type: 'build_road', edgeId: s.roads[0].edgeId }, { rng: makeRng('x') }), ERROR_CODES.INVALID_POSITION);
    // fora da rede: aresta sem ponta na rede própria (varre até achar)
    const farEdge = s.board.edges.find((e) => !checkRoadEdge(s, actor, e).ok && !s.roads.some((r) => r.edgeId === e)) as string;
    expectErr(applyCommand(s, actor, { type: 'build_road', edgeId: farEdge }, { rng: makeRng('x') }), ERROR_CODES.NOT_CONNECTED);
    // ladrão não bloqueia construção: move ladrão para hex adjacente da estrada alvo
    giveCards(s, actor, { brick: 1, lumber: 1 });
    const [v1] = s.board.edgeEndpoints[hints.roadEdges[0]];
    const hexNear = (s.board.vertexHexes[v1] ?? [])[0];
    s = { ...s, robberHexId: hexNear };
    const s2 = act(s, { type: 'build_road', edgeId: hints.roadEdges[0] }, makeRng('x'));
    expect(s2.roads.some((r) => r.edgeId === hints.roadEdges[0])).toBe(true);
  });

  it('limite de peças: 15 estradas, 5 assentamentos, 4 cidades', () => {
    const s = toAction(finishSetup(newGame(3, 'limit'), makeRng('limit')));
    const actor = s.players[s.activeIndex].id;
    const e = legalBuildTargets(s, actor).roadEdges[0];
    s.players.find((p) => p.id === actor)!.pieces.roads = 0;
    giveCards(s, actor, { brick: 1, lumber: 1 });
    expectErr(applyCommand(s, actor, { type: 'build_road', edgeId: e }, { rng: makeRng('x') }), ERROR_CODES.PIECE_LIMIT);
  });

  it('assentamento: distância, conexão e limite', () => {
    // cenário controlado: p0 com settlement em V0 e estradas V0–V1–V2 no hex central
    let s = toAction(finishSetup(newGame(3, 'sett'), makeRng('sett')));
    s = resetBoard(s);
    const [V0, V1, V2, , V4] = hexVertices(s, s.board.hexes[0].id);
    addBuilding(s, 'p0', V0, 'settlement');
    const edge = (a: string, b: string): string =>
      s.board.edges.find((e) => {
        const [x, y] = s.board.edgeEndpoints[e];
        return (x === a && y === b) || (x === b && y === a);
      }) as string;
    s.roads.push({ edgeId: edge(V0, V1), playerId: 'p0' });
    s.roads.push({ edgeId: edge(V1, V2), playerId: 'p0' });
    giveCards(s, 'p0', { brick: 4, lumber: 4, wool: 4, grain: 4 });
    // custo
    const sBroke = structuredClone(s);
    sBroke.players.find((p) => p.id === 'p0')!.resources = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    expectErr(applyCommand(sBroke, 'p0', { type: 'build_settlement', vertexId: V2 }, { rng: makeRng('x') }), ERROR_CODES.INSUFFICIENT_RESOURCES);
    // distância: vizinho de V0 (que tem construção) proibido
    expectErr(applyCommand(s, 'p0', { type: 'build_settlement', vertexId: V1 }, { rng: makeRng('x') }), ERROR_CODES.DISTANCE_RULE);
    // não conectado: V4 não toca a rede
    expectErr(applyCommand(s, 'p0', { type: 'build_settlement', vertexId: V4 }, { rng: makeRng('x') }), ERROR_CODES.NOT_CONNECTED);
    // legal: V2 toca a estrada V1–V2 e distância ok
    const legal = legalBuildTargets(s, 'p0').settlementVertices;
    expect(legal).toContain(V2);
    s = act(s, { type: 'build_settlement', vertexId: V2 }, makeRng('x'));
    expect(buildingsOf(s, 'p0').some((x) => x.vertexId === V2)).toBe(true);
    // limite de 5 assentamentos
    const another = legalBuildTargets(s, 'p0').settlementVertices.find((v) => v !== V2);
    s.players.find((p) => p.id === 'p0')!.pieces.settlements = 0;
    if (another) {
      giveCards(s, 'p0', { brick: 1, lumber: 1, wool: 1, grain: 1 });
      expectErr(applyCommand(s, 'p0', { type: 'build_settlement', vertexId: another }, { rng: makeRng('x') }), ERROR_CODES.PIECE_LIMIT);
    }
  });

  it('cidade: upgrade, casa volta ao suprimento, custo e invalid_position', () => {
    let s = toAction(finishSetup(newGame(3, 'city'), makeRng('city')));
    const actor = s.players[s.activeIndex].id;
    const own = buildingsOf(s, actor)[0].vertexId;
    // sem recursos
    expectErr(applyCommand(s, actor, { type: 'build_city', vertexId: own }, { rng: makeRng('x') }), ERROR_CODES.INSUFFICIENT_RESOURCES);
    giveCards(s, actor, { ore: 3, grain: 2 });
    const settlementsBefore = s.players.find((p) => p.id === actor)!.pieces.settlements;
    s = act(s, { type: 'build_city', vertexId: own }, makeRng('x'));
    expect(buildingsOf(s, actor).find((x) => x.vertexId === own)?.kind).toBe('city');
    const me = s.players.find((p) => p.id === actor)!;
    expect(me.pieces.settlements).toBe(settlementsBefore + 1);
    expect(me.pieces.cities).toBe(3);
    // vértice sem assentamento próprio
    const free = s.board.vertices.find((v) => !s.buildings.some((b) => b.vertexId === v)) as string;
    expectErr(applyCommand(s, actor, { type: 'build_city', vertexId: free }, { rng: makeRng('x') }), ERROR_CODES.INVALID_POSITION);
  });

  it('estrada não atravessa construção adversária (chegar até o vértice é permitido)', () => {
    let s = finishSetup(newGame(3, 'block'), makeRng('block'));
    s = toAction(s);
    s = resetBoard(s);
    const verts = hexVertices(s, s.board.hexes[0].id); // 6 vértices do hex central
    const [A, B, C] = [verts[0], verts[1], verts[2]];
    addBuilding(s, 'p0', A, 'settlement');
    addBuilding(s, 'p1', B, 'settlement'); // adversária no meio
    giveCards(s, 'p0', { brick: 5, lumber: 5 });
    const edgeAB = s.board.edges.find((e) => {
      const [x, y] = s.board.edgeEndpoints[e];
      return (x === A && y === B) || (x === B && y === A);
    }) as string;
    const edgeBC = s.board.edges.find((e) => {
      const [x, y] = s.board.edgeEndpoints[e];
      return (x === B && y === C) || (x === C && y === B);
    }) as string;
    // chegar até B (vértice adversário) é permitido; usar B como passagem, não
    expect(checkRoadEdge(s, 'p0', edgeAB).ok).toBe(true);
    s = act(s, { type: 'build_road', edgeId: edgeAB }, makeRng('blk'));
    // atravessar B não é: aresta B–C não conecta
    expect(ownNetworkReaches(s, 'p0', B)).toBe(false);
    expectErr(applyCommand(s, 'p0', { type: 'build_road', edgeId: edgeBC }, { rng: makeRng('x') }), ERROR_CODES.NOT_CONNECTED);
    // C é vizinho de B (adversária): validação de distância aciona antes da conexão
    expectErr(applyCommand(s, 'p0', { type: 'build_settlement', vertexId: C }, { rng: makeRng('x') }), ERROR_CODES.DISTANCE_RULE);
  });

  it('comando de construção rejeitado fora da fase action', () => {
    const s = finishSetup(newGame(3, 'wrongphase'), makeRng('wrongphase'));
    const actor = s.players[s.activeIndex].id;
    // pre_roll: construção não permitida
    expectErr(applyCommand(s, actor, { type: 'build_road', edgeId: s.board.edges[0] }, { rng: makeRng('x') }), ERROR_CODES.WRONG_PHASE);
    // em action: rolar de novo e comandos de setup não permitidos
    const s2 = act(s, { type: 'roll_dice' }, diceRng(3, 2));
    expect(s2.phase).toBe('action');
    expectErr(applyCommand(s2, actor, { type: 'roll_dice' }, { rng: diceRng(3, 2) }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s2, actor, { type: 'setup_settlement', vertexId: s.board.vertices[0] }, { rng: makeRng('x') }), ERROR_CODES.WRONG_PHASE);
  });
});
