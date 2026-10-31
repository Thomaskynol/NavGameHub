// Asfalto Vivo — tipos de mensagem do protocolo WebSocket.
// Fonte canônica de nomes de tipo; formatos descritos em ARCHITECTURE.md §3.
// Uso: import { C2S, S2C } e confira `msg.t`.

export const C2S = {
  CREATE: 'create',        // {name, color?, room?, htok?}  (room = código pedido pelo Hub; htok = dono p/ retry/close)
  JOIN: 'join',            // {room, name, color?, resume?, htok?}  (htok aceito como contexto do launch; identidade do resume é o token)
  LEAVE: 'leave',          // {}
  SET: 'set',              // {color?|null, ready?|null, track?|null, laps?|null}
  START: 'start',          // {}
  READY_LOAD: 'ready_load',// {}
  ST: 'st',                // {x,z,hd,v,steer,hb,nit,off,dr}  @ STATE_HZ
  PING: 'ping',            // {ts}
};

export const S2C = {
  WELCOME: 'welcome',      // {serverNow}
  ERR: 'err',              // {code, msg}
  JOINED: 'joined',        // {room, you, token, mode, state}
  STATE: 'state',          // lobby/room state (ver ARCHITECTURE §3)
  PREPARE: 'prepare',      // {track, laps, roster, grid, startAt}
  CD: 'cd',                // {n, at}  n=3..0 (0=GO)
  SN: 'sn',                // {seq, raceNow, cars:[...]}
  LAP: 'lap',              // {id, lap, timeMs, bestMs, valid}
  FIN: 'fin',              // {id, place, timeMs}
  DEADLINE: 'deadline',    // {at}
  RESULTS: 'results',      // {rows, reason}
  BACK_LOBBY: 'back_lobby',// {}
  CANCEL: 'cancel',        // {msg}
  SNAP_SELF: 'snap_self',  // {x,z,hd,v}
  COLLIDE: 'collide',      // {a,b,imp}
  NOTICE: 'notice',        // {kind, msg}
  BYE: 'bye',              // {reason}
  PONG: 'pong',            // {ts, serverNow}
};

export const ERR = {
  NOT_FOUND: 'NOT_FOUND',
  FULL: 'FULL',
  BAD_NAME: 'BAD_NAME',
  BAD_COLOR: 'BAD_COLOR',
  NOT_HOST: 'NOT_HOST',
  NOT_READY: 'NOT_READY',
  RACING: 'RACING',
  INVALID: 'INVALID',
  RATE: 'RATE',
  RECONNECT_EXPIRED: 'RECONNECT_EXPIRED',
  REPLACED: 'replaced',
  CODE_TAKEN: 'CODE_TAKEN',
};

export const ROOM_STATUS = { LOBBY: 'lobby', COUNTDOWN: 'countdown', RACE: 'race', RESULTS: 'results' };
