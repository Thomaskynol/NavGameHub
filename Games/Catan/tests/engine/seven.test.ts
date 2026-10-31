import { describe, expect, it } from 'vitest';
import { applyCommand, legalRobberHexes, robberVictims } from '../../src/engine';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { GameState, RandomSource } from '../../src/shared/types';
import {
  diceRng,
  expectErr,
  finishSetup,
  makeRng,
  newGame,
  setBank,
} from './helpers';

/** Estado em pre_roll do p0 com p0 tendo `n0` cartas (lumber), p1 `n1`, p2 `n2`. */
function sevenScenario(n0: number, n1 = 0, n2 = 0): GameState {
  let s = finishSetup(newGame(3, 'seven'), makeRng('seven'));
  s = structuredClone(s);
  for (const p of s.players) for (const k of Object.keys(p.resources) as (keyof typeof p.resources)[]) p.resources[k] = 0;
  setBank(s, { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
  s.players.find((p) => p.id === 'p0')!.resources.lumber = n0;
  s.players.find((p) => p.id === 'p1')!.resources.lumber = n1;
  s.players.find((p) => p.id === 'p2')!.resources.lumber = n2;
  s.bank.lumber -= n0 + n1 + n2;
  return s;
}

function rollSeven(s: GameState): GameState {
  const r = applyCommand(s, s.players[s.activeIndex].id, { type: 'roll_dice' }, { rng: diceRng(6, 1) });
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}

/** Hex com vítima adversária (construção de playerId) e sem o ladrão. */
function hexWithVictim(s: GameState, victimId: string): string {
  const b = s.buildings.find((x) => x.playerId === victimId);
  if (!b) throw new Error(`sem construção de ${victimId}`);
  const hex = (s.board.vertexHexes[b.vertexId] ?? []).find((h) => h !== s.robberHexId);
  if (!hex) throw new Error('sem hex disponível para vítima');
  return hex;
}

/** Hex válido para mover o ladrão sem vítimas (evita exigir victimId nos cenários). */
function freeHexId(s: GameState): string {
  const hex = s.board.hexes.find((h) => h.id !== s.robberHexId && robberVictims(s, h.id, s.players[s.activeIndex].id).length === 0);
  if (!hex) throw new Error('sem hex livre de vítimas');
  return hex.id;
}

describe('o 7: descarte + ladrão', () => {
  it('descarte exige exatamente floor(n/2); compõe banco; ordem pendente', () => {
    const s0 = sevenScenario(9, 7, 3); // p0: 9 => descarta 4
    const s1 = rollSeven(s0);
    expect(s1.phase).toBe('await_discards');
    expect(s1.pending).toEqual({ type: 'discard', waitingOn: ['p0'] });
    // quantidade errada
    expectErr(applyCommand(s1, 'p0', { type: 'discard', cards: { lumber: 3 } }, { rng: makeRng('x') }), ERROR_CODES.INVALID_PAYLOAD);
    expectErr(applyCommand(s1, 'p0', { type: 'discard', cards: { lumber: 5 } }, { rng: makeRng('x') }), ERROR_CODES.INVALID_PAYLOAD);
    // jogador fora da lista
    expectErr(applyCommand(s1, 'p1', { type: 'discard', cards: { lumber: 1 } }, { rng: makeRng('x') }), ERROR_CODES.NOT_YOUR_TURN);
    // comandos normais bloqueados durante a pendência
    expectErr(applyCommand(s1, 'p0', { type: 'end_turn' }, { rng: makeRng('x') }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s1, 'p0', { type: 'move_robber', hexId: s1.board.hexes.find((h) => h.id !== s1.robberHexId)!.id }, { rng: makeRng('x') }), ERROR_CODES.WRONG_PHASE);
    // descarte correto
    const bankBefore = s1.bank.lumber;
    const r = applyCommand(s1, 'p0', { type: 'discard', cards: { lumber: 4 } }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources.lumber).toBe(5);
    expect(r.state.bank.lumber).toBe(bankBefore + 4);
    // evento público com contagem + evento privado com composição
    expect(r.state.history.events.some((e) => e.type === 'discarded' && e.count === 4)).toBe(true);
    const priv = r.state.history.events.find((e) => e.type === 'resources_private' && e.reason === 'discard');
    expect(priv).toBeDefined();
    if (priv && priv.type === 'resources_private') {
      expect(r.state.history.meta[priv.seq].visibility).toBe('private');
      expect(priv.resources).toEqual({ lumber: 4 });
    }
    // pendência vazia => ladrão
    expect(r.state.phase).toBe('robber');
    expect(r.state.pending).toEqual({ type: 'robber' });
  });

  it('vários descartantes: ordem pendente até todos concluírem', () => {
    const s0 = sevenScenario(8, 8, 2); // p0 e p1 > 7
    const s1 = rollSeven(s0);
    expect(s1.pending).toEqual({ type: 'discard', waitingOn: ['p0', 'p1'] });
    const r1 = applyCommand(s1, 'p1', { type: 'discard', cards: { lumber: 4 } }, { rng: makeRng('x') });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.pending).toEqual({ type: 'discard', waitingOn: ['p0'] });
    expect(r1.state.phase).toBe('await_discards');
    const r2 = applyCommand(r1.state, 'p0', { type: 'discard', cards: { lumber: 4 } }, { rng: makeRng('x') });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.phase).toBe('robber');
  });

  it('ladrão: mesmo hex rejeitado; vítima obrigatória quando há adversário; sem vítima ok', () => {
    const s1 = rollSeven(sevenScenario(0, 0, 0));
    expect(s1.phase).toBe('robber');
    // mesmo hex
    expectErr(
      applyCommand(s1, 'p0', { type: 'move_robber', hexId: s1.robberHexId }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_POSITION,
    );
    // hex com vítima exige victimId
    const victimHex = hexWithVictim(s1, 'p1');
    expectErr(applyCommand(s1, 'p0', { type: 'move_robber', hexId: victimHex }, { rng: makeRng('x') }), ERROR_CODES.INVALID_POSITION);
    // victimId inválido
    expectErr(applyCommand(s1, 'p0', { type: 'move_robber', hexId: victimHex, victimId: 'p0' }, { rng: makeRng('x') }), ERROR_CODES.INVALID_POSITION);
    // hex sem vítima: ok sem victimId
    const emptyHex = s1.board.hexes.find(
      (h) => h.id !== s1.robberHexId && legalRobberHexes(s1, 'p0').includes(h.id) && robberVictims(s1, h.id, 'p0').length === 0,
    );
    expect(emptyHex).toBeDefined();
    const r = applyCommand(s1, 'p0', { type: 'move_robber', hexId: emptyHex!.id }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.robberHexId).toBe(emptyHex!.id);
    expect(r.state.phase).toBe('action');
    expect(r.state.pending).toBeNull();
    // legalRobberHexes: todos menos o atual
    expect(legalRobberHexes(s1, 'p0').length).toBe(s1.board.hexes.length - 1);
  });

  it('roubo: carta aleatória da vítima; vítima sem cartas => roubo sem tipo', () => {
    const s = sevenScenario(0, 3, 0);
    s.players.find((p) => p.id === 'p1')!.resources = { brick: 1, lumber: 1, wool: 1, grain: 0, ore: 0 };
    const s1 = rollSeven(s);
    const victimHex = hexWithVictim(s1, 'p1');
    const f = (d: number) => (d - 1 + 0.5) / 6;
    let i = 0;
    const seq = [f(1), f(1)]; // sorteio da carta: idx 0 => brick
    const rng: RandomSource = { next: () => seq[Math.min(i++, 1)] };
    const r = applyCommand(s1, 'p0', { type: 'move_robber', hexId: victimHex, victimId: 'p1' }, { rng });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p1 = r.state.players.find((p) => p.id === 'p1')!;
    const p0 = r.state.players.find((p) => p.id === 'p0')!;
    expect(p1.resources.brick).toBe(0);
    expect(p0.resources.brick).toBe(1);
    const priv = r.state.history.events.find((e) => e.type === 'stolen' && e.resource !== undefined);
    expect(priv).toBeDefined();
    if (priv && priv.type === 'stolen') {
      expect(priv.resource).toBe('brick');
      expect(r.state.history.meta[priv.seq].visibility).toBe('private');
      expect(r.state.history.meta[priv.seq].audience).toEqual(['p0', 'p1']);
    }
    // vítima sem cartas
    const s2 = rollSeven(sevenScenario(0, 0, 0));
    const victimHex2 = hexWithVictim(s2, 'p1');
    const r2 = applyCommand(s2, 'p0', { type: 'move_robber', hexId: victimHex2, victimId: 'p1' }, { rng: makeRng('x') });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const publicStolen = r2.state.history.events.filter((e) => e.type === 'stolen').pop();
    expect(publicStolen).toBeDefined();
    if (publicStolen && publicStolen.type === 'stolen') expect(publicStolen.resource).toBeUndefined();
    expect(r2.state.history.meta[publicStolen!.seq].visibility).toBe('public');
  });

  it('cavaleiro + 7 no mesmo turno = dois movimentos de ladrão', () => {
    // p0 com cavaleiro não comprado neste turno
    let s = finishSetup(newGame(3, 'knight7'), makeRng('knight7'));
    s = structuredClone(s);
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.push({ id: 'k-test', kind: 'knight' });
    // jogada pré-dados do cavaleiro: move ladrão e volta para pre_roll
    const hexA = freeHexId(s);
    const r1 = applyCommand(s, 'p0', { type: 'play_knight', hexId: hexA }, { rng: makeRng('k1') });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.robberHexId).toBe(hexA);
    expect(r1.state.phase).toBe('pre_roll');
    expect(r1.state.returnPhase).toBeNull();
    expect(r1.state.players.find((p) => p.id === 'p0')!.knightsPlayed).toBe(1);
    expect(r1.state.players.find((p) => p.id === 'p0')!.devCards.length).toBe(0);
    // agora o 7: sem descartes pendentes (mãos vazias) => ladrão de novo
    const s2 = rollSeven(r1.state);
    expect(s2.phase).toBe('robber');
    const hexB = freeHexId(s2);
    const r3 = applyCommand(s2, 'p0', { type: 'move_robber', hexId: hexB }, { rng: makeRng('k3') });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.state.robberHexId).toBe(hexB);
    expect(r3.state.phase).toBe('action');
  });

  it('cavaleiro em action volta para action; maior exército recalcula', () => {
    let s = finishSetup(newGame(3, 'knightA'), makeRng('knightA'));
    s = structuredClone(s);
    // rolar até action
    const rolled = applyCommand(s, 'p0', { type: 'roll_dice' }, { rng: diceRng(3, 2) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.push({ id: 'k1', kind: 'knight' }, { id: 'k2', kind: 'knight' }, { id: 'k3', kind: 'knight' });
    let cur = s;
    for (let i = 0; i < 3; i++) {
      const hex = freeHexId(cur);
      const r = applyCommand(cur, 'p0', { type: 'play_knight', hexId: hex }, { rng: makeRng('k') });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      cur = r.state;
      // simula virada de turno: 1 carta de ação por turno
      cur.players.find((p) => p.id === 'p0')!.playedActionCardThisTurn = false;
    }
    expect(cur.phase).toBe('action');
    expect(cur.players.find((p) => p.id === 'p0')!.knightsPlayed).toBe(3);
    expect(cur.largestArmy.playerId).toBe('p0');
    expect(cur.largestArmy.value).toBe(3);
  });

  it('cavaleiro: carta comprada neste turno bloqueada; 1 ação por turno', () => {
    let s = finishSetup(newGame(3, 'kblock'), makeRng('kblock'));
    s = structuredClone(s);
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.push({ id: 'kb', kind: 'knight' });
    p0.boughtThisTurn.push('kb');
    const hex = freeHexId(s);
    expectErr(applyCommand(s, 'p0', { type: 'play_knight', hexId: hex }, { rng: makeRng('x') }), ERROR_CODES.DEV_BOUGHT_THIS_TURN);
    p0.boughtThisTurn = [];
    p0.devCards.push({ id: 'kb2', kind: 'knight' });
    const r = applyCommand(s, 'p0', { type: 'play_knight', hexId: hex }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // segunda carta de ação no mesmo turno => bloqueada (kb2 ainda na mão)
    const hex2 = freeHexId(r.state);
    expectErr(applyCommand(r.state, 'p0', { type: 'play_knight', hexId: hex2 }, { rng: makeRng('x') }), ERROR_CODES.DEV_ALREADY_PLAYED);
    // mão vazia => no card
    const empty = structuredClone(r.state);
    empty.players.find((p) => p.id === 'p0')!.devCards = [];
    empty.players.find((p) => p.id === 'p0')!.playedActionCardThisTurn = false;
    expectErr(applyCommand(empty, 'p0', { type: 'play_knight', hexId: hex2 }, { rng: makeRng('x') }), ERROR_CODES.NO_DEV_CARD);
  });

  it('após roubo do 7 o jogador ativo segue sendo o mesmo', () => {
    const s1 = rollSeven(sevenScenario(0, 0, 0));
    expect(s1.players[s1.activeIndex].id).toBe('p0');
    const emptyHex = freeHexId(s1);
    const r = applyCommand(s1, 'p0', { type: 'move_robber', hexId: emptyHex }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[r.state.activeIndex].id).toBe('p0');
  });
});
