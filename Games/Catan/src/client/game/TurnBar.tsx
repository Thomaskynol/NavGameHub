// Barra inferior: dados, fase e ações contextuais do turno.
import type { DevCardKind } from '../../shared/constants';
import { COSTS } from '../../shared/constants';
import type { GameView } from '../../shared/protocol';
import { canAfford, missingCost } from './HandPanel';
import { DevCardIcon, DiceIcon, RoadIcon, CityIcon, SettlementIcon, ResourceIcon, DEV_LABEL } from '../ui/icons';

const PHASE_LABEL: Record<string, string> = {
  setup_settlement: 'Coloque um assentamento',
  setup_road: 'Coloque a estrada ao lado do assentamento',
  pre_roll: 'Antes dos dados',
  action: 'Sua fase: troque, construa ou termine o turno',
  await_discards: 'Aguardando descartes do 7',
  robber: 'Mova o ladrão',
  dev_road_building: 'Construção de estradas — estradas gratuitas',
  dev_monopoly: 'Monopólio — escolha o recurso',
  dev_year_of_plenty: 'Fartura — escolha as cartas',
  game_over: 'Fim de jogo',
};

interface TurnBarProps {
  view: GameView;
  youId: string;
  onRoll(): void;
  onBuild(kind: 'road' | 'settlement' | 'city'): void;
  onBuyDev(): void;
  onBankTrade(): void;
  onOfferTrade(): void;
  onEndTurn(): void;
  onFinishFreeRoads(): void;
  onHelp(): void;
  onSession(): void;
  playableDevs: { kind: DevCardKind; n: number }[];
  onPlayDev(kind: DevCardKind): void;
  busy: boolean;
}

function ActionButton({
  id,
  label,
  icon,
  disabled,
  reason,
  onClick,
  primary,
}: {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  reason?: string;
  onClick(): void;
  primary?: boolean;
}) {
  if (disabled && reason) {
    return (
      <span className="pop-wrap">
        <button id={id} type="button" className={`btn${primary ? ' btn-primary' : ''}`} disabled onClick={onClick} aria-describedby={`${id}-pop`}>
          {icon}
          {label}
        </button>
        <span className="pop" id={`${id}-pop`} role="tooltip">
          {reason}
        </span>
      </span>
    );
  }
  return (
    <button id={id} type="button" className={`btn${primary ? ' btn-primary' : ''}`} disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

export default function TurnBar({
  view,
  youId,
  onRoll,
  onBuild,
  onBuyDev,
  onBankTrade,
  onOfferTrade,
  onEndTurn,
  onFinishFreeRoads,
  onHelp,
  onSession,
  playableDevs,
  onPlayDev,
  busy,
}: TurnBarProps) {
  const isYourTurn = view.activePlayerId === youId;
  const res = view.you.resources;
  const phase = view.phase;
  const me = view.players.find((p) => p.id === youId);
  const roadReason = missingCost(res, COSTS.road);
  const settleReason = missingCost(res, COSTS.settlement);
  const cityReason = missingCost(res, COSTS.city);
  const devReason = missingCost(res, COSTS.devCard);

  const phaseHint =
    phase === 'await_discards'
      ? view.pending?.yourAction
        ? 'Você precisa descartar.'
        : `Aguardando descartes de ${view.pending?.waitingOn.length ?? 0} jogador(es).`
      : phase === 'robber'
        ? 'Clique em um hex da ilha para mover o ladrão.'
        : !isYourTurn
          ? `Vez de ${view.players.find((p) => p.id === view.activePlayerId)?.name ?? 'outro jogador'}.`
          : view.pending?.type === 'road_building'
            ? `Restam ${view.pending.roadsLeft ?? 0} estrada(s) gratuita(s).`
            : 'Boa jogada!';

  const freeRoadsLeft = view.pending?.type === 'road_building' ? view.pending.roadsLeft ?? 0 : 0;

  return (
    <div className="area-turn">
      <div className="turn-bar">
        <div className="dice-pair" aria-label={view.dice ? `Dados: ${view.dice.d1} e ${view.dice.d2}` : 'Dados ainda não rolados'}>
          <span className="die">{view.dice ? view.dice.d1 : '?'}</span>
          <span className="die">{view.dice ? view.dice.d2 : '?'}</span>
          {view.dice && (
            <span className={`dice-total${view.dice.d1 + view.dice.d2 === 7 || view.dice.d1 + view.dice.d2 >= 10 ? ' hot' : ''}`}>
              = {view.dice.d1 + view.dice.d2}
            </span>
          )}
        </div>

        <div className="turn-info">
          <span className="turn-phase">{PHASE_LABEL[phase] ?? phase}</span>
          <span className="turn-hint">{phaseHint}</span>
        </div>

        <div className="turn-actions">
          {phase === 'pre_roll' && isYourTurn && (
            <ActionButton id="btn-roll" label="Rolar dados" icon={<DiceIcon />} primary onClick={onRoll} disabled={busy} />
          )}

          {(phase === 'action' || phase === 'pre_roll') && isYourTurn && (
            <>
              {phase === 'action' && (
                <>
                  <ActionButton
                    id="btn-road"
                    label="Estrada"
                    icon={<RoadIcon />}
                    onClick={() => onBuild('road')}
                    disabled={busy || roadReason.length > 0 || (me?.piecesLeft.roads ?? 0) <= 0}
                    reason={roadReason.length ? `Falta ${roadReason.join(', ')}` : (me?.piecesLeft.roads ?? 0) <= 0 ? 'Sem estradas no estoque' : undefined}
                  />
                  <ActionButton
                    id="btn-settlement"
                    label="Assentamento"
                    icon={<SettlementIcon />}
                    onClick={() => onBuild('settlement')}
                    disabled={busy || settleReason.length > 0 || (me?.piecesLeft.settlements ?? 0) <= 0}
                    reason={settleReason.length ? `Falta ${settleReason.join(', ')}` : (me?.piecesLeft.settlements ?? 0) <= 0 ? 'Sem assentamentos no estoque' : undefined}
                  />
                  <ActionButton
                    id="btn-city"
                    label="Cidade"
                    icon={<CityIcon />}
                    onClick={() => onBuild('city')}
                    disabled={busy || cityReason.length > 0 || (me?.piecesLeft.cities ?? 0) <= 0}
                    reason={cityReason.length ? `Falta ${cityReason.join(', ')}` : (me?.piecesLeft.cities ?? 0) <= 0 ? 'Sem cidades no estoque' : undefined}
                  />
                </>
              )}
              <ActionButton
                id="btn-buy-dev"
                label="Desenvolvimento"
                icon={<DevCardIcon kind="knight" />}
                onClick={onBuyDev}
                disabled={busy || phase !== 'action' || devReason.length > 0 || view.devDeckCount <= 0}
                reason={
                  phase !== 'action'
                    ? 'Indisponível antes dos dados'
                    : view.devDeckCount <= 0
                      ? 'Monte vazio'
                      : devReason.length
                        ? `Falta ${devReason.join(', ')}`
                        : undefined
                }
              />
              <ActionButton
                id="btn-bank"
                label="Trocar com banco"
                icon={<ResourceIcon kind="grain" />}
                onClick={onBankTrade}
                disabled={busy || phase !== 'action'}
                reason={phase !== 'action' ? 'Fora da fase de trocas' : undefined}
              />
              {playableDevs.map(({ kind, n }) => (
                <ActionButton
                  key={kind}
                  id={`btn-dev-${kind}`}
                  label={DEV_LABEL[kind] + (n > 1 ? ` ×${n}` : '')}
                  icon={<DevCardIcon kind={kind} />}
                  onClick={() => onPlayDev(kind)}
                  disabled={busy}
                  reason={kind === 'knight' ? 'Mova o ladrão e roube uma carta' : undefined}
                />
              ))}
              <ActionButton
                id="btn-trade"
                label="Propor troca"
                onClick={onOfferTrade}
                disabled={busy || phase !== 'action'}
                reason={phase !== 'action' ? 'Fora da fase de trocas' : undefined}
              />
            </>
          )}

          {phase === 'dev_road_building' && isYourTurn && (
            <>
              <span className="turn-hint">Clique nas arestas destacadas (restam {freeRoadsLeft}).</span>
              <ActionButton id="btn-finish-roads" label="Concluir estradas" primary onClick={onFinishFreeRoads} disabled={busy} />
            </>
          )}

          {(phase === 'action' || phase === 'pre_roll') && isYourTurn && (
            <ActionButton id="btn-end" label="Fim de turno" onClick={onEndTurn} disabled={busy || phase !== 'action'} reason={phase !== 'action' ? 'Rode os dados primeiro' : undefined} />
          )}
        </div>

        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onHelp} aria-label="Regras e custos">
            ❔ Regras
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSession} aria-label="Minha sessão">
            🔑
          </button>
        </div>
      </div>
    </div>
  );
}

export { canAfford };
