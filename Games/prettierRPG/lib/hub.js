'use strict';

// Hub lado-servidor: dono desta lane.
// Contrato em INTEGRACAO_GAME_HUB.md.
// HUB_SECRET ausente => endpoints recusam (503) sem quebrar modo independente.

const owners = new Map(); // roomCode -> htok

function hubSecret() { return process.env.HUB_SECRET || ''; }

// htok opaco do contrato (PROTOCOLO R2): 1..64 chars [A-Za-z0-9_-]; fora
// disso vale como ausente (sem dono), nunca como dono parcial.
function validHtok(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(t) ? t : null;
}

// Registra o dono no momento da criação dirigida pelo Hub (antes de
// qualquer poll/state/close), nunca no primeiro close.
function remember(code, htok) {
  const h = validHtok(htok);
  if (!h) return null;
  code = String(code || '').toUpperCase();
  if (!code) return null;
  owners.set(code, h);
  return h;
}

function ownerOf(code) {
  return owners.get(String(code || '').toUpperCase()) || null;
}

function stateOf(rooms, code, htok) {
  const secret = hubSecret();
  if (!secret) return { status: 503, body: { ok: false, error: 'Hub não configurado (HUB_SECRET ausente).' } };
  code = String(code || '').toUpperCase();
  if (!code) return { status: 400, body: { ok: false, error: 'Sala inválida.' } };
  const room = rooms.get(code);
  if (!room) return { status: 404, body: { ok: false, error: 'NOT_FOUND' } };
  const owner = owners.get(code) || null;
  htok = validHtok(htok);
  if (htok && owner && htok !== owner) return { status: 409, body: { ok: false, error: 'CODE_TAKEN', hubOwner: owner } };
  const m = room.match;
  const players = [...m.players.values()].filter((p) => !p.left);
  const capacity = m.mode === 'pve' ? 1 : m.mode === '2v2' ? 4 : 12;
  return {
    status: 200,
    body: {
      ok: true,
      room: {
        code,
        phase: m.state === 'playing' ? 'playing' : m.state === 'ended' ? 'results' : 'lobby',
        players: players.length,
        capacity,
        joinable: m.state === 'lobby' && players.length < capacity,
        hubOwner: owner,
        mode: m.mode,
      },
    },
  };
}

function closeRoom(rooms, code, htok, secret) {
  const need = hubSecret();
  if (!need) return { status: 503, body: { ok: false, error: 'Hub não configurado (HUB_SECRET ausente).' } };
  if (secret !== need) return { status: 403, body: { ok: false, error: 'FORBIDDEN' } };
  code = String(code || '').toUpperCase();
  if (!code) return { status: 400, body: { ok: false, error: 'Sala inválida.' } };
  htok = validHtok(htok);
  const room = rooms.get(code);
  if (!room) { // idempotente: sala livre, nada a fechar nem reservar
    owners.delete(code);
    return { status: 200, body: { ok: true, closed: false, room: code } };
  }
  const owner = owners.get(code) || null;
  if (owner && htok !== owner) return { status: 403, body: { ok: false, error: 'FORBIDDEN' } };
  // Sala sem dono (standalone/legada): close afiliado COM htok de outro
  // launch preserva — só fecha sem htok (legítimo).
  if (!owner && htok) return { status: 403, body: { ok: false, error: 'FORBIDDEN' } };
  // libera timers sem afetar outras salas
  for (const t of room.pendingRemove.values()) clearTimeout(t);
  room.pendingRemove.clear();
  rooms.delete(code);
  owners.delete(code);
  return { status: 200, body: { ok: true, closed: true, room: code } };
}

function forget(code) { owners.delete(String(code || '').toUpperCase()); }

module.exports = { stateOf, closeRoom, forget, remember, ownerOf, validHtok, _owners: owners, hubSecret };
