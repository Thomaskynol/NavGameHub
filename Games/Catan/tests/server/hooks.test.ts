// Hooks de teste: gate por CATAN_TEST_HOOKS, force_next_dice, seed_rng, fixture de vitória.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cmd, createRoom, emitHook, hook, nextViewMatching, startedRoom, startHarness, type Harness } from './harness';

describe('hooks de teste', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness({ hooks: true });
  });
  afterEach(async () => {
    await h.close();
  });

  it('sem CATAN_TEST_HOOKS o evento hook nao existe no socket (timeout)', async () => {
    const off = await startHarness({ hooks: false });
    try {
      const { sockets } = await startedRoom(off, 3);
      const res = await emitHook(sockets[0], { type: 'force_next_dice', d1: 1, d2: 1 });
      expect(res.timeout).toBe(true);
    } finally {
      await off.close();
    }
  });

  it('com hooks: evento hook responde (AUTH_REQUIRED sem bind)', async () => {
    const socket = await h.connect();
    const res = await emitHook(socket, { type: 'force_next_dice', d1: 1, d2: 1 });
    expect(res.timeout).toBe(false);
    expect(res.res?.ok).toBe(false);
    if (res.res && !res.res.ok) expect(res.res.error.code).toBe('AUTH_REQUIRED');
  });

  it('force_next_dice: proximo roll sai com os valores forçados', async () => {
    const { sockets } = await startedRoom(h, 3);
    const forced = await hook(sockets[0], { type: 'force_next_dice', d1: 2, d2: 5 });
    expect(forced.ok).toBe(true);
    const viewP = nextViewMatching(sockets[0], (v) => v.version === 1);
    const roll = await cmd(sockets[0], { type: 'roll_dice' }, { baseVersion: 0 });
    expect(roll.ok).toBe(true);
    const view = await viewP;
    expect(view.dice).toEqual({ d1: 2, d2: 5 });
    // Hook desarmado: proxima mutacao normal segue.
    const next = await cmd(sockets[0], { type: 'end_turn' }, { baseVersion: 1 });
    expect(next.ok).toBe(true);
  });

  it('force_next_dice valida entradas', async () => {
    const { sockets } = await startedRoom(h, 3);
    const bad = await hook(sockets[0], { type: 'force_next_dice', d1: 9, d2: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_PAYLOAD');
  });

  it('seed_rng: determiniza a RNG da sala', async () => {
    const roomA = await startedRoom(h, 3);
    const roomB = await startedRoom(h, 3);
    await hook(roomA.sockets[0], { type: 'seed_rng', seed: 'mesma-seed' });
    await hook(roomB.sockets[0], { type: 'seed_rng', seed: 'mesma-seed' });
    const vaP = nextViewMatching(roomA.sockets[0], (v) => v.version === 1);
    const vbP = nextViewMatching(roomB.sockets[0], (v) => v.version === 1);
    expect((await cmd(roomA.sockets[0], { type: 'roll_dice' }, { baseVersion: 0 })).ok).toBe(true);
    expect((await cmd(roomB.sockets[0], { type: 'roll_dice' }, { baseVersion: 0 })).ok).toBe(true);
    const va = await vaP;
    const vb = await vbP;
    expect(va.dice).toEqual(vb.dice); // mesma seed => mesmos dados
    expect(va.dice).not.toBeNull();
  });

  it('load_near_win_fixture: instala estado valido perto da vitória e persiste', async () => {
    const { sockets, sessions } = await startedRoom(h, 3);
    const viewP = nextViewMatching(sockets[0], (v) => v.version === 1);
    const res = await hook(sockets[0], { type: 'load_near_win_fixture' });
    expect(res.ok).toBe(true);
    const view = await viewP;
    expect(view.version).toBe(1);
    // Jogador ativo: 2 cidades + 2 assentamentos + 6 estradas, mao cheia para comprar.
    const myBuildings = view.board.buildings.filter((b) => b.playerId === sessions[0].playerId);
    expect(myBuildings.filter((b) => b.kind === 'city').length).toBe(2);
    expect(myBuildings.filter((b) => b.kind === 'settlement').length).toBe(2);
    expect(view.board.roads.filter((r) => r.playerId === sessions[0].playerId).length).toBe(6);
    expect(view.you.victoryPoints).toBe(6);
    expect(view.you.resources).toEqual({ brick: 3, lumber: 3, wool: 4, grain: 4, ore: 3 });
    // Compra de dev card ainda funciona (deck real disponível).
    const buy = await cmd(sockets[0], { type: 'buy_dev_card' }, { baseVersion: 1 });
    expect(buy.ok).toBe(true);
  });

  it('hook sem bind => AUTH_REQUIRED; fixture em lobby sem jogo => GAME_NOT_FOUND', async () => {
    const socket = await h.connect();
    const noBind = await hook(socket, { type: 'force_next_dice', d1: 1, d2: 1 });
    expect(noBind.ok).toBe(false);
    if (!noBind.ok) expect(noBind.error.code).toBe('AUTH_REQUIRED');
    const solo = await createRoom(h, 'Lia');
    const noGame = await hook(solo.socket, { type: 'load_near_win_fixture' });
    expect(noGame.ok).toBe(false);
    if (!noGame.ok) expect(noGame.error.code).toBe('GAME_NOT_FOUND');
  });
});
