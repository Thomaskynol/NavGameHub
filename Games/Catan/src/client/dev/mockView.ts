// Camada mock (apenas DEV com VITE_MOCK=1): GameView completo + motorzinho local.
// Em produção o import some (tree-shake por import.meta.env.DEV).
import type { DevCardKind, HexId, PlayerColor, PlayerId, ResourceKind, VertexId, EdgeId } from '../../shared/constants';
import { COSTS, NUMBER_TOKENS, TERRAIN_COUNTS, TERRAIN_RESOURCE } from '../../shared/constants';
import type { PortSlot } from '../../shared/types';
import type {
  BoardView,
  ChatMessageView,
  GameView,
  HistoryView,
  OfferView,
  PublicPlayerView,
  YouView,
} from '../../shared/protocol';
import { buildIslandGeometry, edgeIdOf, ISLAND_AXIAL, hexId, motorCornerId, axialToCube, type IslandGeometry } from '../board/geometry';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MOCK_SEED = 'mock-ilha-deluxe';

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function mockHexes() {
  const rand = mulberry32(hashStr(MOCK_SEED));
  const terrains: string[] = [];
  (Object.keys(TERRAIN_COUNTS) as string[]).forEach((t) => {
    for (let i = 0; i < TERRAIN_COUNTS[t as keyof typeof TERRAIN_COUNTS]; i++) terrains.push(t);
  });
  const shuffledTerrains = shuffle(terrains, rand);
  // deserto sem token; tokens embaralhados nos 18 hexes não-deserto
  const tokenPool = [...NUMBER_TOKENS];
  const hexes: { id: HexId; terrain: any; number: number | null }[] = [];
  const tokenSlots = shuffle(tokenPool, rand);
  let ti = 0;
  for (let i = 0; i < ISLAND_AXIAL.length; i++) {
    const [q, r] = ISLAND_AXIAL[i];
    const terrain = shuffledTerrains[i];
    const number = terrain === 'desert' ? null : tokenSlots[ti++];
    hexes.push({ id: hexId(q, r), terrain, number });
  }
  return hexes;
}

function mockPorts(geo: IslandGeometry): PortSlot[] {
  const coastalEdges = [...geo.edges.values()].filter((e) => {
    const va = geo.vertices.get(e.a)!;
    const vb = geo.vertices.get(e.b)!;
    return va.hexes.length === 1 && vb.hexes.length === 1;
  });
  // ordena por ângulo ao centro p/ espaçar
  coastalEdges.sort((a, b) => {
    const aa = Math.atan2(a.my - geo.center.y, a.mx - geo.center.x);
    const bb = Math.atan2(b.my - geo.center.y, b.mx - geo.center.x);
    return aa - bb;
  });
  const kinds: PortSlot['kind'][] = ['generic', 'lumber', 'generic', 'wool', 'generic', 'grain', 'generic', 'ore', 'brick'];
  const out: PortSlot[] = [];
  const step = Math.max(1, Math.floor(coastalEdges.length / 9));
  for (let i = 0; i < 9; i++) {
    const e = coastalEdges[(i * step) % coastalEdges.length];
    if (!e) continue;
    out.push({ id: `port-${i}`, edgeId: e.id, vertexIds: [e.a, e.b], kind: kinds[i] });
  }
  return out;
}

const MOCK_PLAYERS: { id: PlayerId; name: string; color: PlayerColor }[] = [
  { id: 'p1', name: 'Você', color: 'blue' },
  { id: 'p2', name: 'Marina', color: 'red' },
  { id: 'p3', name: 'Caio', color: 'orange' },
  { id: 'p4', name: 'Lia', color: 'white' },
];

export function createMockView(): GameView {
  const hexes = mockHexes();
  const geo = buildIslandGeometry(hexes);
  const ports = mockPorts(geo);

  // Construções fictícias distribuídas pela ilha.
  const pickHex = (i: number) => geo.hexes[(i * 4 + 1) % geo.hexes.length];
  const buildings: BoardView['buildings'] = [];
  const roads: BoardView['roads'] = [];
  MOCK_PLAYERS.forEach((p, i) => {
    const h = pickHex(i);
    const mc = axialToCube(h.q, h.r);
    const vA = geo.vertices.get(motorCornerId(mc, 0))!;
    const vB = geo.vertices.get(motorCornerId(mc, 1))!;
    buildings.push({ vertexId: vA.id, playerId: p.id, kind: i === 0 ? 'settlement' : i === 1 ? 'city' : 'settlement' });
    roads.push({ edgeId: edgeIdOf(vA.id, vB.id), playerId: p.id });
    const h2 = pickHex(i + 5);
    const mc2 = axialToCube(h2.q, h2.r);
    const vC = geo.vertices.get(motorCornerId(mc2, 3))!;
    if (!buildings.some((b) => b.vertexId === vC.id)) {
      buildings.push({ vertexId: vC.id, playerId: p.id, kind: 'settlement' });
      const vD = geo.vertices.get(motorCornerId(mc2, 4))!;
      roads.push({ edgeId: edgeIdOf(vC.id, vD.id), playerId: p.id });
    }
  });

  const robberHexId = hexes.find((h) => h.terrain === 'desert')?.id ?? hexes[0].id;

  // Dedup: uma aresta/vértice não recebe duas peças.
  const seenB = new Set<VertexId>();
  const uniqueBuildings = buildings.filter((b) => (seenB.has(b.vertexId) ? false : (seenB.add(b.vertexId), true)));
  const seenR = new Set<EdgeId>();
  const uniqueRoads = roads.filter((r) => (seenR.has(r.edgeId) ? false : (seenR.add(r.edgeId), true)));

  const players: PublicPlayerView[] = MOCK_PLAYERS.map((p, i) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    connected: true,
    isHost: i === 0,
    ready: true,
    resourcesCount: [7, 5, 9, 4][i],
    devCardsCount: [2, 1, 3, 0][i],
    knightsPlayed: [1, 2, 0, 0][i],
    longestRoadLength: [3, 4, 2, 2][i],
    hasLargestRoad: i === 1,
    hasLargestArmy: i === 1,
    publicVictoryPoints: [4, 6, 3, 2][i],
    piecesLeft: [
      { roads: 12, settlements: 3, cities: 4 },
      { roads: 13, settlements: 4, cities: 3 },
      { roads: 14, settlements: 4, cities: 3 },
      { roads: 13, settlements: 4, cities: 4 },
    ][i],
  }));

  const you: YouView = {
    id: 'p1',
    name: 'Você',
    color: 'blue',
    resources: { brick: 4, lumber: 5, wool: 3, grain: 4, ore: 3 },
    devCards: [
      { id: 'dc1', kind: 'knight' },
      { id: 'dc2', kind: 'victoryPoint' },
    ],
    victoryPoints: 4,
    bankRate: 3,
    ports: [{ id: ports[0]?.id ?? 'port-0', kind: 'generic' }],
    boughtThisTurn: [],
    playedActionCardThisTurn: false,
  };

  const history: HistoryView[] = [
    { seq: 1, kind: 'game_started', text: 'A partida começou. Boa sorte!', private: false },
    { seq: 2, kind: 'setup_placed', text: 'Marina colocou um assentamento.', playerId: 'p2', private: false },
    { seq: 3, kind: 'dice', text: 'Você rolou 4 + 5 = 9.', playerId: 'p1', private: false },
    { seq: 4, kind: 'built', text: 'Caio construiu uma estrada.', playerId: 'p3', private: false },
    { seq: 5, kind: 'bank_trade', text: 'Marina trocou 4:1 com o banco.', playerId: 'p2', private: false },
    { seq: 6, kind: 'bought_dev_card', text: 'Lia comprou um desenvolvimento.', playerId: 'p4', private: false },
  ];

  const chat: ChatMessageView[] = [
    { id: 'c1', playerId: 'p2', name: 'Marina', color: 'red', text: 'Boa partida, pessoal!', at: Date.now() - 90_000 },
    { id: 'c2', playerId: 'p3', name: 'Caio', color: 'orange', text: 'Alguém tem tijolo para trocar?', at: Date.now() - 40_000 },
  ];

  const offers: OfferView[] = [
    {
      id: 'of1',
      fromPlayerId: 'p2',
      toPlayerId: 'p1',
      give: { ore: 1 },
      want: { grain: 2 },
    },
  ];

  return {
    roomCode: 'MOCK1',
    roomName: 'Sala de demonstração',
    version: 12,
    phase: 'action',
    activePlayerId: 'p1',
    setupCurrentPlayerId: null,
    setupQueue: MOCK_PLAYERS.map((p) => p.id),
    setupPos: MOCK_PLAYERS.length * 2,
    setupLastSettlementVertex: null,
    pending: null,
    mustRollAfterCard: false,
    board: {
      seed: MOCK_SEED,
      hexes,
      ports,
      buildings: uniqueBuildings,
      roads: uniqueRoads,
      robberHexId,
    },
    dice: { d1: 4, d2: 5 },
    players,
    you,
    bankCounts: { brick: 12, lumber: 14, wool: 11, grain: 13, ore: 15 },
    devDeckCount: 13,
    offers,
    history,
    chat,
    winnerId: null,
  };
}

// ---------- mini motor do mock ----------

const YOU: PlayerId = 'p1';

function subtract(res: YouView['resources'], cost: Partial<Record<ResourceKind, number>>): YouView['resources'] {
  const out = { ...res };
  for (const [k, n] of Object.entries(cost)) out[k as ResourceKind] -= n as number;
  return out;
}

function canAfford(res: YouView['resources'], cost: Partial<Record<ResourceKind, number>>): boolean {
  return Object.entries(cost).every(([k, n]) => (res[k as ResourceKind] ?? 0) >= (n as number));
}

function pushHistory(v: GameView, kind: string, text: string): HistoryView[] {
  return [...v.history, { seq: v.history.length + 1, kind, text, playerId: YOU, private: false }];
}

/** Aplica um comando no estado mock (retorna nova visão; nunca muta a entrada). */
export function applyMockCommand(view: GameView, payload: { type: string } & Record<string, any>): GameView {
  const base: GameView = { ...view, history: [...view.history], board: { ...view.board, buildings: [...view.board.buildings], roads: [...view.board.roads] }, you: { ...view.you, resources: { ...view.you.resources }, devCards: [...view.you.devCards] } };
  const isYourTurn = base.activePlayerId === YOU;
  const myTurnOnly = () => isYourTurn || base.phase.startsWith('setup') || base.phase === 'robber' || base.phase.startsWith('dev_');

  switch (payload.type) {
    case 'roll_dice': {
      let d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      if (d1 + d2 === 7) d1 = 3; // mock evita 7 para simplificar
      const total = d1 + d2;
      // Produção espelhando o motor (só o próprio jogador tem mão modelada no mock):
      // hex com o número, sem ladrão, sem deserto; assentamento 1, cidade 2; teto do banco
      // (beneficiário único recebe o que restar — mesma exceção do motor).
      const geo = buildIslandGeometry(base.board.hexes);
      const owed = new Map<ResourceKind, number>();
      for (const b of base.board.buildings) {
        if (b.playerId !== YOU) continue;
        for (const hid of geo.vertices.get(b.vertexId)?.hexes ?? []) {
          const t = base.board.hexes.find((h) => h.id === hid);
          if (!t || t.number !== total || t.id === base.board.robberHexId || t.terrain === 'desert') continue;
          const kind = TERRAIN_RESOURCE[t.terrain];
          owed.set(kind, (owed.get(kind) ?? 0) + (b.kind === 'city' ? 2 : 1));
        }
      }
      const res = { ...base.you.resources };
      const bank = { ...base.bankCounts };
      for (const [kind, n] of owed) {
        const give = Math.min(n, bank[kind]);
        bank[kind] -= give;
        res[kind] += give;
      }
      return {
        ...base,
        you: { ...base.you, resources: res },
        bankCounts: bank,
        dice: { d1, d2 },
        phase: 'action',
        history: pushHistory(base, 'dice', `Você rolou ${d1} + ${d2} = ${total}.`),
      };
    }
    case 'end_turn': {
      const ids = base.players.map((p) => p.id);
      const idx = ids.indexOf(base.activePlayerId ?? YOU);
      const next = ids[(idx + 1) % ids.length];
      return {
        ...base,
        activePlayerId: next,
        phase: 'action',
        dice: null,
        history: pushHistory(base, 'turn_ended', 'Você terminou o turno.'),
      };
    }
    case 'build_road': {
      if (!canAfford(base.you.resources, COSTS.road)) return view;
      const roads = [...base.board.roads, { edgeId: payload.edgeId as EdgeId, playerId: YOU }];
      const pl = base.players.map((p) => (p.id === YOU ? { ...p, piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 } } : p));
      return {
        ...base,
        you: { ...base.you, resources: subtract(base.you.resources, COSTS.road) },
        board: { ...base.board, roads },
        players: pl,
        history: pushHistory(base, 'built', 'Você construiu uma estrada.'),
      };
    }
    case 'build_settlement': {
      if (!canAfford(base.you.resources, COSTS.settlement)) return view;
      const buildings = [...base.board.buildings, { vertexId: payload.vertexId as VertexId, playerId: YOU, kind: 'settlement' as const }];
      const pl = base.players.map((p) => (p.id === YOU ? { ...p, piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements - 1 } } : p));
      return {
        ...base,
        you: { ...base.you, resources: subtract(base.you.resources, COSTS.settlement), victoryPoints: base.you.victoryPoints + 1 },
        board: { ...base.board, buildings },
        players: pl,
        history: pushHistory(base, 'built', 'Você construiu um assentamento.'),
      };
    }
    case 'build_city': {
      if (!canAfford(base.you.resources, COSTS.city)) return view;
      const buildings = base.board.buildings.map((b) =>
        b.vertexId === payload.vertexId && b.playerId === YOU ? { ...b, kind: 'city' as const } : b,
      );
      return {
        ...base,
        you: { ...base.you, resources: subtract(base.you.resources, COSTS.city), victoryPoints: base.you.victoryPoints + 1 },
        board: { ...base.board, buildings },
        history: pushHistory(base, 'built', 'Você ergueu uma cidade.'),
      };
    }
    case 'buy_dev_card': {
      if (!canAfford(base.you.resources, COSTS.devCard) || base.devDeckCount <= 0) return view;
      const kinds: DevCardKind[] = ['knight', 'victoryPoint', 'roadBuilding', 'monopoly', 'yearOfPlenty'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      return {
        ...base,
        you: {
          ...base.you,
          resources: subtract(base.you.resources, COSTS.devCard),
          devCards: [...base.you.devCards, { id: `dc-${Date.now()}`, kind }],
        },
        devDeckCount: base.devDeckCount - 1,
        history: pushHistory(base, 'bought_dev_card', 'Você comprou um desenvolvimento.'),
      };
    }
    case 'bank_trade': {
      const { give, want } = payload as unknown as { give: Record<ResourceKind, number>; want: Record<ResourceKind, number> };
      const res = { ...base.you.resources };
      for (const [k, n] of Object.entries(give)) res[k as ResourceKind] -= n as number;
      for (const [k, n] of Object.entries(want)) res[k as ResourceKind] = (res[k as ResourceKind] ?? 0) + (n as number);
      return { ...base, you: { ...base.you, resources: res }, history: pushHistory(base, 'bank_trade', 'Você trocou com o banco.') };
    }
    case 'move_robber':
    case 'play_knight': {
      const hexIdTarget = payload.hexId as HexId;
      const victim = payload.victimId as PlayerId | undefined;
      let res = base.you.resources;
      let players = base.players;
      if (victim) {
        res = { ...res, [base.you.bankRate >= 2 ? 'ore' : 'ore']: res.ore + 1 };
        players = players.map((p) => (p.id === victim ? { ...p, resourcesCount: Math.max(0, p.resourcesCount - 1) } : p));
      }
      return {
        ...base,
        you: { ...base.you, resources: res },
        players,
        board: { ...base.board, robberHexId: hexIdTarget },
        phase: 'action',
        pending: null,
        history: pushHistory(base, 'robber_moved', 'Você moveu o ladrão.'),
      };
    }
    case 'play_monopoly': {
      const r = payload.resource as ResourceKind;
      const stolen = base.players.filter((p) => p.id !== YOU).reduce((acc, p) => acc + Math.min(2, p.resourcesCount), 0);
      return {
        ...base,
        you: { ...base.you, resources: { ...base.you.resources, [r]: base.you.resources[r] + Math.min(stolen, 6) } },
        phase: 'action',
        pending: null,
        history: pushHistory(base, 'played_dev_card', `Você jogou Monopólio (${r}).`),
      };
    }
    case 'play_year_of_plenty': {
      const list = (payload.resources as ResourceKind[]) ?? [];
      const res = { ...base.you.resources };
      for (const r of list) res[r] += 1;
      return {
        ...base,
        you: { ...base.you, resources: res },
        phase: 'action',
        pending: null,
        history: pushHistory(base, 'played_dev_card', 'Você jogou Fartura.'),
      };
    }
    case 'play_road_building': {
      return {
        ...base,
        phase: 'dev_road_building',
        pending: { type: 'road_building', yourAction: true, waitingOn: [], roadsLeft: 2 },
        history: pushHistory(base, 'played_dev_card', 'Você jogou Construção de Estradas.'),
      };
    }
    case 'place_free_road': {
      const left = (base.pending as any)?.roadsLeft ?? 0;
      const roads = [...base.board.roads, { edgeId: payload.edgeId as EdgeId, playerId: YOU }];
      return {
        ...base,
        board: { ...base.board, roads },
        pending: left - 1 <= 0 ? null : { ...base.pending!, roadsLeft: left - 1 },
        phase: left - 1 <= 0 ? 'action' : 'dev_road_building',
      };
    }
    case 'finish_road_building': {
      return { ...base, phase: 'action', pending: null };
    }
    case 'propose_trade': {
      const offer: OfferView = {
        id: `of-${Date.now()}`,
        fromPlayerId: YOU,
        toPlayerId: payload.toPlayerId,
        give: payload.give,
        want: payload.want,
      };
      return { ...base, offers: [...base.offers, offer], history: pushHistory(base, 'trade_proposed', 'Você propôs uma troca.') };
    }
    case 'respond_trade': {
      const off = base.offers.find((o) => o.id === payload.offerId);
      if (!off) return view;
      const res = { ...base.you.resources };
      if (payload.response === 'accept') {
        for (const [k, n] of Object.entries(off.give)) res[k as ResourceKind] = (res[k as ResourceKind] ?? 0) + (n as number);
        for (const [k, n] of Object.entries(off.want)) res[k as ResourceKind] -= n as number;
      }
      return {
        ...base,
        you: { ...base.you, resources: res },
        offers: base.offers.filter((o) => o.id !== payload.offerId),
        history: pushHistory(base, payload.response === 'accept' ? 'trade_accepted' : 'trade_rejected', payload.response === 'accept' ? 'Você aceitou a troca.' : 'Você recusou a troca.'),
      };
    }
    case 'cancel_trade': {
      return { ...base, offers: base.offers.filter((o) => o.id !== payload.offerId), history: pushHistory(base, 'trade_cancelled', 'Você cancelou a proposta.') };
    }
    case 'discard': {
      const cards = payload.cards as Partial<Record<ResourceKind, number>>;
      const res = { ...base.you.resources };
      for (const [k, n] of Object.entries(cards)) res[k as ResourceKind] -= n as number;
      return { ...base, you: { ...base.you, resources: res }, phase: 'action', pending: null };
    }
    default:
      void myTurnOnly;
      return view;
  }
}

export const MOCK_ROOM = { roomCode: 'MOCK1', roomName: 'Sala de demonstração', playerId: YOU, recoveryCode: 'mock-recovery-code-000', isHost: true };
