// Idempotência e versionamento de comandos de jogo.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cmd, nextView, rid, startedRoom, startHarness, type Harness } from './harness';

describe('idempotência e versão', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('mesmo requestId duas vezes: 1 efeito, mesma resposta', async () => {
    const { sockets } = await startedRoom(h, 3);
    const requestId = rid();
    const first = await cmd(sockets[0], { type: 'roll_dice' }, { requestId, baseVersion: 0 });
    expect(first.ok).toBe(true);
    const callsAfterFirst = h.engine.calls;
    const second = await cmd(sockets[0], { type: 'roll_dice' }, { requestId, baseVersion: 0 });
    expect(second).toEqual(first);
    expect(h.engine.calls).toBe(callsAfterFirst); // sem novo efeito
  });

  it('mesmo requestId com payload diferente => REQUEST_CONFLICT', async () => {
    const { sockets } = await startedRoom(h, 3);
    const requestId = rid();
    const first = await cmd(sockets[0], { type: 'roll_dice' }, { requestId, baseVersion: 0 });
    expect(first.ok).toBe(true);
    const conflict = await cmd(sockets[0], { type: 'end_turn' }, { requestId, baseVersion: 1 });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('REQUEST_CONFLICT');
  });

  it('reenvio idempotente funciona mesmo com versão base antiga (pós-sucesso)', async () => {
    const { sockets } = await startedRoom(h, 3);
    const requestId = rid();
    const first = await cmd(sockets[0], { type: 'roll_dice' }, { requestId, baseVersion: 0 });
    expect(first.ok).toBe(true);
    // Estado avançou; reenvio com baseVersion antiga NÃO pode virar STALE.
    const replay = await cmd(sockets[0], { type: 'roll_dice' }, { requestId, baseVersion: 0 });
    expect(replay.ok).toBe(true);
  });

  it('STALE_VERSION: ack com versão atual + state pessoal para ressincronizar', async () => {
    const { sockets } = await startedRoom(h, 3);
    const viewP = nextView(sockets[1]);
    const stale = await cmd(sockets[1], { type: 'roll_dice' }, { baseVersion: 99 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('STALE_VERSION');
      expect(stale.version).toBe(0);
    }
    const view = await viewP;
    expect(view.version).toBe(0);
    expect(view.roomCode).toBeTruthy();
  });

  it('erro do motor: ack erro, SEM bump de versão e sem persistência', async () => {
    const { sockets } = await startedRoom(h, 3);
    const res = await cmd(sockets[0], { type: 'build_road', edgeId: 'err' }, { baseVersion: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_POSITION');
    const okRes = await cmd(sockets[0], { type: 'roll_dice' }, { baseVersion: 0 });
    expect(okRes.ok).toBe(true);
    if (okRes.ok) expect(okRes.version).toBe(1); // primeira mutação aceita = versão 1
  });

  it('dois comandos concorrentes são serializados (versões 1 e 2, sem intercalação)', async () => {
    const { sockets } = await startedRoom(h, 3);
    const [a, b] = await Promise.all([
      cmd(sockets[0], { type: 'roll_dice' }, { baseVersion: 0 }),
      cmd(sockets[0], { type: 'end_turn' }, { baseVersion: 0 }),
    ]);
    // Um vence; o outro fica STALE (ambos partiram da versão 0).
    const oks = [a, b].filter((r) => r.ok);
    const stales = [a, b].filter((r) => !r.ok);
    expect(oks.length).toBe(1);
    expect(stales.length).toBe(1);
    if (!stales[0].ok) expect(stales[0].error.code).toBe('STALE_VERSION');
    // Reenvio com a versão corrente funciona: fila nunca corrompe.
    const retry = await cmd(sockets[0], { type: 'end_turn' }, { baseVersion: 1 });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.version).toBe(2);
  });
});
