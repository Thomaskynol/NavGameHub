// L3 Item3 (R9) no navegador real (cliente + servidor + motor reais).
//
// Inconsistência sob teste (Games/Catan/src/client/screens/Game.tsx): o
// `playableDevs` (TurnBar) usa `canPlayDev` (só turno+fase) e IGNORA
// `boughtThisTurn` (por id) e `playedActionCardThisTurn` — a barra oferece
// botão habilitado que o servidor rejeita (DEV_BOUGHT_THIS_TURN /
// DEV_ALREADY_PLAYED). Referência read-only: HandPanel.devCardState.
//
// Preparação (hooks do servidor, SÓ p/ viabilizar cartas — compras, jogadas,
// rejeições e leituras de estado são 100% reais):
// - seed_rng ANTES do start_game => baralho determinístico (pop order:
//   knight, monopoly, monopoly, roadBuilding, knight; sem VP no top5).
// - force_next_dice em todas as rolagens (sem 7/descarte/ladrão); produção
//   natural + troca marítima pela UI fecham os trios (1 lã+1 grão+1 minério).
//   SEM load_near_win_fixture (ela somaria 8 PV aos 2 do setup e acabaria o jogo).
//
// Casos (2 jogadoras, fluxo natural pela UI):
//  1. carta comprada no turno bloqueada (sem botão; servidor DEV_BOUGHT_THIS_TURN).
//  2. carta antiga do mesmo tipo PERMITIDA com nova presente (rótulo sem ×2).
//  3. ação já usada no turno bloqueia tudo (+ DEV_ALREADY_PLAYED).
//  4. turno alheio: sem botões de dev na aba adversária.
//  5. pré-dados e ação permitem (carta antiga); fase do ladrão bloqueia.
//  6. contagem mista: antiga jogável + nova bloqueada (×1, sem botão da nova).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  actorName,
  anyDiscardVisible,
  dismissDiscards,
  emitHook,
  getView,
  handTotal,
  openPage,
  phaseText,
  prepareContext,
  productiveNumber,
  resourceIndexForModal,
  setupVertexIndex,
  splitDice,
  vertexTargetList,
  waitForTurn,
} from './helpers';
import { bestBankRate, getGeometry, legalKnightHexes, legalRobberHexes, robberVictims } from '../src/client/board/legalClient';

const ANA = 'L3-Ana';
const BIA = 'L3-Bia';
const RNG_SEED = 'l3-deck-13'; // pops: knight, monopoly, monopoly, roadBuilding, knight
const BOARD_SEED = 'r2-board-01'; // tabuleiro comprovado p/ produção (lane R2)
const ACTION_PHASE = 'Sua fase: troque, construa ou termine o turno';
const PRE_ROLL = 'Antes dos dados';
const ROBBER_PHASE = 'Mova o ladrão';

let ctx: BrowserContext;
let pAna: Page;
let pBia: Page;

function byName(name: string): Page {
  return name === ANA ? pAna : pBia;
}

/** Botões de dev na TurnBar (ids btn-dev-<kind>). */
async function devButtons(page: Page): Promise<string[]> {
  return page.locator('[id^="btn-dev-"]').evaluateAll((els) => els.map((e) => e.id));
}

async function setupActorPage(phase: string): Promise<Page> {
  const sel = phase.includes('estrada') ? 'line.hit-edge' : 'circle.hit-vertex';
  for (const page of [pAna, pBia]) {
    if ((await page.locator(sel).count()) > 0) return page;
  }
  await expect
    .poll(
      async () => {
        for (const page of [pAna, pBia]) {
          if ((await page.locator(sel).count()) > 0) return true;
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  for (const page of [pAna, pBia]) {
    if ((await page.locator(sel).count()) > 0) return page;
  }
  throw new Error(`nenhuma aba com alvos de setup (${sel})`);
}

/** Envia GameCommand real pelo socket do cliente (mesmo canal da UI). */
async function emitCmd(
  page: Page,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: { code?: string; message?: string } }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const version = (await getView(page)).version;
    const res = await page.evaluate(async ({ v, p }) => {
      const w = window as unknown as {
        __catanBootSocket?: () => { emit: (ev: string, data: unknown, ack: (res: unknown) => void) => void } | null;
        __catanSock?: { emit: (ev: string, data: unknown, ack: (res: unknown) => void) => void };
      };
      const sock = w.__catanSock ?? w.__catanBootSocket?.() ?? null;
      if (!sock) return { ok: false as const, error: { message: 'sem socket' } };
      return await new Promise<{ ok: boolean; error?: { code?: string; message?: string } }>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: { message: 'timeout cmd' } }), 8000);
        sock.emit(
          'cmd',
          { requestId: `l3-${Date.now()}-${Math.floor(Math.random() * 1e9)}`, baseVersion: v, payload: p },
          (r: unknown) => {
            clearTimeout(timer);
            resolve(r as { ok: boolean; error?: { code?: string; message?: string } });
          },
        );
      });
    }, { v: version, p: payload });
    if (res.ok) return res;
    if (res.error?.message === 'timeout cmd' || (res.error as { code?: string })?.code === 'STALE_VERSION') continue;
    return res;
  }
  throw new Error('emitCmd: sem resposta após 2 tentativas');
}

type View = Awaited<ReturnType<typeof getView>>;
const hasTrio = (v: View): boolean =>
  v.you.resources.wool >= 1 && v.you.resources.grain >= 1 && v.you.resources.ore >= 1;

/** Troca marítima pela UI p/ fechar o trio (taxa clássica: vale pelo recurso ENTREGUE). */
async function bankTradeForTrio(page: Page): Promise<boolean> {
  const v = await getView(page);
  const missing = (['wool', 'grain', 'ore'] as const).find((k) => v.you.resources[k] < 1);
  if (!missing) return true;
  const give = (['brick', 'lumber', 'wool', 'grain', 'ore'] as const).find((k) => {
    if (k === missing) return false;
    const reserve = k === 'wool' || k === 'grain' || k === 'ore' ? 1 : 0;
    return v.you.resources[k] - reserve >= bestBankRate(v, k);
  });
  if (!give) return false;
  const rate = bestBankRate(v, give);
  await page.getByRole('button', { name: 'Trocar com banco' }).click();
  const modal = page.getByRole('dialog', { name: 'Trocar com o banco (marítima)' });
  await expect(modal).toBeVisible();
  await modal.getByRole('radiogroup', { name: 'Recurso entregue' }).locator('button').nth(resourceIndexForModal(give)).click();
  await modal.getByRole('radiogroup', { name: 'Recurso recebido' }).locator('button').nth(resourceIndexForModal(missing)).click();
  await expect(modal.getByRole('button', { name: `Trocar ${rate}:1` })).toBeEnabled();
  await modal.getByRole('button', { name: `Trocar ${rate}:1` }).click();
  await expect(modal).toBeHidden();
  return true;
}

/**
 * Acumula produção natural até Ana ter `target` cartas (compras 100% pela UI).
 * Bia passa rápido (dados forçados 2+2). Máx `maxIter` iterações.
 */
async function farmBuys(target: number, maxIter = 150): Promise<void> {
  const exclude: number[] = [];
  let stall = 0;
  for (let i = 0; i < maxIter; i += 1) {
    const viewA = await getView(pAna);
    if (viewA.you.devCards.length >= target) return;
    const actor = await actorName(pAna);
    const phase = await phaseText(pAna);
    const page = byName(actor);
    if (phase === PRE_ROLL) {
      if (actor === ANA) {
        const n = productiveNumber(viewA, viewA.you.id, exclude);
        const before = handTotal(viewA);
        const { d1, d2 } = splitDice(n);
        const res = await emitHook(page, { type: 'force_next_dice', d1, d2 });
        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        await page.getByRole('button', { name: 'Rolar dados' }).click();
        await expect.poll(() => phaseText(pAna)).not.toBe(PRE_ROLL);
        const after = handTotal(await getView(pAna));
        if (after === before) {
          stall += 1;
          if (stall >= 2 && exclude.length < 5) {
            exclude.push(n);
            stall = 0;
          }
        } else {
          stall = 0;
          exclude.length = 0;
        }
      } else {
        const res = await emitHook(page, { type: 'force_next_dice', d1: 2, d2: 2 });
        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        await page.getByRole('button', { name: 'Rolar dados' }).click();
        await expect.poll(() => phaseText(pAna)).not.toBe(PRE_ROLL);
      }
    } else {
      expect(phase).toBe(ACTION_PHASE);
      if (actor === ANA) {
        const v = await getView(pAna);
        if (v.you.devCards.length < target) {
          if (!hasTrio(v)) await bankTradeForTrio(pAna);
          const w = await getView(pAna);
          if (w.you.devCards.length < target && hasTrio(w)) {
            const nCards = w.you.devCards.length;
            await expect(pAna.getByRole('button', { name: 'Desenvolvimento' })).toBeEnabled();
            await pAna.getByRole('button', { name: 'Desenvolvimento' }).click();
            await expect.poll(async () => (await getView(pAna)).you.devCards.length).toBe(nCards + 1);
          } else if (w.you.devCards.length >= target) {
            return;
          } else {
            await page.getByRole('button', { name: 'Fim de turno' }).click();
            await expect.poll(() => actorName(pAna)).not.toBe(actor);
          }
        } else {
          return;
        }
      } else {
        await page.getByRole('button', { name: 'Fim de turno' }).click();
        await expect.poll(() => actorName(pAna)).not.toBe(actor);
      }
    }
  }
  throw new Error(`Ana nunca acumulou ${target} cartas de desenvolvimento`);
}

async function passTurn(from: Page, fromName: string): Promise<void> {
  await from.getByRole('button', { name: 'Fim de turno' }).click();
  await expect.poll(() => actorName(pAna)).not.toBe(fromName);
}

/** Bia rola (forçado, sem 7) e passa — devolve o turno rápido. */
async function biaPass(): Promise<void> {
  await waitForTurn(pBia, BIA, PRE_ROLL);
  const res = await emitHook(pBia, { type: 'force_next_dice', d1: 2, d2: 2 });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  await pBia.getByRole('button', { name: 'Rolar dados' }).click();
  await waitForTurn(pBia, BIA, ACTION_PHASE);
  await passTurn(pBia, BIA);
  await waitForTurn(pAna, ANA, PRE_ROLL);
}

test.describe.serial('L3 dev cards no navegador', () => {
  test.afterAll(async () => {
    await ctx?.close();
  });

  test('1. lobby + setup snake pela UI (deck determinístico)', async ({ browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await prepareContext(ctx);

    pAna = await openPage(ctx);
    await expect(pAna.getByRole('heading', { name: 'Catan Deluxe' })).toBeVisible();
    await pAna.getByLabel('Seu apelido').fill(ANA);
    await pAna.getByRole('button', { name: 'Criar sala' }).click();
    await expect(pAna.locator('.code-big')).toBeVisible();
    const roomCode = (await pAna.locator('.code-big').innerText()).trim();
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);

    const seedRes = await emitHook(pAna, { type: 'seed_rng', seed: RNG_SEED });
    expect(seedRes.ok, JSON.stringify(seedRes.error)).toBe(true);

    pBia = await openPage(ctx);
    await pBia.getByLabel('Seu apelido').fill(BIA);
    await pBia.getByRole('button', { name: 'Entrar com código' }).click();
    await pBia.locator('#code').fill(roomCode);
    await pBia.getByRole('button', { name: 'Entrar na sala' }).click();
    await expect(pBia.getByText('Jogadores (2/4)')).toBeVisible();
    await pBia.getByRole('button', { name: 'Cor blue', exact: true }).click();
    await pBia.getByRole('button', { name: 'Estou pronto' }).click();
    await pAna.getByRole('button', { name: 'Estou pronto' }).click();
    await pAna.getByLabel('Configuração avançada (seed do tabuleiro)').check();
    await pAna.locator('#seed').fill(BOARD_SEED);
    await pAna.getByRole('button', { name: 'Iniciar partida' }).click();

    for (const page of [pAna, pBia]) {
      await expect(page.getByRole('img', { name: 'Tabuleiro de Catan' })).toBeVisible();
    }
    for (let step = 0; step < 10; step += 1) {
      const phase = await phaseText(pAna);
      if (phase === PRE_ROLL) break;
      const page = await setupActorPage(phase);
      const beforeSig = phase;
      if (phase.includes('estrada')) {
        await expect.poll(async () => page.locator('line.hit-edge').count()).toBeGreaterThan(0);
        await page.locator('line.hit-edge').first().click({ force: true });
      } else {
        expect(phase).toContain('assentamento');
        let idx = 0;
        await expect
          .poll(async () => {
            const view = await getView(page);
            const verts = vertexTargetList(view, 'setup');
            if (verts.length === 0) return false;
            if ((await page.locator('circle.hit-vertex').count()) !== verts.length) return false;
            idx = setupVertexIndex(view);
            return true;
          })
          .toBe(true);
        await page.locator('circle.hit-vertex').nth(idx).click({ force: true });
      }
      await page.getByRole('button', { name: 'Confirmar jogada' }).click();
      await expect.poll(() => phaseText(pAna)).not.toBe(beforeSig);
    }
    await expect.poll(() => phaseText(pAna)).toBe(PRE_ROLL);
    await expect.poll(() => actorName(pAna)).toBe(ANA);
  });

  test('2. caso 1+4: carta nova bloqueada; turno alheio sem botões; servidor rejeita', async ({}, testInfo) => {
    testInfo.setTimeout(600_000);
    await waitForTurn(pAna, ANA, PRE_ROLL);
    expect(await devButtons(pAna)).toEqual([]);

    await farmBuys(1);
    const view = await getView(pAna);
    expect(view.you.devCards.map((c) => c.kind)).toEqual(['knight']);
    expect(view.you.boughtThisTurn).toHaveLength(1);

    // HandPanel (referência) trava a carta nova…
    await expect(pAna.locator('.dev-card.locked')).toHaveCount(1);
    // …e a TurnBar NÃO pode oferecer botão da carta nova (caso 1).
    expect(await devButtons(pAna)).toEqual([]);

    // Servidor autoritativo rejeita a carta nova.
    const hexId = view.board.hexes.find((h) => h.id !== view.board.robberHexId)!.id;
    const rej = await emitCmd(pAna, { type: 'play_knight', hexId });
    expect(rej.ok).toBe(false);
    expect(rej.error?.code).toBe('DEV_BOUGHT_THIS_TURN');

    // (4) turno alheio: a aba da Bia não tem botões de dev.
    expect(await devButtons(pBia)).toEqual([]);

    await passTurn(pAna, ANA);
    await biaPass();
  });

  test('3. casos 5+6: pré-dados permite antiga; mista antiga×1 sem botão da nova', async ({}, testInfo) => {
    testInfo.setTimeout(600_000);
    // (5-pré) carta antiga em pre_roll: botão presente e habilitado.
    await waitForTurn(pAna, ANA, PRE_ROLL);
    expect(await devButtons(pAna)).toEqual(['btn-dev-knight']);
    await expect(pAna.getByRole('button', { name: 'Cavaleiro', exact: true })).toBeEnabled();

    await farmBuys(2);
    const v = await getView(pAna);
    expect(v.you.devCards.map((c) => c.kind)).toEqual(['knight', 'monopoly']);
    // (6) só a antiga aparece (×1, sem sufixo); a nova não tem botão.
    expect(await devButtons(pAna)).toEqual(['btn-dev-knight']);
    const rejMono = await emitCmd(pAna, { type: 'play_monopoly', resource: 'lumber' });
    expect(rejMono.ok).toBe(false);
    expect(rejMono.error?.code).toBe('DEV_BOUGHT_THIS_TURN');

    await passTurn(pAna, ANA);
    await biaPass();
  });

  test('4. casos 2+3: mesma-tipo ×1 sem ×2; após 1 ação, nada jogável', async ({}, testInfo) => {
    testInfo.setTimeout(600_000);
    await waitForTurn(pAna, ANA, PRE_ROLL);
    // Ambas antigas agora: cavaleiro + monopólio.
    expect(await devButtons(pAna)).toEqual(['btn-dev-knight', 'btn-dev-monopoly']);

    await farmBuys(3);
    const v = await getView(pAna);
    expect(v.you.devCards.map((c) => c.kind)).toEqual(['knight', 'monopoly', 'monopoly']);
    // (2) Monopólio conta ×1 (a antiga) — nunca "×2".
    expect(await devButtons(pAna)).toEqual(['btn-dev-knight', 'btn-dev-monopoly']);
    await expect(pAna.getByRole('button', { name: 'Monopólio', exact: true })).toBeVisible();
    expect(await pAna.getByRole('button', { name: /Monopólio ×2/ }).count()).toBe(0);

    // Joga o Monopólio ANTIGO pela UI (modal real).
    await pAna.getByRole('button', { name: 'Monopólio', exact: true }).click();
    const modal = pAna.getByRole('dialog', { name: 'Monopólio — escolha o recurso' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'madeira' }).click();
    await expect(modal).toBeHidden();
    await expect
      .poll(async () => (await getView(pAna)).you.playedActionCardThisTurn)
      .toBe(true);
    await expect.poll(() => phaseText(pAna)).toBe(ACTION_PHASE);
    // (3) TurnBar sem nenhum botão de dev após a ação.
    expect(await devButtons(pAna)).toEqual([]);
    // Servidor rejeita a 2ª ação no turno.
    const vAfter = await getView(pAna);
    const hexId = vAfter.board.hexes.find((h) => h.id !== vAfter.board.robberHexId)!.id;
    const rej = await emitCmd(pAna, { type: 'play_knight', hexId });
    expect(rej.ok).toBe(false);
    expect(rej.error?.code).toBe('DEV_ALREADY_PLAYED');

    await passTurn(pAna, ANA);
    await biaPass();
  });

  test('5. caso 5 (ladrão/7 + cavaleiro): sem botões fora da ação; retorno no turno seguinte', async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    const pages = [pAna, pBia];
    // Turno novo: ação zerada, cartas antigas (knight + monopoly) jogáveis de novo.
    await waitForTurn(pAna, ANA, PRE_ROLL);
    expect(await devButtons(pAna)).toEqual(['btn-dev-knight', 'btn-dev-monopoly']);

    // 7 forçado => descarte obrigatório + fase do ladrão.
    const seven = await emitHook(pAna, { type: 'force_next_dice', d1: 3, d2: 4 });
    expect(seven.ok, JSON.stringify(seven.error)).toBe(true);
    await pAna.getByRole('button', { name: 'Rolar dados' }).click();
    await expect
      .poll(
        async () => {
          if (await anyDiscardVisible(pages)) return 'discard';
          return (await phaseText(pAna)) === ROBBER_PHASE ? 'robber' : 'wait';
        },
        { timeout: 30_000 },
      )
      .not.toBe('wait');
    await dismissDiscards(pages);
    await expect.poll(() => phaseText(pAna)).toBe(ROBBER_PHASE);

    // (5-ladrão) fora da fase de ação: sem botões de dev em nenhuma aba.
    expect(await devButtons(pAna)).toEqual([]);
    expect(await devButtons(pBia)).toEqual([]);

    // Move o ladrão pela UI (hex com vítima com cartas => roubo observável).
    const rv = await getView(pAna);
    const rgeo = getGeometry(rv);
    const rHexes = legalRobberHexes(rv, rv.you.id);
    const rWithCards = (id: string): boolean => (rv.players.find((p) => p.id === id)?.resourcesCount ?? 0) > 0;
    const rChosen =
      rHexes.find((h) => robberVictims(rv, rgeo, h, rv.you.id).some(rWithCards)) ??
      rHexes.find((h) => robberVictims(rv, rgeo, h, rv.you.id).length > 0);
    expect(rChosen, 'sem hex com vítima para o ladrão').not.toBeUndefined();
    const rVics = robberVictims(rv, rgeo, rChosen!, rv.you.id);
    const rName = (id: string): string => rv.players.find((p) => p.id === id)?.name ?? id;
    await pAna.locator('g.board-hex polygon.board-hex').nth(rgeo.hexes.findIndex((h) => h.id === rChosen!)).click({ force: true });
    const picker = pAna.getByRole('dialog', { name: 'Roubar — escolha a vítima' });
    await expect
      .poll(
        async () => {
          if ((await pAna.locator('.hist-line').filter({ hasText: 'roubou uma carta' }).count()) > 0) return 'stolen';
          if (await picker.isVisible().catch(() => false)) return 'picker';
          return 'wait';
        },
        { timeout: 20_000 },
      )
      .not.toBe('wait');
    if (await picker.isVisible().catch(() => false)) {
      const rPick = rVics.find(rWithCards) ?? rVics[0]!;
      await picker.locator('button').filter({ hasText: rName(rPick) }).first().click();
    }
    await expect(pAna.locator('.hist-line').filter({ hasText: 'roubou uma carta' })).toBeVisible();
    await expect.poll(() => phaseText(pAna)).toBe(ACTION_PHASE);
    // Mover o ladrão (sem carta) não consome a ação: botões voltam.
    expect(await devButtons(pAna)).toEqual(['btn-dev-knight', 'btn-dev-monopoly']);

    // Joga o Cavaleiro ANTIGO pela UI (hexes do cavaleiro valem em action).
    await pAna.getByRole('button', { name: 'Cavaleiro', exact: true }).click();
    await expect(pAna.getByText('Cavaleiro: escolha o hex do ladrão.')).toBeVisible();
    const kv = await getView(pAna);
    const kgeo = getGeometry(kv);
    const kHexes = legalKnightHexes(kv, kv.you.id);
    expect(kHexes.length).toBeGreaterThan(0);
    const withCards = (id: string): boolean => (kv.players.find((p) => p.id === id)?.resourcesCount ?? 0) > 0;
    const chosen =
      kHexes.find((h) => robberVictims(kv, kgeo, h, kv.you.id).some(withCards)) ??
      kHexes.find((h) => robberVictims(kv, kgeo, h, kv.you.id).length > 0) ??
      kHexes[0]!;
    const kVics = robberVictims(kv, kgeo, chosen, kv.you.id);
    const kName = (id: string): string => kv.players.find((p) => p.id === id)?.name ?? id;
    await pAna.locator('g.board-hex polygon.board-hex').nth(kgeo.hexes.findIndex((h) => h.id === chosen)).click({ force: true });
    const kPicker = pAna.getByRole('dialog', { name: 'Roubar — escolha a vítima' });
    await expect
      .poll(
        async () => {
          if ((await pAna.locator('.hist-line').filter({ hasText: 'Cavaleiro' }).count()) > 0) return 'played';
          if (await kPicker.isVisible().catch(() => false)) return 'picker';
          return 'wait';
        },
        { timeout: 20_000 },
      )
      .not.toBe('wait');
    if (await kPicker.isVisible().catch(() => false)) {
      await kPicker.locator('button').filter({ hasText: kName(kVics[0]!) }).first().click();
    }
    await expect
      .poll(async () => (await getView(pAna)).you.playedActionCardThisTurn)
      .toBe(true);
    await expect.poll(() => phaseText(pAna)).toBe(ACTION_PHASE);
    // Ação do turno consumida pelo cavaleiro: sem botões (caso 3, 2ª via).
    expect(await devButtons(pAna)).toEqual([]);

    await passTurn(pAna, ANA);
    await waitForTurn(pBia, BIA, PRE_ROLL);
    expect(await devButtons(pBia)).toEqual([]);
    const rollB = await emitHook(pBia, { type: 'force_next_dice', d1: 2, d2: 2 });
    expect(rollB.ok, JSON.stringify(rollB.error)).toBe(true);
    await pBia.getByRole('button', { name: 'Rolar dados' }).click();
    await waitForTurn(pBia, BIA, ACTION_PHASE);
    await passTurn(pBia, BIA);
    await waitForTurn(pAna, ANA, PRE_ROLL);
    // Monopoly restante (antiga agora) volta a aparecer.
    expect(await devButtons(pAna)).toEqual(['btn-dev-monopoly']);
  });
});
