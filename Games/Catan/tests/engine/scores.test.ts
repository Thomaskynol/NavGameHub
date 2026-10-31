import { describe, expect, it } from 'vitest';
import { applyCommand, computeLongestRoad, publicVictoryPoints, totalVictoryPoints, bestBankRate } from '../../src/engine';
import { recomputeTitles } from '../../src/engine/scores';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { GameState } from '../../src/shared/types';
import {
  addBuilding,
  diceRng,
  expectErr,
  finishSetup,
  giveCards,
  makeRng,
  newGame,
  resetBoard,
} from './helpers';

/** Anel de 6 arestas do hex central: e0..e5 ligam c0..c5. */
function hexRing(s: GameState): { verts: string[]; edges: string[] } {
  const hex = s.board.hexes.find((h) => h.id === '0,0') ?? s.board.hexes[0];
  const edgeIds = s.board.hexEdges[hex.id];
  // ordena as arestas em ciclo pelos vértices
  const verts = new Set<string>();
  for (const e of edgeIds) {
    const [a, b] = s.board.edgeEndpoints[e];
    verts.add(a);
    verts.add(b);
  }
  const vList = [...verts];
  const cycle: string[] = [];
  let cur = vList[0];
  const usedV = new Set<string>([cur]);
  while (cycle.length < 6) {
    const e = edgeIds.find((id) => {
      const [a, b] = s.board.edgeEndpoints[id];
      return (a === cur || b === cur) && !cycle.includes(id);
    }) as string;
    cycle.push(e);
    const [a, b] = s.board.edgeEndpoints[e];
    cur = a === cur ? b : a;
    usedV.add(cur);
  }
  // vértices na ordem do ciclo
  const ordered: string[] = [s.board.edgeEndpoints[cycle[0]][0]];
  for (const e of cycle) {
    const [a, b] = s.board.edgeEndpoints[e];
    ordered.push(a === ordered[ordered.length - 1] ? b : a);
  }
  return { verts: ordered.slice(0, 6), edges: cycle };
}

function scoreScenario(): GameState {
  const s = finishSetup(newGame(3, 'score'), makeRng('score'));
  return resetBoard(s); // fase segue pre_roll; tabuleiro/mãos limpos
}

describe('pontuação e títulos', () => {
  it('setup dá 2 pontos públicos a cada jogador', () => {
    const s = finishSetup(newGame(3, 'pts'), makeRng('pts'));
    for (const p of s.players) expect(publicVictoryPoints(s, p.id)).toBe(2);
    expect(s.largestRoad).toEqual({ playerId: null, value: 0 });
    expect(s.largestArmy).toEqual({ playerId: null, value: 0 });
  });

  it('maior estrada: caminho em Y conta só o ramo mais longo', () => {
    const s = scoreScenario();
    const { verts, edges } = hexRing(s);
    // Y em verts[1]: ramo externo (1) + anel verts[1]->verts[2]->verts[3] (2) => max 3
    const external = s.board.vertexEdges[verts[1]].find((e) => !edges.includes(e)) as string;
    s.roads.push(
      { edgeId: edges[0], playerId: 'p0' }, // verts[0]-verts[1]
      { edgeId: edges[1], playerId: 'p0' }, // verts[1]-verts[2]
      { edgeId: edges[2], playerId: 'p0' }, // verts[2]-verts[3]
      { edgeId: external, playerId: 'p0' }, // verts[1]-x (ramo cego)
    );
    expect(computeLongestRoad(s, 'p0')).toBe(3);
    expect(computeLongestRoad(s, 'p1')).toBe(0);
  });

  it('maior estrada: ciclo conta como caminho contínuo', () => {
    const s = scoreScenario();
    const { edges } = hexRing(s);
    for (const e of edges) s.roads.push({ edgeId: e, playerId: 'p0' });
    expect(computeLongestRoad(s, 'p0')).toBe(6);
  });

  it('maior estrada: construção adversária interrompe (chegar é ok)', () => {
    const s = scoreScenario();
    const { verts, edges } = hexRing(s);
    for (const e of edges) s.roads.push({ edgeId: e, playerId: 'p0' });
    addBuilding(s, 'p1', verts[2], 'settlement');
    // não ATRAVESSA verts[2], mas pode CHEGAR até ela: trilha verts[3]->...->verts[2] = 5
    expect(computeLongestRoad(s, 'p0')).toBe(5);
  });

  it('maior estrada: detentor em empate mantém; perde para estrada estritamente maior; sem dono no empate sem detentor', () => {
    const s = scoreScenario();
    const { edges: e0 } = hexRing(s);
    // p0 com 6 (anel)
    for (const e of e0) s.roads.push({ edgeId: e, playerId: 'p0' });
    // p1 com 6 em outra região: arestas do último hex
    const hex2 = s.board.hexes[s.board.hexes.length - 1];
    const e2 = s.board.hexEdges[hex2.id];
    let c2 = 0;
    for (const e of e2) {
      if (c2 >= 6) break;
      s.roads.push({ edgeId: e, playerId: 'p1' });
      c2++;
    }
    expect(computeLongestRoad(s, 'p1')).toBe(6);
    recomputeTitles(s);
    // empate 6-6 sem detentor prévio => sem dono
    expect(s.largestRoad.playerId).toBeNull();
    expect(s.largestRoad.value).toBe(6);
    // p0 quebra o empate com 7? não: p0 fica com 5 (remove 1 do anel => ainda ciclo de 5)
    s.roads = s.roads.filter((r) => !(r.playerId === 'p0' && r.edgeId === e0[0]));
    expect(computeLongestRoad(s, 'p0')).toBe(5);
    recomputeTitles(s);
    // p1 único com 6 => detentor
    expect(s.largestRoad.playerId).toBe('p1');
    // empate incluindo detentor => mantém (p0 volta a 6 com um ciclo pequeno + trilho)
    s.roads.push({ edgeId: e0[0], playerId: 'p0' }); // p0 = 6 novamente (ciclo de 5 + rabo de 1)
    expect(computeLongestRoad(s, 'p0')).toBe(6);
    recomputeTitles(s);
    expect(s.largestRoad.playerId).toBe('p1');
  });

  it('maior exército: empate mantém detentor; perde com menos', () => {
    const s = scoreScenario();
    s.players.find((p) => p.id === 'p0')!.knightsPlayed = 3;
    recomputeTitles(s);
    expect(s.largestArmy).toEqual({ playerId: 'p0', value: 3 });
    // empate
    s.players.find((p) => p.id === 'p1')!.knightsPlayed = 3;
    recomputeTitles(s);
    expect(s.largestArmy.playerId).toBe('p0');
    // p0 cai para 2 => p1 líder único
    s.players.find((p) => p.id === 'p0')!.knightsPlayed = 2;
    recomputeTitles(s);
    expect(s.largestArmy.playerId).toBe('p1');
    // ambos abaixo do mínimo => sem dono
    s.players.find((p) => p.id === 'p1')!.knightsPlayed = 1;
    recomputeTitles(s);
    expect(s.largestArmy.playerId).toBeNull();
  });

  it('VP ocultas contam em total mas não em pública', () => {
    const s = scoreScenario(); // sem construções
    s.players.find((p) => p.id === 'p0')!.devCards.push({ id: 'vp1', kind: 'victoryPoint' });
    expect(publicVictoryPoints(s, 'p0')).toBe(0);
    expect(totalVictoryPoints(s, 'p0')).toBe(1);
    // cidades valem 2
    const { verts } = hexRing(s);
    addBuilding(s, 'p0', verts[0], 'city');
    expect(publicVictoryPoints(s, 'p0')).toBe(2);
    expect(totalVictoryPoints(s, 'p0')).toBe(3);
  });

  it('titulos valem 2 pontos públicos', () => {
    const s = scoreScenario(); // sem construções (resetBoard)
    s.largestRoad = { playerId: 'p0', value: 5 };
    s.largestArmy = { playerId: 'p0', value: 3 };
    expect(publicVictoryPoints(s, 'p0')).toBe(4); // 2 (estrada) + 2 (exército)
    expect(publicVictoryPoints(s, 'p1')).toBe(0);
  });

  it('bestBankRate: 4 padrão, 3 genérico, 2 especial; adversário não controla', () => {
    const s = scoreScenario();
    expect(bestBankRate(s, 'p0', 'ore')).toBe(4);
    const generic = s.board.ports.find((p) => p.kind === 'generic')!;
    addBuilding(s, 'p0', generic.vertexIds[0], 'settlement');
    expect(bestBankRate(s, 'p0', 'ore')).toBe(3);
    const orePort = s.board.ports.find((p) => p.kind === 'ore')!;
    addBuilding(s, 'p1', orePort.vertexIds[1], 'city');
    expect(bestBankRate(s, 'p1', 'ore')).toBe(2);
    expect(bestBankRate(s, 'p0', 'ore')).toBe(3); // p0 não tem o porto de ore
  });

  it('vitória:10 pontos no próprio turno encerra imediatamente; fora do turno espera', () => {
    let s = finishSetup(newGame(3, 'win'), makeRng('win'));
    s = resetBoard(s);
    // rolar até action do p0
    const rolled = applyCommand(s, 'p0', { type: 'roll_dice' }, { rng: diceRng(3, 2) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    // p1 com 10 pontos públicos (4 cidades + 2 assentamentos)
    for (let i = 0; i < 4; i++) addBuilding(s, 'p1', s.board.vertices[i * 4], 'city');
    addBuilding(s, 'p1', s.board.vertices[1], 'settlement');
    addBuilding(s, 'p1', s.board.vertices[2], 'settlement');
    expect(publicVictoryPoints(s, 'p1')).toBe(10);
    // p0 termina o turno => p1 vence ao entrar em pre_roll
    const ended = applyCommand(s, 'p0', { type: 'end_turn' }, { rng: makeRng('x') });
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.phase).toBe('game_over');
    expect(ended.state.winnerId).toBe('p1');
    // comandos posteriores rejeitados
    expectErr(applyCommand(ended.state, 'p1', { type: 'roll_dice' }, { rng: makeRng('x') }), ERROR_CODES.INVALID_STATE);
  });

  it('vitória: título de maior estrada empurra para 10 no próprio turno', () => {
    let s = finishSetup(newGame(3, 'win2'), makeRng('win2'));
    s = resetBoard(s);
    const rolled = applyCommand(s, 'p0', { type: 'roll_dice' }, { rng: diceRng(3, 2) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    // p0 com 8 pontos públicos (3 cidades + 2 assentamentos no anel) + estrada de 5 pronta
    const { verts: rv, edges } = hexRing(s);
    addBuilding(s, 'p0', rv[0], 'city'); // 2
    addBuilding(s, 'p0', rv[1], 'city'); // 4
    addBuilding(s, 'p0', rv[2], 'city'); // 6
    addBuilding(s, 'p0', rv[3], 'settlement'); // 7
    addBuilding(s, 'p0', rv[4], 'settlement'); // 8
    for (const e of edges.slice(0, 5)) s.roads.push({ edgeId: e, playerId: 'p0' }); // caminho de 5
    expect(computeLongestRoad(s, 'p0')).toBe(5);
    expect(publicVictoryPoints(s, 'p0')).toBe(8); // título ainda não recomputado
    // nova estrada dispara recompute => maior estrada (+2) => 10 => vitória imediata
    giveCards(s, 'p0', { brick: 1, lumber: 1 });
    const r = applyCommand(s, 'p0', { type: 'build_road', edgeId: edges[5] }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.largestRoad.playerId).toBe('p0');
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winnerId).toBe('p0');
  });
});
