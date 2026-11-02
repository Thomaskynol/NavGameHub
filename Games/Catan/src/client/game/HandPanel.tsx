// Painel esquerdo: sua mão, desenvolvimentos, custos e estoque de peças.
import type { DevCardKind, ResourceKind } from '../../shared/constants';
import { COSTS, RESOURCE_KINDS } from '../../shared/constants';
import type { GameView } from '../../shared/protocol';
import { bestBankRate } from '../board/legalClient';
import { DEV_DESC, DEV_LABEL, ResourceIcon } from '../ui/icons';

const DEV_STATE_HINT: Record<string, string> = {
  boughtThisTurn: 'Comprada neste turno — só vale a partir do próximo.',
  actionPlayed: 'Você já jogou uma carta de ação neste turno.',
  notYourTurn: 'Só pode ser jogada no seu turno.',
};

export function canAfford(res: Record<ResourceKind, number>, cost: Partial<Record<ResourceKind, number>>): boolean {
  return Object.entries(cost).every(([k, n]) => (res[k as ResourceKind] ?? 0) >= (n as number));
}

export function missingCost(res: Record<ResourceKind, number>, cost: Partial<Record<ResourceKind, number>>): string[] {
  const out: string[] = [];
  for (const [k, n] of Object.entries(cost)) {
    const have = res[k as ResourceKind] ?? 0;
    if (have < (n as number)) {
      const label = { brick: 'tijolo', lumber: 'madeira', wool: 'lã', grain: 'grão', ore: 'minério' }[k as ResourceKind];
      out.push(`${(n as number) - have} ${label}`);
    }
  }
  return out;
}

/** Gate do modo estrada: só entra com custo pago ou estrada gratuita (carta). */
export function canEnterRoadMode(res: Record<ResourceKind, number>, freeRoadsLeft: number): boolean {
  return canAfford(res, COSTS.road) || freeRoadsLeft > 0;
}

export function CostIcons({ cost, showQty = true }: { cost: Partial<Record<ResourceKind, number>>; showQty?: boolean }) {
  return (
    <span className="cost-icons">
      {RESOURCE_KINDS.filter((k) => cost[k]).map((k) => (
        <span key={k} className="row" style={{ gap: 2 }} title={k}>
          <ResourceIcon kind={k} size={14} />
          {showQty && <b>×{cost[k]}</b>}
        </span>
      ))}
    </span>
  );
}

export const COST_LABEL: Record<string, string> = {
  road: 'Estrada',
  settlement: 'Assentamento',
  city: 'Cidade',
  devCard: 'Desenvolvimento',
};

export function devCardState(
  view: GameView,
  cardId: string,
  kind: DevCardKind,
  youId: string,
): { playable: boolean; reason?: string } {
  const isYourTurn = view.activePlayerId === youId;
  if (kind === 'victoryPoint') {
    return { playable: isYourTurn && view.you.victoryPoints >= 10, reason: isYourTurn ? undefined : DEV_STATE_HINT.notYourTurn };
  }
  if (!isYourTurn) return { playable: false, reason: DEV_STATE_HINT.notYourTurn };
  if (view.phase !== 'action' && view.phase !== 'pre_roll') return { playable: false, reason: 'Fora da fase de ação.' };
  // Comprada neste turno (por id) — bloqueia jogar até virar o turno.
  if (view.you.boughtThisTurn.includes(cardId)) return { playable: false, reason: DEV_STATE_HINT.boughtThisTurn };
  // Só UMA carta de ação por turno (cavaleiro + progresso); VP não consome a ação.
  if (view.you.playedActionCardThisTurn) return { playable: false, reason: DEV_STATE_HINT.actionPlayed };
  return { playable: true };
}

export default function HandPanel({ view, youId }: { view: GameView; youId: string }) {
  const me = view.players.find((p) => p.id === youId);
  const res = view.you.resources;
  const myRate = bestBankRate(view, 'lumber');

  return (
    <div className="panel area-hand" style={{ overflowY: 'auto' }}>
      <div className="panel-head">
        <span>Sua mão</span>
        <span className="tag tag-gold" title="Melhor taxa de banco disponível">
          banco {myRate}:1
        </span>
      </div>

      <div className="hand-sec">
        <h3>Recursos</h3>
        <div className="res-row">
          {RESOURCE_KINDS.map((k) => (
            <span key={k} className="res-chip" title={k}>
              <ResourceIcon kind={k} />
              <span className="cnt">{res[k]}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="hand-sec">
        <h3>Desenvolvimentos ({view.you.devCards.length})</h3>
        {view.you.devCards.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nenhuma carta ainda.</p>}
        <div className="col">
          {view.you.devCards.map((c) => {
            const st = devCardState(view, c.id, c.kind, youId);
            return (
              <div key={c.id} className={`dev-card${st.playable ? '' : ' locked'}`} title={st.reason ?? DEV_DESC[c.kind]}>
                <div className="dev-name">{DEV_LABEL[c.kind]}</div>
                <div className="dev-desc">{DEV_DESC[c.kind]}</div>
                {!st.playable && st.reason && <span className="dev-badge">{st.reason === DEV_STATE_HINT.boughtThisTurn ? 'novo turno' : 'aguarda'}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="hand-sec">
        <h3>Custos e estoque</h3>
        <div className="cost-table">
          {(Object.keys(COSTS) as (keyof typeof COSTS)[]).map((key) => {
            const cost = COSTS[key];
            const ok = canAfford(res, cost);
            const missing = missingCost(res, cost);
            const pieceKey = key === 'road' ? 'roads' : key === 'settlement' ? 'settlements' : key === 'city' ? 'cities' : null;
            const left = pieceKey ? me?.piecesLeft[pieceKey] : undefined;
            return (
              <div key={key} className="cost-row" title={ok ? undefined : `Falta ${missing.join(', ')}`}>
                <span>{COST_LABEL[key]}</span>
                <span className="row">
                  <CostIcons cost={cost} />
                  {key !== 'devCard' && left !== undefined && (
                    <span className="small muted" title="Peças restantes">
                      ({left})
                    </span>
                  )}
                  <span className={ok ? 'can' : 'cannot'}>{ok ? '✓' : '✗'}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hand-sec">
        <h3>Banco</h3>
        <div className="cost-table">
          {RESOURCE_KINDS.map((k) => (
            <div key={k} className="cost-row">
              <span className="row" style={{ gap: 4 }}>
                <ResourceIcon kind={k} size={14} />
                {k === 'brick' ? 'tijolo' : k === 'lumber' ? 'madeira' : k === 'wool' ? 'lã' : k === 'grain' ? 'grão' : 'minério'}
              </span>
              <span className="small muted">{view.bankCounts[k]} no banco</span>
            </div>
          ))}
          <div className="cost-row">
            <span>Desenvolvimento</span>
            <span className="small muted">{view.devDeckCount} no monte</span>
          </div>
        </div>
      </div>
    </div>
  );
}
