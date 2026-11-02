import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMockCommand, createMockView } from '../../src/client/dev/mockView';
import { buildIslandGeometry } from '../../src/client/board/geometry';
import type { ResourceKind } from '../../src/shared/constants';
import type { GameView } from '../../src/shared/protocol';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Total -> par de dados (sem 7; o mock remapeia 7). */
function diceFor(total: number): [number, number] {
  const map: Record<number, [number, number]> = {
    2: [1, 1], 3: [1, 2], 4: [2, 2], 5: [2, 3], 6: [3, 3],
    8: [4, 4], 9: [4, 5], 10: [5, 5], 11: [5, 6], 12: [6, 6],
  };
  const pair = map[total];
  if (!pair) throw new Error(`sem dados para ${total}`);
  return pair;
}

function stubDice(d1: number, d2: number): void {
  vi.spyOn(Math, 'random')
    .mockReturnValueOnce((d1 - 1 + 0.5) / 6)
    .mockReturnValueOnce((d2 - 1 + 0.5) / 6);
}

/** Ganho esperado do mock pelas regras do motor (adjacência, ladrão, deserto, cidade=2, teto do banco). */
function expectedGain(view: GameView, total: number): Partial<Record<ResourceKind, number>> {
  const geo = buildIslandGeometry(view.board.hexes);
  const byId = new Map(view.board.hexes.map((h) => [h.id, h]));
  const owed = new Map<ResourceKind, number>();
  for (const b of view.board.buildings) {
    if (b.playerId !== view.you.id) continue;
    for (const hid of geo.vertices.get(b.vertexId)?.hexes ?? []) {
      const t = byId.get(hid);
      if (!t || t.number !== total || t.id === view.board.robberHexId || t.terrain === 'desert') continue;
      const kinds: Record<string, ResourceKind> = { hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore' };
      const kind = kinds[t.terrain];
      owed.set(kind, (owed.get(kind) ?? 0) + (b.kind === 'city' ? 2 : 1));
    }
  }
  const out: Partial<Record<ResourceKind, number>> = {};
  for (const [kind, n] of owed) out[kind] = Math.min(n, view.bankCounts[kind]);
  return out;
}

/** Um total que produz algo para o jogador do mock (ladrão fora). */
function productiveTotal(view: GameView): number {
  const geo = buildIslandGeometry(view.board.hexes);
  const byId = new Map(view.board.hexes.map((h) => [h.id, h]));
  for (const b of view.board.buildings) {
    if (b.playerId !== view.you.id) continue;
    for (const hid of geo.vertices.get(b.vertexId)?.hexes ?? []) {
      const t = byId.get(hid);
      if (t && t.number != null && t.id !== view.board.robberHexId && t.terrain !== 'desert') return t.number;
    }
  }
  throw new Error('mock sem hex producente adjacente');
}

describe('mock: producao no roll_dice', () => {
  it('roll do numero adjacente entrega recursos (cidade dobra)', () => {
    const view = createMockView();
    const total = productiveTotal(view);
    const [d1, d2] = diceFor(total);
    stubDice(d1, d2);
    const before = { ...view.you.resources };
    const want = expectedGain(view, total);
    expect(Object.keys(want).length).toBeGreaterThan(0);
    const next = applyMockCommand(view, { type: 'roll_dice' });
    expect(next.dice).toEqual({ d1, d2 });
    for (const [kind, n] of Object.entries(want)) {
      expect(next.you.resources[kind as ResourceKind]).toBe(before[kind as ResourceKind] + (n as number));
    }
  });

  it('ladrao no hex bloqueia a producao dele', () => {
    const view = createMockView();
    const total = productiveTotal(view);
    const geo = buildIslandGeometry(view.board.hexes);
    const target = view.board.hexes.find(
      (h) => h.number === total && h.id !== view.board.robberHexId && (geo.vertices.get(view.board.buildings.find((b) => b.playerId === view.you.id)!.vertexId)?.hexes ?? []).includes(h.id),
    );
    expect(target).toBeDefined();
    const blocked: GameView = { ...view, board: { ...view.board, robberHexId: target!.id } };
    const [d1, d2] = diceFor(total);
    stubDice(d1, d2);
    const want = expectedGain(blocked, total);
    const next = applyMockCommand(blocked, { type: 'roll_dice' });
    const before = { ...blocked.you.resources };
    for (const [kind, n] of Object.entries(want)) {
      expect(next.you.resources[kind as ResourceKind]).toBe(before[kind as ResourceKind] + (n as number));
    }
    // o hex bloqueado nao produz: ganho total cai em relacao ao tabuleiro sem bloqueio
    const unblocked = expectedGain(view, total);
    const sum = (o: Partial<Record<ResourceKind, number>>): number => Object.values(o).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum(want)).toBeLessThan(sum(unblocked));
  });

  it('nao muta a view de entrada', () => {
    const view = createMockView();
    const snapshot = JSON.stringify(view);
    const total = productiveTotal(view);
    const [d1, d2] = diceFor(total);
    stubDice(d1, d2);
    applyMockCommand(view, { type: 'roll_dice' });
    expect(JSON.stringify(view)).toBe(snapshot);
  });
});
