// Tela de partida: tabuleiro + mão + painéis + barra de turno + fluxos de dev cards.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DevCardKind, HexId, PlayerId, ResourceKind, EdgeId, VertexId } from '../../shared/constants';
import type { GameCommand } from '../../shared/protocol';
import { useApp } from '../appContext';
import { playSfx } from '../audio';
import Board, { type BoardMode, type BoardPick } from '../board/Board';
import { getGeometry, legalBuildTargets, legalKnightHexes, legalRobberHexes, robberVictims } from '../board/legalClient';
import { parseHubParams } from '../session';
import HandPanel, { canEnterRoadMode } from '../game/HandPanel';
import PlayersTop from '../game/PlayersTop';
import ResultScreen from '../game/ResultScreen';
import SideTabs from '../game/SideTabs';
import Tutorial, { TUTORIAL_STEPS } from '../game/Tutorial';
import TurnBar from '../game/TurnBar';
import {
  BankTradeModal,
  DiscardModal,
  MonopolyModal,
  OfferTradeModal,
  VictimPicker,
  YearOfPlentyModal,
} from '../game/modals';

type BuildMode = null | 'road' | 'settlement' | 'city' | 'free_road' | 'robber' | 'knight';

interface TutorialFlow {
  step: number; // -1 desligado
}

export default function Game({ mock = false }: { mock?: boolean }) {
  const app = useApp();
  const { view, session, prefs, updatePrefs, openSessionModal, openRules } = app;
  const youId = session?.playerId ?? view?.you.id ?? '';
  const [busy, setBusy] = useState(false);
  const [buildMode, setBuildMode] = useState<BuildMode>(null);
  const [selected, setSelected] = useState<BoardPick | null>(null);
  const [victimFor, setVictimFor] = useState<{ hexId: HexId; knight: boolean } | null>(null);
  const [modal, setModal] = useState<'bank' | 'offer' | 'monopoly' | 'yop' | null>(null);
  const [tab, setTab] = useState<'history' | 'chat' | 'offers'>('history');
  const [drawer, setDrawer] = useState<null | 'left' | 'right'>(null);
  const [tut, setTut] = useState<TutorialFlow>({ step: prefs.tutorialSeen ? -1 : 0 });
  const [offerPreset, setOfferPreset] = useState<{ toPlayerId: PlayerId; give: Partial<Record<ResourceKind, number>>; want: Partial<Record<ResourceKind, number>> } | undefined>();

  const geo = useMemo(() => (view ? getGeometry(view) : null), [view]);
  const legal = useMemo(
    () => (view && geo ? legalBuildTargets(view, geo, youId) : null),
    [view, geo, youId],
  );

  // Inicia tutorial na primeira partida.
  useEffect(() => {
    if (!prefs.tutorialSeen && tut.step === -1) setTut({ step: 0 });
  }, []);

  const advanceTutorial = useCallback(
    (action: string) => {
      setTut((t) => {
        if (t.step < 0) return t;
        const expected = ['roll', 'build', 'bank', 'dev'][t.step];
        if (expected && action !== expected) return t;
        const next = t.step + 1;
        if (next >= TUTORIAL_STEPS.length) {
          updatePrefs({ tutorialSeen: true });
          return { step: -1 };
        }
        return { step: next };
      });
    },
    [updatePrefs],
  );

  const finishTutorial = () => {
    setTut({ step: -1 });
    updatePrefs({ tutorialSeen: true });
  };

  const send = useCallback(
    async (payload: GameCommand, sfxName?: Parameters<typeof playSfx>[0], tutorialAction?: string) => {
      setBusy(true);
      try {
        const ok = mock && app.sendMockGame ? await app.sendMockGame(payload) : await app.sendGame(payload);
        if (ok) {
          if (sfxName) playSfx(sfxName);
          setBuildMode(null);
          setSelected(null);
          if (tutorialAction) advanceTutorial(tutorialAction);
        }
        return ok;
      } finally {
        setBusy(false);
      }
    },
    [app, mock, advanceTutorial],
  );

  if (!view || !geo || !legal) {
    return (
      <div className="home-wrap">
        <p style={{ color: 'var(--parchment)', fontFamily: 'var(--font-display)', fontSize: '1.3rem' }}>
          Carregando a ilha…
        </p>
      </div>
    );
  }

  // Modo Hub: fim de partida volta para a sala do Hub (link direto, sem navegação manual).
  const hubUrl = useMemo(() => parseHubParams(window.location.search)?.hubUrl || null, []);

  const winner = view.winnerId != null;

  // ----- modo do tabuleiro -----
  const robberHexes = useMemo(() => legalRobberHexes(view, youId), [view, youId]);
  const knightHexes = useMemo(() => (buildMode === 'knight' ? legalKnightHexes(view, youId) : []), [view, youId, buildMode]);
  const boardMode: BoardMode = useMemo(() => {
    if (winner) return { kind: 'none', label: '' };
    if (view.phase === 'robber' && view.activePlayerId === youId) return { kind: 'robber', hexes: robberHexes, label: 'Escolha o novo hex do ladrão' };
    if (buildMode === 'knight') return { kind: 'robber', hexes: knightHexes, label: 'Cavaleiro: escolha o hex' };
    if (view.phase === 'setup_settlement' && view.setupCurrentPlayerId === youId) {
      return { kind: 'vertex', vertices: legal.setupVertices, label: 'Coloque um assentamento' };
    }
    if (view.phase === 'setup_road' && view.setupCurrentPlayerId === youId) {
      return { kind: 'edge', edges: legal.setupEdges, label: 'Coloque a estrada ao lado' };
    }
    if (buildMode === 'road') {
      // Gate de custo: sem 1 tijolo + 1 madeira (e sem estrada gratuita), não há placement nem destaques.
      const free = view.pending?.type === 'road_building' ? view.pending.roadsLeft ?? 0 : 0;
      if (!canEnterRoadMode(view.you.resources, free)) return { kind: 'none', label: '' };
      return { kind: 'edge', edges: legal.roadEdges, label: 'Escolha a aresta da estrada' };
    }
    if (buildMode === 'free_road') return { kind: 'edge', edges: legal.freeRoadEdges.length ? legal.freeRoadEdges : legal.roadEdges, label: 'Estrada gratuita' };
    if (buildMode === 'settlement') return { kind: 'vertex', vertices: legal.settlementVertices, label: 'Escolha o local do assentamento' };
    if (buildMode === 'city') return { kind: 'vertex', vertices: legal.cityVertices, label: 'Escolha a casa para promover a cidade' };
    return { kind: 'none', label: '' };
  }, [winner, view, youId, buildMode, robberHexes, knightHexes, legal]);

  // ----- interação com o tabuleiro -----
  const handlePick = async (pick: BoardPick) => {
    if (boardMode.kind === 'robber' || buildMode === 'knight') {
      if (pick.type !== 'hex') return;
      const knight = buildMode === 'knight';
      const victims = robberVictims(view, geo, pick.id, youId);
      if (victims.length === 0) {
        await send({ type: knight ? 'play_knight' : 'move_robber', hexId: pick.id }, 'thunk');
        return;
      }
      if (victims.length === 1) {
        await send({ type: knight ? 'play_knight' : 'move_robber', hexId: pick.id, victimId: victims[0] }, 'thunk');
        return;
      }
      setVictimFor({ hexId: pick.id, knight });
      return;
    }
    setSelected(pick);
    playSfx('select');
  };

  const cancelSelection = () => {
    setSelected(null);
    if (buildMode === 'free_road') return; // continua no modo até concluir
    setBuildMode(null);
  };

  const confirmSelection = async () => {
    if (!selected) return;
    if (view.phase === 'setup_settlement' && view.setupCurrentPlayerId === youId) {
      await send({ type: 'setup_settlement', vertexId: selected.id as VertexId }, 'place');
      return;
    }
    if (view.phase === 'setup_road' && view.setupCurrentPlayerId === youId) {
      await send({ type: 'setup_road', edgeId: selected.id as EdgeId }, 'place');
      return;
    }
    if (buildMode === 'road') await send({ type: 'build_road', edgeId: selected.id as EdgeId }, 'place', 'build');
    if (buildMode === 'free_road') await send({ type: 'place_free_road', edgeId: selected.id as EdgeId }, 'place');
    if (buildMode === 'settlement') await send({ type: 'build_settlement', vertexId: selected.id as VertexId }, 'place', 'build');
    if (buildMode === 'city') await send({ type: 'build_city', vertexId: selected.id as VertexId }, 'thunk', 'build');
  };

  const startBuild = (kind: 'road' | 'settlement' | 'city') => {
    if (kind === 'road') {
      // TurnBar desabilita o botão sem recurso; defesa em profundidade aqui.
      const free = view.pending?.type === 'road_building' ? view.pending.roadsLeft ?? 0 : 0;
      if (!canEnterRoadMode(view.you.resources, free)) return;
    }
    setSelected(null);
    setBuildMode(kind);
    setDrawer(null);
    playSfx('select');
  };

  // ----- dev cards -----
  // O GameView não expõe "já jogou ação este turno"; o servidor rejeita (DEV_ALREADY_PLAYED).
  const isYourActionTurn = view.activePlayerId === youId && (view.phase === 'action' || view.phase === 'pre_roll');

  const canPlayDev = (kind: DevCardKind): boolean => {
    if (kind === 'victoryPoint') return false;
    if (!isYourActionTurn) return false;
    // Motor (rules.md §2.4): carta de ação também é permitida antes de rolar os dados.
    return true;
  };

  const playableDevs = useMemo(() => {
    const counts = new Map<DevCardKind, number>();
    for (const c of view.you.devCards) {
      if (canPlayDev(c.kind)) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, n]) => ({ kind, n }));
  }, [view.you.devCards, view.phase, view.activePlayerId, youId]);

  const playDev = async (kind: DevCardKind) => {
    if (kind === 'knight') {
      setBuildMode('knight');
      return;
    }
    if (kind === 'monopoly') {
      setModal('monopoly');
      return;
    }
    if (kind === 'yearOfPlenty') {
      setModal('yop');
      return;
    }
    if (kind === 'roadBuilding') {
      const ok = await send({ type: 'play_road_building' }, 'coins');
      if (ok) setBuildMode('free_road');
    }
  };

  // ----- ofertas -----
  const respondOffer = (offerId: string, response: 'accept' | 'reject') => {
    void send({ type: 'respond_trade', offerId, response }, response === 'accept' ? 'coins' : undefined);
  };
  const cancelOffer = (offerId: string) => {
    void send({ type: 'cancel_trade', offerId });
  };
  const sendChat = (text: string) => {
    if (mock) return;
    void app.sendLobby({ type: 'chat', text }).then(() => playSfx('chat'));
  };

  // descarte obrigatório
  const discardPending = view.pending?.type === 'discard' && view.pending.yourAction;

  const phaseInstruction =
    view.phase === 'robber' && view.activePlayerId === youId
      ? 'Mova o ladrão para outro hex da ilha.'
      : view.phase === 'setup_settlement' && view.setupCurrentPlayerId === youId
        ? 'Escolha um local para o assentamento (destaque no tabuleiro).'
        : view.phase === 'setup_road' && view.setupCurrentPlayerId === youId
          ? 'Coloque a estrada ao lado do assentamento recém-colocado.'
          : buildMode === 'road' || buildMode === 'settlement' || buildMode === 'city'
            ? 'Clique na posição destacada no tabuleiro e confirme.'
            : buildMode === 'free_road'
              ? 'Estradas gratuitas: clique nas arestas destacadas.'
              : buildMode === 'knight'
                ? 'Cavaleiro: escolha o hex do ladrão.'
                : null;

  return (
    <div className="game-root">
      <div className="area-players">
        <PlayersTop view={view} youId={youId} />
      </div>

      {drawer && <div className="drawer-scrim" onClick={() => setDrawer(null)} />}
      <div className={`area-hand drawer-left${drawer === 'left' ? ' open' : ''}`}>
        <HandPanel view={view} youId={youId} />
      </div>

      <div className="area-main">
        <div className="board-stage" style={{ position: 'absolute', inset: 0 }}>
          <Board
            view={view}
            geo={geo}
            legal={legal}
            mode={boardMode}
            selected={selected}
            onPick={(p) => void handlePick(p)}
            youId={youId}
          />
        </div>

        <div className="board-toolbar mobile-only" style={{ left: 10, right: 'auto' }}>
          <button type="button" aria-label="Abrir sua mão" onClick={() => setDrawer(drawer === 'left' ? null : 'left')}>
            🎴
          </button>
          <button type="button" aria-label="Abrir painéis" onClick={() => setDrawer(drawer === 'right' ? null : 'right')}>
            📋
          </button>
        </div>

        {phaseInstruction && !selected && (
          <div className="confirm-float" style={{ pointerEvents: 'none' }}>
            <span style={{ fontWeight: 700 }}>{phaseInstruction}</span>
          </div>
        )}

        {selected && (
          <div className="confirm-float" role="region" aria-label="Confirmação da jogada">
            <span style={{ fontWeight: 700 }}>
              {boardMode.label || 'Confirmar posição'}
            </span>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmSelection()}>
              Confirmar jogada
            </button>
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--ink)', borderColor: 'var(--parchment-shadow)' }} onClick={cancelSelection}>
              Cancelar
            </button>
          </div>
        )}
      </div>

      <div className={`area-side drawer-right${drawer === 'right' ? ' open' : ''}`}>
        <SideTabs
          view={view}
          youId={youId}
          activeTab={tab}
          onTab={setTab}
          onRespond={respondOffer}
          onCancel={cancelOffer}
          onSendChat={sendChat}
        />
      </div>

      <TurnBar
        view={view}
        youId={youId}
        busy={busy}
        onRoll={() => void send({ type: 'roll_dice' }, 'dice', 'roll')}
        onBuild={startBuild}
        onBuyDev={() => void send({ type: 'buy_dev_card' }, 'coins', 'dev')}
        onBankTrade={() => setModal('bank')}
        onOfferTrade={() => {
          setOfferPreset(undefined);
          setModal('offer');
        }}
        onEndTurn={() => void send({ type: 'end_turn' })}
        onFinishFreeRoads={() => void send({ type: 'finish_road_building' })}
        onHelp={openRules}
        onSession={openSessionModal}
        playableDevs={playableDevs}
        onPlayDev={(k) => void playDev(k)}
      />

      {/* modais */}
      {modal === 'bank' && (
        <BankTradeModal
          view={view}
          onClose={() => setModal(null)}
          onConfirm={(give, want) => {
            setModal(null);
            void send({ type: 'bank_trade', give, want }, 'coins');
          }}
        />
      )}
      {modal === 'offer' && (
        <OfferTradeModal
          view={view}
          youId={youId}
          preset={offerPreset}
          onClose={() => setModal(null)}
          onConfirm={(toPlayerId, give, want) => {
            setModal(null);
            void send({ type: 'propose_trade', toPlayerId, give, want });
          }}
        />
      )}
      {modal === 'monopoly' && (
        <MonopolyModal
          onClose={() => setModal(null)}
          onPick={(r) => {
            setModal(null);
            void send({ type: 'play_monopoly', resource: r }, 'coins');
          }}
        />
      )}
      {modal === 'yop' && (
        <YearOfPlentyModal
          onClose={() => setModal(null)}
          onPick={(resources) => {
            setModal(null);
            void send({ type: 'play_year_of_plenty', resources }, 'coins');
          }}
        />
      )}
      {discardPending && (
        <DiscardModal
          view={view}
          onConfirm={(cards) => {
            void send({ type: 'discard', cards });
          }}
        />
      )}
      {victimFor && (
        <VictimPicker
          view={view}
          victimIds={robberVictims(view, geo, victimFor.hexId, youId)}
          onCancel={() => setVictimFor(null)}
          onPick={(victimId) => {
            const v = victimFor;
            setVictimFor(null);
            void send({ type: v.knight ? 'play_knight' : 'move_robber', hexId: v.hexId, victimId }, 'thunk');
          }}
        />
      )}

      {tut.step >= 0 && !winner && (
        <Tutorial step={tut.step} onNext={() => setTut((t) => ({ step: Math.min(t.step + 1, TUTORIAL_STEPS.length - 1) }))} onSkip={finishTutorial} onFinish={finishTutorial} />
      )}

      {winner && <ResultScreen view={view} youId={youId} onHome={app.leaveRoom} hubUrl={hubUrl} />}
    </div>
  );
}
