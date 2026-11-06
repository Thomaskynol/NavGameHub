// Helpers compartilhados dos testes E2E (Playwright).
//
// Acesso ao socket do cliente: o socket real fica dentro do React (useRef em App);
// os testes o localizam via walk dos fibers a partir de #root (EXPANDO do React)
// e o guardam em window.__catanSock. Uso permitido SOMENTE para os hooks de teste
// do servidor (force_next_dice / seed_rng / load_near_win_fixture).
//
// Escolhas de tabuleiro (vértice/aresta/hex) são calculadas em Node com os MESMOS
// módulos puros que o cliente usa para os destaques (src/client/board/legalClient),
// replicando a ordem de union do Board para casar índice do locator DOM ↔ id real.
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { GameView } from '../src/shared/protocol';
import { bestBankRate, getGeometry, legalBuildTargets, legalRobberHexes, robberVictims } from '../src/client/board/legalClient';
import { generateBoard } from '../src/engine/mapgen';
import { RESOURCE_KINDS, type EdgeId, type PlayerId, type ResourceKind, type VertexId } from '../src/shared/constants';
import type { BoardLayout, HexTile } from '../src/shared/types';

export const ROOM_SEED = 'e2e-seed-01';
const PREFS_JSON = JSON.stringify({ volume: 0, muted: true, reduceMotion: true, tutorialSeen: true, nickname: '' });

// Topologia MOTOR (fonte de verdade do servidor). A geometria do cliente
// (src/client/board/geometry.ts) associa cada canto aos mesmos tiles do motor
// (motorCornerId sobre axialToCube(q, r) — regressão coberta em
// tests/client/geometry.test.ts); usá-la para hex↔vértice é seguro.
const boardCache = new Map<string, BoardLayout>();
function motorBoard(view: GameView): BoardLayout {
  let b = boardCache.get(view.board.seed);
  if (!b) {
    b = generateBoard(view.board.seed);
    boardCache.set(view.board.seed, b);
  }
  return b;
}

function adjacentTiles(view: GameView, vertexId: VertexId): HexTile[] {
  const b = motorBoard(view);
  const out: HexTile[] = [];
  for (const hid of b.vertexHexes[vertexId] ?? []) {
    const t = view.board.hexes.find((h) => h.id === hid);
    if (t) out.push(t);
  }
  return out;
}

function neighborVertices(view: GameView, vertexId: VertexId): VertexId[] {
  const b = motorBoard(view);
  const out: VertexId[] = [];
  for (const e of b.vertexEdges[vertexId] ?? []) {
    const [a, c] = b.edgeEndpoints[e];
    out.push(a === vertexId ? c : a);
  }
  return out;
}

/** Injeta preferências (sem tutorial/movimento) + bootstrap do socket via fiber. */
export async function prepareContext(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript((prefs: string) => {
    try {
      localStorage.setItem('catan:prefs', prefs);
    } catch {
      /* storage indisponível */
    }
  }, PREFS_JSON);
  await ctx.addInitScript(`
    window.__catanBootSocket = function () {
      if (window.__catanSock) return window.__catanSock;
      var root = document.getElementById('root');
      if (!root) return null;
      var key = Object.keys(root).find(function (k) { return k.indexOf('__reactContainer$') === 0; });
      if (!key) return null;
      // O fiber do container alterna com o tempo; o fiber ATUAL é stateNode.current (FiberRoot).
      var start = root[key];
      if (start && start.stateNode && start.stateNode.current) start = start.stateNode.current;
      var isSock = function (v) {
        return v && typeof v === 'object' && typeof v.emit === 'function' && typeof v.on === 'function' && typeof v.connected === 'boolean';
      };
      var q = [start];
      var seen = new Set();
      while (q.length) {
        var f = q.shift();
        if (!f || seen.has(f)) continue;
        seen.add(f);
        var h = f.memoizedState;
        while (h) {
          var ms = h.memoizedState;
          if (ms && typeof ms === 'object') {
            if (isSock(ms)) { window.__catanSock = ms; return ms; }
            if (isSock(ms.current)) { window.__catanSock = ms.current; return ms.current; }
          }
          h = h.next;
        }
        if (f.child) q.push(f.child);
        if (f.sibling) q.push(f.sibling);
      }
      return null;
    };
  `);
}

export async function openPage(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto('/');
  return p;
}

// ---------- socket (somente hooks de teste) ----------

export async function emitHook(page: Page, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: { message: string } }> {
  return page.evaluate(async (p) => {
    const w = window as unknown as {
      __catanBootSocket?: () => { emit: (ev: string, data: unknown, ack: (res: unknown) => void) => void } | null;
      __catanSock?: { emit: (ev: string, data: unknown, ack: (res: unknown) => void) => void };
    };
    const sock = w.__catanSock ?? w.__catanBootSocket?.() ?? null;
    if (!sock) return { ok: false, error: { message: 'socket do cliente não encontrado (fiber walk falhou)' } };
    return await new Promise<{ ok: boolean; error?: { message: string } }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: { message: 'timeout aguardando ack do hook' } }), 8000);
      sock.emit('hook', p, (res: unknown) => {
        clearTimeout(timer);
        resolve(res as { ok: boolean; error?: { message: string } });
      });
    });
  }, payload);
}

export async function getView(page: Page): Promise<GameView> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('sem #root');
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) throw new Error('sem fiber do React');
    // O fiber do container alterna entre current/alternate entre renders; o fiber
    // ATUAL da árvore é stateNode.current (FiberRoot) — sem isso a leitura fica velha.
    const container = Reflect.get(root, key) as {
      stateNode?: { current?: unknown } | null;
      child?: unknown;
      sibling?: unknown;
      memoizedState?: unknown;
    } | null;
    const start = (container?.stateNode?.current ?? container) as {
      child?: unknown;
      sibling?: unknown;
      memoizedState?: unknown;
    } | null;
    const q = [start as unknown];
    const seen = new Set<unknown>();
    let best: { version: number } | null = null;
    while (q.length) {
      const f = q.shift() as { memoizedState?: unknown; child?: unknown; sibling?: unknown } | null;
      if (!f || seen.has(f)) continue;
      seen.add(f);
      let h = f.memoizedState as { memoizedState?: unknown; next?: unknown } | null;
      while (h) {
        const ms = h.memoizedState;
        if (ms && typeof ms === 'object' && 'screen' in (ms as Record<string, unknown>) && 'view' in (ms as Record<string, unknown>)) {
          const view = (ms as { view: unknown }).view as { version: number } | null;
          // Pode haver mais de um estado 'tela' na árvore (render pendente/alternate):
          // sempre leva o de MAIOR version (versão do jogo é monotônica).
          if (view && (best === null || view.version > best.version)) best = view;
        }
        h = (h.next ?? null) as { memoizedState?: unknown; next?: unknown } | null;
      }
      if (f.child) q.push(f.child);
      if (f.sibling) q.push(f.sibling);
    }
    if (!best) throw new Error('view do jogo não encontrada nos fibers');
    return best as unknown as GameView;
  });
}

// ---------- leitura de UI ----------

export async function phaseText(page: Page): Promise<string> {
  return (await page.locator('.turn-phase').first().innerText()).trim();
}

/** Nome do jogador destacado (pcard.active-turn). */
export async function actorName(page: Page): Promise<string> {
  const t = (await page.locator('.pcard.active-turn .pname').first().innerText()).trim();
  return t.replace(/\s*\(você\)\s*$/, '');
}

export async function waitForTurn(page: Page, name: string, phase: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await actorName(page).catch(() => '');
        const p = await phaseText(page).catch(() => '');
        return a === name && p === phase;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

// ---------- cálculos Node (mesmos módulos puros do cliente) ----------

export function handTotal(view: GameView): number {
  return RESOURCE_KINDS.reduce((n, k) => n + view.you.resources[k], 0);
}

function resIndex(r: ResourceKind): number {
  return RESOURCE_KINDS.indexOf(r);
}

/** Union de vértices na MESMA ordem do Board (Set de legals) — índice DOM ↔ VertexId. */
export function vertexTargetList(view: GameView, mode: 'setup' | 'settlement' | 'city'): VertexId[] {
  const geo = getGeometry(view);
  const legal = legalBuildTargets(view, geo, view.you.id);
  const modeV =
    mode === 'setup' ? legal.setupVertices : mode === 'settlement' ? legal.settlementVertices : legal.cityVertices;
  const active = mode === 'setup' ? legal.setupVertices : legal.setupVertices.length ? legal.setupVertices : [];
  return [...new Set([...modeV, ...legal.setupVertices, ...legal.settlementVertices, ...legal.cityVertices, ...active])];
}

export function edgeTargetList(view: GameView, mode: 'setup' | 'road'): EdgeId[] {
  const geo = getGeometry(view);
  const legal = legalBuildTargets(view, geo, view.you.id);
  const modeE = mode === 'setup' ? legal.setupEdges : legal.roadEdges;
  const active = mode === 'setup' ? legal.setupEdges : legal.setupEdges.length ? legal.setupEdges : [];
  return [...new Set([...modeE, ...legal.setupEdges, ...legal.roadEdges, ...legal.freeRoadEdges, ...active])];
}

/**
 * Escolha determinística de vértice de setup: prioriza cobrir terrenos que o
 * jogador ainda não tem adjacentes (minério/grão/lã — necessários p/ desenvolvimento),
 * depois fichas boas (6/8) e porto. Isso garante produção futura dos3 recursos.
 */
export function setupVertexIndex(view: GameView): number {
  const list = vertexTargetList(view, 'setup');
  const ports = new Set(view.board.ports.flatMap((p) => [...p.vertexIds]));
  const covered = coveredTerrains(view);
  const missing = DEV_TERRAINS.filter((k) => !covered.has(k));
  const score = (v: VertexId): number => {
    let s = 0;
    const kinds = new Set<string>();
    for (const t of adjacentTiles(view, v)) {
      kinds.add(t.terrain);
      if (t.number != null) {
        s += t.number === 6 || t.number === 8 ? 12 : Math.max(1, 5 - Math.abs(t.number - 7));
      }
    }
    for (const m of missing) {
      if (kinds.has(m)) s += 100;
    }
    if (kinds.has('desert')) s -= 5;
    if (ports.has(v)) s += 25;
    return s;
  };
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < list.length; i += 1) {
    const s = score(list[i]);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

const DEV_TERRAINS = ['mountains', 'fields', 'pasture'] as const;

/** Terrenos adjacentes às construções do próprio jogador na view atual. */
export function coveredTerrains(view: GameView): Set<string> {
  const covered = new Set<string>();
  for (const b of view.board.buildings) {
    if (b.playerId !== view.you.id) continue;
    for (const t of adjacentTiles(view, b.vertexId)) {
      covered.add(t.terrain);
    }
  }
  return covered;
}

/** O jogador tem adjacentes minério+grão+lã (dá para comprar desenvolvimento via produção)? */
export function coversDevTrio(view: GameView): boolean {
  const covered = coveredTerrains(view);
  return DEV_TERRAINS.every((t) => covered.has(t));
}

/** Plano de troca marítima possível na mão atual (dev + troca cabem juntas; taxa clássica: vale pelo recurso ENTREGUE). */
export function bankPlan(view: GameView): { give: ResourceKind; want: ResourceKind; rate: 2 | 3 | 4 } | null {
  const res = view.you.resources;
  if (res.wool < 1 || res.grain < 1 || res.ore < 1) return null; // reserva para desenvolvimento
  const total = handTotal(view);
  for (const want of RESOURCE_KINDS) {
    for (const give of RESOURCE_KINDS) {
      if (give === want) continue;
      const rate = bestBankRate(view, give);
      if (total - 3 - rate + 1 < 8) continue; // pós dev+troca precisa ficar >7 (descarte do 7)
      const reserve = give === 'wool' || give === 'grain' || give === 'ore' ? 1 : 0;
      if (res[give] - reserve >= rate) return { give, want, rate };
    }
  }
  return null;
}

/** Número que mais produz para o jogador-alvo (evita 7 e hexes com ladrão). */
export function productiveNumber(view: GameView, targetId: PlayerId, exclude: number[]): number {
  const gain = new Map<number, number>();
  for (const b of view.board.buildings) {
    if (b.playerId !== targetId) continue;
    for (const t of adjacentTiles(view, b.vertexId)) {
      if (t.number == null || t.id === view.board.robberHexId) continue;
      gain.set(t.number, (gain.get(t.number) ?? 0) + (b.kind === 'city' ? 2 : 1));
    }
  }
  const candidates = [...gain.entries()]
    .filter(([n]) => n !== 7 && !exclude.includes(n))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return candidates[0]?.[0] ?? 2;
}

export function splitDice(n: number): { d1: number; d2: number } {
  const map: Record<number, [number, number]> = {
    2: [1, 1],
    3: [1, 2],
    4: [2, 2],
    5: [2, 3],
    6: [3, 3],
    7: [3, 4],
    8: [4, 4],
    9: [4, 5],
    10: [5, 5],
    11: [5, 6],
    12: [6, 6],
  };
  const [d1, d2] = map[n] ?? [1, 1];
  return { d1, d2 };
}

/** Hex com vítima (preferindo vítima com cartas) para mover o ladrão via UI. */
export function pickVictimHex(
  view: GameView,
): { hexIndex: number; victimId: PlayerId; victimName: string; victims: number } | null {
  const geo = getGeometry(view);
  const youId = view.you.id;
  for (const hexId of legalRobberHexes(view, youId)) {
    const vics = robberVictims(view, geo, hexId, youId);
    if (vics.length === 0) continue;
    const withCards = vics.filter((id) => (view.players.find((p) => p.id === id)?.resourcesCount ?? 0) > 0);
    const chosen = withCards[0] ?? vics[0];
    const hexIndex = geo.hexes.findIndex((h) => h.id === hexId);
    if (hexIndex < 0) continue;
    return {
      hexIndex,
      victimId: chosen,
      victimName: view.players.find((p) => p.id === chosen)?.name ?? chosen,
      victims: vics.length,
    };
  }
  return null;
}

/** Índice de aresta para estrada: prefere aresta cujo extremo passa na regra de distância. */
export function roadEdgeIndex(view: GameView): number {
  const edges = edgeTargetList(view, 'road');
  const built = new Set(view.board.buildings.map((b) => b.vertexId));
  const passes = (v: VertexId): boolean => !built.has(v) && neighborVertices(view, v).every((n) => !built.has(n));
  for (let i = 0; i < edges.length; i += 1) {
    const [a, b] = edges[i].split('|') as [VertexId, VertexId];
    if (passes(a) || passes(b)) return i;
  }
  return 0;
}

export function resourceIndexForModal(r: ResourceKind): number {
  return resIndex(r);
}

// ---------- descarte do 7 ----------

function discardDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Você precisa descartar/ });
}

/** Descarta exatamente o mínimo exigido (preenche por recurso até o confirm habilitar). */
export async function fillDiscard(page: Page): Promise<boolean> {
  const dlg = discardDialog(page);
  if (!(await dlg.isVisible().catch(() => false))) return false;
  const confirm = dlg.getByRole('button', { name: /^Descartar \d+\/\d+$/ });
  for (const res of ['tijolo', 'madeira', 'lã', 'grão', 'minério']) {
    if (await confirm.isEnabled().catch(() => false)) break;
    const add = dlg.getByRole('button', { name: `Adicionar a ${res}` });
    while (await add.isEnabled().catch(() => false)) {
      if (await confirm.isEnabled().catch(() => false)) break;
      await add.click();
    }
  }
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dlg).toBeHidden();
  return true;
}

/** Resolve TODOS os modais de descarte abertos (vários jogadores podem estar >7). */
export async function dismissDiscards(pages: Page[]): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    let any = false;
    for (const p of pages) {
      if (await fillDiscard(p)) any = true;
    }
    if (!any) return;
  }
}

export async function anyDiscardVisible(pages: Page[]): Promise<boolean> {
  for (const p of pages) {
    if (await discardDialog(p).isVisible().catch(() => false)) return true;
  }
  return false;
}
