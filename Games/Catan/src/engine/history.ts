// Histórico: eventos públicos/privados com seq crescente e meta por seq.
import { HISTORY_LIMIT } from '../shared/constants';
import type { HistoryEvent, HistoryMeta } from '../shared/types';
import type { GameState } from '../shared/types';

type NoSeq<T> = T extends { seq: number } ? Omit<T, 'seq'> : never;
type EventInput = NoSeq<HistoryEvent>;

/** Anexa evento, atribui seq e aplica HISTORY_LIMIT descartando os mais antigos. */
export function pushEvent(state: GameState, event: EventInput, meta: HistoryMeta): void {
  const seq = state.historySeq + 1;
  state.historySeq = seq;
  state.history.events.push({ ...event, seq } as HistoryEvent);
  state.history.meta[seq] = meta;
  while (state.history.events.length > HISTORY_LIMIT) {
    const dropped = state.history.events.shift();
    if (dropped) delete state.history.meta[dropped.seq];
  }
}

/** Evento público de conveniência. */
export function pushPublic(state: GameState, event: EventInput): void {
  pushEvent(state, event, { visibility: 'public' });
}
