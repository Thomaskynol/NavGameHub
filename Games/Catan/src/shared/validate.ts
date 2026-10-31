// Validação runtime de payloads de rede. Sem dependências externas.
import {
  CHAT_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  PLAYER_COLORS,
  RESOURCE_KINDS,
  ROOM_CODE_ALPHABET,
  ROOM_NAME_MAX_LENGTH,
} from './constants';
import { ERROR_CODES, type CommandEnvelope, type GameCommand, type LobbyCommand } from './protocol';
import type { EngineError } from './types';

export function invalid(message: string, details?: unknown): EngineError {
  return { code: ERROR_CODES.INVALID_PAYLOAD, message, details };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkString(v: unknown, max: number, label: string): string | null {
  if (typeof v !== 'string') return `${label} deve ser texto`;
  if (v.length === 0 || v.length > max) return `${label} deve ter 1–${max} caracteres`;
  return null;
}

function checkId(v: unknown, label: string, max = 64): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) return `${label} inválido`;
  if (!/^[A-Za-z0-9:_|,-]+$/.test(v)) return `${label} inválido`;
  return null;
}

/** Valida um mapa parcial de recursos: chaves conhecidas, inteiros 0..99, pelo menos 1 entrada positiva se exigido. */
export function validateResourcePatch(
  v: unknown,
  label: string,
  opts: { allowEmpty?: boolean } = {},
): { ok: true; value: Partial<Record<(typeof RESOURCE_KINDS)[number], number>> } | { ok: false; error: EngineError } {
  if (!isPlainObject(v)) return { ok: false, error: invalid(`${label} deve ser um objeto de recursos`) };
  const out: Partial<Record<(typeof RESOURCE_KINDS)[number], number>> = {};
  let total = 0;
  for (const [k, n] of Object.entries(v)) {
    if (!(RESOURCE_KINDS as readonly string[]).includes(k)) return { ok: false, error: invalid(`${label}: recurso desconhecido`) };
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 99) {
      return { ok: false, error: invalid(`${label}: quantidade deve ser inteiro entre 0 e 99`) };
    }
    if (n > 0) {
      out[k as (typeof RESOURCE_KINDS)[number]] = n;
      total += n;
    }
  }
  if (total === 0 && !opts.allowEmpty) return { ok: false, error: invalid(`${label}: informe ao menos um recurso`) };
  return { ok: true, value: out };
}

function validateDiscardCards(v: unknown): { ok: true; value: Partial<Record<(typeof RESOURCE_KINDS)[number], number>> } | { ok: false; error: EngineError } {
  if (!isPlainObject(v)) return { ok: false, error: invalid('Descarte deve ser um objeto de recursos') };
  const out: Partial<Record<(typeof RESOURCE_KINDS)[number], number>> = {};
  let total = 0;
  for (const [k, n] of Object.entries(v)) {
    if (!(RESOURCE_KINDS as readonly string[]).includes(k)) return { ok: false, error: invalid('Descarte: recurso desconhecido') };
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return { ok: false, error: invalid('Descarte: quantidades devem ser inteiros não negativos') };
    if (n > 0) {
      out[k as (typeof RESOURCE_KINDS)[number]] = n;
      total += n;
    }
  }
  if (total === 0) return { ok: false, error: invalid('Descarte: informe ao menos um recurso') };
  return { ok: true, value: out };
}

export function validateGameCommand(p: unknown): { ok: true; value: GameCommand } | { ok: false; error: EngineError } {
  if (!isPlainObject(p)) return { ok: false, error: invalid('Comando inválido') };
  const t = p.type;
  switch (t) {
    case 'setup_settlement':
    case 'build_settlement':
    case 'build_city': {
      const e = checkId(p.vertexId, 'Vértice');
      return e ? { ok: false, error: invalid(e) } : { ok: true, value: { type: t, vertexId: String(p.vertexId) } };
    }
    case 'setup_road':
    case 'build_road':
    case 'place_free_road': {
      const e = checkId(p.edgeId, 'Aresta');
      return e ? { ok: false, error: invalid(e) } : { ok: true, value: { type: t, edgeId: String(p.edgeId) } };
    }
    case 'roll_dice':
    case 'end_turn':
    case 'buy_dev_card':
    case 'play_road_building':
    case 'finish_road_building':
      return { ok: true, value: { type: t } };
    case 'discard': {
      const c = validateDiscardCards(p.cards);
      return c.ok ? { ok: true, value: { type: 'discard', cards: c.value } } : c;
    }
    case 'move_robber':
    case 'play_knight': {
      const hex = checkId(p.hexId, 'Hexágono');
      if (hex) return { ok: false, error: invalid(hex) };
      let victimId: string | undefined;
      if (p.victimId !== undefined) {
        const v = checkId(p.victimId, 'Vítima');
        if (v) return { ok: false, error: invalid(v) };
        victimId = String(p.victimId);
      }
      return { ok: true, value: victimId === undefined ? { type: t, hexId: String(p.hexId) } : { type: t, hexId: String(p.hexId), victimId } };
    }
    case 'play_monopoly': {
      if (!(RESOURCE_KINDS as readonly string[]).includes(String(p.resource))) return { ok: false, error: invalid('Monopólio: recurso inválido') };
      return { ok: true, value: { type: 'play_monopoly', resource: p.resource as (typeof RESOURCE_KINDS)[number] } };
    }
    case 'play_year_of_plenty': {
      const r = p.resources;
      if (!Array.isArray(r) || r.length < 1 || r.length > 2) return { ok: false, error: invalid('Ano de fartura: informe 1 ou 2 recursos') };
      for (const x of r) {
        if (!(RESOURCE_KINDS as readonly string[]).includes(String(x))) return { ok: false, error: invalid('Ano de fartura: recurso inválido') };
      }
      return { ok: true, value: { type: 'play_year_of_plenty', resources: r as (typeof RESOURCE_KINDS)[number][] } };
    }
    case 'bank_trade': {
      const g = validateResourcePatch(p.give, 'Você oferece');
      if (!g.ok) return g;
      const w = validateResourcePatch(p.want, 'Você pede');
      if (!w.ok) return w;
      return { ok: true, value: { type: 'bank_trade', give: g.value, want: w.value } };
    }
    case 'propose_trade': {
      const to = checkId(p.toPlayerId, 'Jogador');
      if (to) return { ok: false, error: invalid(to) };
      const g = validateResourcePatch(p.give, 'Você oferece');
      if (!g.ok) return g;
      const w = validateResourcePatch(p.want, 'Você pede');
      if (!w.ok) return w;
      return { ok: true, value: { type: 'propose_trade', toPlayerId: String(p.toPlayerId), give: g.value, want: w.value } };
    }
    case 'respond_trade': {
      const o = checkId(p.offerId, 'Oferta');
      if (o) return { ok: false, error: invalid(o) };
      if (p.response !== 'accept' && p.response !== 'reject') return { ok: false, error: invalid('Resposta deve ser accept ou reject') };
      return { ok: true, value: { type: 'respond_trade', offerId: String(p.offerId), response: p.response } };
    }
    case 'cancel_trade': {
      const o = checkId(p.offerId, 'Oferta');
      return o ? { ok: false, error: invalid(o) } : { ok: true, value: { type: 'cancel_trade', offerId: String(p.offerId) } };
    }
    default:
      return { ok: false, error: invalid('Tipo de comando desconhecido') };
  }
}

export function validateLobbyCommand(p: unknown): { ok: true; value: LobbyCommand } | { ok: false; error: EngineError } {
  if (!isPlainObject(p)) return { ok: false, error: invalid('Comando de lobby inválido') };
  const t = p.type;
  switch (t) {
    case 'create_room': {
      const n = checkString(p.nickname, NICKNAME_MAX_LENGTH, 'Apelido');
      if (n) return { ok: false, error: invalid(n) };
      const nickname = String(p.nickname);
      let roomName: string | undefined;
      if (p.roomName !== undefined) {
        const r = checkString(p.roomName, ROOM_NAME_MAX_LENGTH, 'Nome da sala');
        if (r) return { ok: false, error: invalid(r) };
        roomName = String(p.roomName);
      }
      // Código solicitado (Hub): opcional, só precisa usar o alfabeto da sala.
      let roomCode: string | undefined;
      if (p.roomCode !== undefined) {
        if (typeof p.roomCode !== 'string') return { ok: false, error: invalid('Código da sala inválido') };
        const rc = p.roomCode.toUpperCase().trim();
        if (rc.length === 0 || rc.length > 16 || ![...rc].every((ch) => ROOM_CODE_ALPHABET.includes(ch))) {
          return { ok: false, error: invalid('Código da sala inválido') };
        }
        roomCode = rc;
      }
      // Dono da instância (htok do Hub): opcional, identifica a partida do Hub
      // para retentativa legítima (mesmo htok) vs colisão (htok diferente).
      let hubToken: string | undefined;
      if (p.hubToken !== undefined) {
        if (typeof p.hubToken !== 'string') return { ok: false, error: invalid('Token do Hub inválido') };
        const t = p.hubToken.trim();
        if (t.length === 0 || t.length > 128 || !/^[A-Za-z0-9\-_]+$/.test(t)) {
          return { ok: false, error: invalid('Token do Hub inválido') };
        }
        hubToken = t;
      }
      const value: Extract<LobbyCommand, { type: 'create_room' }> = { type: 'create_room', nickname };
      if (roomName !== undefined) value.roomName = roomName;
      if (roomCode !== undefined) value.roomCode = roomCode;
      if (hubToken !== undefined) value.hubToken = hubToken;
      return { ok: true, value };
    }
    case 'join_room': {
      const c = checkString(p.code, 16, 'Código da sala');
      if (c) return { ok: false, error: invalid(c) };
      const code = String(p.code).toUpperCase().trim();
      if (![...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch))) return { ok: false, error: invalid('Código da sala inválido') };
      const n = checkString(p.nickname, NICKNAME_MAX_LENGTH, 'Apelido');
      if (n) return { ok: false, error: invalid(n) };
      // Dono (htok) opcional no join: quando informado, precisa conferir com o
      // dono da sala; divergente (ou sala sem dono) => CODE_TAKEN no handler,
      // sem entrada. Ausente => legado preservado (entra como antes).
      let hubToken: string | undefined;
      if (p.hubToken !== undefined) {
        if (typeof p.hubToken !== 'string') return { ok: false, error: invalid('Token do Hub inválido') };
        const t = p.hubToken.trim();
        if (t.length === 0 || t.length > 128 || !/^[A-Za-z0-9\-_]+$/.test(t)) {
          return { ok: false, error: invalid('Token do Hub inválido') };
        }
        hubToken = t;
      }
      const value: Extract<LobbyCommand, { type: 'join_room' }> = { type: t, code, nickname: String(p.nickname) };
      if (hubToken !== undefined) value.hubToken = hubToken;
      return { ok: true, value };
    }
    case 'bind_session': {
      const c = checkString(p.code, 16, 'Código da sala');
      if (c) return { ok: false, error: invalid(c) };
      const code = String(p.code).toUpperCase().trim();
      if (![...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch))) return { ok: false, error: invalid('Código da sala inválido') };
      const r = checkString(p.recoveryCode, 200, 'Código de recuperação');
      if (r) return { ok: false, error: invalid(r) };
      if (p.mode !== 'resume' && p.mode !== 'takeover' && p.mode !== 'claim') return { ok: false, error: invalid('Modo de sessão inválido') };
      return { ok: true, value: { type: t, code, recoveryCode: String(p.recoveryCode), mode: p.mode } };
    }
    case 'set_color': {
      if (!(PLAYER_COLORS as readonly string[]).includes(String(p.color))) return { ok: false, error: invalid('Cor inválida') };
      return { ok: true, value: { type: t, color: p.color as (typeof PLAYER_COLORS)[number] } };
    }
    case 'set_ready': {
      if (typeof p.ready !== 'boolean') return { ok: false, error: invalid('Pronto deve ser booleano') };
      return { ok: true, value: { type: t, ready: p.ready } };
    }
    case 'start_game': {
      let boardSeed: string | undefined;
      if (p.boardSeed !== undefined) {
        const s = checkString(p.boardSeed, 64, 'Seed do tabuleiro');
        if (s) return { ok: false, error: invalid(s) };
        boardSeed = String(p.boardSeed);
      }
      return { ok: true, value: boardSeed === undefined ? { type: t } : { type: t, boardSeed } };
    }
    case 'leave_room':
      return { ok: true, value: { type: t } };
    case 'kick_player':
    case 'transfer_host': {
      const e = checkId(p.playerId, 'Jogador');
      return e ? { ok: false, error: invalid(e) } : { ok: true, value: { type: t, playerId: String(p.playerId) } };
    }
    case 'chat': {
      const e = checkString(p.text, CHAT_MAX_LENGTH, 'Mensagem');
      if (e) return { ok: false, error: invalid(e) };
      // Texto tratado como texto puro (nunca HTML); corta controle de caracteres.
      const text = [...String(p.text)].filter((ch) => ch === '\n' || ch >= ' ').join('').trim().slice(0, CHAT_MAX_LENGTH);
      if (!text) return { ok: false, error: invalid('Mensagem vazia') };
      return { ok: true, value: { type: t, text } };
    }
    default:
      return { ok: false, error: invalid('Tipo de comando de lobby desconhecido') };
  }
}

/** Valida o envelope completo de comando (cmd do jogo). Exige `baseVersion`. */
export function validateEnvelope(raw: unknown): { ok: true; value: CommandEnvelope } | { ok: false; error: EngineError } {
  if (!isPlainObject(raw)) return { ok: false, error: invalid('Envelope inválido') };
  const rid = checkId(raw.requestId, 'requestId', 80);
  if (rid) return { ok: false, error: invalid(rid) };
  if (raw.baseVersion === undefined || !Number.isInteger(raw.baseVersion) || (raw.baseVersion as number) < 0) {
    return { ok: false, error: invalid('Comando de jogo exige baseVersion inteira >= 0 (versão base do estado).') };
  }
  const g = validateGameCommand(raw.payload);
  if (!g.ok) return g;
  return {
    ok: true,
    value: { requestId: String(raw.requestId), baseVersion: raw.baseVersion as number, payload: g.value },
  };
}

export function validateLobbyEnvelope(raw: unknown): { ok: true; value: CommandEnvelope } | { ok: false; error: EngineError } {
  if (!isPlainObject(raw)) return { ok: false, error: invalid('Envelope inválido') };
  const rid = checkId(raw.requestId, 'requestId', 80);
  if (rid) return { ok: false, error: invalid(rid) };
  const g = validateLobbyCommand(raw.payload);
  if (!g.ok) return g;
  return { ok: true, value: { requestId: String(raw.requestId), payload: g.value } };
}
