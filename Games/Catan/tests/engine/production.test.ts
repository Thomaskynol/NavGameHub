import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/engine';
import { ERROR_CODES } from '../../src/shared/protocol';
import type { GameState } from '../../src/shared/types';
import type { ResourceKind, TerrainKind } from '../../src/shared/constants';
import { RESOURCE_KINDS, TERRAIN_RESOURCE } from '../../src/shared/constants';
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

  it('aldeia adjacente a dois hexes 5: roll 5 da 2 recursos (banco cheio, sem ladrao)', () => {
    let s = finishSetup(newGame(3, 's2'), makeRng('s2'));
    s = resetBoard(s);
    const fives = new Set(s.board.hexes.filter((h) => h.number === 5).map((h) => h.id));
    expect(fives.size).toBe(2);
    const entry = Object.entries(s.board.vertexHexes).find(([, hs]) => hs.filter((h) => fives.has(h)).length >= 2);
    expect(entry).toBeDefined();
    const [v, hs] = entry as [string, string[]];
    addBuilding(s, 'p0', v, 'settlement');
    const kinds = hs.filter((h) => fives.has(h)).map((h) => resourceOf(s, h));
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    const before = { ...s.players.find((p) => p.id === 'p0')!.resources };
    const r = roll(s, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.state.players.find((p) => p.id === 'p0')!;
    for (const k of kinds) {
      const n = kinds.filter((x) => x === k).length;
      expect(after.resources[k]).toBe(before[k] + n);
    }
    expect(r.state.dice).toEqual({ d1: 4, d2: 1 }); // roll(5): 4+1
  });

  it('aldeia adjacente a dois hexes 5 com ladrao em um deles: roll 5 da 1 recurso', () => {
    let s = finishSetup(newGame(3, 's2'), makeRng('s2'));
    s = resetBoard(s);
    const fives = s.board.hexes.filter((h) => h.number === 5).map((h) => h.id);
    expect(fives.length).toBe(2);
    const entry = Object.entries(s.board.vertexHexes).find(([, hs]) => fives.every((f) => hs.includes(f)));
    expect(entry).toBeDefined();
    const [v] = entry as [string, string[]];
    addBuilding(s, 'p0', v, 'settlement');
    s.robberHexId = fives[0]; // bloqueia um dos dois hexes 5
    const freeRes = resourceOf(s, fives[1]);
    const before = s.players.find((p) => p.id === 'p0')!.resources[freeRes];
    const r = roll(s, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources[freeRes]).toBe(before + 1);
  });

  it('cada terreno paga o recurso clássico (contrato terreno→recurso, ex. floresta 8 paga madeira)', () => {
    // Pina o contrato: colinas→tijolo, floresta→madeira, pasto→lã, campos→grão, montanhas→minério.
    expect(TERRAIN_RESOURCE).toEqual({
      hills: 'brick',
      forest: 'lumber',
      pasture: 'wool',
      fields: 'grain',
      mountains: 'ore',
    });
    const cases: [TerrainKind, ResourceKind][] = [
      ['hills', 'brick'],
      ['forest', 'lumber'],
      ['pasture', 'wool'],
      ['fields', 'grain'],
      ['mountains', 'ore'],
    ];
    for (const [terrain, res] of cases) {
      let s = finishSetup(newGame(3, `t-${terrain}`), makeRng(`t-${terrain}`));
      s = resetBoard(s);
      const hex = s.board.hexes.find((h) => h.terrain === terrain);
      if (!hex) throw new Error(`sem hex de ${terrain}`);
      hex.number = 8; // o caso do usuário: 8 tem que pagar
      for (const h of s.board.hexes) {
        if (h.id !== hex.id && h.number === 8) h.number = null;
      }
      s.robberHexId = s.board.hexes.find((h) => h.terrain === 'desert')?.id ?? s.robberHexId;
      const [v] = hexVertices(s, hex.id);
      addBuilding(s, 'p0', v, 'settlement');
      setBank(s, { [res]: 19 });
      const r = roll(s, 8);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const got = r.state.players.find((p) => p.id === 'p0')!.resources;
      expect(got[res]).toBe(1);
      for (const k of RESOURCE_KINDS) {
        if (k !== res) expect(got[k]).toBe(0);
      }
    }
  });
});

describe('duplo 8 de trigo (duas casas, uma em cada hex)', () => {
  /**
   * Premissa do relato: DOIS hexes fields com nº 8 + 1 assentamento adjacente a cada.
   * O motor acumula por (recurso, jogador) em todos os hexes producentes, então com
   * banco cheio e sem ladrão o dono recebe 2 grãos. Regressão do relato "saiu 8 e
   * veio só 1 trigo": com este estado o motor paga 2 — 1 grão só é correto com
   * ladrão num dos hexes ou escassez do banco (testes abaixo).
   */
  function doubleWheat8(seed = 'duplo8'): { s: GameState; hexA: string; hexB: string; vA: string; vB: string } {
    let s = finishSetup(newGame(3, seed), makeRng(seed));
    s = resetBoard(s);
    const h1 = s.board.hexes[0];
    const h2 = s.board.hexes.find((h) => h.id !== h1.id && !(s.board.hexNeighbors[h1.id] ?? []).includes(h.id));
    if (!h2) throw new Error('sem par de hexes não-adjacentes');
    h1.terrain = 'fields';
    h1.number = 8;
    h2.terrain = 'fields';
    h2.number = 8;
    for (const h of s.board.hexes) {
      if (h.id !== h1.id && h.id !== h2.id && h.number === 8) h.number = null;
    }
    // Ladrão longe dos dois 8s (deserto do próprio tabuleiro).
    s.robberHexId = s.board.hexes.find((h) => h.terrain === 'desert')?.id ?? s.robberHexId;
    const v1s = hexVertices(s, h1.id);
    const v2s = hexVertices(s, h2.id);
    const shared = new Set(v1s.filter((v) => v2s.includes(v)));
    const vA = v1s.find((v) => !shared.has(v)) ?? v1s[0];
    const vB = v2s.find((v) => !shared.has(v) && v !== vA) ?? v2s.find((v) => v !== vA)!;
    addBuilding(s, 'p0', vA, 'settlement');
    addBuilding(s, 'p0', vB, 'settlement');
    return { s, hexA: h1.id, hexB: h2.id, vA, vB };
  }

  it('banco cheio e sem ladrão: 2 grãos', () => {
    const { s } = doubleWheat8();
    setBank(s, { grain: 19 });
    const before = s.players.find((p) => p.id === 'p0')!.resources.grain;
    const r = roll(s, 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources.grain).toBe(before + 2);
    expect(r.state.bank.grain).toBe(17);
  });

  it('board de seed real com dois 8s de trigo naturais: 2 grãos', () => {
    // seed-39 gera dois fields com nº 8 não-adjacentes (cobertura "board real vs teste").
    let s = finishSetup(newGame(3, 'seed-39'), makeRng('seed-39'));
    s = resetBoard(s);
    const wheat8 = s.board.hexes.filter((h) => h.terrain === 'fields' && h.number === 8);
    expect(wheat8.length).toBe(2);
    const [hA, hB] = wheat8;
    expect(s.board.hexNeighbors[hA.id] ?? []).not.toContain(hB.id); // 6/8 nunca adjacentes
    const vA = hexVertices(s, hA.id)[0];
    const vB = hexVertices(s, hB.id).find((v) => v !== vA)!;
    addBuilding(s, 'p0', vA, 'settlement');
    addBuilding(s, 'p0', vB, 'settlement');
    setBank(s, { grain: 19 });
    expect(s.board.vertexHexes[vA]).toContain(hA.id);
    expect(s.board.vertexHexes[vB]).toContain(hB.id);
    const r = roll(s, 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources.grain).toBe(2);
  });

  it('ladrão num dos 8s: 1 grão (correto — hex bloqueado não produz)', () => {
    const { s, hexA, hexB } = doubleWheat8();
    expect(hexA).not.toBe(hexB);
    s.robberHexId = hexA; // bloqueia um dos dois hexes 8
    setBank(s, { grain: 19 });
    const r = roll(s, 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources.grain).toBe(1);
  });

  it('escassez com beneficiário único (banco 1, direito a 2): 1 grão (correto — exceção do único)', () => {
    const { s } = doubleWheat8();
    setBank(s, { grain: 1 });
    const r = roll(s, 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources.grain).toBe(1);
    expect(r.state.bank.grain).toBe(0);
  });

  it('escassez com 2+ beneficiários no mesmo recurso: ninguém recebe (correto — regra oficial)', () => {
    const { s, hexB } = doubleWheat8();
    // p1 também produz grão no 8 (direito a 1); total devido 3 > banco 2 => ninguém recebe grão.
    addBuilding(s, 'p1', hexVertices(s, hexB).find((v) => !(s.buildings.some((b) => b.vertexId === v)))!, 'settlement');
    setBank(s, { grain: 2 });
    const r = roll(s, 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === 'p0')!.resources.grain).toBe(0);
    expect(r.state.players.find((p) => p.id === 'p1')!.resources.grain).toBe(0);
    expect(r.state.bank.grain).toBe(2);
  });
});
