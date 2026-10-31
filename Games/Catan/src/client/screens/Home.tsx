// Home: apelido, criar/entrar sala, recuperar sessão, preferências rápidas.
import { useState } from 'react';
import { ROOM_CODE_LENGTH } from '../../shared/constants';
import { useApp } from '../appContext';
import { saveSession } from '../session';

function Orbs() {
  return (
    <div className="home-orbs" aria-hidden="true">
      <div className="home-orb" style={{ width: 340, height: 340, left: '-6%', top: '10%' }} />
      <div className="home-orb" style={{ width: 260, height: 260, right: '-4%', bottom: '12%' }} />
      <div className="home-orb" style={{ width: 180, height: 180, right: '18%', top: '6%' }} />
    </div>
  );
}

function HexBadge() {
  return (
    <svg width="86" height="96" viewBox="0 0 86 96" aria-hidden="true">
      <polygon points="43,4 82,26 82,70 43,92 4,70 4,26" fill="#c9962c" stroke="#8a6d3b" strokeWidth="3" />
      <polygon points="43,14 73,31 73,65 43,82 13,65 13,31" fill="#3d7ea6" opacity="0.85" />
      <polygon points="43,24 63,36 63,60 43,72 23,60 23,36" fill="#93c25f" stroke="#6f9b43" strokeWidth="2" />
      <circle cx="43" cy="48" r="11" fill="#f3e6c8" stroke="#8a6d3b" strokeWidth="1.5" />
      <text x="43" y="52.5" textAnchor="middle" fontSize="12" fontWeight="800" fontFamily="Georgia, serif" fill="#b33a2e">
        8
      </text>
    </svg>
  );
}

export default function Home() {
  const { sendLobby, toast, prefs, updatePrefs, adoptSession, connected, openRules } = useApp();
  const [nickname, setNickname] = useState(prefs.nickname);
  const [busy, setBusy] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [showRecover, setShowRecover] = useState(false);
  const [recCode, setRecCode] = useState('');
  const [recRoom, setRecRoom] = useState('');

  const name = nickname.trim();

  async function withName(fn: () => Promise<void>) {
    if (!name) {
      toast('error', 'Escolha um apelido primeiro.');
      return;
    }
    if (name.length > 20) {
      toast('error', 'Apelido muito longo (máx. 20).');
      return;
    }
    updatePrefs({ nickname: name });
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const createRoom = () =>
    withName(async () => {
      const res = await sendLobby({ type: 'create_room', nickname: name });
      if (res.ok && res.session) adoptSession(res.session);
    });

  const joinRoom = () =>
    withName(async () => {
      const code = joinCode.trim().toUpperCase();
      if (code.length !== ROOM_CODE_LENGTH) {
        toast('error', `O código da sala tem ${ROOM_CODE_LENGTH} letras.`);
        return;
      }
      const res = await sendLobby({ type: 'join_room', code, nickname: name });
      if (res.ok && res.session) adoptSession(res.session);
    });

  const recover = () =>
    withName(async () => {
      const code = recRoom.trim().toUpperCase();
      const rc = recCode.trim();
      if (code.length !== ROOM_CODE_LENGTH || !rc) {
        toast('error', 'Preencha o código da sala e o código de recuperação.');
        return;
      }
      const res = await sendLobby({ type: 'bind_session', code, recoveryCode: rc, mode: 'claim' });
      if (res.ok && res.session) adoptSession(res.session);
      else if (!res.ok && res.error.code === 'SESSION_CONFLICT') {
        // Guarda o código para o diálogo de conflito conseguir "Recuperar controle"
        // (takeover lê a sessão armazenada; o claim falhou antes de salvá-la).
        saveSession({ roomCode: code, roomName: '', playerId: '', recoveryCode: rc });
      }
    });

  return (
    <div className="home-wrap">
      <Orbs />
      <header className="home-hero">
        <HexBadge />
        <h1>
          Catan <em>Deluxe</em>
        </h1>
        <p className="home-sub">Multijogador clássico no navegador — ilha, portos, trocas e estradas.</p>
        <p className="home-disclaimer">Projeto independente, não oficial. Sem vínculo com Catan GmbH ou Catan Studio.</p>
      </header>

      <main className="panel home-card">
        <div className="field">
          <label htmlFor="nick">Seu apelido</label>
          <input
            id="nick"
            className="input"
            value={nickname}
            maxLength={20}
            placeholder="Como quer ser chamado?"
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <button type="button" className="btn btn-primary btn-block" disabled={busy || !connected} onClick={createRoom}>
          Criar sala
        </button>

        {!showJoin ? (
          <button type="button" className="btn btn-parchment btn-block" onClick={() => setShowJoin(true)}>
            Entrar com código
          </button>
        ) : (
          <div className="col" style={{ gap: 'var(--s2)' }}>
            <div className="field">
              <label htmlFor="code">Código da sala</label>
              <input
                id="code"
                className="input input-code"
                value={joinCode}
                maxLength={ROOM_CODE_LENGTH}
                placeholder="ABCDE"
                autoCapitalize="characters"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </div>
            <button type="button" className="btn btn-primary btn-block" disabled={busy || !connected} onClick={joinRoom}>
              Entrar na sala
            </button>
          </div>
        )}

        <details className="adv" open={showRecover} onToggle={(e) => setShowRecover((e.target as HTMLDetailsElement).open)}>
          <summary>Já tenho uma sala — recuperar sessão</summary>
          <div className="col" style={{ marginTop: 'var(--s3)', gap: 'var(--s2)' }}>
            <div className="field">
              <label htmlFor="rec-room">Código da sala</label>
              <input
                id="rec-room"
                className="input input-code"
                value={recRoom}
                maxLength={ROOM_CODE_LENGTH}
                placeholder="ABCDE"
                onChange={(e) => setRecRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </div>
            <div className="field">
              <label htmlFor="rec-code">Código de recuperação</label>
              <input
                id="rec-code"
                className="input"
                value={recCode}
                placeholder="Cole o código que você salvou"
                onChange={(e) => setRecCode(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-primary btn-block" disabled={busy || !connected} onClick={recover}>
              Recuperar sessão
            </button>
          </div>
        </details>

        <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px dashed var(--parchment-shadow)', paddingTop: 'var(--s3)' }}>
          <div className="row" style={{ gap: 'var(--s3)' }}>
            <div className="row">
              <span className="small muted">Volume</span>
              <div className="seg" role="group" aria-label="Áudio">
                <button type="button" aria-pressed={!prefs.muted} onClick={() => updatePrefs({ muted: false })}>
                  🔊
                </button>
                <button type="button" aria-pressed={prefs.muted} onClick={() => updatePrefs({ muted: true })}>
                  🔇
                </button>
              </div>
            </div>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={prefs.reduceMotion}
                onChange={(e) => updatePrefs({ reduceMotion: e.target.checked })}
              />
              Reduzir movimento
            </label>
          </div>
          <button type="button" className="btn btn-parchment btn-sm" onClick={openRules}>
            Como jogar
          </button>
        </div>

        {!connected && <p className="small muted" style={{ margin: 0 }}>Conectando ao servidor…</p>}
      </main>
    </div>
  );
}
