// Identidade: códigos de sala, recovery codes (só hash no banco), ids, hash de payload.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { RECOVERY_CODE_BYTES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/constants';

export function newPlayerId(): string {
  return randomUUID();
}

export function newChatId(): string {
  return randomUUID();
}

export function generateRoomCode(): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    out += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

export function generateRecoveryCode(): string {
  return randomBytes(RECOVERY_CODE_BYTES).toString('base64url');
}

export function hashRecovery(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Stringify canônico (chaves ordenadas) para hash de payload estável. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonical(payload), 'utf8').digest('hex');
}
