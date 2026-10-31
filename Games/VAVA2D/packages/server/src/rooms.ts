import {
  MATCH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TICK_DT,
} from '@vava/shared';
import { Room } from './room.js';

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(): Room {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
        code += ROOM_CODE_ALPHABET[index] ?? 'A';
      }
    } while (this.rooms.has(code));

    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  /** Cria sala com código pedido pelo Hub. Valida charset/tamanho; colisão ou
   *  código inválido retorna null (chamador sinaliza CODE_TAKEN/INVALID) —
   *  nunca substitui silenciosamente por outro código. Guarda o dono
   *  (htok) quando informado. */
  createWithCode(raw: string, hubOwner: string | null = null): Room | null {
    const code = raw.toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH) return null;
    for (const ch of code) {
      if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
    }
    if (this.rooms.has(code)) return null;
    const room = new Room(code);
    room.hubOwner = hubOwner;
    this.rooms.set(code, room);
    return room;
  }

  /** Remove a sala do Hub e libera o código. Idempotente. Com dono (htok),
   *  só fecha se o htok conferir — protege reutilização do código por outra
   *  partida. Sala sem dono fecha livremente (manual/legada). */
  close(code: string, htok?: string | null): boolean {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return false;
    if (room.hubOwner && room.hubOwner !== (htok ?? null)) return false;
    return this.rooms.delete(code.toUpperCase());
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  update(dt: number = TICK_DT): void {
    for (const room of this.rooms.values()) {
      if (room.isEmpty) continue;
      room.update(dt);
    }
  }

  cleanup(now: number = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (
        room.isEmpty &&
        room.emptySince !== null &&
        now - room.emptySince > MATCH.roomEmptyTtlMs
      ) {
        this.rooms.delete(code);
      }
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}
