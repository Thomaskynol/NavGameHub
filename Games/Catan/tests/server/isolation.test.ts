// Isolamento entre salas, chat (rate limit + sanitizacao), payload invalido.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collect, cmd, createRoom, joinRoom, lobby, rid, startedRoom, startHarness, type Harness } from './harness';

describe('isolamento e chat', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('salas isoladas: chat e comandos nao vazam entre salas', async () => {
    const a = await startedRoom(h, 3);
    const b = await startedRoom(h, 3);
    const cb = collect(b.sockets[0]);
    const ca = collect(a.sockets[0]);
    await lobby(a.sockets[1], { type: 'chat', text: 'segredo da sala A' });
    await new Promise((r) => setTimeout(r, 100));
    expect(ca.chats.some((m) => m.text === 'segredo da sala A')).toBe(true);
    expect(cb.chats.some((m) => m.text === 'segredo da sala A')).toBe(false);
    const bump = await cmd(b.sockets[0], { type: 'roll_dice' }, { baseVersion: 0 });
    expect(bump.ok).toBe(true);
    const staleInA = await cmd(a.sockets[0], { type: 'roll_dice' }, { baseVersion: 1 });
    expect(staleInA.ok).toBe(false);
    if (!staleInA.ok) expect(staleInA.error.code).toBe('STALE_VERSION');
  });

  it('apos leave no lobby, socket fica sem vinculo (AUTH_REQUIRED)', async () => {
    const host = await createRoom(h, 'Ana');
    const j1 = await joinRoom(h, host.session.roomCode, 'Bia');
    const left = await lobby(j1.socket, { type: 'leave_room' });
    expect(left.ok).toBe(true);
    const res = await cmd(j1.socket, { type: 'roll_dice' }, { baseVersion: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AUTH_REQUIRED');
  });

  it('rate limit de chat: 6a mensagem rapida => RATE_LIMITED', async () => {
    const host = await createRoom(h, 'Ana');
    for (let i = 0; i < 5; i += 1) {
      const res = await lobby(host.socket, { type: 'chat', text: `oi ${i}` });
      expect(res.ok).toBe(true);
    }
    const limited = await lobby(host.socket, { type: 'chat', text: 'oi demais' });
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.code).toBe('RATE_LIMITED');
  });

  it('sanitizacao: HTML permanece texto puro; caracteres de controle removidos', async () => {
    const host = await createRoom(h, 'Ana');
    const c = collect(host.socket);
    const res = await lobby(host.socket, { type: 'chat', text: '<b>oi</b>' });
    expect(res.ok).toBe(true);
    const noisy = 'ab' + String.fromCharCode(7) + 'cd';
    const ctrl = await lobby(host.socket, { type: 'chat', text: noisy });
    expect(ctrl.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    const html = c.chats.find((m) => m.text.includes('oi'));
    expect(html?.text).toContain('<b>oi</b>'); // literal, nunca interpretado
    const cleaned = c.chats.find((m) => m.text.includes('ab'));
    expect(cleaned?.text).toBe('abcd');
  });

  it('payload invalido: INVALID_PAYLOAD sem stack', async () => {
    const { sockets } = await startedRoom(h, 3);
    const requestId = rid();
    const res = await new Promise<{ ok: boolean; error?: { code: string; message: string } }>((resolve) => {
      sockets[0].emit('cmd', { requestId, payload: { type: 'unknown_thing' } }, resolve);
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error?.code).toBe('INVALID_PAYLOAD');
      expect(res.error?.message ?? '').not.toMatch(/\n\s+at /);
    }
  });
});
