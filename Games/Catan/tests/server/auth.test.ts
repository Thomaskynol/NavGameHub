// Auth: vínculo de sessão, recuperação por hash, conflito/takeover, impersonação.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collect, cmd, createRoom, lobby, lobbyAckOk, nextViewMatching, startedRoom, startHarness, type Harness } from './harness';

describe('autenticação e sessão', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('cmd e lobby mutante sem bind => AUTH_REQUIRED', async () => {
    const socket = await h.connect();
    const res = await cmd(socket, { type: 'roll_dice' }, { baseVersion: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AUTH_REQUIRED');
    const lobbyRes = await lobby(socket, { type: 'set_ready', ready: true });
    expect(lobbyRes.ok).toBe(false);
    if (!lobbyRes.ok && 'error' in lobbyRes) expect(lobbyRes.error.code).toBe('AUTH_REQUIRED');
  });

  it('jogador nao age por outro: envelope sem player; efeito sai apenas da mao do vinculado', async () => {
    const { sockets } = await startedRoom(h, 3);
    // sockets[1] rola: broadcast para todos; só a mao de sockets[1] muda.
    const viewP = nextViewMatching(sockets[2], (v) => v.version === 1);
    const res = await cmd(sockets[1], { type: 'roll_dice' }, { baseVersion: 0 });
    expect(res.ok).toBe(true);
    const view = await viewP;
    expect(view.players[1].resourcesCount).toBe(1);
    expect(view.players[0].resourcesCount).toBe(0);
    expect(view.players[2].resourcesCount).toBe(0);
  });

  it('recuperação por hash: bind_session resume funciona após desconexão', async () => {
    const host = await createRoom(h, 'Ana');
    host.socket.disconnect();
    const socket2 = await h.connect();
    const res = await lobby(socket2, {
      type: 'bind_session',
      code: host.session.roomCode,
      recoveryCode: host.session.recoveryCode,
      mode: 'resume',
    });
    lobbyAckOk(res);
    if ('session' in res) expect(res.session.playerId).toBe(host.session.playerId);
    expect(res.ok && 'view' in res && res.view !== null).toBe(true);
  });

  it('recovery errado ou de outra sala => INVALID_RECOVERY', async () => {
    const host = await createRoom(h, 'Ana');
    const other = await createRoom(h, 'Bia');
    host.socket.disconnect();
    const socket2 = await h.connect();
    const wrongCode = await lobby(socket2, {
      type: 'bind_session',
      code: host.session.roomCode,
      recoveryCode: 'recovery-inexistente-000',
      mode: 'claim',
    });
    expect(wrongCode.ok).toBe(false);
    if (!wrongCode.ok) expect(wrongCode.error.code).toBe('INVALID_RECOVERY');
    // Recuperação válida apontando para OUTRA sala não serve para entrar na sala errada.
    const crossRoom = await lobby(socket2, {
      type: 'bind_session',
      code: host.session.roomCode,
      recoveryCode: other.session.recoveryCode,
      mode: 'claim',
    });
    expect(crossRoom.ok).toBe(false);
    if (!crossRoom.ok) expect(crossRoom.error.code).toBe('INVALID_RECOVERY');
  });

  it('resume com sessão ativa => SESSION_CONFLICT + bind_conflict no novo socket', async () => {
    const host = await createRoom(h, 'Ana');
    const socket2 = await h.connect();
    const conflictP = new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      socket2.once('bind_conflict', resolve);
    });
    const res = await lobby(socket2, {
      type: 'bind_session',
      code: host.session.roomCode,
      recoveryCode: host.session.recoveryCode,
      mode: 'resume',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('SESSION_CONFLICT');
    const conflict = await conflictP;
    expect(conflict.playerId).toBe(host.session.playerId);
    // Sessão anterior não perde o controle.
    const still = await lobby(host.socket, { type: 'set_ready', ready: true });
    expect(still.ok).toBe(true);
  });

  it('takeover transfere controle: anterior recebe session_replaced e perde vínculo', async () => {
    const host = await createRoom(h, 'Ana');
    const c1 = collect(host.socket);
    const socket2 = await h.connect();
    const res = await lobby(socket2, {
      type: 'bind_session',
      code: host.session.roomCode,
      recoveryCode: host.session.recoveryCode,
      mode: 'takeover',
    });
    lobbyAckOk(res);
    expect(c1.replaced.length).toBe(1);
    expect(c1.replaced[0].by).toBe(host.session.playerId);
    // Socket anterior desvinculado: comandos agora falham.
    const old = await lobby(host.socket, { type: 'set_ready', ready: true });
    expect(old.ok).toBe(false);
    if (!old.ok && 'error' in old) expect(old.error.code).toBe('AUTH_REQUIRED');
    // Novo socket age como o jogador original.
    const ready = await lobby(socket2, { type: 'set_ready', ready: true });
    expect(ready.ok).toBe(true);
  });

  it('presença: desconexão emite presence connected=false e não remove o jogador', async () => {
    const { sockets, sessions } = await startedRoom(h, 3);
    const c = collect(sockets[2]);
    const presenceP = new Promise<void>((resolve) => {
      const check = (): void => {
        if (c.presence.some((p) => p.playerId === sessions[0].playerId && p.connected === false)) {
          sockets[2].off('presence', check);
          resolve();
        }
      };
      sockets[2].on('presence', check);
    });
    sockets[0].disconnect();
    await presenceP;
    // Jogador permanece no jogo: comandos seguem e a view ainda tem 3 jogadores.
    const viewP = nextViewMatching(sockets[2], (v) => v.version === 1);
    const roll = await cmd(sockets[2], { type: 'roll_dice' }, { baseVersion: 0 });
    expect(roll.ok).toBe(true);
    const view = await viewP;
    expect(view.players.length).toBe(3);
    expect(view.players[0].connected).toBe(false);
  });
});
