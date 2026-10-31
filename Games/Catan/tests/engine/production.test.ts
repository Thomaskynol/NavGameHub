import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/engine';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { GameState } from '../../src/shared/types';
import type { ResourceKind } from '../../src/shared/constants';
import {
  addBuilding,
  diceRng,
  expectErr,
  finishSetup,
  hexVertices,
  makeRng,
  newGame,
  resetBoard,
  setBank,
} from './helpers';

/** Cenário: tabuleiro limpo + um hex com número conhecido (únicos com o token); p0 em pre_roll. */
function scenario(token: number, seed = 'prod'): { s: GameState; hexId: string; verts: string[] } {
  let s = finishSetup(newGame(3, seed), makeRng(seed));
  s = resetBoard(s);
  const hex = s.board.hexes.find((h) => h.number === token);
  if (!hex) throw new Error(`sem hex com número ${token}`);
  // zera outros hexes com o mesmo token (tokens aparecem 2x; evita produção fantasma no cenário)
  for (const h of s.board.hexes) {
    if (h.number === token && h.id !== hex.id) h.number = null;
  }
  return { s, hexId: hex.id, verts: hexVertices(s, hex.id) };
}

function roll(s: GameState, token: number): ReturnType<typeof applyCommand> {
  const d1 = Math.min(6, token - 1);
  const d2 = token - d1;
  return applyCommand(s, s.players[s.activeIndex].id, { type: 'roll_dice' }, { rng: diceRng(d1, d2) });
}

function resourceOf(s: GameState, hexId: string): ResourceKind {
  const hex = s.board.hexes.find((h) => h.id === hexId);
  if (!hex || hex.terrain === 'desert') throw new Error('hex sem recurso');
  const map: Record<string, ResourceKind> = { hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore' };
  return map[hex.terrain];
}

describe('produção (roll)', () => {
  it('números corretos: assentamento 1, cidade 2; sem produção nos demais hexes', () => {
    const { s, hexId, verts } = scenario(6);
    const res = resourceOf(s, hexId);
    addBuilding(s, 'p0', verts[0], 'settlement');
    addBuilding(s, 'p1', verts[1], 'city');
    setBank(s, { [res]: 19 });
    const r = roll(s, 6);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p0 = r.state.players.find((p) => p.id === 'p0')!;
    const p1 = r.state.players.find((p) => p.id === 'p1')!;
    expect(p0.resources[res]).toBe(1);
    expect(p1.resources[res]).toBe(2);
    expect(r.state.dice).toEqual({ d1: 5, d2: 1 }); // 5+1 = token 6
    const ev = r.state.history.events.find((e) => e.type === 'production');
    expect(ev).toBeDefined();
  });

  it('ladrão bloqueia o hex', () => {
    const { s, hexId, verts } = scenario(8);
    const res = resourceOf(s, hexId);
    addBuilding(s, 'p0', verts[0], 'city');
    s.robberHexId = hexId;
    setBank(s, { [res]: 19 });
    const r = roll(s, 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources[res]).toBe(0);
    const ev = r.state.history.events.find((e) => e.type === 'production');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'production') {
      expect(Object.values(ev.byResource).every((list) => list.length === 0)).toBe(true);
    }
  });

  it('escassez: banco insuficiente com 2+ beneficiários => ninguém recebe', () => {
    const { s, hexId, verts } = scenario(9);
    const res = resourceOf(s, hexId);
    addBuilding(s, 'p0', verts[0], 'city'); // 2
    addBuilding(s, 'p1', verts[1], 'settlement'); // 1 => total 3, banco 2
    setBank(s, { [res]: 2 });
    const r = roll(s, 9);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources[res]).toBe(0);
    expect(r.state.players.find((p) => p.id === 'p1')!.resources[res]).toBe(0);
    expect(r.state.bank[res]).toBe(2);
  });

  it('escassez: único beneficiário recebe o que restar no banco', () => {
    const { s, hexId, verts } = scenario(10);
    const res = resourceOf(s, hexId);
    addBuilding(s, 'p0', verts[0], 'city'); // direito a 2; banco só 1
    setBank(s, { [res]: 1 });
    const r = roll(s, 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p0 = r.state.players.find((p) => p.id === 'p0')!;
    expect(p0.resources[res]).toBe(1);
    expect(r.state.bank[res]).toBe(0);
  });

  it('escassez só afeta o tipo afetado', () => {
    // dois hexes com o mesmo número: um com banco ruim, outro normal
    let s = finishSetup(newGame(3, 'mixed'), makeRng('mixed'));
    s = resetBoard(s);
    const twoHexes = s.board.hexes.filter((h) => h.number === 5);
    if (twoHexes.length < 2) throw new Error('seed sem dois hexes com 5');
    const [hA, hB] = twoHexes;
    const resA = resourceOf(s, hA.id);
    const resB = resourceOf(s, hB.id);
    expect(resA).not.toBe(resB);
    const vAHexes = hexVertices(s, hA.id).map((v) => ({ v, hexes: s.board.vertexHexes[v] ?? [] }));
    const vBHexes = hexVertices(s, hB.id).map((v) => ({ v, hexes: s.board.vertexHexes[v] ?? [] }));
    const vA = (vAHexes.find((x) => !x.hexes.includes(hB.id)) ?? vAHexes[0]).v;
    const vB = (vBHexes.find((x) => !x.hexes.includes(hA.id)) ?? vBHexes[0]).v;
    addBuilding(s, 'p0', vA, 'settlement'); // resA: 1 beneficiário => recebe
    addBuilding(s, 'p0', vB, 'settlement');
    const vB1 = (vBHexes.find((x) => x.v !== vB) ?? vBHexes[1]).v;
    addBuilding(s, 'p1', vB1, 'settlement'); // resB: 2 benef. banco baixo
    setBank(s, { [resA]: 19, [resB]: 1 });
    const r = applyCommand(s, 'p0', { type: 'roll_dice' }, { rng: diceRng(4, 1) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p0 = r.state.players.find((p) => p.id === 'p0')!;
    // resB: total devido 2 > banco 1 com 2 beneficiários => ninguém recebe
    expect(p0.resources[resB]).toBe(0);
    expect(r.state.bank[resB]).toBe(1);
    // resA: 1 beneficiário com banco cheio => recebe
    expect(p0.resources[resA]).toBe(1);
  });

  it('roll 7 sem ninguém com >7: vai direto para o ladrão', () => {
    const { s } = scenario(4);
    const r = roll(s, 7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('robber');
    expect(r.state.pending).toEqual({ type: 'robber' });
    expect(r.state.dice).toEqual({ d1: 6, d2: 1 }); // roll(7): d1=min(6,6)=6, d2=1
  });

  it('único beneficiário com banco zerado: sem ganho e sem destinatário no evento', () => {
    const { s, hexId, verts } = scenario(10);
    const res = resourceOf(s, hexId);
    addBuilding(s, 'p0', verts[0], 'city'); // único beneficiário, direito a 2
    setBank(s, { [res]: 0 });
    const r = roll(s, 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources[res]).toBe(0);
    expect(r.state.bank[res]).toBe(0);
    const ev = r.state.history.events.find((e) => e.type === 'production');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'production') {
      expect(ev.byResource[res] ?? []).toEqual([]);
    }
  });

  it('fora da fase pre_roll o roll é rejeitado', () => {
    const { s, verts } = scenario(4);
    addBuilding(s, 'p0', verts[0], 'settlement');
    const first = roll(s, 4);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.phase).toBe('action');
    expectErr(roll(first.state, 4), ERROR_CODES.WRONG_PHASE);
  });
});
