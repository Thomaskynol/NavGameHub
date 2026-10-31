// Testes E2E do Catan Deluxe — servidor real + cliente real (sem mock).
//
// Cenários (serial):
//  1. Lobby multiplayer: 3 abas (mesmo contexto), cores, prontidão, anfitrião inicia.
//  2. Partida completa via UI: setup snake guiado, dados, produção acumulada,
//     desenvolvimento, troca marítima, 7 forçado (descarte + ladrão + roubo),
//     fixture de vitória + construção → Resultado nas 3 abas.
//  3. Sessão em 2º contexto: claim com conflito UI → takeover → reload com resume.
//  4. Robustez: chat entre abas, código de sala inexistente → toast amigável.
//
// Hooks de teste do servidor (evento `hook`) só para: seed_rng, force_next_dice e
// load_near_win_fixture. Ações normais de jogo são feitas pela UI.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  actorName,
  anyDiscardVisible,
  bankPlan,
  coversDevTrio,
  dismissDiscards,
  edgeTargetList,
  emitHook,
  getView,
  handTotal,
  phaseText,
  pickVictimHex,
  prepareContext,
  productiveNumber,
  openPage,
  resourceIndexForModal,
  ROOM_SEED,
  roadEdgeIndex,
  setupVertexIndex,
  splitDice,
  vertexTargetList,
  waitForTurn,
} from './helpers';

const NAMES = ['Ana', 'Bia', 'Caio'] as const;

let ctx1: BrowserContext;
const p: Record<(typeof NAMES)[number], Page> = { Ana: null as unknown as Page, Bia: null as unknown as Page, Caio: null as unknown as Page };
let roomCode = '';
let recoveryCode = '';

async function copyRecovery(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Copiar recuperação' }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

function resultHeading(page: Page) {
  return page.getByRole('heading', { name: 'Vitória!' });
}

test.describe.serial('Catan E2E', () => {
  test.afterAll(async () => {
    await ctx1?.close();
  });

  test('1. Lobby: criar sala, 2 jogadores entram, cores, prontos, anfitrião inicia', async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    ctx1 = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx1.grantPermissions(['clipboard-read', 'clipboard-write']);
    await prepareContext(ctx1);

    // Page1 cria sala e anota código + recovery (via botão de copiar da UI).
    p.Ana = await openPage(ctx1);
    await expect(p.Ana.getByRole('heading', { name: 'Catan Deluxe' })).toBeVisible();
    await p.Ana.screenshot({ path: 'screenshots/home.png' });
    await p.Ana.getByLabel('Seu apelido').fill('Ana');
    await expect(p.Ana.getByRole('button', { name: 'Criar sala' })).toBeEnabled();
    await p.Ana.getByRole('button', { name: 'Criar sala' }).click();
    await expect(p.Ana.locator('.code-big')).toBeVisible();
    roomCode = (await p.Ana.locator('.code-big').innerText()).trim();
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);
    recoveryCode = await copyRecovery(p.Ana);
    expect(recoveryCode.length).toBeGreaterThan(20);

    // Seed determinístico do RNG do servidor (hook) — permitido pelo escopo dos testes.
    const seedRes = await emitHook(p.Ana, { type: 'seed_rng', seed: ROOM_SEED });
    expect(seedRes.ok, JSON.stringify(seedRes.error)).toBe(true);

    // Page2 e Page3 entram com o código.
    const joiners: [name: (typeof NAMES)[number], count: number][] = [
      ['Bia', 2],
      ['Caio', 3],
    ];
    for (const [name, count] of joiners) {
      p[name] = await openPage(ctx1);
      await p[name].getByLabel('Seu apelido').fill(name);
      await p[name].getByRole('button', { name: 'Entrar com código' }).click();
      await p[name].locator('#code').fill(roomCode);
      await p[name].getByRole('button', { name: 'Entrar na sala' }).click();
      await expect(p[name].getByText(`Jogadores (${count}/4)`)).toBeVisible();
    }
    await expect(p.Ana.getByText('Jogadores (3/4)')).toBeVisible();

    // Cores distintas escolhidas pela UI (Bia→azul, Caio→laranja; anfitrião fica vermelho).
    await p.Bia.getByRole('button', { name: 'Cor blue', exact: true }).click();
    await expect(p.Bia.getByRole('button', { name: 'Cor blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await p.Caio.getByRole('button', { name: 'Cor orange', exact: true }).click();
    await expect(p.Caio.getByRole('button', { name: 'Cor orange', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const dots = await p.Ana.locator('.player-row .pc-dot').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(new Set(dots).size).toBe(3);

    // Todos marcam pronto (inclusive anfitrião) e o anfitrião inicia.
    await p.Bia.getByRole('button', { name: 'Estou pronto' }).click();
    await p.Caio.getByRole('button', { name: 'Estou pronto' }).click();
    await p.Ana.getByRole('button', { name: 'Estou pronto' }).click();
    await expect(p.Ana.locator('.player-row .tag').filter({ hasText: 'pronto' })).toHaveCount(3);

    // Seed do tabuleiro pela UI (Configuração avançada).
    await p.Ana.getByLabel('Configuração avançada (seed do tabuleiro)').check();
    await p.Ana.locator('#seed').fill(ROOM_SEED);

    await p.Ana.screenshot({ path: 'screenshots/lobby.png' });

    const startBtn = p.Ana.getByRole('button', { name: 'Iniciar partida' });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // As 3 abas veem o tabuleiro (19 hexes, 18 fichas) e a vez do primeiro jogador.
    for (const name of NAMES) {
      await expect(p[name].getByRole('img', { name: 'Tabuleiro de Catan' })).toBeVisible();
      await expect(p[name].locator('g.board-hex')).toHaveCount(19);
      await expect(p[name].locator('svg circle[r="14.5"]')).toHaveCount(18);
      await p[name].getByText('Coloque um assentamento').first().waitFor();
      await expect.poll(() => actorName(p[name])).toBe('Ana');
    }
  });

  test('2. Partida completa: setup, dados, dev, troca, 7+descarte+ladrão, fixture e vitória', async ({ browser: _browser }, testInfo) => {
    testInfo.setTimeout(420_000);
    const pages = NAMES.map((n) => p[n]);
    const byName = (n: string): Page => (p as Record<string, Page>)[n];

    // ---- Setup snake guiado pela UI (12 colocações) ----
    // Durante o setup o `activePlayerId` não anda (fila usa setupCurrentPlayerId),
    // então o ator real é a ÚNICA aba que recebe destaques legais no tabuleiro.
    const setupActorPage = async (phase: string): Promise<Page> => {
      const sel = phase.includes('estrada') ? 'line.hit-edge' : 'circle.hit-vertex';
      for (const name of NAMES) {
        if ((await p[name].locator(sel).count()) > 0) return p[name];
      }
      await expect
        .poll(
          async () => {
            for (const name of NAMES) {
              if ((await p[name].locator(sel).count()) > 0) return true;
            }
            return false;
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      for (const name of NAMES) {
        if ((await p[name].locator(sel).count()) > 0) return p[name];
      }
      throw new Error(`nenhuma aba com alvos de setup (${sel})`);
    };

    for (let step = 0; step < 14; step += 1) {
      const phase = await phaseText(p.Ana);
      if (phase === 'Antes dos dados') break;
      const page = await setupActorPage(phase);
      const beforeSig = phase;
      if (phase.includes('estrada')) {
        // Linhas SVG verticais têm bbox de largura 0 (ocultas p/ Playwright): espera por contagem.
        await expect.poll(async () => page.locator('line.hit-edge').count()).toBeGreaterThan(0);
        await page.locator('line.hit-edge').first().click({ force: true });
      } else {
        expect(phase).toContain('assentamento');
        await expect.poll(async () => page.locator('circle.hit-vertex').count()).toBeGreaterThan(0);
        // View e DOM precisam concordar (mesma contagem de alvos) antes de escolher o índice.
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
      await expect.poll(() => phaseText(p.Ana)).not.toBe(beforeSig);
    }
    await expect.poll(() => phaseText(p.Ana)).toBe('Antes dos dados');
    for (const name of NAMES) {
      await expect.poll(() => actorName(p[name])).toBe('Ana');
      await expect(p[name].locator('.pcard')).toHaveCount(3);
    }

    // ---- Rolagem de produção com valor forçado (hook) + histórico ----
    const diceRes = await emitHook(p.Ana, { type: 'force_next_dice', d1: 5, d2: 3 });
    expect(diceRes.ok, JSON.stringify(diceRes.error)).toBe(true);
    await expect(p.Ana.getByRole('button', { name: 'Rolar dados' })).toBeEnabled();
    await p.Ana.getByRole('button', { name: 'Rolar dados' }).click();
    await expect(p.Ana.locator('.dice-pair')).toHaveAttribute('aria-label', 'Dados: 5 e 3');
    await expect(p.Ana.locator('.hist-line').filter({ hasText: 'rolou 5+3=8' })).toHaveCount(1);
    await expect(p.Bia.locator('.hist-line').filter({ hasText: 'rolou 5+3=8' })).toHaveCount(1);
    await p.Ana.screenshot({ path: 'screenshots/jogo.png' });

    // ---- Alvo de dev+troca: jogador com minério+grão+lã adjacentes (preferência: Bia) ----
    let target: (typeof NAMES)[number] | null = null;
    for (const name of ['Bia', 'Caio', 'Ana'] as const) {
      if (coversDevTrio(await getView(p[name]))) {
        target = name;
        break;
      }
    }
    expect(target, 'nenhum jogador ficou com minério+grão+lã adjacentes após o setup').not.toBeNull();
    const tgt = p[target!];

    // ---- Acumulação via produções naturais (rolls forçados) até o alvo fechar dev+troca ----
    const exclude: number[] = [];
    let stall = 0;
    let lastTotal = -1;
    let plan = null as Awaited<ReturnType<typeof bankPlan>>;
    for (let i = 0; i < 90; i += 1) {
      const actor = await actorName(p.Ana);
      const phase = await phaseText(p.Ana);
      const page = byName(actor);
      if (phase === 'Antes dos dados') {
        const viewT = await getView(tgt);
        const n = productiveNumber(viewT, viewT.you.id, exclude);
        const before = handTotal(viewT);
        const { d1, d2 } = splitDice(n);
        const res = await emitHook(page, { type: 'force_next_dice', d1, d2 });
        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        await page.getByRole('button', { name: 'Rolar dados' }).click();
        await expect.poll(() => phaseText(page)).not.toBe('Antes dos dados');
        const after = handTotal(await getView(tgt));
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
        lastTotal = after;
      } else if (actor === target && phase.startsWith('Sua fase')) {
        plan = bankPlan(await getView(tgt));
        if (plan) break;
        await page.getByRole('button', { name: 'Fim de turno' }).click();
        await expect.poll(() => actorName(p.Ana)).not.toBe(target!);
      } else {
        await page.getByRole('button', { name: 'Fim de turno' }).click();
        await expect.poll(() => actorName(p.Ana)).not.toBe(actor);
      }
    }
    expect(plan, `mão de ${target} nunca fechou dev+troca (último total=${lastTotal})`).not.toBeNull();

    // ---- Compra de desenvolvimento via UI ----
    await expect(tgt.getByRole('button', { name: 'Desenvolvimento' })).toBeEnabled();
    await tgt.getByRole('button', { name: 'Desenvolvimento' }).click();
    await expect(tgt.getByText('Desenvolvimentos (1)')).toBeVisible();
    await expect(tgt.locator('.hist-line').filter({ hasText: 'comprou uma carta de desenvolvimento' })).toBeVisible();
    await expect(p.Ana.locator('.hist-line').filter({ hasText: 'comprou uma carta de desenvolvimento' })).toBeVisible();

    // ---- Troca marítima via modal (taxa do recurso recebido) ----
    const trade = plan!;
    await tgt.getByRole('button', { name: 'Trocar com banco' }).click();
    const modal = tgt.getByRole('dialog', { name: 'Trocar com o banco (marítima)' });
    await expect(modal).toBeVisible();
    await modal.getByRole('radiogroup', { name: 'Recurso entregue' }).locator('button').nth(resourceIndexForModal(trade.give)).click();
    await modal.getByRole('radiogroup', { name: 'Recurso recebido' }).locator('button').nth(resourceIndexForModal(trade.want)).click();
    await expect(modal.getByRole('button', { name: `Trocar ${trade.rate}:1` })).toBeEnabled();
    await modal.getByRole('button', { name: `Trocar ${trade.rate}:1` }).click();
    await expect(modal).toBeHidden();
    await expect(tgt.locator('.hist-line').filter({ hasText: 'trocou no banco' })).toBeVisible();
    await expect(p.Ana.locator('.hist-line').filter({ hasText: 'trocou no banco' })).toBeVisible();

    // ---- 7 forçado no próximo rolamento: descarte obrigatório + ladrão + roubo ----
    const sevenRes = await emitHook(tgt, { type: 'force_next_dice', d1: 3, d2: 4 });
    expect(sevenRes.ok, JSON.stringify(sevenRes.error)).toBe(true);
    await tgt.getByRole('button', { name: 'Fim de turno' }).click();
    // O jogador seguinte rola (é o rolamento que dispara o 7 forçado).
    await expect.poll(() => actorName(p.Ana)).not.toBe(target!);
    const nextName = await actorName(p.Ana);
    const nextPage = byName(nextName);
    await waitForTurn(nextPage, nextName, 'Antes dos dados');
    await nextPage.getByRole('button', { name: 'Rolar dados' }).click();

    await expect
      .poll(
        async () => {
          if (await anyDiscardVisible(pages)) return 'discard';
          return (await phaseText(p.Ana)) === 'Mova o ladrão' ? 'robber' : 'wait';
        },
        { timeout: 30_000 },
      )
      .not.toBe('wait');
    await dismissDiscards(pages);
    await expect.poll(() => phaseText(p.Ana)).toBe('Mova o ladrão');

    // O jogador que rolou o 7 (próximo após o alvo) move o ladrão para hex com vítima com cartas.
    const robberActor = await actorName(p.Ana);
    const robberPage = byName(robberActor);
    await waitForTurn(robberPage, robberActor, 'Mova o ladrão');
    let victim: { hexIndex: number; victimId: string; victimName: string; victims: number } | null = null;
    await expect
      .poll(
        async () => {
          victim = pickVictimHex(await getView(robberPage));
          return victim !== null;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await robberPage.locator('g.board-hex polygon.board-hex').nth(victim!.hexIndex).click({ force: true });
    const picker = robberPage.getByRole('dialog', { name: 'Roubar — escolha a vítima' });
    await expect
      .poll(
        async () => {
          if ((await robberPage.locator('.hist-line').filter({ hasText: 'roubou uma carta' }).count()) > 0) return 'stolen';
          if (await picker.isVisible().catch(() => false)) return 'picker';
          return 'wait';
        },
        { timeout: 20_000 },
      )
      .not.toBe('wait');
    if (await picker.isVisible().catch(() => false)) {
      await picker.locator('button').filter({ hasText: victim!.victimName }).first().click();
    }
    await expect(robberPage.locator('.hist-line').filter({ hasText: 'roubou uma carta' })).toBeVisible();
    await expect(p.Ana.locator('.hist-line').filter({ hasText: 'roubou uma carta' })).toBeVisible();

    // ---- Turno de Ana: fixture de vitória + construção pela UI ----
    if (robberActor !== 'Ana') {
      await robberPage.getByRole('button', { name: 'Fim de turno' }).click();
      await waitForTurn(p.Ana, 'Ana', 'Antes dos dados');
      const rollRes = await emitHook(p.Ana, { type: 'force_next_dice', d1: 2, d2: 2 });
      expect(rollRes.ok, JSON.stringify(rollRes.error)).toBe(true);
      await p.Ana.getByRole('button', { name: 'Rolar dados' }).click();
    }
    await expect.poll(() => phaseText(p.Ana)).toBe('Sua fase: troque, construa ou termine o turno');

    const fixtureRes = await emitHook(p.Ana, { type: 'load_near_win_fixture' });
    expect(fixtureRes.ok, JSON.stringify(fixtureRes.error)).toBe(true);
    // Espera via UI (pcard do jogador = você): fixture instala exatamente 17 cartas.
    await expect(p.Ana.locator('.pcard').first().locator('.pstats span[aria-label$="recursos"]')).toHaveAttribute(
      'aria-label',
      '17 recursos',
      { timeout: 20_000 },
    );
    expect(handTotal(await getView(p.Ana))).toBe(17);

    const builds = [
      { label: 'Estrada', kind: 'road' as const, hist: 'construiu uma estrada' },
      { label: 'Assentamento', kind: 'settlement' as const, hist: 'construiu um assentamento' },
      { label: 'Cidade', kind: 'city' as const, hist: 'construiu uma cidade' },
    ];
    for (const b of builds) {
      if (await resultHeading(p.Ana).isVisible().catch(() => false)) break;
      const btn = p.Ana.getByRole('button', { name: b.label, exact: true });
      await expect(btn).toBeEnabled();
      await btn.click();
      // Espera a view do cliente e o DOM concordarem (mesma contagem de alvos) antes de clicar.
      if (b.kind === 'road') {
        let idx = 0;
        await expect
          .poll(async () => {
            const view = await getView(p.Ana);
            const edges = edgeTargetList(view, 'road');
            if (edges.length === 0) return false;
            if ((await p.Ana.locator('line.hit-edge').count()) !== edges.length) return false;
            idx = roadEdgeIndex(view);
            return true;
          })
          .toBe(true);
        await p.Ana.locator('line.hit-edge').nth(idx).click({ force: true });
      } else {
        await expect
          .poll(async () => {
            const view = await getView(p.Ana);
            const verts = vertexTargetList(view, b.kind);
            return verts.length > 0 && (await p.Ana.locator('circle.hit-vertex').count()) === verts.length;
          })
          .toBe(true);
        await p.Ana.locator('circle.hit-vertex').nth(0).click({ force: true });
      }
      await p.Ana.getByRole('button', { name: 'Confirmar jogada' }).click();
      await expect(p.Ana.locator('.hist-line').filter({ hasText: b.hist })).toBeVisible();
    }

    // ---- Resultado nas 3 abas ----
    await expect(resultHeading(p.Ana)).toBeVisible();
    await expect(p.Bia.getByRole('heading', { name: /venceu/ })).toBeVisible();
    await expect(p.Caio.getByRole('heading', { name: /venceu/ })).toBeVisible();
    for (const name of NAMES) {
      await expect(p[name].getByRole('button', { name: 'Nova partida com o grupo' })).toBeVisible();
      await expect(p[name].locator('.result-scores .result-row')).toHaveCount(3);
    }
    await p.Ana.screenshot({ path: 'screenshots/resultado.png' });
  });

  test('3. Sessão em outro contexto: conflito de resume, takeover e reload', async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    try {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      await prepareContext(ctx);
      const pA = await openPage(ctx);
      const pB = await openPage(ctx);

      await pA.getByLabel('Seu apelido').fill('Davi');
      await pA.getByRole('button', { name: 'Criar sala' }).click();
      await expect(pA.locator('.code-big')).toBeVisible();
      const code = (await pA.locator('.code-big').innerText()).trim();
      const rec = await copyRecovery(pA);

      // PageB tenta resume (claim) com o recovery → conflito UI (bind_conflict).
      await pB.getByLabel('Seu apelido').fill('Eva');
      await pB.getByText('Já tenho uma sala — recuperar sessão').click();
      await pB.locator('#rec-room').fill(code);
      await pB.locator('#rec-code').fill(rec);
      await pB.getByRole('button', { name: 'Recuperar sessão' }).click();
      const conflict = pB.getByRole('dialog', { name: 'Sessão ativa em outra aba ou dispositivo' });
      await expect(conflict).toBeVisible();

      // Takeover: PageB assume; PageA recebe "sessão substituída".
      await pB.getByRole('button', { name: 'Recuperar controle' }).click();
      await expect(pB.locator('.code-big')).toHaveText(code);
      await expect(pB.getByText('Jogadores (1/4)')).toBeVisible();
      await expect(pA.getByRole('dialog', { name: 'Sessão substituída' })).toBeVisible();

      // Reload da PageB: resume automático preserva a sessão.
      await pB.reload();
      const conflict2 = pB.getByRole('dialog', { name: 'Sessão ativa em outra aba ou dispositivo' });
      await expect(conflict2.or(pB.getByText('Jogadores (1/4)'))).toBeVisible();
      if (await conflict2.isVisible().catch(() => false)) {
        await pB.getByRole('button', { name: 'Recuperar controle' }).click();
      }
      await expect(pB.getByText('Jogadores (1/4)')).toBeVisible();
      await expect(pB.locator('.code-big')).toHaveText(code);
    } finally {
      await ctx.close();
    }
  });

  test('4. Robustez: chat entre abas e código de sala inexistente', async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    try {
      await prepareContext(ctx);
      const q1 = await openPage(ctx);
      const q2 = await openPage(ctx);

      await q1.getByLabel('Seu apelido').fill('Fio');
      await q1.getByRole('button', { name: 'Criar sala' }).click();
      await expect(q1.locator('.code-big')).toBeVisible();
      const code = (await q1.locator('.code-big').innerText()).trim();

      await q2.getByLabel('Seu apelido').fill('Gia');
      await q2.getByRole('button', { name: 'Entrar com código' }).click();
      await q2.locator('#code').fill(code);
      await q2.getByRole('button', { name: 'Entrar na sala' }).click();
      await expect(q2.getByText('Jogadores (2/4)')).toBeVisible();

      // Chat: mensagem enviada numa aba aparece na outra (broadcast de estado).
      await q2.getByLabel('Mensagem da conversa').fill('ola da outra aba');
      await q2.getByRole('button', { name: 'Enviar' }).click();
      await expect(q1.locator('.chat-log').filter({ hasText: 'ola da outra aba' })).toBeVisible();
      await expect(q2.locator('.chat-log').filter({ hasText: 'ola da outra aba' })).toBeVisible();

      // Código de sala inexistente → toast amigável.
      const q3 = await openPage(ctx);
      await q3.getByLabel('Seu apelido').fill('Ze');
      await q3.getByRole('button', { name: 'Entrar com código' }).click();
      await q3.locator('#code').fill('ZZZZZ');
      await q3.getByRole('button', { name: 'Entrar na sala' }).click();
      await expect(q3.locator('.toast-stack .toast').filter({ hasText: 'Sala não encontrada.' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
