// Painel direito com abas: Histórico, Conversa, Ofertas.
import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, type PlayerId } from '../../shared/constants';
import type { GameView, OfferView } from '../../shared/protocol';
import { RESOURCE_KINDS, type ResourceKind } from '../../shared/constants';
import { ResourceIcon } from '../ui/icons';

function ResourceList({ res }: { res: Partial<Record<ResourceKind, number>> }) {
  const items = RESOURCE_KINDS.filter((k) => res[k]);
  if (items.length === 0) return <span className="muted">nada</span>;
  return (
    <span className="trade-line">
      {items.map((k) => (
        <span key={k} className="row" style={{ gap: 2 }}>
          <ResourceIcon kind={k} size={14} />
          <b>×{res[k]}</b>
        </span>
      ))}
    </span>
  );
}

function OfferCard({
  offer,
  view,
  youId,
  onRespond,
  onCancel,
}: {
  offer: OfferView;
  view: GameView;
  youId: PlayerId;
  onRespond(offerId: string, response: 'accept' | 'reject'): void;
  onCancel(offerId: string): void;
}) {
  const from = view.players.find((p) => p.id === offer.fromPlayerId);
  const to = view.players.find((p) => p.id === offer.toPlayerId);
  const isMine = offer.fromPlayerId === youId;
  const isForMe = offer.toPlayerId === youId;
  return (
    <div className="offer-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>
          <span className={`pc-${from?.color}`}>{from?.name ?? '?'}</span>
          <span className="muted"> → </span>
          <span className={`pc-${to?.color}`}>{to?.name ?? '?'}</span>
        </b>
        {isMine && <span className="tag tag-gold">sua proposta</span>}
      </div>
      <div className="small">
        <div className="row" style={{ gap: 6 }}>
          <span className="muted">Dá:</span> <ResourceList res={offer.give} />
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="muted">Quer:</span> <ResourceList res={offer.want} />
        </div>
      </div>
      <div className="row">
        {isForMe && (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onRespond(offer.id, 'accept')}>
              Aceitar
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onRespond(offer.id, 'reject')}>
              Recusar
            </button>
          </>
        )}
        {isMine && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => onCancel(offer.id)}>
            Cancelar
          </button>
        )}
      </div>
      <span className="small muted">Ofertas expiram no fim do turno de quem propôs.</span>
    </div>
  );
}

interface SideTabsProps {
  view: GameView;
  youId: PlayerId;
  activeTab: 'history' | 'chat' | 'offers';
  onTab(tab: 'history' | 'chat' | 'offers'): void;
  onRespond(offerId: string, response: 'accept' | 'reject'): void;
  onCancel(offerId: string): void;
  onSendChat(text: string): void;
}

export default function SideTabs({ view, youId, activeTab, onTab, onRespond, onCancel, onSendChat }: SideTabsProps) {
  const [chatText, setChatText] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);
  const histRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = activeTab === 'chat' ? logRef.current : histRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeTab, view.chat.length, view.history.length]);

  const offerCount = view.offers.length;

  return (
    <div className="panel-dark area-side" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="side-tabs" role="tablist" aria-label="Painéis laterais">
        <button type="button" role="tab" aria-selected={activeTab === 'history'} className="side-tab" onClick={() => onTab('history')}>
          Histórico
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'chat'} className="side-tab" onClick={() => onTab('chat')}>
          Conversa
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'offers'} className="side-tab" onClick={() => onTab('offers')}>
          Ofertas{offerCount > 0 ? ` (${offerCount})` : ''}
        </button>
      </div>

      {activeTab === 'history' && (
        <div className="side-body" ref={histRef}>
          {[...view.history].reverse().map((h) => (
            <div key={h.seq} className="hist-line">
              {h.playerId ? (
                <span className={`pc-${view.players.find((p) => p.id === h.playerId)?.color ?? 'white'}`}>● </span>
              ) : null}
              {h.text}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'chat' && (
        <>
          <div className="side-body" ref={logRef}>
            {view.chat.map((m) => (
              <div key={m.id} className="small" style={{ color: '#e8dcc0' }}>
                <b className={`pc-${m.color}`}>{m.name}: </b>
                {m.text}
              </div>
            ))}
            {view.chat.length === 0 && <span className="small muted">Sem mensagens ainda.</span>}
          </div>
          <form
            className="chat-form"
            style={{ borderTopColor: 'var(--wood-line)' }}
            onSubmit={(e) => {
              e.preventDefault();
              const t = chatText.trim();
              if (!t) return;
              onSendChat(t.slice(0, CHAT_MAX_LENGTH));
              setChatText('');
            }}
          >
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
        </>
      )}

      {activeTab === 'offers' && (
        <div className="side-body">
          {view.offers.length === 0 && <span className="small muted">Nenhuma oferta no momento.</span>}
          {view.offers.map((o) => (
            <OfferCard key={o.id} offer={o} view={view} youId={youId} onRespond={onRespond} onCancel={onCancel} />
          ))}
        </div>
      )}
    </div>
  );
}
