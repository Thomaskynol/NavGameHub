// DI do motor de regras: interface estrutural espelhando docs/architecture.md.
// O módulo real (`src/engine`) é carregado sob demanda; testes injetam um fake.
import type { PlayerColor, PlayerId, ResourceKind } from '../shared/constants';
import type { GameCommand } from '../shared/protocol';
import type { EngineResult, GameState, RandomSource } from '../shared/types';

export interface GameEngineApi {
  createGame(opts: {
    players: { id: PlayerId; name: string; color: PlayerColor }[];
    boardSeed: string;
    rng: RandomSource;
  }): GameState;
  applyCommand(state: GameState, playerId: PlayerId, cmd: GameCommand, deps: { rng: RandomSource }): EngineResult;
  publicVictoryPoints(state: GameState, playerId: PlayerId): number;
  totalVictoryPoints(state: GameState, playerId: PlayerId): number;
  bestBankRate(state: GameState, playerId: PlayerId, resource: ResourceKind): 2 | 3 | 4;
  computeLongestRoad(state: GameState, playerId: PlayerId): number;
}

/** Import dinâmico do motor real (empacotado pelo esbuild em produção). */
export async function loadEngine(): Promise<GameEngineApi> {
  const mod = await import('../engine');
  return mod;
}
