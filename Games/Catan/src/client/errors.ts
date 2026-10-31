// Mensagens amigáveis por código de erro do protocolo.
import type { EngineError } from '../shared/types';
import { ERROR_CODES } from '../shared/protocol';

const MESSAGES: Record<string, string> = {
  [ERROR_CODES.AUTH_REQUIRED]: 'Sessão inválida. Entre na sala de novo.',
  [ERROR_CODES.INVALID_PAYLOAD]: 'Comando inválido.',
  [ERROR_CODES.NOT_IN_ROOM]: 'Você não está nesta sala.',
  [ERROR_CODES.NOT_YOUR_TURN]: 'Não é a sua vez.',
  [ERROR_CODES.WRONG_PHASE]: 'Essa ação não está disponível agora.',
  [ERROR_CODES.INVALID_POSITION]: 'Posição inválida.',
  [ERROR_CODES.DISTANCE_RULE]: 'Muito perto de outra construção (regra de distância).',
  [ERROR_CODES.NOT_CONNECTED]: 'Você precisa estar ligado a uma estrada ou cidade.',
  [ERROR_CODES.BLOCKED_PATH]: 'Caminho bloqueado por construção adversária.',
  [ERROR_CODES.INSUFFICIENT_RESOURCES]: 'Você não tem recursos suficientes.',
  [ERROR_CODES.PIECE_LIMIT]: 'Acabaram suas peças deste tipo.',
  [ERROR_CODES.BANK_EMPTY]: 'O banco não tem esse recurso.',
  [ERROR_CODES.DEV_DECK_EMPTY]: 'O monte de desenvolvimento está vazio.',
  [ERROR_CODES.DEV_ALREADY_PLAYED]: 'Você já jogou uma carta de ação neste turno.',
  [ERROR_CODES.DEV_BOUGHT_THIS_TURN]: 'Não pode jogar carta comprada neste turno.',
  [ERROR_CODES.NO_DEV_CARD]: 'Você não tem essa carta de desenvolvimento.',
  [ERROR_CODES.INVALID_TRADE]: 'Troca inválida.',
  [ERROR_CODES.TRADE_NOT_AVAILABLE]: 'Essa troca não está disponível.',
  [ERROR_CODES.OFFER_EXPIRED]: 'A proposta de troca expirou.',
  [ERROR_CODES.STALE_VERSION]: 'O jogo mudou — sincronizando…',
  [ERROR_CODES.DUPLICATE_REQUEST]: 'Comando repetido.',
  [ERROR_CODES.REQUEST_CONFLICT]: 'Conflito de comandos. Tente de novo.',
  [ERROR_CODES.RATE_LIMITED]: 'Muitas mensagens. Aguarde um instante.',
  [ERROR_CODES.ROOM_NOT_FOUND]: 'Sala não encontrada.',
  [ERROR_CODES.ROOM_FULL]: 'A sala já está cheia.',
  [ERROR_CODES.ALREADY_STARTED]: 'A partida já começou.',
  [ERROR_CODES.COLOR_TAKEN]: 'Essa cor já foi escolhida.',
  [ERROR_CODES.NOT_HOST]: 'Só o anfitrião pode fazer isso.',
  [ERROR_CODES.NEED_PLAYERS]: 'Faltam jogadores para começar.',
  [ERROR_CODES.NOT_READY]: 'Nem todos os jogadores estão prontos.',
  [ERROR_CODES.INVALID_RECOVERY]: 'Código de recuperação inválido.',
  [ERROR_CODES.SESSION_CONFLICT]: 'Sessão ativa em outra conexão.',
  [ERROR_CODES.GAME_NOT_FOUND]: 'Partida não encontrada.',
  [ERROR_CODES.ALREADY_IN_ROOM]: 'Você já está em uma sala.',
  [ERROR_CODES.CODE_TAKEN]: 'O código da sala já está em uso.',
  [ERROR_CODES.INVALID_STATE]: 'Ação inválida no momento.',
  [ERROR_CODES.INTERNAL]: 'Erro no servidor. Tente de novo.',
};

export function errorText(err: EngineError): string {
  if (!err) return 'Algo deu errado.';
  return err.message || MESSAGES[err.code] || 'Algo deu errado.';
}
