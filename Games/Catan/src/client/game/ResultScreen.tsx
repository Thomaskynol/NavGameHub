// Tela de vitória: confete suaves, placar final, retorno à home.
import { useMemo } from 'react';
import type { GameView } from '../../shared/protocol';

const CONFETTI_COLORS = ['#c9962c', '#b33a2e', '#2f6ea8', '#3e8e5a', '#d97b28', '#f0e8d5'];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        id: i,
        left: (i * 37 + 11) % 100,
        delay: (i % 7) * 0.45,
        dur: 3.4 + (i % 5) * 0.7,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 7 + (i % 3) * 3,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <i
          key={p.id}
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.w,
            height: p.w + 6,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function ResultScreen({
  view,
  youId,
  onHome,
  hubUrl,
}: {
  view: GameView;
  youId: string;
  onHome(): void;
  /** Modo Hub: volta para a sala do Hub em vez da tela inicial. */
  hubUrl?: string | null;
}) {
  const winner = view.players.find((p) => p.id === view.winnerId);
  const youWon = view.winnerId === youId;
  const sorted = [...view.players].sort((a, b) => {
    const sa = a.id === youId ? view.you.victoryPoints : a.publicVictoryPoints;
    const sb = b.id === youId ? view.you.victoryPoints : b.publicVictoryPoints;
    return sb - sa;
  });

  return (
    <div className="result-root">
      <div className="panel result-card">
        <Confetti />
        <h1>{youWon ? 'Vitória!' : `${winner?.name ?? 'Alguém'} venceu`}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {youWon
            ? 'Você chegou a 10 pontos. A ilha é sua!'
            : 'A partida terminou. Nova partida, nova ilha.'}
        </p>
        <div className="result-scores">
          {sorted.map((p) => {
            const score = p.id === youId ? view.you.victoryPoints : p.publicVictoryPoints;
            return (
              <div key={p.id} className={`result-row${p.id === view.winnerId ? ' win' : ''}`}>
                <span className={`pc-dot bg-${p.color}`} />
                <b className="grow">{p.name}{p.id === youId ? ' (você)' : ''}</b>
                {p.hasLargestRoad && <span className="tag tag-gold">Maior Estrada</span>}
                {p.hasLargestArmy && <span className="tag tag-gold">Maior Exército</span>}
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 800 }}>{score}</span>
              </div>
            );
          })}
        </div>
        <p className="small muted">
          Só os pontos públicos dos rivais são mostrados — desenvolvimentos ocultos permanecem ocultos.
        </p>
        {hubUrl ? (
          <a className="btn btn-primary" href={hubUrl} target="_top" rel="noreferrer">
            Voltar à sala do Hub
          </a>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onHome}>
            Nova partida com o grupo
          </button>
        )}
        <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>
          Projeto independente, não oficial.
        </p>
      </div>
    </div>
  );
}
