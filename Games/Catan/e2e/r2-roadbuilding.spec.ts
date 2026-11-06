// R2-browser: Construção de Estradas — correcao isOwnFreeRoadPhase validada no
// navegador real (cliente + servidor + motor reais).
//
// Correcao sob teste (Games/Catan/src/client/screens/Game.tsx): a fase gratuita
// é fonte da verdade via view (phase dev_road_building + pending.playerId ===
// youId), então a 2ª estrada continua clicável após o send zerar o buildMode
// local e após reload. O dono da pendência evita abrir o modo p/ o adversário.
//
// Preparacao (hooks do servidor, SÓ p/ viabilizar a carta — ver
// tests/e2e/r2-roadbuilding-fixture.ts): seed_rng (deck determinístico com
// roadBuilding no topo das 2 primeiras compras) + force_next_dice em todas as
// rolagens (sem 7/descarte/ladrão). Compras, carta jogada, estradas, finish e
// reload são 100% interacao real pela interface; estado lido via getView (fiber)
// só p/ assercoes. Nenhuma chamada direta a motor/projecao.
//
// Casos:
//  1. lobby + setup snake pela UI (2 jogadoras).
//  2. acumula producao natural e compra 2 Construcao de Estradas pela UI.
//  3. joga a carta pela UI, coloca a 1ª estrada (clicável sem modo local) e
//     confere estado; adversária sem alvos nem botão (owner===youId).
//  4. reload no meio da fase: modo persiste e 2ª estrada conclui (volta à origem).
//  5. finish antecipado ("Concluir estradas") com a 2ª carta: volta à origem sem
//     colocar. (Mesma rota de fuga do caso "sem 2 posicoes válidas"; a rejeicao
//     de aresta ocupada está coberta em tests/engine/devcards.test.ts.)
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  actorName,
  edgeTargetList,
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
import { bestBankRate } from '../src/client/board/legalClient';
import { R2_BOARD_SEED, R2_FREE_ROAD_PHASE, R2_NAMES, R2_RNG_SEED } from '../tests/e2e/r2-roadbuilding-fixture';

const [ANA, BIA] = R2_NAMES;
const ACTION_PHASE = 'Sua fase: troque, construa ou termine o turno';
const PRE_ROLL = 'Antes dos dados';

let ctx: BrowserContext;
let pAna: Page;
let pBia: Page;
let roomCode = '';
let roadsAfterTwo = -1;

function byName(name: string): Page {
  return name === ANA ? pAna : pBia;
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

/** Alvos de estrada gratuita na MESMA ordem do union do Board (DOM ↔ id real). */
async function freeRoadTargets(page: Page): Promise<string[]> {
  const view = await getView(page);
  return edgeTargetList(view, 'road');
}

async function expectFreeRoadDom(page: Page, timeoutMs = 20_000): Promise<string[]> {
  let list: string[] = [];
  await expect
    .poll(
      async () => {
        list = await freeRoadTargets(page);
        if (list.length === 0) return false;
        return (await page.locator('line.hit-edge').count()) === list.length;
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
  return list;
}

test.describe.serial('R2 Construcao de Estradas no navegador', () => {
  test.afterAll(async () => {
    await ctx?.close();
  });

  test('1. lobby + setup snake pela UI', async ({ browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await prepareContext(ctx);

    pAna = await openPage(ctx);
    await expect(pAna.getByRole('heading', { name: 'Catan Deluxe' })).toBeVisible();
    await pAna.getByLabel('Seu apelido').fill(ANA);
    await pAna.getByRole('button', { name: 'Criar sala' }).click();
    await expect(pAna.locator('.code-big')).toBeVisible();
    roomCode = (await pAna.locator('.code-big').innerText()).trim();
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);

    const seedRes = await emitHook(pAna, { type: 'seed_rng', seed: R2_RNG_SEED });
    expect(seedRes.ok, JSON.stringify(seedRes.error)).toBe(true);

    pBia = await openPage(ctx);
    await pBia.getByLabel('Seu apelido').fill(BIA);
    await pBia.getByRole('button', { name: 'Entrar com código' }).click();
    await pBia.locator('#code').fill(roomCode);
    await pBia.getByRole('button', { name: 'Entrar na sala' }).click();
    await expect(pBia.getByText('Jogadores (2/4)')).toBeVisible();
    await pBia.getByRole('button', { name: 'Cor blue', exact: true }).click();
    await expect(pBia.getByRole('button', { name: 'Cor blue', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await pBia.getByRole('button', { name: 'Estou pronto' }).click();
    await pAna.getByRole('button', { name: 'Estou pronto' }).click();
    await pAna.getByLabel('Configuração avançada (seed do tabuleiro)').check();
    await pAna.locator('#seed').fill(R2_BOARD_SEED);
    await pAna.getByRole('button', { name: 'Iniciar partida' }).click();

    for (const page of [pAna, pBia]) {
      await expect(page.getByRole('img', { name: 'Tabuleiro de Catan' })).toBeVisible();
      await expect(page.locator('g.board-hex')).toHaveCount(19);
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
  });

  test('2. producao natural e 2 compras de Construcao de Estradas pela UI', async ({}, testInfo) => {
    testInfo.setTimeout(420_000);
    type View = Awaited<ReturnType<typeof getView>>;
    const hasTrio = (v: View): boolean =>
      v.you.resources.wool >= 1 && v.you.resources.grain >= 1 && v.you.resources.ore >= 1;
    const rbCount = (v: View): number =>
      v.you.devCards.filter((c) => c.kind === 'roadBuilding').length;

    // Troca marítima pela UI p/ fechar o trio (tabuleiro pode não dar os 3 recursos).
    async function bankTradeForTrio(): Promise<boolean> {
      const v = await getView(pAna);
      const missing = (['wool', 'grain', 'ore'] as const).find((k) => v.you.resources[k] < 1);
      if (!missing) return true;
      // Taxa clássica: vale pelo recurso ENTREGUE (give), como o motor valida.
      const give = (['brick', 'lumber', 'wool', 'grain', 'ore'] as const).find((k) => {
        if (k === missing) return false;
        const reserve = k === 'wool' || k === 'grain' || k === 'ore' ? 1 : 0;
        return v.you.resources[k] - reserve >= bestBankRate(v, k);
      });
      if (!give) return false;
      const rate = bestBankRate(v, give);
      await pAna.getByRole('button', { name: 'Trocar com banco' }).click();
      const modal = pAna.getByRole('dialog', { name: 'Trocar com o banco (marítima)' });
      await expect(modal).toBeVisible();
      await modal.getByRole('radiogroup', { name: 'Recurso entregue' }).locator('button').nth(resourceIndexForModal(give)).click();
      await modal.getByRole('radiogroup', { name: 'Recurso recebido' }).locator('button').nth(resourceIndexForModal(missing)).click();
      await expect(modal.getByRole('button', { name: `Trocar ${rate}:1` })).toBeEnabled();
      await modal.getByRole('button', { name: `Trocar ${rate}:1` }).click();
      await expect(modal).toBeHidden();
      return true;
    }

    const exclude: number[] = [];
    let stall = 0;
    for (let i = 0; i < 150; i += 1) {
      const viewA = await getView(pAna);
      if (rbCount(viewA) >= 2) break;
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
          if (rbCount(v) < 2) {
            if (!hasTrio(v)) await bankTradeForTrio();
            const w = await getView(pAna);
            if (rbCount(w) < 2 && hasTrio(w)) {
              const before = w.you.devCards.length;
              await expect(pAna.getByRole('button', { name: 'Desenvolvimento' })).toBeEnabled();
              await pAna.getByRole('button', { name: 'Desenvolvimento' }).click();
              await expect
                .poll(async () => (await getView(pAna)).you.devCards.length)
                .toBe(before + 1);
            } else if (rbCount(w) >= 2) {
              await page.getByRole('button', { name: 'Fim de turno' }).click();
              await expect.poll(() => actorName(pAna)).not.toBe(actor);
            } else {
              await page.getByRole('button', { name: 'Fim de turno' }).click();
              await expect.poll(() => actorName(pAna)).not.toBe(actor);
            }
          } else {
            await page.getByRole('button', { name: 'Fim de turno' }).click();
            await expect.poll(() => actorName(pAna)).not.toBe(actor);
          }
        } else {
          await page.getByRole('button', { name: 'Fim de turno' }).click();
          await expect.poll(() => actorName(pAna)).not.toBe(actor);
        }
      }
      if (i === 149) throw new Error('R2-Ana nunca acumulou 2 Construcao de Estradas');
    }

    // Fail-fast da premissa do deck determinístico: as 2 primeiras compras são RB.
    const bought = (await getView(pAna)).you.devCards;
    expect(bought).toHaveLength(2);
    expect(bought.filter((c) => c.kind === 'roadBuilding')).toHaveLength(2);
    await expect(pAna.getByRole('heading', { name: 'Vitória!' })).toBeHidden();

    // Passa o turno p/ R2-Bia rolar e devolver (a carta só pode ser jogada no turno seguinte).
    await pAna.getByRole('button', { name: 'Fim de turno' }).click();
    await waitForTurn(pBia, BIA, PRE_ROLL);
    const pass = await emitHook(pBia, { type: 'force_next_dice', d1: 2, d2: 2 });
    expect(pass.ok, JSON.stringify(pass.error)).toBe(true);
    await pBia.getByRole('button', { name: 'Rolar dados' }).click();
    await waitForTurn(pBia, BIA, ACTION_PHASE);
    await pBia.getByRole('button', { name: 'Fim de turno' }).click();
    await waitForTurn(pAna, ANA, PRE_ROLL);
  });

  test('3. joga a carta e coloca a 1a estrada gratuita pela UI', async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    await waitForTurn(pAna, ANA, PRE_ROLL);
    await expect(pAna.getByRole('button', { name: /Construção de Estradas/ })).toBeEnabled();
    await pAna.getByRole('button', { name: /Construção de Estradas/ }).click();

    for (const page of [pAna, pBia]) {
      await expect.poll(() => phaseText(page)).toBe(R2_FREE_ROAD_PHASE);
    }
    await expect(pAna.locator('.turn-hint').filter({ hasText: 'Restam 2' }).first()).toBeVisible();
    await expect(pAna.getByText('Estradas gratuitas: clique nas arestas destacadas.')).toBeVisible();

    const list = await expectFreeRoadDom(pAna);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Adversária (não-dona da pendência): sem alvos e sem botão de concluir.
    expect(await pBia.locator('line.hit-edge').count()).toBe(0);
    expect(await pBia.getByRole('button', { name: 'Concluir estradas' }).count()).toBe(0);

    // Posições inválidas (arestas já ocupadas) não são oferecidas como alvo.
    const view0 = await getView(pAna);
    const occupied = new Set(view0.board.roads.map((r) => r.edgeId));
    expect(list.filter((e) => occupied.has(e))).toEqual([]);
    const roadsBefore = view0.board.roads.length;

    // PROVA-1 da correção: a aresta clica e abre confirmação SEM modo local
    // (o send zerou o buildMode; só a fase da view sustenta o boardMode edge).
    await pAna.locator('line.hit-edge').nth(0).click({ force: true });
    await expect(pAna.getByRole('button', { name: 'Confirmar jogada' })).toBeVisible();
    await pAna.getByRole('button', { name: 'Confirmar jogada' }).click();

    await expect(pAna.locator('.turn-hint').filter({ hasText: 'Restam 1' }).first()).toBeVisible();
    const view1 = await getView(pAna);
    expect(view1.phase).toBe('dev_road_building');
    expect(view1.pending).toMatchObject({ type: 'road_building', roadsLeft: 1 });
    expect(view1.board.roads.length).toBe(roadsBefore + 1);
    // A aresta ocupada sai dos alvos; ainda há alvos p/ a 2ª.
    const list1 = await expectFreeRoadDom(pAna);
    expect(list1.length).toBeGreaterThanOrEqual(1);
    expect(list1).not.toContain(list[0]);
  });

  test('4. reload no meio da fase e 2a estrada conclui', async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    const roadsBefore = (await getView(pAna)).board.roads.length;
    await pAna.reload();
    await expect(pAna.getByRole('img', { name: 'Tabuleiro de Catan' })).toBeVisible();
    // PROVA-2: fase + pendência com dono sobrevivem ao reload (sessão retoma) e os
    // alvos voltam sem reentrar em modo nenhum.
    await expect.poll(() => phaseText(pAna)).toBe(R2_FREE_ROAD_PHASE);
    await expect(pAna.locator('.turn-hint').filter({ hasText: 'Restam 1' }).first()).toBeVisible();
    const list = await expectFreeRoadDom(pAna);
    await pAna.locator('line.hit-edge').nth(0).click({ force: true });
    await expect(pAna.getByRole('button', { name: 'Confirmar jogada' })).toBeVisible();
    await pAna.getByRole('button', { name: 'Confirmar jogada' }).click();

    // Volta à fase de origem (pre_roll): sem pendência, +2 estradas no total.
    await expect.poll(() => phaseText(pAna)).toBe(PRE_ROLL);
    const view = await getView(pAna);
    expect(view.pending).toBeNull();
    expect(view.board.roads.length).toBe(roadsBefore + 1);
    expect(view.board.roads.filter((r) => r.playerId === view.you.id).length).toBeGreaterThanOrEqual(4);
    roadsAfterTwo = view.board.roads.length;
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  test('5. finish antecipado com a 2a carta volta a origem sem colocar', async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    // Limite do motor: 1 carta de ação por turno (a 1ª foi jogada neste turno);
    // a 2ª carta exige o turno seguinte: passa por Bia e volta p/ Ana.
    await waitForTurn(pAna, ANA, PRE_ROLL);
    let pass = await emitHook(pAna, { type: 'force_next_dice', d1: 2, d2: 2 });
    expect(pass.ok, JSON.stringify(pass.error)).toBe(true);
    await pAna.getByRole('button', { name: 'Rolar dados' }).click();
    await waitForTurn(pAna, ANA, ACTION_PHASE);
    await pAna.getByRole('button', { name: 'Fim de turno' }).click();
    await waitForTurn(pBia, BIA, PRE_ROLL);
    pass = await emitHook(pBia, { type: 'force_next_dice', d1: 2, d2: 2 });
    expect(pass.ok, JSON.stringify(pass.error)).toBe(true);
    await pBia.getByRole('button', { name: 'Rolar dados' }).click();
    await waitForTurn(pBia, BIA, ACTION_PHASE);
    await pBia.getByRole('button', { name: 'Fim de turno' }).click();
    await waitForTurn(pAna, ANA, PRE_ROLL);
    pass = await emitHook(pAna, { type: 'force_next_dice', d1: 2, d2: 2 });
    expect(pass.ok, JSON.stringify(pass.error)).toBe(true);
    await pAna.getByRole('button', { name: 'Rolar dados' }).click();
    await waitForTurn(pAna, ANA, ACTION_PHASE);

    await expect(pAna.getByRole('button', { name: /Construção de Estradas/ })).toBeEnabled();
    await pAna.getByRole('button', { name: /Construção de Estradas/ }).click();
    await expect.poll(() => phaseText(pAna)).toBe(R2_FREE_ROAD_PHASE);
    await expect(pAna.locator('.turn-hint').filter({ hasText: 'Restam 2' }).first()).toBeVisible();
    await expectFreeRoadDom(pAna);

    await pAna.getByRole('button', { name: 'Concluir estradas' }).click();
    await expect.poll(() => phaseText(pAna)).toBe(ACTION_PHASE);
    const view = await getView(pAna);
    expect(view.pending).toBeNull();
    expect(view.board.roads.length).toBe(roadsAfterTwo);
  });
});
