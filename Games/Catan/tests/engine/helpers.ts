// Utilitários compartilhados dos testes do motor (RNG determinística + drivers).
import { expect } from 'vitest';
import { BANK_SIZE_PER_RESOURCE, type PlayerId, type ResourceKind, type VertexId } from '../../src/shared/constants';
import type { EngineResult, GameState, RandomSource } from '../../src/shared/types';
import { applyCommand, createGame, legalBuildTargets } from '../../src/engine';
import { hashString, mulberry32 } from '../../src/engine/rng';
import { currentActorId, checkRoadEdge } from '../../src/engine/legal';

export function makeRng(seed: string | number): RandomSource {
  return mulberry32(typeof seed === 'number' ? seed : hashString(seed));
}

/** RNG que devolve a sequência fixa de valores (repete o último ao acabar). */
export function fixedRng(values: number[]): RandomSource {
  let i = 0;
  return {
    next(): number {
      const v = values[Math.min(i, values.length - 1)];
      i += 1;
      return v;
    },
  };
}

/** RNG que rola d1 e d2 exatos (soma = d1+d2). */
export function diceRng(d1: number, d2: number): RandomSource {
  const f = (d: number): number => (d - 1 + 0.5) / 6;
  return fixedRng([f(d1), f(d2)]);
}

export function makePlayers(n: number): { id: PlayerId; name: string; color: 'red' | 'orange' | 'white' | 'blue' }[] {
  const colors = ['red', 'orange', 'white', 'blue'] as const;
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Jogador ${i}`, color: colors[i] }));
}

export function newGame(n = 3, seed = 'test'): GameState {
  return createGame({ players: makePlayers(n), boardSeed: seed, rng: makeRng(seed) });
}

export function okState<T>(r: EngineResult<T>): T {
  if (!r.ok) throw new Error(`esperado ok, veio ${r.error.code}: ${r.error.message}`);
  return r.state;
}

export function expectErr(r: EngineResult, code: string): void {
  if (r.ok) throw new Error(`esperado erro ${code}, veio ok`);
  expect(r.error.code).toBe(code);
}

export function activeId(s: GameState): PlayerId {
  const id = currentActorId(s);
  if (!id) throw new Error('sem jogador corrente');
  return id;
}

/** Aplica um comando do jogador corrente e exige sucesso. */
export function act(s: GameState, cmd: Parameters<typeof applyCommand>[2], rng: RandomSource): GameState {
  return okState(applyCommand(s, activeId(s), cmd, { rng }));
}

/** Avança um comando do jogador corrente sem exigir sucesso. */
export function actRaw(s: GameState, cmd: Parameters<typeof applyCommand>[2], rng: RandomSource): EngineResult {
  return applyCommand(s, activeId(s), cmd, { rng });
}

/** Um passo do setup (assentamento ou estrada) usando as dicas legais. */
export function setupStep(s: GameState, rng: RandomSource): GameState {
  const actor = activeId(s);
  const hints = legalBuildTargets(s, actor);
  if (s.phase === 'setup_settlement') {
    return act(s, { type: 'setup_settlement', vertexId: hints.setupVertices[0] }, rng);
  }
  return act(s, { type: 'setup_road', edgeId: hints.setupEdges[0] }, rng);
}

/** Completa toda a preparação (3–4 jogadores). */
export function finishSetup(s: GameState, rng: RandomSource): GameState {
  let cur = s;
  let guard = 0;
  while ((cur.phase === 'setup_settlement' || cur.phase === 'setup_road') && guard++ < 100) {
    cur = setupStep(cur, rng);
  }
  if (cur.phase !== 'pre_roll') throw new Error(`setup não terminou: fase ${cur.phase}`);
  return cur;
}

/** Estado em fase `action` do jogador que começa (rola 3+2=5). */
export function toAction(s: GameState): GameState {
  return act(s, { type: 'roll_dice' }, diceRng(3, 2));
}

/** Limpa tabuleiro (estradas/construções), suprimentos, mãos e banco — para cenários diretos. */
export function resetBoard(s: GameState): GameState {
  const n = structuredClone(s);
  n.roads = [];
  n.buildings = [];
  for (const p of n.players) {
    p.pieces = { roads: 15, settlements: 5, cities: 4 };
    for (const k of Object.keys(p.resources) as ResourceKind[]) p.resources[k] = 0;
  }
  for (const k of Object.keys(n.bank) as ResourceKind[]) n.bank[k] = BANK_SIZE_PER_RESOURCE;
  return n;
}

/** Mutadores diretos de cenário (fora do motor, só em testes). */
export function addBuilding(s: GameState, playerId: PlayerId, vertexId: VertexId, kind: 'settlement' | 'city' = 'settlement'): void {
  s.buildings.push({ vertexId, playerId, kind });
}

export function addRoad(s: GameState, playerId: PlayerId, edgeId: string): void {
  s.roads.push({ edgeId, playerId });
}

export function giveCards(s: GameState, playerId: PlayerId, patch: Partial<Record<ResourceKind, number>>): void {
  const p = s.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`jogador ${playerId} ausente`);
  for (const [k, v] of Object.entries(patch) as [ResourceKind, number][]) {
    p.resources[k] += v;
    s.bank[k] -= v;
  }
}

export function setBank(s: GameState, patch: Partial<Record<ResourceKind, number>>): void {
  for (const [k, v] of Object.entries(patch) as [ResourceKind, number][]) s.bank[k] = v;
}

export function totalOf(p: { resources: Record<ResourceKind, number> }): number {
  return (Object.values(p.resources) as number[]).reduce((a, b) => a + b, 0);
}

export function sumPatch(p: Partial<Record<ResourceKind, number>>): number {
  return (Object.values(p) as number[]).reduce((a, b) => a + (b ?? 0), 0);
}

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const v of Object.values(obj as object)) deepFreeze(v);
  }
  return obj;
}

/** Vértices de um hex no estado. */
export function hexVertices(s: GameState, hexId: string): VertexId[] {
  const verts = new Set<VertexId>();
  for (const e of s.board.hexEdges[hexId]) {
    const [a, b] = s.board.edgeEndpoints[e];
    verts.add(a);
    verts.add(b);
  }
  return [...verts];
}

/** Primeira construção de um jogador no estado (ordem de colocação). */
export function buildingsOf(s: GameState, playerId: PlayerId) {
  return s.buildings.filter((b) => b.playerId === playerId);
}

/** Arestas legais livres para estrada (ignora custo). */
export function legalFreeRoads(s: GameState, playerId: PlayerId): string[] {
  return s.board.edges.filter((e) => !s.roads.some((r) => r.edgeId === e) && checkRoadEdge(s, playerId, e).ok);
}
