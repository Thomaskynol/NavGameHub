// Aplicação: fluxo Home → Lobby → Game, sessão, rede, toasts, preferências.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { GameCommand, GameView, LobbyCommand, SessionPayload } from '../shared/protocol';
import { AppCtx, type AppApi, type ConflictInfo, type Screen, type ToastKind } from './appContext';
import { playSfx, setAudioPrefs, unlockAudio } from './audio';
import { errorText } from './errors';
import { createSocket, emitGameCommand, emitLobbyCommand, type CatanSocket, type LobbyResult } from './net';
import { ConflictDialog, ReplacedDialog, RulesModal, SessionModal } from './game/modals';
import Game from './screens/Game';
import Home from './screens/Home';
import Lobby from './screens/Lobby';
import { clearActiveSession, loadActiveSession, loadPrefs, parseHubParams, savePrefs, saveSession, type HubParams, type Prefs, type StoredSession } from './session';

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface State {
  screen: Screen;
  view: GameView | null;
  session: StoredSession | null;
  connected: boolean;
  conflict: ConflictInfo | null;
  replaced: { by: string } | null;
  toasts: ToastItem[];
  prefs: Prefs;
  sessionModal: boolean;
  rulesModal: boolean;
}

type Action =
  | { type: 'patch'; patch: Partial<State> }
  | { type: 'view'; view: GameView }
  | { type: 'toast'; toast: ToastItem }
  | { type: 'untoast'; id: number }
  | { type: 'prefs'; patch: Partial<Prefs> };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'patch':
      return { ...s, ...a.patch };
    case 'view':
      return { ...s, view: a.view };
    case 'toast':
      return { ...s, toasts: [...s.toasts.slice(-3), a.toast] };
    case 'untoast':
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case 'prefs': {
      const prefs = { ...s.prefs, ...a.patch };
      savePrefs(prefs);
      return { ...s, prefs };
    }
  }
}

function bootState(): State {
  return {
    screen: 'home',
    view: null,
    session: null,
    connected: false,
    conflict: null,
    replaced: null,
    toasts: [],
    prefs: loadPrefs(),
    sessionModal: false,
    rulesModal: false,
  };
}

export default function App() {
  const mockEnabled = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1';
  return mockEnabled ? <MockShell /> : <RealApp />;
}

function RealApp() {
  const [state, dispatch] = useReducer(reducer, undefined, bootState);
  const socketRef = useRef<CatanSocket | null>(null);
  const viewRef = useRef<GameView | null>(null);
  const toastId = useRef(0);
  // Modo Hub (?hub=1): pula a tela inicial e entra direto na sala indicada.
  const [hub] = useState<HubParams | null>(() => parseHubParams(window.location.search));
  const [hubState, setHubState] = useState<'joining' | 'waiting' | 'failed' | 'done'>('joining');
  const [hubError, setHubError] = useState('');

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastId.current;
    dispatch({ type: 'toast', toast: { id, kind, text } });
    playSfx(kind === 'error' ? 'error' : 'chat');
    setTimeout(() => dispatch({ type: 'untoast', id }), kind === 'error' ? 6000 : 3800);
  }, []);

  useEffect(() => {
    viewRef.current = state.view;
  }, [state.view]);

  const adoptSession = useCallback((s: SessionPayload) => {
    const stored: StoredSession = {
      roomCode: s.roomCode,
      roomName: s.roomName,
      playerId: s.playerId,
      recoveryCode: s.recoveryCode,
    };
    saveSession(stored);
    dispatch({ type: 'patch', patch: { session: stored, screen: 'lobby', conflict: null } });
  }, []);

  // Entrada automática do modo Hub: cria (create=1) ou entra (create=0) na sala
  // indicada, com o apelido do Hub. Sem prompt de apelido, sem tela inicial.
  const runHubJoin = useCallback(
    async (socket: CatanSocket, params: HubParams) => {
      setHubError('');
      try {
        // Reaproveita a sessão desta aba quando for da mesma sala (iframe recarregado).
        const stored = loadActiveSession();
        if (stored && stored.roomCode === params.room) {
          const bound = await emitLobbyCommand(socket, {
            type: 'bind_session',
            code: params.room,
            recoveryCode: stored.recoveryCode,
            mode: 'resume',
          });
          if (bound.ok && bound.session) {
            adoptSession(bound.session);
            setHubState('done');
            return;
          }
        }
        clearActiveSession();
        if (params.create) {
          const created = await emitLobbyCommand(socket, {
            type: 'create_room',
            nickname: params.name,
            roomCode: params.room,
            ...(params.htok ? { hubToken: params.htok } : {}),
          });
          if (created.ok && created.session) {
            adoptSession(created.session);
            setHubState('done');
            return;
          }
          // Falha honesta, sem join cego: CODE_TAKEN indica colisão com outra
          // partida (dono diferente). Retentativa legítima (mesmo htok) entra
          // no servidor como nova vaga e retorna ok — nunca cai aqui.
          if (!created.ok) {
            setHubError(errorText(created.error));
            setHubState('failed');
            return;
          }
        }
        const joined = await emitLobbyCommand(socket, {
          type: 'join_room',
          code: params.room,
          nickname: params.name,
          ...(params.htok ? { hubToken: params.htok } : {}),
        });
        if (joined.ok && joined.session) {
          adoptSession(joined.session);
          setHubState('done');
          return;
        }
        if (!joined.ok && joined.error.code === 'ALREADY_STARTED') {
          // Sem entrada no meio da partida: espera no Hub, sem fingir entrada.
          setHubState('waiting');
          return;
        }
        if (!joined.ok) {
          setHubError(errorText(joined.error));
          setHubState('failed');
        }
      } catch {
        setHubError('Sem conexão com o servidor. Tente de novo.');
        setHubState('failed');
      }
    },
    [adoptSession],
  );

  const retryHubJoin = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !hub) return;
    setHubState('joining');
    if (socket.connected) void runHubJoin(socket, hub);
    else socket.once('connect', () => void runHubJoin(socket, hub));
  }, [hub, runHubJoin]);

  const sendLobby = useCallback(
    async (payload: LobbyCommand): Promise<LobbyResult> => {
      const socket = socketRef.current;
      if (!socket) return { ok: false, error: { code: 'INTERNAL', message: 'Sem conexão.' } };
      try {
        const res = await emitLobbyCommand(socket, payload);
        if (!res.ok) toast('error', errorText(res.error));
        return res;
      } catch {
        toast('error', 'Sem resposta do servidor. Tente de novo.');
        return { ok: false, error: { code: 'INTERNAL', message: 'Sem resposta' } };
      }
    },
    [toast],
  );

  const sendGame = useCallback(
    async (payload: GameCommand): Promise<boolean> => {
      const socket = socketRef.current;
      if (!socket) {
        toast('error', 'Sem conexão com o servidor.');
        return false;
      }
      try {
        const res = await emitGameCommand(socket, payload, viewRef.current?.version);
        if (res.ok) return true;
        toast('error', errorText(res.error));
        return false;
      } catch {
        toast('error', 'Sem resposta do servidor — o comando não foi aplicado.');
        return false;
      }
    },
    [toast],
  );

  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    if (socket && socket.connected) {
      emitLobbyCommand(socket, { type: 'leave_room' }).catch(() => {});
    }
    clearActiveSession();
    dispatch({ type: 'patch', patch: { session: null, view: null, screen: 'home', replaced: null, conflict: null } });
  }, []);

  // ----- socket + boot -----
  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => dispatch({ type: 'patch', patch: { connected: true } }));
    socket.on('disconnect', () => dispatch({ type: 'patch', patch: { connected: false } }));

    socket.on('state', (view) => {
      const prev = viewRef.current;
      if (prev && view.chat.length > prev.chat.length) playSfx('chat');
      dispatch({ type: 'view', view });
    });

    socket.on('session_replaced', (info) => {
      dispatch({ type: 'patch', patch: { replaced: info } });
    });

    socket.on('bind_conflict', (info) => {
      dispatch({ type: 'patch', patch: { conflict: info } });
    });

    socket.on('presence', () => {
      // O estado novo (com connected) chega logo em seguida via `state`.
    });

    // Boot: tenta retomar sessão ativa desta aba (só fora do modo Hub —
    // o Hub tem seu próprio fluxo de entrada, sem prompt de apelido).
    const sess = loadActiveSession();
    if (!hub && sess) {
      const tryBind = async (mode: 'resume' | 'takeover') => {
        const res = await emitLobbyCommand(socket, {
          type: 'bind_session',
          code: sess.roomCode,
          recoveryCode: sess.recoveryCode,
          mode,
        }).catch(() => null);
        if (!res) return;
        if (res.ok && res.session) {
          adoptSession(res.session);
          return;
        }
        if (!res.ok) {
          if (res.error.code === 'SESSION_CONFLICT') {
            dispatch({ type: 'patch', patch: { conflict: { roomCode: sess.roomCode, playerId: sess.playerId } } });
            return;
          }
          clearActiveSession();
          dispatch({ type: 'patch', patch: { session: null, screen: 'home' } });
          toast('info', 'Não foi possível retomar a sessão. Entre na sala de novo.');
        }
      };
      const onConnect = () => void tryBind('resume');
      if (socket.connected) onConnect();
      else socket.once('connect', onConnect);
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Modo Hub: ao conectar, cria ou entra na sala indicada (sem tela inicial).
  useEffect(() => {
    if (!hub || hubState !== 'joining') return;
    const socket = socketRef.current;
    if (!socket) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void runHubJoin(socket, hub);
    };
    if (socket.connected) run();
    else socket.once('connect', run);
    return () => {
      cancelled = true;
      socket.off('connect', run);
    };
  }, [hub, hubState, runHubJoin]);

  // Áudio: desbloqueia no primeiro gesto; aplica preferências.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    setAudioPrefs({ volume: state.prefs.volume, muted: state.prefs.muted });
  }, [state.prefs.volume, state.prefs.muted]);

  useEffect(() => {
    const off = state.prefs.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.dataset.motion = off ? 'off' : 'on';
  }, [state.prefs.reduceMotion]);

  // Lobby → jogo quando o servidor inicia a partida (view sai da fase lobby).
  useEffect(() => {
    if (state.screen === 'lobby' && state.view && state.view.phase !== 'lobby') {
      dispatch({ type: 'patch', patch: { screen: 'game' } });
    }
  }, [state.screen, state.view]);

  // Conflito de sessão: takeover explícito.
  const resolveConflictTakeover = useCallback(() => {
    const sess = state.session ?? loadActiveSession();
    const conflict = state.conflict;
    if (!sess || !conflict) return;
    void (async () => {
      const res = await sendLobby({
        type: 'bind_session',
        code: conflict.roomCode,
        recoveryCode: sess.recoveryCode,
        mode: 'takeover',
      });
      if (res.ok && res.session) {
        adoptSession(res.session);
        toast('success', 'Você assumiu o controle da sessão.');
      }
    })();
  }, [state.session, state.conflict, sendLobby, adoptSession, toast]);

  const resolveConflictNewPlayer = useCallback(() => {
    clearActiveSession();
    dispatch({ type: 'patch', patch: { session: null, view: null, screen: 'home', conflict: null } });
    toast('info', 'Entre na sala como um novo jogador (se houver vaga).');
  }, [toast]);

  const dismissReplaced = useCallback(() => {
    clearActiveSession();
    dispatch({ type: 'patch', patch: { session: null, view: null, screen: 'home', replaced: null } });
  }, []);

  const api = useMemo<AppApi>(() => {
    return {
      screen: state.screen,
      view: state.view,
      session: state.session,
      connected: state.connected,
      prefs: state.prefs,
      mock: false,
      conflict: state.conflict,
      replaced: state.replaced,
      goto: (screen) => dispatch({ type: 'patch', patch: { screen } }),
      adoptSession,
      sendGame,
      sendLobby,
      toast,
      updatePrefs: (patch) => dispatch({ type: 'prefs', patch }),
      leaveRoom,
      resolveConflictTakeover,
      resolveConflictNewPlayer,
      dismissReplaced,
      openSessionModal: () => dispatch({ type: 'patch', patch: { sessionModal: true } }),
      openRules: () => dispatch({ type: 'patch', patch: { rulesModal: true } }),
    };
  }, [
    state.screen,
    state.view,
    state.session,
    state.connected,
    state.prefs,
    state.conflict,
    state.replaced,
    adoptSession,
    sendGame,
    sendLobby,
    toast,
    leaveRoom,
    resolveConflictTakeover,
    resolveConflictNewPlayer,
    dismissReplaced,
  ]);

  return (
    <AppCtx.Provider value={api}>
      <div className="bg-isle" aria-hidden="true" />
      {hub && !state.session ? (
        <div className="home-wrap">
          <main className="panel home-card">
            {hubState === 'waiting' ? (
              <>
                <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>Partida em andamento</h1>
                <p className="small muted" style={{ marginTop: 0 }}>
                  Você chegou com a partida já iniciada e este jogo não aceita entrar no meio.
                  Aguarde na sala do Hub — a próxima partida começa já já.
                </p>
                {hub.hubUrl && (
                  <a className="btn btn-primary btn-block" href={hub.hubUrl} target="_top" rel="noreferrer">
                    Voltar à sala do Hub
                  </a>
                )}
              </>
            ) : hubState === 'failed' ? (
              <>
                <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>Não foi possível entrar na partida.</h1>
                <p className="small muted" style={{ marginTop: 0 }}>{hubError || 'Erro desconhecido.'}</p>
                <button type="button" className="btn btn-primary btn-block" onClick={retryHubJoin}>
                  Tentar de novo
                </button>
                {hub.hubUrl && (
                  <a className="btn btn-parchment btn-block" href={hub.hubUrl} target="_top" rel="noreferrer">
                    Voltar à sala do Hub
                  </a>
                )}
              </>
            ) : hubState === 'done' ? (
              <>
                <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>Você saiu da partida.</h1>
                <button type="button" className="btn btn-primary btn-block" onClick={retryHubJoin}>
                  Entrar de novo
                </button>
                {hub.hubUrl && (
                  <a className="btn btn-parchment btn-block" href={hub.hubUrl} target="_top" rel="noreferrer">
                    Voltar à sala do Hub
                  </a>
                )}
              </>
            ) : (
              <>
                <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>Entrando na partida…</h1>
                <p className="small muted" style={{ margin: 0 }}>
                  Sala {hub.room} como {hub.name}. Sem tela inicial no modo Hub.
                </p>
              </>
            )}
          </main>
        </div>
      ) : (
        <>
          {state.screen === 'home' && <Home />}
          {state.screen === 'lobby' && <Lobby />}
          {state.screen === 'game' && <Game />}
        </>
      )}

      {!state.connected && state.screen !== 'home' && (
        <div className="net-banner warn" role="status">
          Conexão perdida… reconectando
        </div>
      )}

      {state.replaced && <ReplacedDialog by={state.replaced.by} onDismiss={dismissReplaced} />}
      {state.conflict && !state.replaced && (
        <ConflictDialog onTakeover={resolveConflictTakeover} onNewPlayer={resolveConflictNewPlayer} />
      )}

      {state.sessionModal && state.session && (
        <SessionModal
          roomCode={state.session.roomCode}
          recoveryCode={state.session.recoveryCode}
          onClose={() => dispatch({ type: 'patch', patch: { sessionModal: false } })}
        />
      )}
      {state.rulesModal && <RulesModal onClose={() => dispatch({ type: 'patch', patch: { rulesModal: false } })} />}

      <div className="toast-stack" role="status" aria-live="polite">
        {state.toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' toast-error' : t.kind === 'success' ? ' toast-success' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

// ---------- modo mock (dev) ----------

type MockModule = typeof import('./dev/mockView');
let mockMod: MockModule | null = null;

function MockShell() {
  const [view, setView] = useState<GameView | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [sessionModal, setSessionModal] = useState(false);
  const [rulesModal, setRulesModal] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const mockToastId = useRef(0);

  useEffect(() => {
    let alive = true;
    void import('./dev/mockView').then((m) => {
      if (!alive) return;
      mockMod = m;
      setView(m.createMockView());
    });
    return () => {
      alive = false;
    };
  }, []);

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++mockToastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const sendMockGame = useCallback(async (payload: GameCommand): Promise<boolean> => {
    if (!mockMod) return false;
    setView((v) => (v ? mockMod!.applyMockCommand(v, payload) : v));
    return true;
  }, []);

  const session: StoredSession | null = view
    ? {
        roomCode: view.roomCode,
        roomName: view.roomName,
        playerId: view.you.id,
        recoveryCode: 'mock-recovery-code-000',
      }
    : null;

  const api = useMemo<AppApi>(
    () => ({
      screen: 'game',
      view,
      session,
      connected: true,
      prefs,
      mock: true,
      conflict: null,
      replaced: null,
      goto: () => {},
      adoptSession: () => {},
      sendGame: async () => false,
      sendMockGame,
      sendLobby: async () => ({ ok: true, session: undefined }),
      toast,
      updatePrefs: (patch) => {
        setPrefs((p) => {
          const n = { ...p, ...patch };
          savePrefs(n);
          return n;
        });
      },
      leaveRoom: () => {
        if (mockMod) setView(mockMod.createMockView());
      },
      resolveConflictTakeover: () => {},
      resolveConflictNewPlayer: () => {},
      dismissReplaced: () => {},
      openSessionModal: () => setSessionModal(true),
      openRules: () => setRulesModal(true),
    }),
    [view, prefs, toast, sendMockGame, session],
  );

  if (!view || !session) return null;

  return (
    <AppCtx.Provider value={api}>
      <div className="bg-isle" aria-hidden="true" />
      <Game mock />
      <div className="net-banner info" style={{ pointerEvents: 'none' }}>
        Modo demonstração (VITE_MOCK) — sem servidor
      </div>
      {sessionModal && (
        <SessionModal roomCode={session.roomCode} recoveryCode={session.recoveryCode} onClose={() => setSessionModal(false)} />
      )}
      {rulesModal && <RulesModal onClose={() => setRulesModal(false)} />}
      <div className="toast-stack" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' toast-error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
