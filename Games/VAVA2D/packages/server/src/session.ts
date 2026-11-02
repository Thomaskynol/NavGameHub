import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import {
  MAX_MESSAGES_PER_SECOND,
  NAME_MAX_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isRecord,
  normalizeAngle,
} from '@vava/shared';
import type { PlayerInput, ServerMessage } from '@vava/shared';
import type { Room, ServerPlayer } from './room.js';
import type { RoomManager } from './rooms.js';

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return 'Jogador';
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX_LENGTH);
  return clean.length > 0 ? clean : 'Jogador';
}

function sanitizeCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

function sanitizeRequestedCode(value: unknown): string | null {
  if (value == null || value === '') return null;
  const code = String(value).trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return '';
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return '';
  }
  return code;
}

// Dono da partida (?htok= do launch do Hub): opaco, 1..64 chars
// [A-Za-z0-9_-]; outro formato → null (sem dono). Só guardado e comparado.
function sanitizeHtok(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) return null;
  return s;
}

function sanitizeInput(value: unknown): PlayerInput | null {
  if (!isRecord(value)) return null;
  const seq = value.seq;
  const move = value.move;
  const aim = value.aim;

  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null;
  if (typeof move !== 'number' || !Number.isInteger(move) || move < 0 || move > 15) return null;
  if (typeof aim !== 'number' || !Number.isFinite(aim)) return null;

  return {
    seq,
    move,
    aim: normalizeAngle(aim),
    shoot: value.shoot === true,
    reload: value.reload === true,
    dash: value.dash === true,
    grenade: value.grenade === true,
  };
}

export class Session {
  private room: Room | null = null;
  private player: ServerPlayer | null = null;
  private windowStart = Date.now();
  private messagesInWindow = 0;
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly rooms: RoomManager,
  ) {
    this.ws.on('message', (data: RawData) => this.onMessage(data.toString()));
    this.ws.on('close', () => this.leave());
    this.ws.on('error', () => this.leave());
  }

  send(message: ServerMessage): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private onMessage(raw: string): void {
    if (this.closed) return;

    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.messagesInWindow = 0;
    }
    this.messagesInWindow += 1;
    if (this.messagesInWindow > MAX_MESSAGES_PER_SECOND) {
      this.fail('Muitas mensagens. Conexão encerrada.');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed) || typeof parsed.t !== 'string') return;

    switch (parsed.t) {
      case 'create': {
        if (this.player) return;
        const requested = sanitizeRequestedCode(parsed.code ?? parsed.room);
        if (requested === '') {
          this.fail('Código de sala inválido. (CODE_TAKEN)');
          return;
        }
        if (requested) {
          const existing = this.rooms.get(requested);
          if (existing) {
            // Contrato htok (R2): código ocupado + mesmo dono → retentativa
            // legítima do mesmo launch (entra/resume, sem CODE_TAKEN).
            // Dono diferente/ausente → CODE_TAKEN; o cliente Hub NÃO faz join
            // cego (erro honesto) para não misturar grupos.
            const htok = sanitizeHtok(parsed.htok);
            if (existing.hubOwner && htok && existing.hubOwner === htok) {
              this.joinRoom(existing, sanitizeName(parsed.name));
              break;
            }
            this.fail('Código de sala já está em uso. (CODE_TAKEN)');
            return;
          }
          const room = this.rooms.createWithCode(requested, sanitizeHtok(parsed.htok));
          if (!room) {
            this.fail('Código de sala já está em uso. (CODE_TAKEN)');
            return;
          }
          this.joinRoom(room, sanitizeName(parsed.name));
          break;
        }
        const room = this.rooms.create();
        this.joinRoom(room, sanitizeName(parsed.name));
        break;
      }
      case 'join': {
        if (this.player) return;
        const code = sanitizeCode(parsed.code);
        const room = this.rooms.get(code);
        if (!room) {
          this.fail('Sala não encontrada. Confira o código.');
          return;
        }
        // Contrato htok (R2): join com htok de outro launch, ou com htok em
        // sala sem dono, é recusado SEM entrar (sem join cego, sem misturar
        // grupos). Sem htok vale o legado (entra como antes, documentado).
        // Mesmo htok entra (resume/startHub legítimo do mesmo launch).
        const htok = sanitizeHtok(parsed.htok);
        if (htok && (!room.hubOwner || room.hubOwner !== htok)) {
          this.fail('Sala reservada para outra partida do Hub. (OWNER_MISMATCH)');
          return;
        }
        if (room.isFull) {
          this.fail('Sala cheia (máximo de 8 jogadores).');
          return;
        }
        this.joinRoom(room, sanitizeName(parsed.name));
        break;
      }
      case 'input': {
        if (!this.room || !this.player) return;
        const input = sanitizeInput(parsed.input);
        if (!input) return;
        this.room.handleInput(this.player.id, input);
        break;
      }
      case 'ping': {
        const id = typeof parsed.id === 'number' && Number.isFinite(parsed.id) ? parsed.id : 0;
        this.send({ t: 'pong', id });
        break;
      }
      case 'chooseCard': {
        if (!this.room || !this.player) return;
        const card = typeof parsed.card === 'string' ? parsed.card : '';
        this.room.handleChooseCard(this.player.id, card);
        break;
      }
      case 'voteMap': {
        if (!this.room || !this.player) return;
        const map = typeof parsed.map === 'string' ? parsed.map : '';
        this.room.handleVoteMap(this.player.id, map);
        break;
      }
      default:
        break;
    }
  }

  private joinRoom(room: Room, name: string): void {
    const player = room.addPlayer(this, name);
    if (!player) {
      this.fail('Sala cheia. Tente outra sala.');
      return;
    }

    this.room = room;
    this.player = player;
    this.send({
      t: 'joined',
      playerId: player.id,
      roomCode: room.code,
      phase: room.phase,
    });
    room.sendSnapshotTo(player);
  }

  private fail(message: string): void {
    this.send({ t: 'error', message });
    this.closed = true;
    this.leave();
    try {
      this.ws.close(1008, 'closed');
    } catch {
      // conexão já encerrada
    }
  }

  private leave(): void {
    if (this.room && this.player) {
      this.room.removePlayer(this.player.id);
    }
    this.room = null;
    this.player = null;
    this.closed = true;
  }
}
