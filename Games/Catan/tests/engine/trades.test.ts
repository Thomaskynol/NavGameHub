import { describe, expect, it } from 'vitest';
import { applyCommand, bestBankRate } from '../../src/engine';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { GameState } from '../../src/shared/types';
import {
  act,
  addBuilding,
  expectErr,
  finishSetup,
  giveCards,
  makeRng,
  newGame,
  resetBoard,
  toAction,
} from './helpers';

/** Estado em action do p0 com mãos zeradas, banco cheio e SEM construções do setup (portos limpos). */
function tradeScenario(): GameState {
  const rolled = toAction(finishSetup(newGame(3, 'trade'), makeRng('trade')));
  return resetBoard(rolled); // limpa tabuleiro/mãos/banco; fase segue action do p0
}

describe('trocas', () => {
  it('marítima 4:1 padrão; taxa errada rejeitada', () => {
    let s = tradeScenario();
    giveCards(s, 'p0', { ore: 4 });
    // taxa errada
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { ore: 3 }, want: { grain: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
    s = act(s, { type: 'bank_trade', give: { ore: 4 }, want: { grain: 1 } }, makeRng('x'));
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.ore).toBe(0);
    expect(p0.resources.grain).toBe(1);
    expect(s.bank.ore).toBe(19); // 4 devolvidas ao banco (giveCards já tinha retirado 4)
    expect(s.bank.grain).toBe(19 - 1);
  });

  it('porto genérico 3:1 e porto especial 2:1 (taxa vale para o recurso recebido)', () => {
    let s = tradeScenario();
    const genericPort = s.board.ports.find((p) => p.kind === 'generic')!;
    addBuilding(s, 'p0', genericPort.vertexIds[0], 'settlement');
    expect(bestBankRate(s, 'p0', 'ore')).toBe(3);
    giveCards(s, 'p0', { lumber: 6 });
    s = act(s, { type: 'bank_trade', give: { lumber: 3 }, want: { ore: 1 } }, makeRng('x'));
    expect(s.players.find((p) => p.id === 'p0')!.resources.ore).toBe(1);
    // porto especial grain => 2:1 para receber grão
    const grainPort = s.board.ports.find((p) => p.kind === 'grain')!;
    addBuilding(s, 'p0', grainPort.vertexIds[1], 'settlement');
    expect(bestBankRate(s, 'p0', 'grain')).toBe(2);
    expect(bestBankRate(s, 'p0', 'ore')).toBe(3); // ore continua 3 (genérico)
    const lumberBefore = s.players.find((p) => p.id === 'p0')!.resources.lumber;
    giveCards(s, 'p0', { lumber: 2 });
    s = act(s, { type: 'bank_trade', give: { lumber: 2 }, want: { grain: 1 } }, makeRng('x'));
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.grain).toBe(1);
    expect(p0.resources.lumber).toBe(lumberBefore); // 3 doadas +2 doadas -1? lumber: 6-3=3; +2=5; -2=3
  });

  it('multi-recurso: taxa somada por recurso pedido (docs/rules.md §4.13)', () => {
    let s = tradeScenario();
    const grainPort = s.board.ports.find((p) => p.kind === 'grain')!;
    addBuilding(s, 'p0', grainPort.vertexIds[0], 'settlement');
    giveCards(s, 'p0', { ore: 8 });
    // quer grão (2:1) + lã (4:1): taxa = 2*1 + 4*1 = 6 => give total 6
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { ore: 4 }, want: { grain: 1, wool: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
    s = act(s, { type: 'bank_trade', give: { ore: 6 }, want: { grain: 1, wool: 1 } }, makeRng('x'));
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.grain).toBe(1);
    expect(p0.resources.wool).toBe(1);
    expect(p0.resources.ore).toBe(2); // 8 - 6
  });

  it('doação e mesmo recurso proibidos; banco sem estoque; jogador sem cartas', () => {
    const s = tradeScenario();
    giveCards(s, 'p0', { ore: 4, grain: 2 });
    // doação (want vazio)
    expectErr(applyCommand(s, 'p0', { type: 'bank_trade', give: { ore: 1 }, want: {} }, { rng: makeRng('x') }), ERROR_CODES.INVALID_TRADE);
    expectErr(applyCommand(s, 'p0', { type: 'bank_trade', give: {}, want: { grain: 1 } }, { rng: makeRng('x') }), ERROR_CODES.INVALID_TRADE);
    // mesmo recurso nos dois lados
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { grain: 4 }, want: { grain: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
    // sem recursos
    expectErr(applyCommand(s, 'p0', { type: 'bank_trade', give: { brick: 4 }, want: { grain: 1 } }, { rng: makeRng('x') }), ERROR_CODES.INSUFFICIENT_RESOURCES);
    // banco sem o recurso pedido
    const s2 = structuredClone(s);
    s2.bank.brick = 0;
    expectErr(applyCommand(s2, 'p0', { type: 'bank_trade', give: { ore: 4 }, want: { brick: 1 } }, { rng: makeRng('x') }), ERROR_CODES.BANK_EMPTY);
  });

  it('proposta/aceite transfere recursos de ambos os lados', () => {
    let s = tradeScenario();
    giveCards(s, 'p0', { lumber: 2 });
    giveCards(s, 'p1', { wool: 1 });
    s = act(s, { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 2 }, want: { wool: 1 } }, makeRng('x'));
    expect(s.offers.length).toBe(1);
    const offerId = s.offers[0].id;
    expect(s.history.events.some((e) => e.type === 'trade_proposed')).toBe(true);
    // p2 (não designado) não pode responder
    expectErr(applyCommand(s, 'p2', { type: 'respond_trade', offerId, response: 'accept' }, { rng: makeRng('x') }), ERROR_CODES.TRADE_NOT_AVAILABLE);
    const r = applyCommand(s, 'p1', { type: 'respond_trade', offerId, response: 'accept' }, { rng: makeRng('x') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.offers.length).toBe(0);
    const p0 = r.state.players.find((p) => p.id === 'p0')!;
    const p1 = r.state.players.find((p) => p.id === 'p1')!;
    expect(p0.resources.lumber).toBe(0);
    expect(p0.resources.wool).toBe(1);
    expect(p1.resources.lumber).toBe(2);
    expect(p1.resources.wool).toBe(0);
    expect(r.state.history.events.some((e) => e.type === 'trade_accepted')).toBe(true);
  });

  it('aceite revalida recursos do aceitante e do proponente no ato', () => {
    let s = tradeScenario();
    giveCards(s, 'p0', { lumber: 2 });
    giveCards(s, 'p1', { wool: 1 });
    s = act(s, { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 2 }, want: { wool: 1 } }, makeRng('x'));
    const offerId = s.offers[0].id;
    // aceitante gasta a lã antes
    const s2 = structuredClone(s);
    s2.players.find((p) => p.id === 'p1')!.resources.wool = 0;
    expectErr(applyCommand(s2, 'p1', { type: 'respond_trade', offerId, response: 'accept' }, { rng: makeRng('x') }), ERROR_CODES.INSUFFICIENT_RESOURCES);
    // proponente gasta a madeira antes
    const s3 = structuredClone(s);
    s3.players.find((p) => p.id === 'p0')!.resources.lumber = 0;
    expectErr(applyCommand(s3, 'p1', { type: 'respond_trade', offerId, response: 'accept' }, { rng: makeRng('x') }), ERROR_CODES.INSUFFICIENT_RESOURCES);
  });

  it('recusa e cancelamento removem a oferta', () => {
    let s = tradeScenario();
    giveCards(s, 'p0', { lumber: 1 });
    s = act(s, { type: 'propose_trade', toPlayerId: 'p2', give: { lumber: 1 }, want: { ore: 1 } }, makeRng('x'));
    const offerId = s.offers[0].id;
    const rj = applyCommand(s, 'p2', { type: 'respond_trade', offerId, response: 'reject' }, { rng: makeRng('x') });
    expect(rj.ok).toBe(true);
    if (!rj.ok) return;
    expect(rj.state.offers.length).toBe(0);
    expect(rj.state.history.events.some((e) => e.type === 'trade_rejected')).toBe(true);
    // recusada não existe mais
    expectErr(applyCommand(rj.state, 'p2', { type: 'respond_trade', offerId, response: 'accept' }, { rng: makeRng('x') }), ERROR_CODES.OFFER_EXPIRED);
    // cancelamento pelo proponente
    let s2 = act(rj.state, { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 1 }, want: { ore: 1 } }, makeRng('x'));
    const offer2 = s2.offers[0].id;
    // somente o proponente cancela
    expectErr(applyCommand(s2, 'p1', { type: 'cancel_trade', offerId: offer2 }, { rng: makeRng('x') }), ERROR_CODES.NOT_YOUR_TURN);
    s2 = act(s2, { type: 'cancel_trade', offerId: offer2 }, makeRng('x'));
    expect(s2.offers.length).toBe(0);
    expect(s2.history.events.some((e) => e.type === 'trade_cancelled')).toBe(true);
  });

  it('fim de turno invalida ofertas pendentes com evento', () => {
    let s = tradeScenario();
    giveCards(s, 'p0', { lumber: 1 });
    s = act(s, { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 1 }, want: { ore: 1 } }, makeRng('x'));
    expect(s.offers.length).toBe(1);
    s = act(s, { type: 'end_turn' }, makeRng('x'));
    expect(s.offers.length).toBe(0);
    expect(s.history.events.some((e) => e.type === 'trade_cancelled')).toBe(true);
    // responder depois do fim de turno: ofertas zeradas e fase mudou
    expectErr(applyCommand(s, 'p1', { type: 'respond_trade', offerId: 'offer-999', response: 'accept' }, { rng: makeRng('x') }), ERROR_CODES.WRONG_PHASE);
  });

  it('máximo de 2 ofertas ativas por jogador ativo; proposta para si rejeitada', () => {
    let s = tradeScenario();
    giveCards(s, 'p0', { lumber: 3 });
    s = act(s, { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 1 }, want: { ore: 1 } }, makeRng('x'));
    s = act(s, { type: 'propose_trade', toPlayerId: 'p2', give: { lumber: 1 }, want: { ore: 1 } }, makeRng('x'));
    expect(s.offers.length).toBe(2);
    giveCards(s, 'p0', { lumber: 1 });
    expectErr(
      applyCommand(s, 'p0', { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 1 }, want: { ore: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.TRADE_NOT_AVAILABLE,
    );
    expectErr(
      applyCommand(s, 'p0', { type: 'propose_trade', toPlayerId: 'p0', give: { lumber: 1 }, want: { ore: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
  });

  it('proposta valida recursos na origem; doméstica não envolve terceiros', () => {
    const s = tradeScenario();
    // sem recursos
    expectErr(
      applyCommand(s, 'p0', { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 1 }, want: { ore: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INSUFFICIENT_RESOURCES,
    );
    // p1 tenta propor (não é o ativo)
    giveCards(s, 'p1', { wool: 1 });
    expectErr(
      applyCommand(s, 'p1', { type: 'propose_trade', toPlayerId: 'p0', give: { wool: 1 }, want: { ore: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.NOT_YOUR_TURN,
    );
    // mesmo recurso nos dois lados
    const s2 = tradeScenario();
    giveCards(s2, 'p0', { lumber: 2 });
    expectErr(
      applyCommand(s2, 'p0', { type: 'propose_trade', toPlayerId: 'p1', give: { lumber: 1 }, want: { lumber: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
  });
});
