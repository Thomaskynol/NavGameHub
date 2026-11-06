// L3 Item3 (R9): TurnBar (via Game.playableDevs) deve espelhar a referência
// HandPanel.devCardState e o servidor autoritativo (consumeDevCard):
// carta nova (boughtThisTurn, por id) não é jogável; com carta antiga do mesmo
// tipo presente, a antiga segue jogável (conta ×1, não ×2); após 1 ação no
// turno, nada é jogável; fora do próprio turno/fase de ação, nada é jogável.
// RED: playableDevCounts ainda não existe em Game.tsx.
import { describe, expect, it } from 'vitest';
import type { DevCardKind } from '../../src/shared/constants';
import type { GameView } from '../../src/shared/protocol';
import { playableDevCounts } from '../../src/client/screens/Game';

type ViewLike = Pick<GameView, 'phase' | 'activePlayerId' | 'you'>;

function viewLike(opts: {
  phase?: GameView['phase'];
  active?: string;
  you?: string;
  devs?: { id: string; kind: DevCardKind }[];
  bought?: string[];
  played?: boolean;
}): ViewLike {
  return {
    phase: opts.phase ?? 'action',
    activePlayerId: opts.active ?? 'p0',
    you: {
      id: opts.you ?? 'p0',
      name: 'Ana',
      color: 'red',
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
      devCards: opts.devs ?? [],
      victoryPoints: 2,
      bankRate: 4,
      ports: [],
      boughtThisTurn: opts.bought ?? [],
      playedActionCardThisTurn: opts.played ?? false,
    },
  } as ViewLike;
}

describe('playableDevCounts (TurnBar espelha servidor + HandPanel)', () => {
  it('(1) carta comprada no turno bloqueada (só nova => [])', () => {
    const v = viewLike({ devs: [{ id: 'n1', kind: 'knight' }], bought: ['n1'] });
    expect(playableDevCounts(v, 'p0')).toEqual([]);
  });

  it('(2) carta antiga do mesmo tipo PERMITIDA com nova presente (×1)', () => {
    const v = viewLike({
      devs: [
        { id: 'old', kind: 'knight' },
        { id: 'new', kind: 'knight' },
      ],
      bought: ['new'],
    });
    expect(playableDevCounts(v, 'p0')).toEqual([{ kind: 'knight', n: 1 }]);
  });

  it('(3) ação já usada no turno bloqueia tudo', () => {
    const v = viewLike({ devs: [{ id: 'old', kind: 'knight' }], bought: [], played: true });
    expect(playableDevCounts(v, 'p0')).toEqual([]);
  });

  it('(4) turno alheio bloqueia tudo', () => {
    const v = viewLike({ active: 'p1', devs: [{ id: 'old', kind: 'knight' }] });
    expect(playableDevCounts(v, 'p0')).toEqual([]);
  });

  it('(5) pré-dados e ação permitem; ladrão/setup bloqueiam', () => {
    const old = [{ id: 'old', kind: 'monopoly' as DevCardKind }];
    expect(playableDevCounts(viewLike({ phase: 'pre_roll', devs: old }), 'p0')).toEqual([
      { kind: 'monopoly', n: 1 },
    ]);
    expect(playableDevCounts(viewLike({ phase: 'action', devs: old }), 'p0')).toEqual([
      { kind: 'monopoly', n: 1 },
    ]);
    expect(playableDevCounts(viewLike({ phase: 'robber', devs: old }), 'p0')).toEqual([]);
    expect(playableDevCounts(viewLike({ phase: 'setup_settlement', devs: old }), 'p0')).toEqual([]);
  });

  it('(6) contagem mista: 2 antigas jogáveis + 2 novas bloqueadas + VP ignorada', () => {
    const v = viewLike({
      devs: [
        { id: 'k-old', kind: 'knight' },
        { id: 'k-new', kind: 'knight' },
        { id: 'm-old', kind: 'monopoly' },
        { id: 'm-new', kind: 'monopoly' },
        { id: 'vp', kind: 'victoryPoint' },
      ],
      bought: ['k-new', 'm-new'],
    });
    expect(playableDevCounts(v, 'p0')).toEqual([
      { kind: 'knight', n: 1 },
      { kind: 'monopoly', n: 1 },
    ]);
  });
});
