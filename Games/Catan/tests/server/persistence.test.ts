// Persistência: reinicio do servidor restaura estado; processed_commands sobrevive.
import { afterEach, describe, expect, it } from 'vitest';
import { cmd, fakeEngine, lobby, rid, startedRoom, startHarness, type FakeEngine } from './harness';

describe('persistência e reinício', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  it('comando aceito sobrevive a reinício; processed_commands devolve mesmo ack sem novo efeito', async () => {
    const engine: FakeEngine = fakeEngine();
    const h1 = await startHarness({ engine });
    cleanups.push(() => h1.close({ keepDb: true }));
    const { code, sockets, sessions } = await startedRoom(h1, 3);
    const requestId = rid();
    const first = await cmd(sockets[0], { type: 'roll_dice' }, { requestId, baseVersion: 0 });
    expect(first.ok).toBe(true);
    const callsBefore = engine.calls;
    await h1.close({ keepDb: true });
    cleanups.length = 0;

    const h2 = await startHarness({ engine, dbPath: h1.dbPath });
    cleanups.push(() => h2.close());
    const socket = await h2.connect();
    const bind = await lobby(socket, { type: 'bind_session', code, recoveryCode: sessions[0].recoveryCode, mode: 'resume' });
    expect(bind.ok).toBe(true);
    if (bind.ok && 'view' in bind) {
      expect(bind.view).not.toBeNull();
      expect(bind.view?.version).toBe(1); // estado restaurado com o comando aplicado
      expect(bind.view?.phase).toBe('setup_settlement');
    }
    // Reenvio idempotente: mesma resposta, sem novo efeito no motor.
    const replay = await cmd(socket, { type: 'roll_dice' }, { requestId, baseVersion: 0 });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.version).toBe(1);
    expect(engine.calls).toBe(callsBefore);
  });

  it('sala em lobby sobrevive a reinício; presença inicia desconectada', async () => {
    const engine = fakeEngine();
    const h1 = await startHarness({ engine });
    cleanups.push(() => h1.close({ keepDb: true }));
    const host = await (async () => {
      const { createRoom } = await import('./harness');
      return createRoom(h1, 'Vera');
    })();
    await lobby(host.socket, { type: 'chat', text: 'ate logo' });
    await h1.close({ keepDb: true });
    cleanups.length = 0;

    const h2 = await startHarness({ engine, dbPath: h1.dbPath });
    cleanups.push(() => h2.close());
    const socket = await h2.connect();
    const bind = await lobby(socket, {
      type: 'bind_session',
      code: host.session.roomCode,
      recoveryCode: host.session.recoveryCode,
      mode: 'claim',
    });
    expect(bind.ok).toBe(true);
    if (bind.ok && 'view' in bind) {
      expect(bind.view?.phase).toBe('lobby');
      expect(bind.view?.chat.some((m) => m.text === 'ate logo')).toBe(true);
    }
  });
});
