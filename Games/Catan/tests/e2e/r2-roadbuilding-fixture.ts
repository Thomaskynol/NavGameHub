// Fixture R2-browser (lane R2): preparação determinística da carta Construção de
// Estradas SEM tocar produção — só constantes + documentação. O spec que a usa
// (e2e/r2-roadbuilding.spec.ts) joga TODO o resto pela interface real.
//
// Por que estas seeds:
// - `seed_rng` (hook, antes do start_game) fixa a RNG da sala; o baralho de
//   desenvolvimento é embaralhado com ela no createGame, então a ordem do deck
//   é determinística para um dado seed.
// - R2_RNG_SEED='r2-deck-31' deixa roadBuilding no TOPO do deck (as 2 primeiras
//   compras, via pop): verificado offline com createGame({boardSeed} +
//   seededRandomSource(seed)) — top3=[roadBuilding,roadBuilding,knight].
//   Sem victoryPoint no top3 => comprar não dispara vitória acidental.
// - R2_BOARD_SEED fixa o tabuleiro (generateBoard usa só o boardSeed).
// - force_next_dice em todas as rolagens evita 7/descarte/ladrão; a produção
//   natural paga as 2 compras (1 lã+1 grão+1 minério cada).
// - load_near_win_fixture NÃO é usada aqui: ela somaria 8 PV aos 2 do setup e a
//   primeira compra terminaria a partida por vitória imediata.
//
// Nada aqui chama motor/projeção: só strings documentadas.
export const R2_RNG_SEED = 'r2-deck-31';
export const R2_BOARD_SEED = 'r2-board-01';

/** Nomes dos 2 jogadores do spec (anfitriã = sujeito do teste). */
export const R2_NAMES = ['R2-Ana', 'R2-Bia'] as const;

/** Texto de fase esperado durante as estradas gratuitas (TurnBar PHASE_LABEL). */
export const R2_FREE_ROAD_PHASE = 'Construção de estradas — estradas gratuitas';
