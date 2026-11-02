// Contexto da aplicação: estado de sessão, view do jogo, envio de comandos, toasts.
import { createContext, useContext } from 'react';
import type { GameCommand, GameView, LobbyCommand, SessionPayload } from '../shared/protocol';
import type { LobbyResult } from './net';
import type { Prefs, StoredSession } from './session';

export type Screen = 'home' | 'lobby' | 'game';
export type ToastKind = 'info' | 'error' | 'success';

export interface ConflictInfo {
  roomCode: string;
  playerId: string;
}

export interface AppApi {
  screen: Screen;
  view: GameView | null;
  session: StoredSession | null;
  connected: boolean;
  prefs: Prefs;
  mock: boolean;
  /** Jogador entrou em sessão ativa em outra conexão (precisa escolher). */
  conflict: ConflictInfo | null;
  replaced: { by: string } | null;
  goto(screen: Screen): void;
  /** Salva a sessão retornada por create/join/bind e entra no lobby. */
  adoptSession(session: SessionPayload): void;
  sendGame(payload: GameCommand): Promise<boolean>;
  sendLobby(payload: LobbyCommand): Promise<LobbyResult>;
  toast(kind: ToastKind, text: string): void;
  updatePrefs(patch: Partial<Prefs>): void;
  leaveRoom(): void;
  resolveConflictTakeover(): void;
  resolveConflictNewPlayer(): void;
  dismissReplaced(): void;
  openSessionModal(): void;
  /** Abre o painel "Regras e custos". */
  openRules(): void;
  /** Mock (dev): view inicial da partida simulada. */
  mockView?: GameView;
  sendMockGame?(payload: GameCommand): Promise<boolean>;
}

export const AppCtx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('AppCtx ausente');
  return ctx;
}
