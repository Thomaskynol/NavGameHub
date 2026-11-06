import { describe, expect, it } from 'vitest';
import { applyCommand, bestBankRate, createGame } from '../../src/engine';
import { DEV_DECK_COMPOSITION, HISTORY_LIMIT, RESOURCE_KINDS } from '../../src/shared/constants';
import type { GameState } from '../../src/shared/types';
import type { ResourceKind } from '../../src/shared/constants';
import {
  act,
  deepFreeze,
  diceRng,
  expectErr,
  finishSetup,
  giveCards,
  makeRng,
  makePlayers,
  newGame,
  totalOf,
} from './helpers';
import { ERROR_CODES } from '../../src/shared/protocol';

function systemTotals(s: GameState): Record<ResourceKind, number> {
  const out = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } as Record<ResourceKind, number>;
  for (const k of RESOURCE_KINDS) {
    let sum = s.bank[k];
    for (const p of s.players) sum += p.resources[k];
    out[k] = sum;
  }
  return out;
}

describe('invariantes do motor', () => {
  it('estado de entrada nunca é mutado (deep-freeze em sucesso e erro)', () => {
    const s = newGame(3, 'freeze');
    deepFreeze(s);
    const before = JSON.stringify(s);
    const rng = makeRng('freeze');
    const ok1 = applyCommand(s, 'p0', { type: 'setup_settlement', vertexId: s.board.vertices[0] }, { rng });
    expect(ok1.ok).toBe(true);
    const err1 = applyCommand(s, 'p0', { type: 'roll_dice' }, { rng });
    expect(err1.ok).toBe(false);
    const err2 = applyCommand(s, 'p1', { type: 'setup_settlement', vertexId: s.board.vertices[1] }, { rng });
    expect(err2.ok).toBe(false); // não é a vez de p1
    expect(JSON.stringify(s)).toBe(before);
  });

  it('conservação de banco+mãos por recurso em fluxo completo (setup, produção, troca, 7)', () => {
    let s = newGame(3, 'cons');
    s = finishSetup(s, makeRng('cons'));
    // após setup: total por recurso ainda 19 (banco + mãos)
    expect(systemTotals(s)).toEqual({ brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
    // roda alguns turnos com trocas bancárias (respeita a taxa real do ator)
    for (let i = 0; i < 3; i++) {
      const actor = s.players[s.activeIndex].id;
      const rate = bestBankRate(s, actor, 'ore'); // taxa para ENTREGAR ore
      giveCards(s, actor, { ore: rate });
      s = act(s, { type: 'roll_dice' }, diceRng(3, 2));
      s = act(s, { type: 'bank_trade', give: { ore: rate }, want: { grain: 1 } }, makeRng('t'));
      s = act(s, { type: 'end_turn' }, makeRng('t'));
      expect(systemTotals(s)).toEqual({ brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
    }
    // fluxo do 7 com descarte devolve ao banco
    giveCards(s, 'p0', { brick: 5 });
    expect(systemTotals(s).brick).toBe(19);
    const rolled = applyCommand(s, s.players[s.activeIndex].id, { type: 'roll_dice' }, { rng: diceRng(6, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    if (s.phase === 'await_discards') {
      const waiting = s.pending && s.pending.type === 'discard' ? [...s.pending.waitingOn] : [];
      for (const pid of waiting) {
        const p = s.players.find((x) => x.id === pid);
        if (!p) continue;
        let need = Math.floor(totalOf(p) / 2);
        if (need === 0) continue;
        const cards: Partial<Record<ResourceKind, number>> = {};
        for (const k of RESOURCE_KINDS) {
          if (need <= 0) break;
          const take = Math.min(need, p.resources[k]);
          if (take > 0) {
            cards[k] = take;
            need -= take;
          }
        }
        const r = applyCommand(s, pid, { type: 'discard', cards }, { rng: makeRng('d') });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        s = r.state;
      }
    }
    expect(systemTotals(s)).toEqual({ brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
  });

  it('baralho de desenvolvimento:25 cartas únicas; nenhuma duplicada/desaparecida', () => {
    const s0 = createGame({ players: makePlayers(4), boardSeed: 'deck', rng: makeRng('deck') });
    expect(s0.devDeck.length).toBe(25);
    const ids = s0.devDeck.map((c) => c.id);
    expect(new Set(ids).size).toBe(25);
    const kinds = s0.devDeck.reduce<Record<string, number>>((acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds).toEqual(DEV_DECK_COMPOSITION as unknown as Record<string, number>);
    // compra3 (precisa estar em action): deck + mãos = 25 instâncias sem duplicata
    let s = finishSetup(s0, makeRng('deck'));
    s = act(s, { type: 'roll_dice' }, diceRng(3, 2));
    const actor = s.players[s.activeIndex].id;
    giveCards(s, actor, { wool: 3, grain: 3, ore: 3 });
    s = act(s, { type: 'buy_dev_card' }, makeRng('d'));
    s = act(s, { type: 'buy_dev_card' }, makeRng('d'));
    s = act(s, { type: 'buy_dev_card' }, makeRng('d'));
    const allIds = [...s.devDeck.map((c) => c.id), ...s.players.flatMap((p) => p.devCards.map((c) => c.id))];
    expect(allIds.length).toBe(25);
    expect(new Set(allIds).size).toBe(25);
    expect(s.devDeck.length).toBe(22);
  });

  it('estoque de peças consistente: peças em campo + suprimento = 15/5/4', () => {
    let s = finishSetup(newGame(4, 'pieces'), makeRng('pieces'));
    const check = (st: GameState): void => {
      for (const p of st.players) {
        const roads = st.roads.filter((r) => r.playerId === p.id).length;
        const settlements = st.buildings.filter((b) => b.playerId === p.id && b.kind === 'settlement').length;
        const cities = st.buildings.filter((b) => b.playerId === p.id && b.kind === 'city').length;
        expect(p.pieces.roads + roads).toBe(15);
        expect(p.pieces.settlements + settlements).toBe(5);
        expect(p.pieces.cities + cities).toBe(4);
      }
    };
    check(s);
    // constrói estrada e cidade
    const actor = s.players[s.activeIndex].id;
    giveCards(s, actor, { brick: 1, lumber: 1, ore: 3, grain: 2 });
    s = act(s, { type: 'roll_dice' }, diceRng(3, 2));
    const own = s.buildings.find((b) => b.playerId === actor && b.kind === 'settlement');
    expect(own).toBeDefined();
    s = act(s, { type: 'build_city', vertexId: own!.vertexId }, makeRng('p'));
    check(s);
  });

  it('comandos fora de fase rejeitados; pós game_over tudo rejeitado', () => {
    const s = newGame(3, 'phases');
    const rng = makeRng('phases');
    expectErr(applyCommand(s, 'p0', { type: 'roll_dice' }, { rng }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s, 'p0', { type: 'discard', cards: { lumber: 1 } }, { rng }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s, 'p0', { type: 'move_robber', hexId: s.board.hexes[0].id }, { rng }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s, 'p0', { type: 'buy_dev_card' }, { rng }), ERROR_CODES.WRONG_PHASE);
    expectErr(applyCommand(s, 'p0', { type: 'respond_trade', offerId: 'x', response: 'accept' }, { rng }), ERROR_CODES.WRONG_PHASE);
  });

  it('histórico: HISTORY_LIMIT descarta os mais antigos mantendo meta coerente', () => {
    let s = finishSetup(newGame(3, 'hist'), makeRng('hist'));
    const seqBefore = s.historySeq;
    const turns = HISTORY_LIMIT + 10;
    for (let i = 0; i < turns; i++) {
      s = act(s, { type: 'roll_dice' }, diceRng(2, 2)); // sempre 4, sem7
      s = act(s, { type: 'end_turn' }, makeRng('h'));
    }
    // 3 eventos por turno: dice + production + turn_ended
    expect(s.historySeq).toBe(seqBefore + turns * 3);
    expect(s.history.events.length).toBe(HISTORY_LIMIT);
    const first = s.history.events[0];
    const last = s.history.events[s.history.events.length - 1];
    expect(first.seq).toBe(s.historySeq - HISTORY_LIMIT + 1);
    expect(last.seq).toBe(s.historySeq);
    expect(s.history.meta[first.seq]).toBeDefined();
    expect(s.history.meta[last.seq]).toBeDefined();
    expect(s.history.meta[1]).toBeUndefined(); // mais antigo descartado
  });

  it('criação determinística: mesma seed + mesma RNG => mesmo estado', () => {
    const a = createGame({ players: makePlayers(3), boardSeed: 'det', rng: makeRng('det-rng') });
    const b = createGame({ players: makePlayers(3), boardSeed: 'det', rng: makeRng('det-rng') });
    expect(a).toEqual(b);
  });
});
