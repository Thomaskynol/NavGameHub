// Modais do jogo: banco, trocas, descarte, dev cards, regras, sessão, conflitos.
import { useMemo, useState } from 'react';
import { COSTS, RESOURCE_KINDS, type ResourceKind, type PlayerId } from '../../shared/constants';
import type { GameView } from '../../shared/protocol';
import { bestBankRate } from '../board/legalClient';
import Modal, { Stepper } from '../ui/Modal';
import { CostIcons, COST_LABEL } from './HandPanel';
import { CopyIcon, ResourceIcon, RobberIcon } from '../ui/icons';

const RES_NAME: Record<ResourceKind, string> = {
  brick: 'tijolo',
  lumber: 'madeira',
  wool: 'lã',
  grain: 'grão',
  ore: 'minério',
};

function ResourcePicker({ value, onChange, label }: { value: ResourceKind; onChange(r: ResourceKind): void; label: string }) {
  return (
    <div className="row" role="radiogroup" aria-label={label}>
      {RESOURCE_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          className={`color-swatch${value === k ? '' : ''}`}
          style={{
            background: '#fff8e8',
            borderColor: value === k ? 'var(--gold)' : 'var(--parchment-shadow)',
            boxShadow: value === k ? '0 0 0 3px var(--gold-soft)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 46,
            height: 42,
          }}
          onClick={() => onChange(k)}
          title={RES_NAME[k]}
        >
          <ResourceIcon kind={k} size={22} />
        </button>
      ))}
    </div>
  );
}

export function BankTradeModal({
  view,
  onClose,
  onConfirm,
}: {
  view: GameView;
  onClose(): void;
  onConfirm(give: Partial<Record<ResourceKind, number>>, want: Partial<Record<ResourceKind, number>>): void;
}) {
  const [giveRes, setGiveRes] = useState<ResourceKind>('lumber');
  const [wantRes, setWantRes] = useState<ResourceKind>('brick');
  // Regra clássica/servidor: a taxa vale pelo recurso ENTREGUE (lote homogêneo).
  const rate = bestBankRate(view, giveRes);
  const have = view.you.resources[giveRes];
  const bankHas = view.bankCounts[wantRes];
  const ok = have >= rate && giveRes !== wantRes && bankHas >= 1;

  return (
    <Modal
      title="Trocar com o banco (marítima)"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" style={{ color: 'var(--ink)', borderColor: 'var(--parchment-shadow)' }} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ok}
            onClick={() => onConfirm({ [giveRes]: rate }, { [wantRes]: 1 })}
          >
            Trocar {rate}:1
          </button>
        </>
      }
    >
      <p className="small muted" style={{ margin: 0 }}>
        Com seus portos, entregar {RES_NAME[giveRes]} custa <b>{rate}:1</b> (lote de {rate} iguais → 1 carta
        qualquer). Você tem {have} de {RES_NAME[giveRes]}.
      </p>
      <div className="col">
        <b>Você entrega ({rate} cartas):</b>
        <ResourcePicker value={giveRes} onChange={setGiveRes} label="Recurso entregue" />
      </div>
      <div className="col">
        <b>Você recebe (1 carta):</b>
        <ResourcePicker value={wantRes} onChange={setWantRes} label="Recurso recebido" />
      </div>
      {!ok && (
        <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>
          {giveRes === wantRes
            ? 'Escolha recursos diferentes.'
            : bankHas < 1
              ? `O banco não tem ${RES_NAME[wantRes]}.`
              : `Você precisa de ${rate} cartas de ${RES_NAME[giveRes]}.`}
        </p>
      )}
    </Modal>
  );
}

export function OfferTradeModal({
  view,
  youId,
  onClose,
  onConfirm,
  preset,
}: {
  view: GameView;
  youId: PlayerId;
  onClose(): void;
  onConfirm(toPlayerId: PlayerId, give: Partial<Record<ResourceKind, number>>, want: Partial<Record<ResourceKind, number>>): void;
  preset?: { toPlayerId: PlayerId; give: Partial<Record<ResourceKind, number>>; want: Partial<Record<ResourceKind, number>> };
}) {
  const others = view.players.filter((p) => p.id !== youId);
  const [target, setTarget] = useState<PlayerId>(preset?.toPlayerId ?? others[0]?.id ?? '');
  const [give, setGive] = useState<Record<ResourceKind, number>>(() => {
    const init: Record<ResourceKind, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    for (const [k, n] of Object.entries(preset?.give ?? {})) init[k as ResourceKind] = n as number;
    return init;
  });
  const [want, setWant] = useState<Record<ResourceKind, number>>(() => {
    const init: Record<ResourceKind, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    for (const [k, n] of Object.entries(preset?.want ?? {})) init[k as ResourceKind] = n as number;
    return init;
  });

  const giveTotal = RESOURCE_KINDS.reduce((a, k) => a + give[k], 0);
  const wantTotal = RESOURCE_KINDS.reduce((a, k) => a + want[k], 0);
  const withinHand = RESOURCE_KINDS.every((k) => give[k] <= view.you.resources[k]);
  const ok = !!target && giveTotal > 0 && wantTotal > 0 && withinHand && giveTotal <= 10 && wantTotal <= 10;

  const set = (side: 'give' | 'want', k: ResourceKind, v: number) => {
    const upd = side === 'give' ? setGive : setWant;
    upd((prev) => ({ ...prev, [k]: v }));
  };

  return (
    <Modal
      title={preset ? 'Contra-oferta' : 'Propor troca'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" style={{ color: 'var(--ink)', borderColor: 'var(--parchment-shadow)' }} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => {
            const g: Partial<Record<ResourceKind, number>> = {};
            const w: Partial<Record<ResourceKind, number>> = {};
            for (const k of RESOURCE_KINDS) {
              if (give[k] > 0) g[k] = give[k];
              if (want[k] > 0) w[k] = want[k];
            }
            onConfirm(target, g, w);
          }}>
            Enviar proposta
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="trade-to">Para quem</label>
        <select id="trade-to" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="col">
        <b>Você entrega</b>
        {RESOURCE_KINDS.map((k) => (
          <div key={k} className="cost-row">
            <span className="row" style={{ gap: 6 }}>
              <ResourceIcon kind={k} />
              {RES_NAME[k]} <span className="small muted">(tem {view.you.resources[k]})</span>
            </span>
            <Stepper label={RES_NAME[k]} value={give[k]} max={Math.min(10, view.you.resources[k])} onChange={(v) => set('give', k, v)} />
          </div>
        ))}
      </div>
      <div className="col">
        <b>Você quer</b>
        {RESOURCE_KINDS.map((k) => (
          <div key={k} className="cost-row">
            <span className="row" style={{ gap: 6 }}>
              <ResourceIcon kind={k} />
              {RES_NAME[k]}
            </span>
            <Stepper label={RES_NAME[k]} value={want[k]} max={10} onChange={(v) => set('want', k, v)} />
          </div>
        ))}
      </div>
      {preset && (
        <p className="small muted" style={{ margin: 0 }}>
          Contra-oferta substitui a anterior (a recusada/cancelada sai da lista).
        </p>
      )}
    </Modal>
  );
}

export function DiscardModal({
  view,
  onConfirm,
}: {
  view: GameView;
  onConfirm(cards: Partial<Record<ResourceKind, number>>): void;
}) {
  const total = RESOURCE_KINDS.reduce((a, k) => a + view.you.resources[k], 0);
  const need = Math.floor(total / 2);
  const [cards, setCards] = useState<Record<ResourceKind, number>>(() => ({
    brick: 0,
    lumber: 0,
    wool: 0,
    grain: 0,
    ore: 0,
  }));
  const chosen = RESOURCE_KINDS.reduce((a, k) => a + cards[k], 0);
  const ok = chosen === need;

  return (
    <Modal
      title={`Você precisa descartar ${need} carta${need === 1 ? '' : 's'}`}
      blocking
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ok}
          onClick={() => {
            const out: Partial<Record<ResourceKind, number>> = {};
            for (const k of RESOURCE_KINDS) if (cards[k] > 0) out[k] = cards[k];
            onConfirm(out);
          }}
        >
          Descartar {chosen}/{need}
        </button>
      }
    >
      <p className="small muted" style={{ margin: 0 }}>
        O 7 obriga todos com mais de 7 cartas a descartarem metade (arredondada para baixo). Escolha exatamente {need}.
      </p>
      {RESOURCE_KINDS.map((k) => (
        <div key={k} className="cost-row">
          <span className="row" style={{ gap: 6 }}>
            <ResourceIcon kind={k} />
            {RES_NAME[k]} <span className="small muted">(tem {view.you.resources[k]})</span>
          </span>
          <Stepper label={RES_NAME[k]} value={cards[k]} max={view.you.resources[k]} onChange={(v) => setCards((p) => ({ ...p, [k]: v }))} />
        </div>
      ))}
    </Modal>
  );
}

export function MonopolyModal({ onClose, onPick }: { onClose(): void; onPick(r: ResourceKind): void }) {
  return (
    <Modal title="Monopólio — escolha o recurso" onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>
        Anuncie um recurso: todos os rivais entregam todas as cartas que têm dele.
      </p>
      <div className="row">
        {RESOURCE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="btn btn-parchment"
            style={{ flexDirection: 'column', padding: '12px 14px' }}
            onClick={() => onPick(k)}
          >
            <ResourceIcon kind={k} size={26} />
            {RES_NAME[k]}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function YearOfPlentyModal({
  onClose,
  onPick,
}: {
  onClose(): void;
  onPick(resources: ResourceKind[]): void;
}) {
  const [picked, setPicked] = useState<ResourceKind[]>([]);
  const toggle = (k: ResourceKind) => {
    setPicked((prev) => {
      if (prev.includes(k)) return prev.filter((x) => x !== k);
      if (prev.length >= 2) return [prev[1], k];
      return [...prev, k];
    });
  };
  return (
    <Modal
      title="Fartura — escolha 1 ou 2 cartas"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" style={{ color: 'var(--ink)', borderColor: 'var(--parchment-shadow)' }} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => onPick(picked)}>
            Pegar do banco
          </button>
        </>
      }
    >
      <p className="small muted" style={{ margin: 0 }}>
        Tome cartas do banco (pode repetir o mesmo tipo).
      </p>
      <div className="row">
        {RESOURCE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="btn btn-parchment"
            style={{
              flexDirection: 'column',
              padding: '12px 14px',
              outline: picked.includes(k) ? '3px solid var(--gold)' : undefined,
            }}
            aria-pressed={picked.includes(k)}
            onClick={() => toggle(k)}
          >
            <ResourceIcon kind={k} size={26} />
            {RES_NAME[k]}
            {picked.filter((x) => x === k).length > 0 && <b>×{picked.filter((x) => x === k).length}</b>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function VictimPicker({
  view,
  victimIds,
  onPick,
  onCancel,
}: {
  view: GameView;
  victimIds: PlayerId[];
  onPick(victimId?: PlayerId): void;
  onCancel(): void;
}) {
  return (
    <Modal title="Roubar — escolha a vítima" onClose={onCancel}>
      <div className="victim-list">
        {victimIds.map((id) => {
          const p = view.players.find((x) => x.id === id);
          const n = p?.resourcesCount ?? 0;
          return (
            <button key={id} type="button" className="btn btn-parchment" onClick={() => onPick(id)}>
              <span className={`pc-dot bg-${p?.color ?? 'white'}`} />
              {p?.name ?? id} · {n === 1 ? '1 carta' : `${n} cartas`}
            </button>
          );
        })}
        {victimIds.length === 0 && (
          <button type="button" className="btn btn-primary" onClick={() => onPick(undefined)}>
            Nenhuma vítima por perto — mover mesmo assim
          </button>
        )}
      </div>
    </Modal>
  );
}

export function RulesModal({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Regras e custos (resumo)" onClose={onClose} wide>
      <div className="stack">
        <section>
          <h3 style={{ margin: '0 0 8px' }}>Custos de construção</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {(Object.keys(COSTS) as (keyof typeof COSTS)[]).map((k) => (
                <tr key={k} style={{ borderBottom: '1px solid rgba(133,112,79,0.25)' }}>
                  <td style={{ padding: '6px 0', fontWeight: 700 }}>{COST_LABEL[k]}</td>
                  <td style={{ padding: '6px 0' }}>
                    <CostIcons cost={COSTS[k]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 style={{ margin: '0 0 8px' }}>Sequência do turno</h3>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li><b>Produção:</b> role os dados (obrigatório).</li>
            <li><b>Trocas:</b> doméstica (com jogadores) e marítima (banco).</li>
            <li><b>Construção:</b> estradas, assentamentos, cidades e desenvolvimentos.</li>
            <li><b>7:</b> metade descarta, o atacante move o ladrão e rouba uma carta.</li>
            <li><b>Vitória:</b> 10 pontos no seu turno encerra a partida.</li>
          </ol>
        </section>

        <section>
          <h3 style={{ margin: '0 0 8px' }}>Pontos</h3>
          <p className="small" style={{ margin: 0, lineHeight: 1.7 }}>
            Assentamento 1 · Cidade 2 · Maior Estrada 2 (5+ estradas) · Maior Exército 2 (3+ cavaleiros) · Ponto de
            Vitória 1 cada. Recursos nunca são entregues por recusa — produção é automática.
          </p>
        </section>

        <section>
          <h3 style={{ margin: '0 0 8px' }}>Portos</h3>
          <p className="small" style={{ margin: 0, lineHeight: 1.7 }}>
            4 portos genéricos dão taxa <b>3:1</b>; 5 portos especiais dão <b>2:1</b> entregando o recurso
            indicado (2 cartas iguais daquele recurso → 1 carta qualquer do banco).
            Controle um porto construindo assentamento ou cidade em uma das duas interseções do cais.
            Sem porto, a taxa padrão é <b>4:1</b>.
          </p>
        </section>

        <p className="small muted" style={{ margin: 0 }}>
          Projeto independente, não oficial. Em caso de conflito, vale o manual oficial da edição adotada.
        </p>
      </div>
    </Modal>
  );
}

export function SessionModal({ roomCode, recoveryCode, onClose }: { roomCode: string; recoveryCode: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  const short = useMemo(() => recoveryCode.slice(0, 24) + '…', [recoveryCode]);
  return (
    <Modal title="Minha sessão" onClose={onClose}>
      <div className="col">
        <p className="small muted" style={{ margin: 0 }}>
          Guarde este código para retomar a partida em outra aba ou navegador. Ele não pode ser recuperado depois.
        </p>
        <div className="field">
          <label>Sala</label>
          <div className="code-big">{roomCode}</div>
        </div>
        <div className="field">
          <label>Código de recuperação</label>
          <div className="small" style={{ wordBreak: 'break-all', background: '#fff8e8', padding: 10, borderRadius: 8, border: '1px solid var(--parchment-shadow)' }}>
            {short}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(recoveryCode);
            } catch {
              // clipboard pode ser bloqueado
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
        >
          <CopyIcon />
          {copied ? <span>Copiado!</span> : 'Copiar código de recuperação'}
        </button>
      </div>
    </Modal>
  );
}

export function ConflictDialog({
  onTakeover,
  onNewPlayer,
}: {
  onTakeover(): void;
  onNewPlayer(): void;
}) {
  return (
    <Modal title="Sessão ativa em outra aba ou dispositivo" blocking>
      <p style={{ margin: 0 }}>
        Esta partida está sendo jogada em outra conexão. O que você quer fazer?
      </p>
      <div className="col">
        <button type="button" className="btn btn-primary" onClick={onTakeover}>
          Recuperar controle
        </button>
        <span className="small muted">Assume esta sessão; a outra aba perde o controle.</span>
        <button type="button" className="btn btn-ghost" style={{ color: 'var(--ink)', borderColor: 'var(--parchment-shadow)' }} onClick={onNewPlayer}>
          Entrar como novo jogador
        </button>
        <span className="small muted">Entra na sala com um apelido novo (se houver vaga).</span>
      </div>
    </Modal>
  );
}

export function ReplacedDialog({ by, onDismiss }: { by: string; onDismiss(): void }) {
  return (
    <Modal title="Sessão substituída" blocking>
      <div className="row" style={{ gap: 10 }}>
        <RobberIcon size={28} />
        <p style={{ margin: 0 }}>
          Outra conexão assumiu o controle da sua sessão (<b>{by}</b>). Esta aba não pode mais jogar.
        </p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onDismiss}>
        Voltar para o início
      </button>
    </Modal>
  );
}
