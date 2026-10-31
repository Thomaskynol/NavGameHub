// Faixa superior: mini-painéis dos jogadores (info pública + destaque de turno).
import type { PlayerId } from '../../shared/constants';
import type { GameView } from '../../shared/protocol';
import { DevCardIcon, ResourceIcon } from '../ui/icons';

function KnightIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 L19 5 V11 C19 16 16 20 12 22 C8 20 5 16 5 11 V5 Z" fill="#5a4630" stroke="#2a1c10" strokeWidth="1.4" />
      <path d="M12 7 L14 11 L12 15 L10 11 Z" fill="#f3e6c8" />
    </svg>
  );
}

function RoadMini({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="9" width="20" height="6" rx="3" fill="#8a6d3b" stroke="#2a1c10" strokeWidth="1" transform="rotate(-18 12 12)" />
    </svg>
  );
}

export default function PlayersTop({ view, youId }: { view: GameView; youId: PlayerId }) {
  return (
    <div className="players-strip" role="list" aria-label="Jogadores">
      {view.players.map((p) => {
        const active = view.activePlayerId === p.id || view.setupCurrentPlayerId === p.id;
        const isYou = p.id === youId;
        const realScore = isYou ? view.you.victoryPoints : p.publicVictoryPoints;
        return (
          <div key={p.id} className={`pcard${active ? ' active-turn' : ''}${p.connected ? '' : ' dot-off'}`} role="listitem">
            <span className={`pc-dot bg-${p.color}`} />
            <div>
              <div className="pname">
                {p.name}
                {isYou && <span className="small muted"> (você)</span>}
              </div>
              <div className="pstats">
                <span title="Recursos na mão" aria-label={`${p.resourcesCount} recursos`}>
                  <ResourceIcon kind="lumber" size={12} />
                  {p.resourcesCount}
                </span>
                <span title="Cartas de desenvolvimento" aria-label={`${p.devCardsCount} desenvolvimentos`}>
                  <DevCardIcon kind="knight" size={12} />
                  {p.devCardsCount}
                </span>
                <span title="Cavaleiros jogados" aria-label={`${p.knightsPlayed} cavaleiros`}>
                  <KnightIcon />
                  {p.knightsPlayed}
                </span>
                <span title="Maior estrada" aria-label={`Estrada ${p.longestRoadLength}`}>
                  <RoadMini />
                  {p.longestRoadLength}
                </span>
                {p.hasLargestRoad && <span title="Maior Estrada (+2)" className="tag tag-gold">ME</span>}
                {p.hasLargestArmy && <span title="Maior Exército (+2)" className="tag tag-gold">MX</span>}
                {!p.connected && <span title="Desconectado">😴</span>}
              </div>
            </div>
            <span className="score" aria-label={`${realScore} pontos`}>
              {realScore}
            </span>
          </div>
        );
      })}
    </div>
  );
}
