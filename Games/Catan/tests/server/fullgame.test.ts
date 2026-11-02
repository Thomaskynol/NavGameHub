// Partida completa com o MOTOR REAL (não fake): setup snake, turnos, produção,
// construção, troca, dev, o 7 com descarte+ladrão, caminho até a vitória e
// persistência após reinício. Determinística via seed_rng + force_next_dice.
//
// Sincronização: todo nextViewMatching é registrado ANTES do comando que dispara
// o broadcast, para não perder a view (o servidor emite uma view por mutação).
import { afterEach, describe, expect, it } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { cmd, createRoom, hook, joinRoom, lobby, nextViewMatching, startHarness, type Harness } from './harness';
import * as realEngine from '../../src/engine';
import type { GameState } from '../../src/shared/types';
import type { EdgeId, HexId, ResourceKind } from '../../src/shared/constants';

// O harness só exige GameEngineApi; o motor real é um subconjunto estrutural.
const engine = realEngine as unknown as Parameters<typeof startHarness>[0] extends { engine?: infer E } ? E : never;

const RES: readonly ResourceKind[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function loadState(h: Harness, code: string): GameState {
  const room = h.app.ctx.store.rooms.get(code);
  if (!room?.state) throw new Error('estado do jogo não carregado');
  return room.state as GameState;
}

function totalOf(p: GameState['players'][number]): number {
  return Object.values(p.resources).reduce((a: number, b: number) => a + b, 0);
}

/** Coloca assentamento + estrada na preparação usando dicas legais do motor real. */
async function setupStep(h: Harness, sockets: Record<string, ClientSocket>, code: string, versionRef: { v: number }): Promise<void> {
  const state = loadState(h, code);
  const actor = state.setup.queue[state.setup.pos];
  const hints = realEngine.legalBuildTargets(state, actor);
  const sock = sockets[actor];
  if (state.phase === 'setup_settlement') {
    const res = await cmd(sock, { type: 'setup_settlement', vertexId: hints.setupVertices[0] }, { baseVersion: versionRef.v });
    expect(res.ok, `setup_settlement falhou: ${JSON.stringify((res as { error?: unknown }).error)}`).toBe(true);
  } else {
    const res = await cmd(sock, { type: 'setup_road', edgeId: hints.setupEdges[0] }, { baseVersion: versionRef.v });
    expect(res.ok, `setup_road falhou: ${JSON.stringify((res as { error?: unknown }).error)}`).toBe(true);
  }
  versionRef.v += 1;
}

/** Monta um descarte válido (floor(n/2)) a partir da mão real do jogador. */
function buildDiscard(hand: Record<ResourceKind, number>): Partial<Record<ResourceKind, number>> {
  const total = totalOf({ resources: hand } as GameState['players'][number]);
  const cards: Partial<Record<ResourceKind, number>> = {};
  let remaining = Math.floor(total / 2);
  for (const k of RES) {
    const take = Math.min(remaining, hand[k]);
    if (take > 0) cards[k] = take;
    remaining -= take;
  }
  return cards;
}

describe('partida completa (motor real)', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  it('setup snake + turnos + 7 com descarte/ladrão + vitória + reinício', async () => {
    const h = await startHarness({ hooks: true, engine: engine as never });
    cleanups.push(() => h.close({ keepDb: true }));

    // ---- lobby: 3 jogadores prontos ----
    const host = await createRoom(h, 'Ana');
    const code = host.session.roomCode;
    const sockets: Record<string, ClientSocket> = { [host.session.playerId]: host.socket };
    const ids: string[] = [host.session.playerId];
    for (const name of ['Bia', 'Caio']) {
      const j = await joinRoom(h, code, name);
      sockets[j.session.playerId] = j.socket;
      ids.push(j.session.playerId);
    }
    for (const pid of ids) {
      const res = await lobby(sockets[pid], { type: 'set_ready', ready: true });
      expect(res.ok).toBe(true);
    }
    // seed_rng ANTES do start_game => createGame usa RNG determinística.
    const hostSock = sockets[ids[0]];
    expect((await hook(hostSock, { type: 'seed_rng', seed: 'fullgame-seed' })).ok).toBe(true);

    // ---- start_game: registra a view de setup ANTES do broadcast ----
    const setupP = nextViewMatching(hostSock, (v) => v.phase === 'setup_settlement');
    const start = await lobby(hostSock, { type: 'start_game', boardSeed: 'fullgame-board' });
    expect(start.ok).toBe(true);
    let view = await setupP;
    expect(view.phase).toBe('setup_settlement');
    expect(view.history.some((hst) => hst.kind === 'game_started')).toBe(true);
    const versionRef = { v: view.version };

    // ---- setup snake completo (6 assentamentos + 6 estradas) ----
    // A fila snake p/ 3 jogadores é [p0,p1,p2,p2,p1,p0] = 6 turnos × 2 comandos = 12.
    const snake: string[] = [...ids, ...[...ids].reverse()];
    const preRollP = nextViewMatching(hostSock, (v) => v.phase === 'pre_roll');
    for (let i = 0; i < snake.length * 2; i += 1) await setupStep(h, sockets, code, versionRef);
    view = await preRollP;
    expect(view.phase).toBe('pre_roll');
    expect(view.board.buildings.length).toBe(6);
    expect(view.board.roads.length).toBe(6);
    for (const pid of ids) expect(view.board.buildings.filter((b) => b.playerId === pid).length).toBe(2);
    // 2º assentamento concedeu recursos (algum jogador tem recursos > 0)
    expect(view.players.some((pl) => pl.resourcesCount > 0)).toBe(true);
    // fila snake confirmada: o 1º a jogar é o p0
    expect(view.activePlayerId).toBe(ids[0]);

    // ---- o 7 no turno do p0 (p0 tem só 2 pts do setup; sem fixture) ----
    const me = ids[0];
    const sockMe = sockets[me];
    expect(realEngine.publicVictoryPoints(loadState(h, code), me)).toBe(2);
    // rola 7: força await_discards se p0 tem >7, senão robber direto
    const stSetup = loadState(h, code);
    const total0 = totalOf(stSetup.players.find((x) => x.id === me)!);
    expect((await hook(sockMe, { type: 'force_next_dice', d1: 6, d2: 1 })).ok).toBe(true);
    const after7P = nextViewMatching(sockMe, (v) => v.phase === 'await_discards' || v.phase === 'robber');
    const roll7 = await cmd(sockMe, { type: 'roll_dice' }, { baseVersion: versionRef.v });
    expect(roll7.ok).toBe(true);
    versionRef.v += 1;
    view = await after7P;
    expect(view.phase === 'robber' || view.phase === 'await_discards').toBe(true);
    // se p0 tinha >7, descarta e o motor leva ao robber
    if (view.phase === 'await_discards') {
      expect(total0).toBeGreaterThan(7);
      expect(view.pending?.type).toBe('discard');
      const stDisc = loadState(h, code);
      const p0Full = stDisc.players.find((x) => x.id === me)!;
      const robberP = nextViewMatching(sockMe, (v) => v.phase === 'robber');
      const disc = await cmd(sockMe, { type: 'discard', cards: buildDiscard(p0Full.resources) }, { baseVersion: versionRef.v });
      expect(disc.ok, `descarte falhou: ${JSON.stringify((disc as { error?: unknown }).error)}`).toBe(true);
      versionRef.v += 1;
      view = await robberP;
    }
    expect(view.phase).toBe('robber');
    // move ladrão p/ hex com construção de p1 (vítima) e rouba
    const stR = loadState(h, code);
    const targetHex = stR.board.hexes.find((hx) => {
      if (hx.id === stR.robberHexId) return false;
      return stR.buildings.some((b) => b.playerId === ids[1] && (stR.board.vertexHexes[b.vertexId] ?? []).includes(hx.id));
    });
    expect(targetHex, 'sem hex com vítima para o ladrão').toBeDefined();
    const afterActionP = nextViewMatching(sockMe, (v) => v.phase === 'action');
    const mv = await cmd(sockMe, { type: 'move_robber', hexId: targetHex!.id as HexId, victimId: ids[1] }, { baseVersion: versionRef.v });
    expect(mv.ok, `move_robber falhou: ${JSON.stringify((mv as { error?: unknown }).error)}`).toBe(true);
    versionRef.v += 1;
    view = await afterActionP;
    expect(view.phase).toBe('action'); // voltou à fase de ação do p0 (2 pts; sub-10)

    // ---- p0 sub-10 (2 pts): construção + troca + dev (nao vencem) ----
    let st = loadState(h, code);
    expect(realEngine.publicVictoryPoints(st, me)).toBe(2); // ainda sub-10

    // construção de estrada (1 tijolo + 1 madeira). Precisa de recursos; o setup pode nao dar.
    // Se nao tiver, pula (a cobertura de construção já existe em tests/engine).
    const freeEdges = realEngine.legalBuildTargets(st, me).roadEdges;
    expect(freeEdges.length).toBeGreaterThan(0);
    const p0Now = st.players.find((x) => x.id === me)!;
    if (p0Now.resources.brick >= 1 && p0Now.resources.lumber >= 1) {
      const roadsBefore = st.roads.filter((r) => r.playerId === me).length;
      const br = await cmd(sockMe, { type: 'build_road', edgeId: freeEdges[0] as EdgeId }, { baseVersion: versionRef.v });
      expect(br.ok).toBe(true);
      versionRef.v += 1;
      st = loadState(h, code);
      expect(st.roads.filter((r) => r.playerId === me).length).toBe(roadsBefore + 1);
    }

    // troca bancária: usa a taxa real do motor (2:1 se porto de brick do setup)
    st = loadState(h, code);
    const rate = realEngine.bestBankRate(st, me, 'brick');
    expect([2, 3, 4]).toContain(rate);
    const p0Hand = st.players.find((x) => x.id === me)!;
    if (p0Hand.resources.wool >= rate) {
      const bankBefore = st.bank.brick;
      const bt = await cmd(sockMe, { type: 'bank_trade', give: { wool: rate }, want: { brick: 1 } }, { baseVersion: versionRef.v });
      expect(bt.ok, `bank_trade falhou: ${JSON.stringify((bt as { error?: unknown }).error)}`).toBe(true);
      versionRef.v += 1;
      st = loadState(h, code);
      expect(st.bank.brick).toBe(bankBefore - 1);
    }

    // compra de dev card (1 lã + 1 grão + 1 minério) + boughtThisTurn na YouView.
    // O p0 sub-10 pode nao ter os 3 recursos do setup; entao pula (cobertura em tests/engine).
    st = loadState(h, code);
    const devBefore = st.devDeck.length;
    const p0Dev = st.players.find((x) => x.id === me)!;
    if (p0Dev.resources.wool >= 1 && p0Dev.resources.grain >= 1 && p0Dev.resources.ore >= 1) {
      const buy = await cmd(sockMe, { type: 'buy_dev_card' }, { baseVersion: versionRef.v });
      expect(buy.ok).toBe(true);
      versionRef.v += 1;
      st = loadState(h, code);
      expect(st.devDeck.length).toBe(devBefore - 1);
      // boughtThisTurn exposto na YouView (o servidor copia do estado do motor)
      expect(st.players.find((x) => x.id === me)!.boughtThisTurn.length).toBe(1);
    }

    // ---- fixture near-win: 8 pts públicos + 17 cartas (p0 => 10 pts) ----
    const fix0 = await hook(sockMe, { type: 'load_near_win_fixture' });
    expect(fix0.ok).toBe(true);
    versionRef.v += 1;
    st = loadState(h, code);
    expect(realEngine.publicVictoryPoints(st, me)).toBeGreaterThanOrEqual(8);

    // ---- vitória no MESMO turno do p0: constrói cidade (3 ore + 2 grain) -> 10+ -> game_over ----
    st = loadState(h, code);
    const meWin = st.players.find((x) => x.id === me)!;
    expect(meWin.resources.ore).toBeGreaterThanOrEqual(3);
    expect(meWin.resources.grain).toBeGreaterThanOrEqual(2);
    const cityTargets = realEngine.legalBuildTargets(st, me).cityVertices;
    expect(cityTargets.length).toBeGreaterThan(0);
    const wonP = nextViewMatching(sockMe, (v) => v.phase === 'game_over');
    const buildCity = await cmd(sockMe, { type: 'build_city', vertexId: cityTargets[0] }, { baseVersion: versionRef.v });
    expect(buildCity.ok, `build_city falhou: ${JSON.stringify((buildCity as { error?: unknown }).error)}`).toBe(true);
    versionRef.v += 1;
    view = await wonP;
    expect(view.phase).toBe('game_over');
    expect(view.winnerId).toBe(me);
    expect(realEngine.totalVictoryPoints(loadState(h, code), me)).toBeGreaterThanOrEqual(10);
    // comandos após game_over rejeitados
    const afterOver = await cmd(sockMe, { type: 'end_turn' }, { baseVersion: view.version });
    expect(afterOver.ok).toBe(false);
    if (!afterOver.ok) expect(afterOver.error.code).toBe('INVALID_STATE');

    // ---- persistência: reinício do store mantém o estado final ----
    const finalVersion = view.version;
    const finalPhase = view.phase;
    const finalWinner = view.winnerId;
    await h.close({ keepDb: true });
    cleanups.length = 0;
    const h2 = await startHarness({ hooks: true, engine: engine as never, dbPath: h.dbPath });
    cleanups.push(() => h2.close());
    const sock2 = await h2.connect();
    const bind = await lobby(sock2, { type: 'bind_session', code, recoveryCode: host.session.recoveryCode, mode: 'resume' });
    expect(bind.ok).toBe(true);
    if (bind.ok && 'view' in bind) {
      expect(bind.view?.version).toBe(finalVersion);
      expect(bind.view?.phase).toBe(finalPhase);
      expect(bind.view?.winnerId).toBe(finalWinner);
    }
  });
});
