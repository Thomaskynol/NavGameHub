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

  it('porto genérico 3:1 e porto especial 2:1 (taxa vale para o recurso ENTREGUE)', () => {
    let s = tradeScenario();
    const genericPort = s.board.ports.find((p) => p.kind === 'generic')!;
    addBuilding(s, 'p0', genericPort.vertexIds[0], 'settlement');
    expect(bestBankRate(s, 'p0', 'ore')).toBe(3);
    // entrega 3 minérios a 3:1 (genérico) e recebe 1 carta qualquer
    giveCards(s, 'p0', { ore: 3 });
    s = act(s, { type: 'bank_trade', give: { ore: 3 }, want: { grain: 1 } }, makeRng('x'));
    expect(s.players.find((p) => p.id === 'p0')!.resources.grain).toBe(1);
    // porto especial de grão => 2:1 ENTREGANDO grão (2 grãos→1 madeira)
    const grainPort = s.board.ports.find((p) => p.kind === 'grain')!;
    addBuilding(s, 'p0', grainPort.vertexIds[1], 'settlement');
    expect(bestBankRate(s, 'p0', 'grain')).toBe(2);
    expect(bestBankRate(s, 'p0', 'ore')).toBe(3); // ore continua 3 (genérico, não o especial)
    giveCards(s, 'p0', { grain: 2, lumber: 2 });
    // 2 madeiras→1 grão REJEITADO: o desconto do porto de grão não vale recebendo grão
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { lumber: 2 }, want: { grain: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
    s = act(s, { type: 'bank_trade', give: { grain: 2 }, want: { lumber: 1 } }, makeRng('x'));
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.grain).toBe(1); // 1 da troca anterior + 2 - 2 entregues
    expect(p0.resources.lumber).toBe(3); // 2 que tinha + 1 recebida
  });

  it('especial sem genérico: 2:1 só no recurso do porto; resto 4:1', () => {
    let s = tradeScenario();
    const orePort = s.board.ports.find((p) => p.kind === 'ore')!;
    addBuilding(s, 'p0', orePort.vertexIds[0], 'settlement');
    expect(bestBankRate(s, 'p0', 'ore')).toBe(2);
    expect(bestBankRate(s, 'p0', 'grain')).toBe(4);
    giveCards(s, 'p0', { ore: 2, grain: 6 });
    // 2 minérios→1 grão (desconto do porto de minério, entregando minério)
    s = act(s, { type: 'bank_trade', give: { ore: 2 }, want: { grain: 1 } }, makeRng('x'));
    expect(s.players.find((p) => p.id === 'p0')!.resources.grain).toBe(7);
    // 2 grãos→1 minério REJEITADO (sem porto de grão nem genérico, grão é 4:1)
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { grain: 2 }, want: { ore: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
    // 4 grãos→1 minério vale (4:1 padrão)
    s = act(s, { type: 'bank_trade', give: { grain: 4 }, want: { ore: 1 } }, makeRng('x'));
    expect(s.players.find((p) => p.id === 'p0')!.resources.ore).toBe(1);
  });

  it('multi-lotes: cada lote homogêneo obedece a taxa do recurso entregue', () => {
    let s = tradeScenario();
    const grainPort = s.board.ports.find((p) => p.kind === 'grain')!;
    addBuilding(s, 'p0', grainPort.vertexIds[0], 'settlement');
    giveCards(s, 'p0', { grain: 6, ore: 8 });
    // 4 grãos a 2:1 = 2 lotes → 2 cartas quaisquer
    s = act(s, { type: 'bank_trade', give: { grain: 4 }, want: { lumber: 1, brick: 1 } }, makeRng('x'));
    let p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.lumber).toBe(1);
    expect(p0.resources.brick).toBe(1);
    expect(p0.resources.grain).toBe(2); // 6 - 4
    // dois lotes de tipos distintos: 2 grãos (2:1) + 4 minérios (4:1) → 2 cartas
    s = act(s, { type: 'bank_trade', give: { grain: 2, ore: 4 }, want: { wool: 2 } }, makeRng('x'));
    p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.resources.wool).toBe(2);
    expect(p0.resources.grain).toBe(0);
    expect(p0.resources.ore).toBe(4); // 8 - 4
    // inválidos: lote quebrado, nº de lotes ≠ nº pedido, give misto como lote único
    giveCards(s, 'p0', { grain: 4 });
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { grain: 3 }, want: { lumber: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { grain: 2 }, want: { lumber: 2 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
    expectErr(
      applyCommand(s, 'p0', { type: 'bank_trade', give: { grain: 1, ore: 1 }, want: { lumber: 1 } }, { rng: makeRng('x') }),
      ERROR_CODES.INVALID_TRADE,
    );
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
