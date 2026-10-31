// Lobby: código da sala, jogadores, cores, prontidão, anfitrião, chat.
import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, PLAYER_COLORS, type PlayerColor } from '../../shared/constants';
import { useApp } from '../appContext';
import { CopyIcon } from '../ui/icons';

function CopyButton({ text, label = 'Copiar código' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm btn-parchment"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // clipboard bloqueado: usuário ainda pode copiar manualmente
        }
        setOk(true);
        setTimeout(() => setOk(false), 1600);
      }}
    >
      <CopyIcon />
      {ok ? <span className="copy-ok">Copiado!</span> : label}
    </button>
  );
}

export default function Lobby() {
  const { view, session, sendLobby, leaveRoom, connected } = useApp();
  const [seed, setSeed] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [chatText, setChatText] = useState('');
  const chatLogRef = useRef<HTMLDivElement | null>(null);

  const me = view?.players.find((p) => p.id === session?.playerId) ?? null;
  const isHost = me?.isHost ?? false;
  const players = view?.players ?? [];

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view?.chat?.length]);

  const missing = Math.max(0, 3 - players.length);
  const notReady = players.filter((p) => !p.ready).length;
  const startBlocked = players.length < 3 || notReady > 0;
  const startReason =
    players.length < 3
      ? `Faltam ${missing} jogador${missing > 1 ? 'es' : ''} (mínimo 3).`
      : notReady > 0
        ? `${notReady} jogador${notReady > 1 ? 'es' : ''} ainda não ${notReady > 1 ? 'estão' : 'está'} pronto${notReady > 1 ? 's' : ''}.`
        : '';

  const setColor = (color: PlayerColor) => void sendLobby({ type: 'set_color', color });
  const toggleReady = () => void sendLobby({ type: 'set_ready', ready: !me?.ready });
  const start = () => void sendLobby({ type: 'start_game', boardSeed: seed.trim() || undefined });
  const kick = (playerId: string) => void sendLobby({ type: 'kick_player', playerId });
  const transfer = (playerId: string) => void sendLobby({ type: 'transfer_host', playerId });

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const t = chatText.trim();
    if (!t) return;
    sendLobby({ type: 'chat', text: t.slice(0, CHAT_MAX_LENGTH) }).catch(() => {});
    setChatText('');
  };

  return (
    <div className="lobby-wrap">
      <div className="lobby-main">
        <section className="panel">
          <div className="panel-head">
            <span>{view?.roomName ?? session?.roomName ?? 'Sala'}</span>
            {!connected && <span className="tag tag-danger">Sem conexão</span>}
          </div>
          <div style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                  Código da sala
                </div>
                <div className="code-big">{view?.roomCode ?? session?.roomCode ?? '·····'}</div>
              </div>
              <CopyButton text={view?.roomCode ?? session?.roomCode ?? ''} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                  Código de recuperação
                </div>
                <div className="small" style={{ wordBreak: 'break-all', maxWidth: 380 }}>
                  {session?.recoveryCode ? `${session.recoveryCode.slice(0, 18)}…` : '—'}
                </div>
              </div>
              <CopyButton text={session?.recoveryCode ?? ''} label="Copiar recuperação" />
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Guarde o código de recuperação: é a única forma de voltar à sua partida em outro navegador.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span>Jogadores ({players.length}/4)</span>
          </div>
          {players.length === 0 && <p style={{ padding: 'var(--s4)' }} className="muted">Aguardando o estado da sala…</p>}
          {players.map((p) => (
            <div key={p.id} className="player-row">
              <span className={`pc-dot bg-${p.color}`} aria-label={`Cor ${p.color}`} />
              <div className="grow">
                <div style={{ fontWeight: 700 }}>
                  {p.name}
                  {p.id === session?.playerId && <span className="small muted"> (você)</span>}
                </div>
                <div className="small muted">
                  {p.connected ? 'conectado' : 'desconectado'}
                  {p.isHost && ' · anfitrião'}
                </div>
              </div>
              {p.ready ? <span className="tag tag-ok">pronto</span> : <span className="tag">esperando</span>}
              {isHost && p.id !== session?.playerId && (
                <div className="row">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => transfer(p.id)} aria-label={`Passar anfitrião para ${p.name}`}>
                    ★
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => kick(p.id)} aria-label={`Remover ${p.name}`}>
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head"><span>Sua cor</span></div>
          <div style={{ padding: 'var(--s4)' }}>
            <div className="color-pick" role="group" aria-label="Escolher cor">
              {PLAYER_COLORS.map((c) => {
                const owner = players.find((p) => p.color === c && p.id !== session?.playerId);
                const mine = me?.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    className={`color-swatch bg-${c}`}
                    aria-pressed={mine}
                    aria-label={owner ? `Cor ${c} — tomada por ${owner.name}` : `Cor ${c}`}
                    disabled={!!owner}
                    title={owner ? `Tomada por ${owner.name}` : c}
                    onClick={() => setColor(c)}
                  />
                );
              })}
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Cores indisponíveis estão desativadas com o nome de quem as tomou.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><span>Anfitrião</span></div>
          <div style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <label className="row small" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={showSeed} onChange={(e) => setShowSeed(e.target.checked)} />
              Configuração avançada (seed do tabuleiro)
            </label>
            {showSeed && (
              <div className="field">
                <label htmlFor="seed">Seed do tabuleiro</label>
                <input id="seed" className="input" value={seed} placeholder="Em branco = aleatório" onChange={(e) => setSeed(e.target.value)} />
              </div>
            )}
            {isHost ? (
              <div className="row">
                {/* Anfitrião também precisa marcar pronto: start_game exige todos prontos. */}
                <button type="button" className={`btn ${me?.ready ? 'btn-ghost' : 'btn-primary'}`} onClick={toggleReady}>
                  {me?.ready ? 'Não estou pronto' : 'Estou pronto'}
                </button>
                <div className="pop-wrap">
                  <button type="button" className="btn btn-primary" disabled={startBlocked} onClick={start}>
                    Iniciar partida
                  </button>
                  {startBlocked && (
                    <span className="pop" role="status">
                      {startReason}
                    </span>
                  )}
                </div>
                <button type="button" className="btn btn-ghost" onClick={leaveRoom}>
                  Excluir sala e sair
                </button>
              </div>
            ) : (
              <div className="row">
                <button type="button" className={`btn ${me?.ready ? 'btn-ghost' : 'btn-primary'}`} onClick={toggleReady}>
                  {me?.ready ? 'Não estou pronto' : 'Estou pronto'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={leaveRoom}>
                  Sair da sala
                </button>
              </div>
            )}
            {startBlocked && isHost && <p className="small muted" style={{ margin: 0 }}>{startReason}</p>}
            {!isHost && <p className="small muted" style={{ margin: 0 }}>O anfitrião inicia a partida quando todos estiverem prontos.</p>}
          </div>
        </section>
      </div>

      <aside className="lobby-side">
        <section className="panel chat-box">
          <div className="panel-head"><span>Conversa</span></div>
          <div className="chat-log" ref={chatLogRef}>
            {(view?.chat ?? []).map((m) => (
              <div key={m.id}>
                <b className={`pc-${m.color}`}>{m.name}: </b>
                <span>{m.text}</span>
              </div>
            ))}
            {(view?.chat?.length ?? 0) === 0 && <span className="small muted">Nada por aqui ainda. Diga oi!</span>}
          </div>
          <form className="chat-form" onSubmit={sendChat}>
            <input
              className="input"
              value={chatText}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Mensagem…"
              aria-label="Mensagem da conversa"
              onChange={(e) => setChatText(e.target.value)}
            />
            <button type="submit" className="btn btn-sm">Enviar</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
