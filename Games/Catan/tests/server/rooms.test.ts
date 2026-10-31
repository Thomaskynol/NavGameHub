// Salas: criação, códigos únicos, join, cores, prontidão, início, bloqueio pós-início.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertCodeValid, createRoom, joinRoom, lobby, startedRoom, startHarness, type Harness } from './harness';

describe('salas', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('cria sala com código único de 5 caracteres e anfitrião host', async () => {
    const a = await createRoom(h, 'Ana');
    const b = await createRoom(h, 'Bia');
    assertCodeValid(a.session.roomCode);
    assertCodeValid(b.session.roomCode);
    expect(a.session.roomCode).not.toBe(b.session.roomCode);
    expect(a.session.isHost).toBe(true);
    expect(a.session.recoveryCode.length).toBeGreaterThan(20);
  });

  it('join adiciona jogadores com cores exclusivas (ordem das constantes)', async () => {
    const host = await createRoom(h, 'Ana');
    const j1 = await joinRoom(h, host.session.roomCode, 'Bia');
    const j2 = await joinRoom(h, host.session.roomCode, 'Caio');
    const colors = [host.session, j1.session, j2.session].map((s) => s.playerId);
    expect(new Set(colors).size).toBe(3);
    const view = await new Promise<{ players: { color: string }[] }>((resolve) => {
      host.socket.once('state', resolve);
      void lobby(j2.socket, { type: 'set_ready', ready: false });
    });
    const viewColors = view.players.map((p) => p.color);
    expect(new Set(viewColors).size).toBe(3);
  });

  it('join de sala inexistente => ROOM_NOT_FOUND; sala cheia => ROOM_FULL', async () => {
    const host = await createRoom(h, 'Ana');
    const missing = await lobby(await h.connect(), { type: 'join_room', code: 'XXXXX', nickname: 'Zoe' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('ROOM_NOT_FOUND');
    await joinRoom(h, host.session.roomCode, 'Bia');
    await joinRoom(h, host.session.roomCode, 'Caio');
    await joinRoom(h, host.session.roomCode, 'Davi'); // 4 = MAX_PLAYERS
    const full = await lobby(await h.connect(), { type: 'join_room', code: host.session.roomCode, nickname: 'Eva' });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error.code).toBe('ROOM_FULL');
  });

  it('start_game: só anfitrião, exige 3+ jogadores todos prontos', async () => {
    const host = await createRoom(h, 'Ana');
    const code = host.session.roomCode;
    const j1 = await joinRoom(h, code, 'Bia');
    const j2 = await joinRoom(h, code, 'Caio');

    const notReady = await lobby(host.socket, { type: 'start_game' });
    expect(notReady.ok).toBe(false);
    if (!notReady.ok) expect(notReady.error.code).toBe('NOT_READY');

    for (const s of [host.socket, j1.socket]) await lobby(s, { type: 'set_ready', ready: true });
    const notHost = await lobby(j1.socket, { type: 'start_game' });
    expect(notHost.ok).toBe(false);
    if (!notHost.ok) expect(notHost.error.code).toBe('NOT_HOST');

    await lobby(j2.socket, { type: 'set_ready', ready: true });
    const started = await lobby(host.socket, { type: 'start_game', boardSeed: 's1' });
    expect(started.ok).toBe(true);
  });

  it('NEED_PLAYERS com menos de 3 jogadores', async () => {
    const host = await createRoom(h, 'Ana');
    await joinRoom(h, host.session.roomCode, 'Bia');
    await lobby(host.socket, { type: 'set_ready', ready: true });
    const res = await lobby(host.socket, { type: 'start_game' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NEED_PLAYERS');
  });

  it('após início: join_room => ALREADY_STARTED; set_color => WRONG_PHASE', async () => {
    const { code, sockets } = await startedRoom(h, 3);
    const late = await lobby(await h.connect(), { type: 'join_room', code, nickname: 'Lis' });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe('ALREADY_STARTED');
    const color = await lobby(sockets[1], { type: 'set_color', color: 'blue' });
    expect(color.ok).toBe(false);
    if (!color.ok) expect(color.error.code).toBe('WRONG_PHASE');
  });

  it('cores exclusivas: COLOR_TAKEN; set_color troca a cor', async () => {
    const host = await createRoom(h, 'Ana');
    const j1 = await joinRoom(h, host.session.roomCode, 'Bia');
    const taken = await lobby(j1.socket, { type: 'set_color', color: 'red' });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.error.code).toBe('COLOR_TAKEN');
    const okRes = await lobby(j1.socket, { type: 'set_color', color: 'blue' });
    expect(okRes.ok).toBe(true);
  });

  it('kick e transfer_host só do anfitrião, só no lobby; leave transfere anfitriado e fecha sala vazia', async () => {
    const host = await createRoom(h, 'Ana');
    const j1 = await joinRoom(h, host.session.roomCode, 'Bia');
    const kickByGuest = await lobby(j1.socket, { type: 'kick_player', playerId: host.session.playerId });
    expect(kickByGuest.ok).toBe(false);
    if (!kickByGuest.ok) expect(kickByGuest.error.code).toBe('NOT_HOST');
    const kicked = await lobby(host.socket, { type: 'kick_player', playerId: j1.session.playerId });
    expect(kicked.ok).toBe(true);
    const afterKick = await joinRoom(h, host.session.roomCode, 'Caio');
    const transfer = await lobby(host.socket, { type: 'transfer_host', playerId: afterKick.session.playerId });
    expect(transfer.ok).toBe(true);
    const leaveHost = await lobby(host.socket, { type: 'leave_room' });
    expect(leaveHost.ok).toBe(true);
    // Membro restante agora é anfitrião: consegue expulsar.
    const rejoin = await joinRoom(h, host.session.roomCode, 'Ana2');
    const kickByNewHost = await lobby(afterKick.socket, { type: 'kick_player', playerId: rejoin.session.playerId });
    expect(kickByNewHost.ok).toBe(true);
    const lastLeave = await lobby(afterKick.socket, { type: 'leave_room' });
    expect(lastLeave.ok).toBe(true);
    const gone = await lobby(await h.connect(), { type: 'join_room', code: host.session.roomCode, nickname: 'Zoe' });
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe('ROOM_NOT_FOUND');
  });
});
