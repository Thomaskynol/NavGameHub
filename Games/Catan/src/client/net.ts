// Camada Socket.IO tipada sobre o protocolo compartilhado.
// URL: mesma origem em produção; em dev o proxy do Vite resolve.
import { io, type Socket } from 'socket.io-client';
import type {
  ClientEvents,
  CommandResponse,
  GameCommand,
  LobbyAck,
  LobbyCommand,
  ServerEvents,
  SessionPayload,
} from '../shared/protocol';

export type CatanSocket = Socket<ServerEvents, ClientEvents>;

export function createSocket(): CatanSocket {
  return io({
    path: '/socket.io',
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    reconnectionAttempts: Infinity,
    withCredentials: true,
  });
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const TIMEOUT_MS = 10_000;

export type LobbyResult =
  | { ok: true; session?: SessionPayload; version?: number }
  | { ok: false; error: { code: string; message: string } };

/** Envia comando de jogo. Rejeita em timeout de rede; erros de regra vêm em ok:false. */
export function emitGameCommand(
  socket: CatanSocket,
  payload: GameCommand,
  baseVersion: number | undefined,
): Promise<CommandResponse> {
  const envelope = { requestId: newRequestId(), baseVersion, payload };
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error('offline'));
      return;
    }
    socket.timeout(TIMEOUT_MS).emit('cmd', envelope, (err: Error | null, res?: CommandResponse) => {
      if (err) {
        reject(new Error('timeout'));
        return;
      }
      if (!res) {
        reject(new Error('empty'));
        return;
      }
      resolve(res);
    });
  });
}

/** Envia comando de lobby (create/join/bind/color/ready/start/leave/kick/transfer). */
export function emitLobbyCommand(
  socket: CatanSocket,
  payload: LobbyCommand,
): Promise<LobbyResult> {
  const envelope = { requestId: newRequestId(), payload };
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error('offline'));
      return;
    }
    socket.timeout(TIMEOUT_MS).emit('lobby', envelope, (err: Error | null, res?: CommandResponse | LobbyAck) => {
      if (err) {
        reject(new Error('timeout'));
        return;
      }
      if (!res) {
        reject(new Error('empty'));
        return;
      }
      if ('session' in res || !('requestId' in res)) {
        const ack = res as LobbyAck;
        if (ack.ok) resolve({ ok: true, session: ack.session });
        else resolve({ ok: false, error: ack.error });
        return;
      }
      if (res.ok) resolve({ ok: true, version: res.version });
      else resolve({ ok: false, error: res.error });
    });
  });
}
