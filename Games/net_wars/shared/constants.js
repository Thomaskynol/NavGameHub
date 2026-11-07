// Física/balance autoritativo. Importado por server e client (sem Node API aqui).
// Mudanças incr.2 (balance documentado):
// - Laser: dano 12→10 + cadência 0.5s (antes: sem cadência, DPS ilimitado no hold).
//   Base: 20 DPS → TTK ~5s numa nave de 100HP.
// - Buffs de dano (power-ups, 15s, sem acúmulo): Cadência (cd×0.8 → ×1.25 DPS),
//   Sobrecarga (dano×1.2), Triplo (2 projéteis laterais a 20% do dano → ×1.4 se todos
//   acertarem). Combinados: 1.25×1.2×1.4 ≈ 2.1x DPS (~2x, critério Fase 2).
// - Míssil: recarga 9s por nave (independe da arma selecionada), dano 35,
//   velocidade/curva/vida finitas, perde o alvo sem linha de visada, sem erro forçado.
// - Boost: drena 28/s, recupera 10/s (×1.9 com Propulsão); mult velocidade ×1.7.
//   Energia nunca é restaurada por trocar arma/menu — só regenera com o tempo.
// - Colisão com cenário: 2–5 de dano por impacto (escala com velocidade), cooldown 1s
//   por nave (sem dano por quadro); nave×nave só afasta, sem dano.
// - Power-ups: 6 tipos em posições fixas, respawn 20s, efeito 15s renovável sem
//   acumular, removido ao morrer; Reparo cura +40 (teto 100HP), Escudo teto 40.
// - Modos: FFA (2–12), teams 1v1–6v6 (FF off), survival 1–12 vs bots em waves
//   infinitas (intervalo 5s, máx 6 bots vivos simultâneos).
// - PvP 5min server-side; respawn 3s + proteção 2s (atirar encerra a proteção);
//   sala fecha com 12 humanos (13ª rejeitada); reconexão 30s sem duplicar.
export const TICK_HZ = 20;
export const SNAP_HZ = 10;
export const MAX_SPEED = 28; // W = frente máxima; S = ré a 60%
export const ACCEL = 26; // convergência p/ velocidade desejada (inércia leve)
export const ROLL_SPEED = 2.4; // rad/s do A/D
export const SHIP_HP = 100;
export const SHIP_RADIUS = 2.4;
export const RESPAWN_S = 3;
export const PROTECT_S = 2; // proteção pós-respawn (atirar encerra antes)
export const RECONNECT_S = 30; // fantasma p/ reconexão sem duplicar
export const DEFAULT_MATCH_LEN_S = 300; // 5min PvP
export const WORLD_BOUND = 350; // cubo semi-lado; passa disso, empurra de volta
export const MAX_PLAYERS = 12; // humanos por sala

// --- Laser ---
export const LASER_SPEED = 130;
export const LASER_LIFE = 1.2; // s
export const LASER_DAMAGE = 10;
export const LASER_COOLDOWN_S = 0.5; // cadência base → 20 DPS, TTK ~5s
export const CADENCE_MULT = 0.8; // power-up Cadência: cooldown ×0.8
export const OVERLOAD_MULT = 1.2; // power-up Sobrecarga: dano ×1.2
export const TRIPLE_SPREAD = 0.045; // rad de abertura dos laterais
export const TRIPLE_SIDE_MULT = 0.2; // laterais causam 20% do dano

// --- Míssil ---
export const MISSILE_DAMAGE = 35;
export const MISSILE_COOLDOWN_S = 9;
export const MISSILE_SPEED = 55;
export const MISSILE_TURN = 1.7; // rad/s máximo de curva
export const MISSILE_LIFE = 6; // s
export const MISSILE_LOCK_RANGE = 140;
export const MISSILE_LOCK_COS = 0.978; // ~12° do centro da mira (lock breve)

// --- Boost ---
export const BOOST_MAX = 100;
export const BOOST_DRAIN = 28; // por s (maior que a recuperação)
export const BOOST_REGEN = 10; // por s
export const PROPULSION_REGEN_MULT = 1.9; // power-up Propulsão acelera recuperação
export const BOOST_MULT = 1.7; // multiplicador de velocidade

// --- Cenário (esferas; mesmo formato no snapshot p/ debug) ---
export const STATION = { x: 0, y: 0, z: -160, r: 26 };
export const ASTEROIDS = [
  { x: 90, y: -20, z: -40, r: 14 },
  { x: -100, y: 30, z: 60, r: 17 },
  { x: 40, y: 60, z: 110, r: 12 },
  { x: -60, y: -50, z: -60, r: 10 },
];
export const IMPACT_MIN = 2;
export const IMPACT_MAX = 5;
export const IMPACT_COOLDOWN_S = 1; // sem dano por quadro

// --- Power-ups ---
export const POWERUP_TYPES = ['cadence', 'triple', 'overload', 'propulsion', 'repair', 'shield'];
export const POWERUP_SPOTS = [ // 6 posições fixas, 1 tipo cada
  { type: 'cadence', x: 60, y: 0, z: 0 },
  { type: 'triple', x: -60, y: 0, z: 0 },
  { type: 'overload', x: 0, y: 40, z: 60 },
  { type: 'propulsion', x: 0, y: -40, z: 60 },
  { type: 'repair', x: 0, y: 0, z: -60 },
  { type: 'shield', x: 0, y: 60, z: -40 },
];
export const POWERUP_RADIUS = 4;
export const POWERUP_RESPAWN_S = 20;
export const EFFECT_LEN_S = 15; // renovável, sem acúmulo
export const REPAIR_AMOUNT = 40;
export const SHIELD_MAX = 40;

// --- Modos / survival ---
export const MODES = ['ffa', 'teams', 'survival'];
export const WAVE_GAP_S = 5; // intervalo entre waves
export const MAX_BOTS_ALIVE = 6; // limite de bots simultâneos (doc: 6)
export const BOT_AIM_ERR = 0.06; // rad de erro plausível (sem erro forçado no míssil)
export const BOT_FIRE_RANGE = 80;
export const TEAMS = ['red', 'blue'];

// --- Câmera / mira (ver shared/camera.js p/ a geometria pura) ---
// A câmera (FP e TP) fica EXATAMENTE sobre a linha de tiro (nariz da nave) e
// olha paralelo a ela: o centro da tela é a linha de tiro em qualquer distância,
// curva ou obstáculo — sem supor que linhas paralelas separadas convergem.
// Em TP a nave própria é deslocada p/ baixo (só visual) p/ não bloquear a mira.
export const FP_EYE_BACK = 0.6;   // olho atrás da origem, sobre a linha de tiro
export const TP_CAM_DIST = 12.5;  // distância de perseguição (damped)
export const TP_SHIP_DROP = 1.25; // deslocamento visual da nave própria (TP)
export const CAM_MARGIN = 1.5;    // folga da câmera contra obstáculos
export const FP_RAD_PER_PX = 0.0022; // rad/pixel do mouse em 1ª pessoa (× sens)
export const MOUSE_PX_CLAMP = 400;    // px por evento (evita salto após lag)
export const AIM_EDGE_MARGIN = 20;    // px da borda p/ prender o ○ fora-da-tela/atrás (nunca some)

// --- Rede / limites de servidor ---
export const MAX_ROOMS = 512;      // salas simultâneas (evita esgotamento)
export const MAX_WS_PAYLOAD = 65536;   // bytes p/ mensagem WS (input é ~200B)
export const MAX_HTTP_BODY = 8192;     // bytes p/ corpo HTTP (close do Hub)
export const INPUT_MIN_MS = 15;        // intervalo mínimo entre inputs (≈66/s)
export const INPUT_STALE_MS = 1500;     // sem input novo por isso → neutraliza (sem empuxo/tiro)
export const HELLO_MIN_MS = 100;       // intervalo mínimo entre HELLOs
export const WS_BACKPRESSURE_SKIP = 4 * 1024 * 1024; // não acumula snapshot
export const WS_BACKPRESSURE_KILL = 16 * 1024 * 1024; // consumidor lento: corta

// --- Câmera / mira ---
// FP e TP: mouse move o DESEJO ○ (bolinha, estável no mundo) e o nariz
// persegue com w_max (instructor, shared/turn.js); FP usa câmera rígida no
// nariz sem auto-bank, TP usa chase + bank. Retículo fixo no centro = linha
// de tiro exata (nariz).
// ✛ central (fixa) = NARIZ = para onde o tiro vai; ◆ = impacto previsto do
// raio do nariz (mesmos colisores do servidor); ○ = ponto do desejo no mundo
// (regras vazio/oculto/muito-perto em shared/turn.js; fora-da-tela/atrás o
// HUD prende na borda com AIM_EDGE_MARGIN e nunca some).
export const TP_YAW_RATE = 1.8; // rad/s (3ª pessoa, mais pesado)
export const TP_PITCH_RATE = 1.8;
export const BANK_MAX = 1.1; // rad (~63°) de bank automático no modo TP
export const BANK_GAIN = 1.4; // bank alvo = clamp(yawErr * GAIN, ±MAX)
export const ROLL_CHASE = 4.0; // velocidade de rolagem até o bank alvo (TP)
export const RUDDER_SPEED = 1.1; // rad/s do A/D (leme fino, modo TP)
export const THR_RATE = 0.8; // manete 0..1 (até -0.6 ré) por segundo no modo TP
