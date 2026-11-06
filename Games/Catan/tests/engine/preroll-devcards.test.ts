// R1: Monopólio/Ano de Fartura jogados PRÉ-roll devem preservar pre_roll
// (rolagem obrigatória única). Regressão: pós-roll permanecem em action.
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/engine';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { PlayerId } from '../../src/shared/constants';
import type { GameState } from '../../src/shared/types';
import {
  act,
  diceRng,
  expectErr,
  finishSetup,
  giveCards,
  makeRng,
  newGame,
  okState,
  setBank,
} from './helpers';

/** 2 jogadores, setup completo, Abhörer em pre_roll, mãos zeradas, banco cheio. */
function prerollScenario(): GameState {
  const done = finishSetup(newGame(2, 'r1'), makeRng('r1'));
  expect(done.phase).toBe('pre_roll');
  const s = structuredClone(done);
  for (const p of s.players) {
    for (const k of Object.keys(p.resources) as (keyof typeof p.resources)[]) p.resources[k] = 0;
    p.devCards = [];
    p.boughtThisTurn = [];
    p.playedActionCardThisTurn = false;
  }
  setBank(s, { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
  return s;
}

function actor(s: GameState): PlayerId {
  return s.players[s.activeIndex].id;
}

function foeOf(s: GameState): PlayerId {
  return s.players.find((p) => p.id !== actor(s))!.id;
}

describe('R1: cartas de progresso pré-roll preservam a fase', () => {
  it('monopólio pré-roll mantém pre_roll; roll aceito 1x; end_turn rejeitado antes do roll', () => {
    let s = prerollScenario();
    const me = actor(s);
    const foe = foeOf(s);
    giveCards(s, foe, { lumber: 3 });
    // carta de turno anterior (não está em boughtThisTurn)
    s.players.find((p) => p.id === me)!.devCards.push({ id: 'm1', kind: 'monopoly' });

    s = okState(applyCommand(s, me, { type: 'play_monopoly', resource: 'lumber' }, { rng: makeRng('x') }));
    expect(s.phase).toBe('pre_roll');
    expect(s.returnPhase).toBeNull();
    expect(s.pending).toBeNull();
    expect(s.dice).toBeNull();
    expect(s.players.find((p) => p.id === me)!.resources.lumber).toBe(3);
    expect(s.players.find((p) => p.id === foe)!.resources.lumber).toBe(0);

    // sem pular para action: encerrar o turno antes de rolar é inválido
    expectErr(applyCommand(s, me, { type: 'end_turn' }, { rng: makeRng('x') }), ERROR_CODES.WRONG_PHASE);

    // rolagem obrigatória aceita exatamente 1x (3+2=5 => produção => action)
    s = okState(applyCommand(s, me, { type: 'roll_dice' }, { rng: diceRng(3, 2) }));
    expect(s.dice).toEqual({ d1: 3, d2: 2 });
    expect(s.phase).toBe('action');
    // segunda rolagem no mesmo turno é inválida
    expectErr(applyCommand(s, me, { type: 'roll_dice' }, { rng: diceRng(3, 2) }), ERROR_CODES.WRONG_PHASE);
  });

  it('fartura pré-roll mantém pre_roll; roll aceito 1x', () => {
    let s = prerollScenario();
    const me = actor(s);
    s.players.find((p) => p.id === me)!.devCards.push({ id: 'y1', kind: 'yearOfPlenty' });

    s = okState(applyCommand(s, me, { type: 'play_year_of_plenty', resources: ['grain', 'wool'] }, { rng: makeRng('x') }));
    expect(s.phase).toBe('pre_roll');
    expect(s.returnPhase).toBeNull();
    expect(s.pending).toBeNull();
    expect(s.dice).toBeNull();
    expect(s.players.find((p) => p.id === me)!.resources.grain).toBe(1);
    expect(s.players.find((p) => p.id === me)!.resources.wool).toBe(1);

    s = okState(applyCommand(s, me, { type: 'roll_dice' }, { rng: diceRng(3, 2) }));
    expect(s.dice).toEqual({ d1: 3, d2: 2 });
    expect(s.phase).toBe('action');
  });

  it('após carta pré-roll, 7 leva a descarte e ladrão normalmente', () => {
    let s = prerollScenario();
    const me = actor(s);
    const foe = foeOf(s);
    s.players.find((p) => p.id === me)!.devCards.push({ id: 'y1', kind: 'yearOfPlenty' });
    s = okState(applyCommand(s, me, { type: 'play_year_of_plenty', resources: ['grain', 'wool'] }, { rng: makeRng('x') }));
    expect(s.phase).toBe('pre_roll');

    giveCards(s, foe, { brick: 8 }); // adversário com 8 cartas => deve descartar 4
    s = okState(applyCommand(s, me, { type: 'roll_dice' }, { rng: diceRng(4, 3) }));
    expect(s.phase).toBe('await_discards');
    expect(s.pending).toEqual({ type: 'discard', waitingOn: [foe] });

    s = okState(applyCommand(s, foe, { type: 'discard', cards: { brick: 4 } }, { rng: makeRng('x') }));
    expect(s.phase).toBe('robber');
    expect(s.pending).toEqual({ type: 'robber' });
  });

  it('monopólio/fartura pós-roll permanecem em action (sem regressão)', () => {
    let s = prerollScenario();
    const me = actor(s);
    const foe = foeOf(s);
    giveCards(s, foe, { lumber: 2, brick: 1 });
    const p0 = s.players.find((p) => p.id === me)!;
    p0.devCards.push({ id: 'm1', kind: 'monopoly' });
    p0.devCards.push({ id: 'y1', kind: 'yearOfPlenty' });

    // rola primeiro (3+2=5 => action), depois joga as duas — limite de 1 carta
    // de ação por turno impede jogar ambas; usa dois cenários.
    s = act(s, { type: 'roll_dice' }, diceRng(3, 2));
    expect(s.phase).toBe('action');
    const afterMono = okState(applyCommand(s, me, { type: 'play_monopoly', resource: 'lumber' }, { rng: makeRng('x') }));
    expect(afterMono.phase).toBe('action');
    expect(afterMono.returnPhase).toBeNull();

    let s2 = prerollScenario();
    const me2 = actor(s2);
    s2.players.find((p) => p.id === me2)!.devCards.push({ id: 'y1', kind: 'yearOfPlenty' });
    s2 = act(s2, { type: 'roll_dice' }, diceRng(3, 2));
    const afterYear = okState(applyCommand(s2, me2, { type: 'play_year_of_plenty', resources: ['ore'] }, { rng: makeRng('x') }));
    expect(afterYear.phase).toBe('action');
    expect(afterYear.returnPhase).toBeNull();
  });
});
