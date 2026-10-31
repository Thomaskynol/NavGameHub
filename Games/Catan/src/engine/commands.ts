// Motor de regras puro. applyCommand NUNCA muta a entrada (structuredClone + work no clone).
// Erro => { ok:false, error } sem efeitos parciais (o clone é descartado).
import {
  COSTS,
  DISCARD_RATIO,
  RESOURCE_KINDS,
  TERRAIN_RESOURCE,
  WINNING_SCORE,
} from '../shared/constants';
import type { DevCardKind, EdgeId, HexId, PlayerId, ResourceKind, VertexId } from '../shared/constants';
import { ERROR_CODES, type GameCommand } from '../shared/protocol';
import type {
  EngineError,
  EngineResult,
  GameState,
  Phase,
  PlayerState,
  RandomSource,
  TradeOffer,
} from '../shared/types';
import { pushEvent, pushPublic } from './history';
import {
  buildingAt,
  checkCityVertex,
  checkRoadEdge,
  checkSettlementVertex,
  checkSetupSettlementVertex,
  currentActorId,
  hexExists,
  edgeExists,
  playerById,
  robberVictims,
} from './legal';
import { recomputeTitles, bestBankRate, totalVictoryPoints } from './scores';

// ---------- utilitários internos ----------

function fail(code: string, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

function failE(error: EngineError): EngineResult {
  return { ok: false, error };
}

function wrongPhase(s: GameState, cmdType: string): EngineResult {
  return fail(ERROR_CODES.WRONG_PHASE, `Comando "${cmdType}" não permitido na fase "${s.phase}".`);
}

const notYourTurn = (): EngineResult => fail(ERROR_CODES.NOT_YOUR_TURN, 'Não é a sua vez de agir.');

function totalResources(p: PlayerState): number {
  return RESOURCE_KINDS.reduce((acc, k) => acc + p.resources[k], 0);
}

type Patch = Partial<Record<ResourceKind, number>>;

/** Normaliza mapa de recursos: chaves válidas, inteiros; entradas 0 removidas. Inválido => null. */
function normalizePatch(p: Patch): Patch | null {
  const out: Patch = {};
  for (const [k, v] of Object.entries(p)) {
    if (!(RESOURCE_KINDS as readonly string[]).includes(k)) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
    if (v > 0) out[k as ResourceKind] = v;
  }
  return out;
}

function patchTotal(p: Patch): number {
  return Object.values(p).reduce((a, b) => a + (b ?? 0), 0);
}

function hasResources(p: PlayerState, patch: Patch): boolean {
  for (const [k, v] of Object.entries(patch)) {
    if ((v ?? 0) > p.resources[k as ResourceKind]) return false;
  }
  return true;
}

function payCost(p: PlayerState, bank: GameState['bank'], cost: Patch): void {
  for (const [k, v] of Object.entries(cost) as [ResourceKind, number][]) {
    p.resources[k] -= v;
    bank[k] += v;
  }
}

function rollDie(rng: RandomSource): number {
  return 1 + Math.floor(rng.next() * 6);
}

/** Sorteia 1 carta da mão da vítima (proporcional às contagens). */
function pickRandomResource(p: PlayerState, rng: RandomSource): ResourceKind {
  const total = totalResources(p);
  let idx = Math.floor(rng.next() * total);
  for (const k of RESOURCE_KINDS) {
    if (idx < p.resources[k]) return k;
    idx -= p.resources[k];
  }
  return RESOURCE_KINDS[RESOURCE_KINDS.length - 1];
}

/** Remove carta de desenvolvimento da mão (e consome da ação). */
function consumeDevCard(s: GameState, playerId: PlayerId, kind: DevCardKind): EngineResult {
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  const ofKind = me.devCards.filter((c) => c.kind === kind);
  if (ofKind.length === 0) return fail(ERROR_CODES.NO_DEV_CARD, `Você não tem carta de ${kindLabel(kind)}.`);
  if (ofKind.every((c) => me.boughtThisTurn.includes(c.id))) {
    return fail(ERROR_CODES.DEV_BOUGHT_THIS_TURN, 'Não é permitido jogar carta comprada neste turno.');
  }
  if (me.playedActionCardThisTurn) {
    return fail(ERROR_CODES.DEV_ALREADY_PLAYED, 'Já jogou uma carta de ação neste turno (limite: 1).');
  }
  const card = ofKind.find((c) => !me.boughtThisTurn.includes(c.id));
  if (!card) return fail(ERROR_CODES.NO_DEV_CARD, `Você não tem carta de ${kindLabel(kind)}.`);
  me.devCards = me.devCards.filter((c) => c.id !== card.id);
  me.playedActionCardThisTurn = true;
  return { ok: true, state: s };
}

function kindLabel(kind: DevCardKind): string {
  switch (kind) {
    case 'knight':
      return 'Cavaleiro';
    case 'roadBuilding':
      return 'Construção de Estradas';
    case 'monopoly':
      return 'Monopólio';
    case 'yearOfPlenty':
      return 'Ano de Fartura';
    case 'victoryPoint':
      return 'Ponto de Vitória';
  }
}

/** Volta à fase de origem após resolução de carta (pré-dados => pre_roll com rolagem pendente). */
function restoreReturnPhase(s: GameState): void {
  s.phase = s.returnPhase === 'pre_roll' ? 'pre_roll' : 'action';
  s.returnPhase = null;
  s.pending = null;
}

// ---------- setup ----------

function grantSetupResources(s: GameState, playerId: PlayerId, vertexId: VertexId): void {
  const me = playerById(s, playerId);
  if (!me) return;
  const gained: Patch = {};
  for (const hexId of s.board.vertexHexes[vertexId] ?? []) {
    const hex = s.board.hexes.find((h) => h.id === hexId);
    if (!hex || hex.terrain === 'desert') continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (s.bank[res] <= 0) continue; // escassez simples: banco sem cartas, ninguém recebe esse tipo
    s.bank[res] -= 1;
    me.resources[res] += 1;
    gained[res] = (gained[res] ?? 0) + 1;
  }
  if (patchTotal(gained) > 0) {
    // Composição é privada: só o jogador sabe o que recebeu.
    pushEvent(s, { type: 'resources_private', playerId, resources: gained, reason: 'setup' }, { visibility: 'private', audience: [playerId] });
  }
}

function doSetupSettlement(s: GameState, playerId: PlayerId, vertexId: VertexId): EngineResult {
  if (s.setup.queue[s.setup.pos] !== playerId) return notYourTurn();
  const check = checkSetupSettlementVertex(s, vertexId);
  if (!check.ok) return failE(check.error);
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  if (me.pieces.settlements <= 0) return fail(ERROR_CODES.PIECE_LIMIT, 'Sem assentamentos no suprimento.');
  me.pieces.settlements -= 1;
  s.buildings.push({ vertexId, playerId, kind: 'settlement' });
  s.setup.lastSettlementVertex = vertexId;
  // Segunda metade da fila (generaliza 3 e 4 jogadores): concede cartas dos hexes adjacentes.
  const second = s.setup.pos >= s.setup.queue.length / 2;
  pushPublic(s, { type: 'setup_placed', playerId, vertexId, second });
  if (second) grantSetupResources(s, playerId, vertexId);
  s.phase = 'setup_road';
  return { ok: true, state: s };
}

function doSetupRoad(s: GameState, playerId: PlayerId, edgeId: EdgeId): EngineResult {
  if (s.setup.queue[s.setup.pos] !== playerId) return notYourTurn();
  const last = s.setup.lastSettlementVertex;
  if (!last) return fail(ERROR_CODES.INVALID_STATE, 'Preparação inconsistente: sem assentamento pendente.');
  if (!edgeExists(s, edgeId)) return fail(ERROR_CODES.INVALID_POSITION, 'Aresta inexistente no tabuleiro.');
  if (s.roads.some((r) => r.edgeId === edgeId)) return fail(ERROR_CODES.INVALID_POSITION, 'Aresta já ocupada por uma estrada.');
  if (!s.board.edgeEndpoints[edgeId].includes(last)) {
    return fail(ERROR_CODES.INVALID_POSITION, 'A estrada deve ser adjacente ao assentamento recém-colocado.');
  }
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  if (me.pieces.roads <= 0) return fail(ERROR_CODES.PIECE_LIMIT, 'Sem estradas no suprimento.');
  me.pieces.roads -= 1;
  s.roads.push({ edgeId, playerId });
  pushPublic(s, { type: 'setup_placed', playerId, vertexId: last, edgeId, second: s.setup.pos >= s.setup.queue.length / 2 });
  s.setup.lastSettlementVertex = null;
  s.setup.pos += 1;
  if (s.setup.pos < s.setup.queue.length) {
    s.phase = 'setup_settlement';
  } else {
    s.phase = 'pre_roll';
    s.activeIndex = 0;
  }
  return { ok: true, state: s };
}

// ---------- dados, produção, 7 ----------

function produceForRoll(s: GameState, total: number): void {
  const producing = s.board.hexes.filter((h) => h.number === total && h.id !== s.robberHexId);
  const owed = new Map<ResourceKind, Map<PlayerId, number>>();
  for (const hex of producing) {
    if (hex.terrain === 'desert') continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    for (const b of s.buildings) {
      if (!(s.board.vertexHexes[b.vertexId] ?? []).includes(hex.id)) continue;
      if (!owed.has(res)) owed.set(res, new Map());
      const m = owed.get(res) as Map<PlayerId, number>;
      m.set(b.playerId, (m.get(b.playerId) ?? 0) + (b.kind === 'city' ? 2 : 1));
    }
  }
  const byResource = { brick: [], lumber: [], wool: [], grain: [], ore: [] } as Record<ResourceKind, PlayerId[]>;
  for (const [res, m] of owed) {
    const totalOwed = [...m.values()].reduce((a, b) => a + b, 0);
    const bankHas = s.bank[res];
    const pay: [PlayerId, number][] = [];
    if (totalOwed <= bankHas) {
      for (const [pid, n] of m) pay.push([pid, n]);
    } else if (m.size === 1) {
      // Exceção do único beneficiário: recebe o que restar no banco.
      const pid = [...m.keys()][0] as PlayerId;
      pay.push([pid, Math.min(totalOwed, bankHas)]);
    }
    // Escassez oficial: banco insuficiente com >= 2 beneficiários => ninguém recebe este tipo.
    const receivers: PlayerId[] = [];
    for (const [pid, n] of pay) {
      const p = playerById(s, pid);
      if (!p) continue;
      const give = Math.min(n, s.bank[res]);
      s.bank[res] -= give;
      p.resources[res] += give;
      if (give > 0) receivers.push(pid); // sem ganho (banco zerado) => sem destinatário no evento
    }
    if (receivers.length > 0) byResource[res] = receivers;
  }
  pushPublic(s, { type: 'production', byResource });
}

function doRollDice(s: GameState, playerId: PlayerId, rng: RandomSource): EngineResult {
  const d1 = rollDie(rng);
  const d2 = rollDie(rng);
  s.dice = { d1, d2 };
  pushPublic(s, { type: 'dice', playerId, d1, d2 });
  if (d1 + d2 === 7) {
    const over = s.players.filter((p) => totalResources(p) > 7).map((p) => p.id);
    if (over.length > 0) {
      s.phase = 'await_discards';
      s.pending = { type: 'discard', waitingOn: over };
    } else {
      s.phase = 'robber';
      s.pending = { type: 'robber' };
    }
    return { ok: true, state: s };
  }
  produceForRoll(s, d1 + d2);
  s.phase = 'action';
  return { ok: true, state: s };
}

function doDiscard(s: GameState, playerId: PlayerId, cards: Patch): EngineResult {
  const pending = s.pending;
  if (!pending || pending.type !== 'discard' || !pending.waitingOn.includes(playerId)) return notYourTurn();
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  const normalized = normalizePatch(cards);
  if (!normalized || patchTotal(normalized) === 0) {
    return fail(ERROR_CODES.INVALID_PAYLOAD, 'Descarte inválido: informe cartas válidas.');
  }
  if (!hasResources(me, normalized)) {
    return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Descarte maior que a sua mão.');
  }
  const required = Math.floor(totalResources(me) * DISCARD_RATIO);
  if (patchTotal(normalized) !== required) {
    return fail(
      ERROR_CODES.INVALID_PAYLOAD,
      `Descarte incorreto: você deve descartar exatamente ${required} carta(s) (metade arredondada para baixo de ${totalResources(me)}).`,
    );
  }
  for (const [k, v] of Object.entries(normalized) as [ResourceKind, number][]) {
    me.resources[k] -= v;
    s.bank[k] += v;
  }
  pushPublic(s, { type: 'discarded', playerId, count: required });
  // Composição do descarte é privada.
  pushEvent(s, { type: 'resources_private', playerId, resources: normalized, reason: 'discard' }, { visibility: 'private', audience: [playerId] });
  pending.waitingOn = pending.waitingOn.filter((id) => id !== playerId);
  if (pending.waitingOn.length === 0) {
    s.phase = 'robber';
    s.pending = { type: 'robber' };
  }
  return { ok: true, state: s };
}

// ---------- ladrão ----------

/** Resolve movimento do ladrão + roubo. origin 'seven' => fase action; 'knight' => returnPhase. */
function resolveRobberMove(
  s: GameState,
  thiefId: PlayerId,
  hexId: HexId,
  victimId: PlayerId | undefined,
  rng: RandomSource,
  origin: 'seven' | 'knight',
): EngineError | null {
  if (!hexExists(s, hexId)) return { code: ERROR_CODES.INVALID_POSITION, message: 'Hexágono inexistente no tabuleiro.' };
  if (hexId === s.robberHexId) {
    return { code: ERROR_CODES.INVALID_POSITION, message: 'O ladrão já está neste hexágono; mova-o para outro hex terrestre.' };
  }
  const victims = robberVictims(s, hexId, thiefId);
  let victim: PlayerId | undefined;
  if (victims.length > 0) {
    if (!victimId || !victims.includes(victimId)) {
      return { code: ERROR_CODES.INVALID_POSITION, message: 'Há construções adversárias neste hex: escolha uma vítima válida.' };
    }
    victim = victimId;
  }
  s.robberHexId = hexId;
  pushPublic(s, { type: 'robber_moved', playerId: thiefId, hexId });
  if (victim) {
    const v = playerById(s, victim);
    const thief = playerById(s, thiefId);
    if (v && thief && totalResources(v) > 0) {
      const res = pickRandomResource(v, rng);
      v.resources[res] -= 1;
      thief.resources[res] += 1;
      // Tipo do roubado só para os envolvidos.
      pushEvent(s, { type: 'stolen', playerId: thiefId, victimId: victim, resource: res }, { visibility: 'private', audience: [thiefId, victim] });
    } else {
      // Vítima sem cartas: roubo sem tipo (evento público).
      pushPublic(s, { type: 'stolen', playerId: thiefId, victimId: victim });
    }
  }
  if (origin === 'seven') {
    s.phase = 'action';
    s.pending = null;
  } else {
    restoreReturnPhase(s);
    s.pending = null;
  }
  return null;
}

function doMoveRobber(s: GameState, playerId: PlayerId, hexId: HexId, victimId: PlayerId | undefined, rng: RandomSource): EngineResult {
  const pending = s.pending;
  if (!pending || pending.type !== 'robber') return fail(ERROR_CODES.WRONG_PHASE, 'Não há movimento de ladrão pendente.');
  // Origem: knight (returnPhase definido) ou 7.
  const origin = s.returnPhase !== null ? 'knight' : 'seven';
  const err = resolveRobberMove(s, playerId, hexId, victimId, rng, origin);
  if (err) return failE(err);
  return { ok: true, state: s };
}

// ---------- cartas de desenvolvimento ----------

function doPlayKnight(s: GameState, playerId: PlayerId, hexId: HexId, victimId: PlayerId | undefined, rng: RandomSource): EngineResult {
  const check = consumeDevCard(s, playerId, 'knight');
  if (!check.ok) return check;
  const me = playerById(s, playerId) as PlayerState;
  me.knightsPlayed += 1;
  s.returnPhase = s.phase; // pre_roll ou action
  pushPublic(s, { type: 'played_dev_card', playerId, card: 'knight' });
  // Resolução imediata do roubo do cavaleiro (o comando carrega hexId/victimId).
  const err = resolveRobberMove(s, playerId, hexId, victimId, rng, 'knight');
  if (err) return failE(err);
  recomputeTitles(s); // maior exército
  return { ok: true, state: s };
}

function doPlayRoadBuilding(s: GameState, playerId: PlayerId): EngineResult {
  const check = consumeDevCard(s, playerId, 'roadBuilding');
  if (!check.ok) return check;
  s.returnPhase = s.phase;
  s.phase = 'dev_road_building';
  s.pending = { type: 'road_building', playerId, roadsLeft: 2 };
  pushPublic(s, { type: 'played_dev_card', playerId, card: 'roadBuilding', freeRoads: 2 });
  return { ok: true, state: s };
}

function doPlaceFreeRoad(s: GameState, playerId: PlayerId, edgeId: EdgeId): EngineResult {
  const pending = s.pending;
  if (!pending || pending.type !== 'road_building') return fail(ERROR_CODES.WRONG_PHASE, 'Não há estradas gratuitas pendentes.');
  if (pending.playerId !== playerId) return notYourTurn();
  const check = checkRoadEdge(s, playerId, edgeId);
  if (!check.ok) return failE(check.error);
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  if (me.pieces.roads <= 0) return fail(ERROR_CODES.PIECE_LIMIT, 'Sem estradas no suprimento.');
  me.pieces.roads -= 1;
  s.roads.push({ edgeId, playerId });
  pushPublic(s, { type: 'built', playerId, kind: 'road', edgeId });
  pending.roadsLeft -= 1;
  if (pending.roadsLeft <= 0) restoreReturnPhase(s);
  recomputeTitles(s);
  return { ok: true, state: s };
}

function doFinishRoadBuilding(s: GameState, playerId: PlayerId): EngineResult {
  const pending = s.pending;
  if (!pending || pending.type !== 'road_building') return fail(ERROR_CODES.WRONG_PHASE, 'Não há estradas gratuitas pendentes.');
  if (pending.playerId !== playerId) return notYourTurn();
  // Encerra cedo: estradas restantes perdidas (decisão §4).
  restoreReturnPhase(s);
  return { ok: true, state: s };
}

function doPlayMonopoly(s: GameState, playerId: PlayerId, resource: ResourceKind): EngineResult {
  const check = consumeDevCard(s, playerId, 'monopoly');
  if (!check.ok) return check;
  const me = playerById(s, playerId) as PlayerState;
  for (const p of s.players) {
    if (p.id === playerId) continue;
    const n = p.resources[resource];
    if (n > 0) {
      p.resources[resource] = 0;
      me.resources[resource] += n;
    }
  }
  pushPublic(s, { type: 'played_dev_card', playerId, card: 'monopoly', monopoly: resource });
  restoreReturnPhase(s);
  return { ok: true, state: s };
}

function doPlayYearOfPlenty(s: GameState, playerId: PlayerId, resources: ResourceKind[]): EngineResult {
  if (resources.length < 1 || resources.length > 2) {
    return fail(ERROR_CODES.INVALID_PAYLOAD, 'Ano de Fartura: escolha 1 ou 2 recursos.');
  }
  for (const r of resources) {
    if (!(RESOURCE_KINDS as readonly string[]).includes(r)) return fail(ERROR_CODES.INVALID_PAYLOAD, 'Ano de Fartura: recurso inválido.');
  }
  const check = consumeDevCard(s, playerId, 'yearOfPlenty');
  if (!check.ok) return check;
  const me = playerById(s, playerId) as PlayerState;
  const takes: ResourceKind[] = [];
  for (const r of resources) {
    if (takes.length >= 2) break;
    if (s.bank[r] > 0) {
      s.bank[r] -= 1;
      me.resources[r] += 1;
      takes.push(r);
    }
  }
  // Banco esgotado: toma o que houver (0–2) e conclui (decisão §4).
  pushPublic(s, { type: 'played_dev_card', playerId, card: 'yearOfPlenty', takes });
  restoreReturnPhase(s);
  return { ok: true, state: s };
}

function doBuyDevCard(s: GameState, playerId: PlayerId): EngineResult {
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  if (s.devDeck.length === 0) return fail(ERROR_CODES.DEV_DECK_EMPTY, 'Monte de desenvolvimento vazio.');
  if (!hasResources(me, COSTS.devCard)) return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Recursos insuficientes para comprar desenvolvimento (1 lã + 1 grão + 1 minério).');
  payCost(me, s.bank, COSTS.devCard);
  const card = s.devDeck.pop();
  if (!card) return fail(ERROR_CODES.DEV_DECK_EMPTY, 'Monte de desenvolvimento vazio.');
  me.devCards.push(card);
  me.boughtThisTurn.push(card.id);
  pushPublic(s, { type: 'bought_dev_card', playerId });
  // VP: contagem imediata em totalVictoryPoints => vitória na hora (checada pelo invólucro).
  return { ok: true, state: s };
}

// ---------- construções ----------

function doBuildRoad(s: GameState, playerId: PlayerId, edgeId: EdgeId): EngineResult {
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  const check = checkRoadEdge(s, playerId, edgeId);
  if (!check.ok) return failE(check.error);
  if (me.pieces.roads <= 0) return fail(ERROR_CODES.PIECE_LIMIT, 'Limite de 15 estradas atingido.');
  if (!hasResources(me, COSTS.road)) return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Recursos insuficientes para estrada (1 tijolo + 1 madeira).');
  payCost(me, s.bank, COSTS.road);
  me.pieces.roads -= 1;
  s.roads.push({ edgeId, playerId });
  pushPublic(s, { type: 'built', playerId, kind: 'road', edgeId });
  recomputeTitles(s);
  return { ok: true, state: s };
}

function doBuildSettlement(s: GameState, playerId: PlayerId, vertexId: VertexId): EngineResult {
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  const check = checkSettlementVertex(s, playerId, vertexId);
  if (!check.ok) return failE(check.error);
  if (me.pieces.settlements <= 0) return fail(ERROR_CODES.PIECE_LIMIT, 'Limite de 5 assentamentos atingido.');
  if (!hasResources(me, COSTS.settlement)) {
    return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Recursos insuficientes para assentamento (1 de cada: tijolo, madeira, lã, grão).');
  }
  payCost(me, s.bank, COSTS.settlement);
  me.pieces.settlements -= 1;
  s.buildings.push({ vertexId, playerId, kind: 'settlement' });
  pushPublic(s, { type: 'built', playerId, kind: 'settlement', vertexId });
  recomputeTitles(s);
  return { ok: true, state: s };
}

function doBuildCity(s: GameState, playerId: PlayerId, vertexId: VertexId): EngineResult {
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  const check = checkCityVertex(s, playerId, vertexId);
  if (!check.ok) return failE(check.error);
  if (me.pieces.cities <= 0) return fail(ERROR_CODES.PIECE_LIMIT, 'Limite de 4 cidades atingido.');
  if (!hasResources(me, COSTS.city)) return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Recursos insuficientes para cidade (3 minério + 2 grão).');
  payCost(me, s.bank, COSTS.city);
  me.pieces.cities -= 1;
  me.pieces.settlements += 1; // a casa volta ao suprimento
  const b = buildingAt(s, vertexId);
  if (b) b.kind = 'city';
  pushPublic(s, { type: 'built', playerId, kind: 'city', vertexId });
  recomputeTitles(s);
  return { ok: true, state: s };
}

// ---------- trocas ----------

function doBankTrade(s: GameState, playerId: PlayerId, giveRaw: Patch, wantRaw: Patch): EngineResult {
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  const give = normalizePatch(giveRaw);
  const want = normalizePatch(wantRaw);
  if (!give || !want || patchTotal(give) === 0 || patchTotal(want) === 0) {
    return fail(ERROR_CODES.INVALID_TRADE, 'Troca inválida: informe o que oferece e o que pede.');
  }
  for (const k of Object.keys(give)) {
    if (k in want) return fail(ERROR_CODES.INVALID_TRADE, 'Proibido oferecer e pedir o mesmo recurso na mesma troca.');
  }
  if (!hasResources(me, give)) return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Você não tem os recursos que diz oferecer.');
  for (const [k, v] of Object.entries(want) as [ResourceKind, number][]) {
    if (s.bank[k] < v) return fail(ERROR_CODES.BANK_EMPTY, `O banco não tem ${v} de ${k}.`);
  }
  /**
   * Decisão do projeto (taxa marítima multi-recurso): a taxa é SOMADA POR RECURSO PEDIDO.
   * taxa = Σ_k want[k] * bestBankRate(s, playerId, k); exige-se sum(give) === taxa.
   * Cada X:1 vale por recurso recebido (porto daquele recurso); exigir a melhor
   * taxa única sobre o total puniria trocas mistas — decisão registrada em docs/rules.md §4.
   */
  const wantEntries = Object.entries(want) as [ResourceKind, number][];
  const taxa = wantEntries.reduce((acc, [k, n]) => acc + n * bestBankRate(s, playerId, k), 0);
  const giveTotal = patchTotal(give);
  const wantTotal = patchTotal(want);
  if (giveTotal !== taxa) {
    return fail(
      ERROR_CODES.INVALID_TRADE,
      `Troca marítima inválida: ofereça ${taxa} carta(s) por ${wantTotal} (soma das taxas por recurso).`,
    );
  }
  for (const [k, v] of Object.entries(give) as [ResourceKind, number][]) {
    me.resources[k] -= v;
    s.bank[k] += v;
  }
  for (const [k, v] of Object.entries(want) as [ResourceKind, number][]) {
    s.bank[k] -= v;
    me.resources[k] += v;
  }
  pushPublic(s, { type: 'bank_trade', playerId, give, want });
  return { ok: true, state: s };
}

const MAX_ACTIVE_OFFERS = 2; // simplificação: no máximo 2 ofertas ativas por jogador ativo

function doProposeTrade(s: GameState, playerId: PlayerId, toPlayerId: PlayerId, giveRaw: Patch, wantRaw: Patch): EngineResult {
  if (toPlayerId === playerId || !playerById(s, toPlayerId)) {
    return fail(ERROR_CODES.INVALID_TRADE, 'Oferta deve ser dirigida a um adversário.');
  }
  const me = playerById(s, playerId);
  if (!me) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  const give = normalizePatch(giveRaw);
  const want = normalizePatch(wantRaw);
  if (!give || !want || patchTotal(give) === 0 || patchTotal(want) === 0) {
    return fail(ERROR_CODES.INVALID_TRADE, 'Oferta inválida: informe o que oferece e o que pede.');
  }
  for (const k of Object.keys(give)) {
    if (k in want) return fail(ERROR_CODES.INVALID_TRADE, 'Proibido oferecer e pedir o mesmo recurso.');
  }
  if (!hasResources(me, give)) return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Você não tem os recursos que diz oferecer.');
  if (s.offers.filter((o) => o.fromPlayerId === playerId).length >= MAX_ACTIVE_OFFERS) {
    return fail(ERROR_CODES.TRADE_NOT_AVAILABLE, `Máximo de ${MAX_ACTIVE_OFFERS} ofertas ativas por jogador.`);
  }
  const offerId = `offer-${s.historySeq + 1}`; // determinístico e único (historySeq cresce a cada evento)
  const offer: TradeOffer = { id: offerId, fromPlayerId: playerId, toPlayerId, give, want };
  s.offers.push(offer);
  pushPublic(s, { type: 'trade_proposed', playerId, toPlayerId, offerId });
  return { ok: true, state: s };
}

function doRespondTrade(s: GameState, playerId: PlayerId, offerId: string, response: 'accept' | 'reject'): EngineResult {
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) return fail(ERROR_CODES.OFFER_EXPIRED, 'Esta oferta não está mais disponível.');
  if (offer.toPlayerId !== playerId) return fail(ERROR_CODES.TRADE_NOT_AVAILABLE, 'Somente o jogador designado pode responder a esta oferta.');
  if (response === 'reject') {
    s.offers = s.offers.filter((o) => o.id !== offerId);
    pushPublic(s, { type: 'trade_rejected', playerId: offer.fromPlayerId, byPlayerId: playerId, offerId });
    return { ok: true, state: s };
  }
  // Aceite: revalida recursos do proponente E do aceitante no ato.
  const from = playerById(s, offer.fromPlayerId);
  const to = playerById(s, playerId);
  if (!from || !to) return fail(ERROR_CODES.INVALID_STATE, 'Jogador não encontrado.');
  if (!hasResources(from, offer.give)) {
    return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'O proponente não tem mais os recursos oferecidos.');
  }
  if (!hasResources(to, offer.want)) {
    return fail(ERROR_CODES.INSUFFICIENT_RESOURCES, 'Você não tem mais os recursos pedidos.');
  }
  for (const [k, v] of Object.entries(offer.give) as [ResourceKind, number][]) {
    from.resources[k] -= v;
    to.resources[k] += v;
  }
  for (const [k, v] of Object.entries(offer.want) as [ResourceKind, number][]) {
    to.resources[k] -= v;
    from.resources[k] += v;
  }
  s.offers = s.offers.filter((o) => o.id !== offerId);
  pushPublic(s, { type: 'trade_accepted', playerId: offer.fromPlayerId, byPlayerId: playerId, offerId });
  return { ok: true, state: s };
}

function doCancelTrade(s: GameState, playerId: PlayerId, offerId: string): EngineResult {
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) return fail(ERROR_CODES.OFFER_EXPIRED, 'Esta oferta não está mais disponível.');
  if (offer.fromPlayerId !== playerId) return fail(ERROR_CODES.NOT_YOUR_TURN, 'Somente quem propôs pode cancelar a oferta.');
  s.offers = s.offers.filter((o) => o.id !== offerId);
  pushPublic(s, { type: 'trade_cancelled', playerId, offerId });
  return { ok: true, state: s };
}

function doEndTurn(s: GameState, playerId: PlayerId): EngineResult {
  // Ofertas pendentes do ativo são invalidadas com evento.
  for (const o of s.offers.filter((x) => x.fromPlayerId === playerId)) {
    pushPublic(s, { type: 'trade_cancelled', playerId, offerId: o.id });
  }
  s.offers = s.offers.filter((o) => o.fromPlayerId !== playerId);
  const me = playerById(s, playerId) as PlayerState;
  me.boughtThisTurn = [];
  me.playedActionCardThisTurn = false;
  s.activeIndex = (s.activeIndex + 1) % s.players.length;
  s.phase = 'pre_roll';
  s.pending = null;
  s.returnPhase = null;
  const next = s.players[s.activeIndex];
  pushPublic(s, { type: 'turn_ended', playerId, nextPlayerId: next.id });
  return { ok: true, state: s };
}

// ---------- despacho por fase ----------

function requireActive(s: GameState, playerId: PlayerId): boolean {
  return currentActorId(s) === playerId;
}

function run(s: GameState, playerId: PlayerId, cmd: GameCommand, deps: { rng: RandomSource }): EngineResult {
  switch (s.phase) {
    case 'setup_settlement': {
      if (cmd.type !== 'setup_settlement') return wrongPhase(s, cmd.type);
      return doSetupSettlement(s, playerId, cmd.vertexId);
    }
    case 'setup_road': {
      if (cmd.type !== 'setup_road') return wrongPhase(s, cmd.type);
      return doSetupRoad(s, playerId, cmd.edgeId);
    }
    case 'pre_roll': {
      if (!requireActive(s, playerId)) return notYourTurn();
      switch (cmd.type) {
        case 'roll_dice':
          return doRollDice(s, playerId, deps.rng);
        case 'play_knight':
          return doPlayKnight(s, playerId, cmd.hexId, cmd.victimId, deps.rng);
        case 'play_road_building':
          return doPlayRoadBuilding(s, playerId);
        case 'play_monopoly':
          return doPlayMonopoly(s, playerId, cmd.resource);
        case 'play_year_of_plenty':
          return doPlayYearOfPlenty(s, playerId, cmd.resources);
        default:
          return wrongPhase(s, cmd.type);
      }
    }
    case 'action': {
      // Resposta de oferta: qualquer adversário designado (não precisa ser o ativo).
      if (cmd.type === 'respond_trade') return doRespondTrade(s, playerId, cmd.offerId, cmd.response);
      if (!requireActive(s, playerId)) return notYourTurn();
      switch (cmd.type) {
        case 'build_road':
          return doBuildRoad(s, playerId, cmd.edgeId);
        case 'build_settlement':
          return doBuildSettlement(s, playerId, cmd.vertexId);
        case 'build_city':
          return doBuildCity(s, playerId, cmd.vertexId);
        case 'buy_dev_card':
          return doBuyDevCard(s, playerId);
        case 'bank_trade':
          return doBankTrade(s, playerId, cmd.give, cmd.want);
        case 'propose_trade':
          return doProposeTrade(s, playerId, cmd.toPlayerId, cmd.give, cmd.want);
        case 'cancel_trade':
          return doCancelTrade(s, playerId, cmd.offerId);
        case 'end_turn':
          return doEndTurn(s, playerId);
        case 'play_knight':
          return doPlayKnight(s, playerId, cmd.hexId, cmd.victimId, deps.rng);
        case 'play_road_building':
          return doPlayRoadBuilding(s, playerId);
        case 'play_monopoly':
          return doPlayMonopoly(s, playerId, cmd.resource);
        case 'play_year_of_plenty':
          return doPlayYearOfPlenty(s, playerId, cmd.resources);
        default:
          return wrongPhase(s, cmd.type);
      }
    }
    case 'await_discards': {
      if (cmd.type !== 'discard') return wrongPhase(s, cmd.type);
      return doDiscard(s, playerId, cmd.cards);
    }
    case 'robber': {
      if (cmd.type !== 'move_robber') return wrongPhase(s, cmd.type);
      if (!requireActive(s, playerId)) return notYourTurn();
      return doMoveRobber(s, playerId, cmd.hexId, cmd.victimId, deps.rng);
    }
    case 'dev_road_building': {
      if (!requireActive(s, playerId)) return notYourTurn();
      if (cmd.type === 'place_free_road') return doPlaceFreeRoad(s, playerId, cmd.edgeId);
      if (cmd.type === 'finish_road_building') return doFinishRoadBuilding(s, playerId);
      return wrongPhase(s, cmd.type);
    }
    case 'game_over':
      return fail(ERROR_CODES.INVALID_STATE, 'O jogo já terminou.');
    // Fases de resolução nomeadas ficam sem uso no fluxo puramente sintático:
    // monopólio/fartura resolvem de forma atômica e retornam ao returnPhase.
    case 'dev_monopoly':
    case 'dev_year_of_plenty':
      return fail(ERROR_CODES.WRONG_PHASE, `Fase de resolução "${s.phase}" não aceita comandos.`);
  }
}

// ---------- vitória ----------

function declareVictory(s: GameState, playerId: PlayerId): void {
  s.phase = 'game_over';
  s.winnerId = playerId;
  s.pending = null;
  s.returnPhase = null;
  pushPublic(s, { type: 'victory', playerId, points: totalVictoryPoints(s, playerId) });
}

/**
 * Vitória só no próprio turno (10+). Após cada comando bem-sucedido:
 * - entrar em pre_roll com 10+ vence na hora (não é obrigatório rolar — FAQ);
 * - o jogador corrente que chegou a 10+ por esta ação vence imediatamente.
 */
function checkVictory(s: GameState, actorId: PlayerId): void {
  if (s.phase === 'game_over') return;
  if (s.phase === 'pre_roll') {
    const p = s.players[s.activeIndex];
    if (p && totalVictoryPoints(s, p.id) >= WINNING_SCORE) {
      declareVictory(s, p.id);
      return;
    }
  }
  const turnPhases: Phase[] = ['pre_roll', 'action', 'robber', 'dev_road_building'];
  if (turnPhases.includes(s.phase)) {
    const actor = currentActorId(s);
    if (actor === actorId && totalVictoryPoints(s, actorId) >= WINNING_SCORE) {
      declareVictory(s, actorId);
    }
  }
}

// ---------- API ----------

/**
 * Transição pura. NUNCA muta a entrada: clona com structuredClone e trabalha no clone.
 * Erro => { ok:false, error } sem efeitos parciais sobre o estado original.
 */
export function applyCommand(
  state: GameState,
  playerId: PlayerId,
  cmd: GameCommand,
  deps: { rng: RandomSource },
): EngineResult {
  if (state.phase === 'game_over') {
    return fail(ERROR_CODES.INVALID_STATE, 'O jogo já terminou.');
  }
  const s: GameState = structuredClone(state);
  const res = run(s, playerId, cmd, deps);
  if (!res.ok) return res; // clone descartado; entrada intacta
  s.version = state.version + 1;
  checkVictory(s, playerId);
  return { ok: true, state: s };
}
