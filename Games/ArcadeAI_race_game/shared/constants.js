// Asfalto Vivo — constantes compartilhadas (servidor + cliente).
// Fonte única da verdade para limites, tempos, física e cores.

export const MAX_PLAYERS = 6;
export const LAPS_DEFAULT = 3;
export const LAPS_MIN = 1;
export const LAPS_MAX = 5;
export const CHECKPOINTS = 8;          // cps por volta (cp0 = linha de chegada)
export const RECONNECT_MS = 30000;     // janela de reconexão do mesmo piloto
export const FINISH_GRACE_MS = 45000;  // prazo p/ demais terminarem após o 1º
export const COUNTDOWN_S = 3;
export const READY_TIMEOUT_MS = 20000; // timeout de carregamento da cena
export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I/O/0/1

export const SNAPSHOT_HZ = 15;
export const STATE_HZ = 15;            // envio de st (cliente→servidor)
export const PING_MS = 2000;
export const MAX_STATE_PER_SEC = 30;   // rate limit por conexão

// Física arcade (unidades SI). Ajuste de feeling só aqui.
export const PHYSICS = {
  maxSpeed: 42,            // m/s (~151 km/h) asfalto
  maxSpeedOff: 18,         // m/s fora da pista
  accel: 16,               // m/s²
  brake: 28,
  reverseMax: 10,
  coastDecel: 4.5,         // soltar acelerador
  offAccel: 8,
  offDrag: 10,             // arrasto extra fora da pista
  steerMax: 2.4,           // rad/s de rotação a baixa velocidade
  steerSpeedFalloff: 0.55, // quanto a esterçada cai com velocidade (0..1)
  gripBase: 8.0,           // aderência base (amortecimento da velocidade lateral)
  gripOff: 2.2,
  gripHandbrake: 0.9,      // freio de mão reduz aderência (derrapa)
  driftYawBoost: 1.35,     // yaw extra durante derrapagem
  wallLatKeep: 0.35,       // amortecimento da componente lateral na parede
  carRadius: 1.6,          // raio de colisão carro-carro (servidor)
  wallMargin: 3.5,         // acostamento além da largura/2 antes da parede
  recoverCooldownMs: 3000,
  respawnY: 0,
};

export const NITRO = {
  tank: 100,
  drainPerSec: 28,
  regenPerSec: 12,         // regeneração enquanto não usado
  regenDelayMs: 900,       // espera após soltar p/ começar a regenerar
  speedBoost: 1.18,        // multiplicador de vmax
  accelBoost: 1.7,         // multiplicador de aceleração
};

export const REMOTE_INTERP_DELAY_MS = 120; // atraso de interpolação dos remotos

// Cores disponíveis (exclusivas por sala). `id` estável; `hex` p/ render.
export const COLORS = [
  { id: 'vermelho', hex: '#e5484d', name: 'Vermelho' },
  { id: 'azul',     hex: '#3b82f6', name: 'Azul' },
  { id: 'verde',    hex: '#30b566', name: 'Verde' },
  { id: 'amarelo',  hex: '#f5a524', name: 'Amarelo' },
  { id: 'roxo',     hex: '#8b5cf6', name: 'Roxo' },
  { id: 'laranja',  hex: '#f97316', name: 'Laranja' },
  { id: 'turquesa', hex: '#14b8a6', name: 'Turquesa' },
  { id: 'rosa',     hex: '#ec4899', name: 'Rosa' },
  { id: 'branco',   hex: '#e8e8ec', name: 'Branco' },
  { id: 'preto',    hex: '#3a3f4b', name: 'Grafite' },
];

export const STORAGE = {
  settings: 'av.settings',
  records: 'av.records',
  session: 'av.session',
};

export const GAME_NAME = 'Asfalto Vivo';
