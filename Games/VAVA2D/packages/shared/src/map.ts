import type { MapId, Obstacle, Vec2 } from './types.js';
import { POWERUP } from './constants.js';

const obstacleData = [
  { kind: 'rock', x: 620, y: 360, radius: 54 },
  { kind: 'tree', x: 980, y: 520, radius: 38 },
  { kind: 'rock', x: 1500, y: 300, radius: 46 },
  { kind: 'tree', x: 1900, y: 460, radius: 40 },
  { kind: 'rock', x: 2050, y: 900, radius: 56 },
  { kind: 'tree', x: 1750, y: 1080, radius: 38 },
  // Era (1400, 760): o vão ficava em cima da porta leste da casa.
  { kind: 'rock', x: 1560, y: 520, radius: 64 },
  { kind: 'tree', x: 760, y: 950, radius: 36 },
  { kind: 'rock', x: 500, y: 1250, radius: 48 },
  { kind: 'tree', x: 1050, y: 1280, radius: 40 },
  { kind: 'rock', x: 2250, y: 1300, radius: 40 },
  { kind: 'tree', x: 300, y: 620, radius: 34 },
] as const;

/**
 * Casa do Campo Aberto: retângulo 560x420 no centro da arena, com 4 portas
 * de 100px (N/S centradas com vãos espelhados + par L/O desencontrado de
 * propósito, sem túnel reto de um lado ao outro) e 2 divisórias internas
 * formando 3 cômodos, mais 2 vestíbulos em L logo após as portas N/S: quem
 * entra vira de lado para sair, e a granada jogada de fora em linha reta
 * morre na parede cheia do fundo (explosão contida no vestíbulo).
 * A colisão reaproveita os círculos de sempre (kind 'wall'); o renderer
 * desenha as paredes por cima a partir de HOUSE_WALL_RUNS.
 */
export const HOUSE = {
  x0: 920,
  y0: 590,
  x1: 1480,
  y1: 1010,
  wallRadius: 22,
  doors: [
    { side: 'N', at: 1200, width: 100 },
    { side: 'S', at: 1200, width: 100 },
    { side: 'E', at: 860, width: 100 },
    { side: 'W', at: 740, width: 100 },
  ],
  // Divisórias internas: segmentos com vãos de passagem (coordenada do eixo).
  dividers: [
    { x1: 920, y1: 800, x2: 1480, y2: 800, gaps: [{ from: 950, to: 1030 }] },
    { x1: 1040, y1: 800, x2: 1040, y2: 1010, gaps: [{ from: 860, to: 940 }] },
    // Vestíbulo N em L: entra pela porta N, sai pela lateral oeste.
    { x1: 1130, y1: 590, x2: 1130, y2: 700, gaps: [{ from: 615, to: 695 }] },
    { x1: 1270, y1: 590, x2: 1270, y2: 700, gaps: [] },
    { x1: 1130, y1: 700, x2: 1270, y2: 700, gaps: [] },
    // Vestíbulo S em L: entra pela porta S, sai pela lateral leste.
    { x1: 1130, y1: 900, x2: 1130, y2: 1010, gaps: [] },
    { x1: 1270, y1: 900, x2: 1270, y2: 1010, gaps: [{ from: 905, to: 985 }] },
    { x1: 1130, y1: 900, x2: 1270, y2: 900, gaps: [] },
  ],
} as const;

export interface HouseWallRun {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  interior: boolean;
}

export interface HouseDoorSpan {
  side: 'N' | 'S' | 'E' | 'W';
  from: number;
  to: number;
}

const WALL_SPACING = 28;
// O centro do círculo mais próximo recua 14px da borda do vão: o vão efetivo
// (~70px+) segue passável e a parede visual não deixa fresta de colisão.
const EDGE_INSET = 14;

function runsAlong(
  start: number,
  end: number,
  gaps: ReadonlyArray<{ from: number; to: number }>,
): Array<[number, number]> {
  const sorted = [...gaps].sort((a, b) => a.from - b.from);
  const runs: Array<[number, number]> = [];
  let cursor = start;
  for (const gap of sorted) {
    const runEnd = gap.from - EDGE_INSET;
    if (runEnd >= cursor) runs.push([cursor, Math.min(runEnd, end)]);
    cursor = Math.max(cursor, gap.to + EDGE_INSET);
  }
  if (cursor <= end) runs.push([cursor, end]);
  return runs;
}

function circlesOnRun(
  fixed: number,
  from: number,
  to: number,
  vertical: boolean,
  out: Array<{ x: number; y: number }>,
): void {
  const length = to - from;
  if (length < 0) return;
  const count = Math.max(1, Math.round(length / WALL_SPACING));
  for (let i = 0; i <= count; i += 1) {
    const p = from + (length * i) / count;
    out.push(vertical ? { x: fixed, y: p } : { x: p, y: fixed });
  }
}

function doorGaps(side: string): Array<{ from: number; to: number }> {
  return HOUSE.doors
    .filter((door) => door.side === side)
    .map((door) => ({ from: door.at - door.width / 2, to: door.at + door.width / 2 }));
}

const wallRuns: HouseWallRun[] = [];
const wallPoints: Array<{ x: number; y: number }> = [];

for (const [from, to] of runsAlong(HOUSE.x0, HOUSE.x1, doorGaps('N'))) {
  wallRuns.push({ x1: from, y1: HOUSE.y0, x2: to, y2: HOUSE.y0, interior: false });
  circlesOnRun(HOUSE.y0, from, to, false, wallPoints);
}
for (const [from, to] of runsAlong(HOUSE.x0, HOUSE.x1, doorGaps('S'))) {
  wallRuns.push({ x1: from, y1: HOUSE.y1, x2: to, y2: HOUSE.y1, interior: false });
  circlesOnRun(HOUSE.y1, from, to, false, wallPoints);
}
for (const [from, to] of runsAlong(HOUSE.y0, HOUSE.y1, doorGaps('W'))) {
  wallRuns.push({ x1: HOUSE.x0, y1: from, x2: HOUSE.x0, y2: to, interior: false });
  circlesOnRun(HOUSE.x0, from, to, true, wallPoints);
}
for (const [from, to] of runsAlong(HOUSE.y0, HOUSE.y1, doorGaps('E'))) {
  wallRuns.push({ x1: HOUSE.x1, y1: from, x2: HOUSE.x1, y2: to, interior: false });
  circlesOnRun(HOUSE.x1, from, to, true, wallPoints);
}
for (const divider of HOUSE.dividers) {
  const gaps = divider.gaps.map((gap) => ({ from: gap.from, to: gap.to }));
  if (divider.x1 === divider.x2) {
    const lo = Math.min(divider.y1, divider.y2);
    const hi = Math.max(divider.y1, divider.y2);
    for (const [from, to] of runsAlong(lo, hi, gaps)) {
      wallRuns.push({ x1: divider.x1, y1: from, x2: divider.x1, y2: to, interior: true });
      circlesOnRun(divider.x1, from, to, true, wallPoints);
    }
  } else {
    const lo = Math.min(divider.x1, divider.x2);
    const hi = Math.max(divider.x1, divider.x2);
    for (const [from, to] of runsAlong(lo, hi, gaps)) {
      wallRuns.push({ x1: from, y1: divider.y1, x2: to, y2: divider.y1, interior: true });
      circlesOnRun(divider.y1, from, to, false, wallPoints);
    }
  }
}

/** Trechos de parede para o renderer (com os vãos das portas já abertos). */
export const HOUSE_WALL_RUNS: readonly HouseWallRun[] = wallRuns;

/** Vãos das portas em coordenadas de mundo, para o renderer. */
export const HOUSE_DOORS: readonly HouseDoorSpan[] = HOUSE.doors.map((door) => ({
  side: door.side,
  from: door.at - door.width / 2,
  to: door.at + door.width / 2,
}));

// Cantos entram em dois trechos: remove duplicados exatos.
const seen = new Set<string>();
const houseCircles = wallPoints.filter((point) => {
  const key = `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

export const OBSTACLES: readonly Obstacle[] = [
  ...obstacleData.map((obstacle, id) => ({
    ...obstacle,
    id,
  })),
  ...houseCircles.map((circle, index) => ({
    kind: 'wall' as const,
    x: circle.x,
    y: circle.y,
    radius: HOUSE.wallRadius,
    id: obstacleData.length + index,
  })),
];

export const SPAWN_POINTS: readonly Vec2[] = [
  { x: 150, y: 150 },
  { x: 2250, y: 150 },
  { x: 150, y: 1450 },
  { x: 2250, y: 1450 },
  { x: 1200, y: 170 },
  { x: 1200, y: 1430 },
  { x: 150, y: 800 },
  { x: 2250, y: 800 },
  { x: 700, y: 800 },
  { x: 1700, y: 800 },
];

// ---------------------------------------------------------------------------
// Cidade Neon: segundo mapa jogável, mesmas dimensões (2400x1600).
// Colisão reaproveita os círculos de sempre, sem física nova: paredes dos
// prédios são kind 'wall' (blindam granada/chama como a casa); coberturas
// urbanas (carros/contêineres = 'rock', barreiras/postes = 'tree') bloqueiam
// movimento/tiro mas não blindam explosão — mesma semântica do Campo.
// ---------------------------------------------------------------------------

export const MAP_IDS: readonly MapId[] = ['field', 'city'];

export interface RectDoor {
  side: 'N' | 'S' | 'E' | 'W';
  at: number;
  width: number;
}

export interface RectDivider {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  gaps: ReadonlyArray<{ from: number; to: number }>;
}

export type CityNeon = 'cyan' | 'magenta' | 'purple';

export interface CityBuilding {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** false = cenário fechado (sem portas, sem entrada). */
  open: boolean;
  neon: CityNeon;
  runs: HouseWallRun[];
}

/** Paredes de um retângulo com portas e divisórias, nos moldes da casa. */
function buildRectWalls(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  doors: ReadonlyArray<RectDoor>,
  dividers: ReadonlyArray<RectDivider>,
): { runs: HouseWallRun[]; points: Array<{ x: number; y: number }> } {
  const runs: HouseWallRun[] = [];
  const points: Array<{ x: number; y: number }> = [];
  const gapsOf = (side: string): Array<{ from: number; to: number }> =>
    doors
      .filter((door) => door.side === side)
      .map((door) => ({ from: door.at - door.width / 2, to: door.at + door.width / 2 }));
  for (const [from, to] of runsAlong(x0, x1, gapsOf('N'))) {
    runs.push({ x1: from, y1: y0, x2: to, y2: y0, interior: false });
    circlesOnRun(y0, from, to, false, points);
  }
  for (const [from, to] of runsAlong(x0, x1, gapsOf('S'))) {
    runs.push({ x1: from, y1: y1, x2: to, y2: y1, interior: false });
    circlesOnRun(y1, from, to, false, points);
  }
  for (const [from, to] of runsAlong(y0, y1, gapsOf('W'))) {
    runs.push({ x1: x0, y1: from, x2: x0, y2: to, interior: false });
    circlesOnRun(x0, from, to, true, points);
  }
  for (const [from, to] of runsAlong(y0, y1, gapsOf('E'))) {
    runs.push({ x1: x1, y1: from, x2: x1, y2: to, interior: false });
    circlesOnRun(x1, from, to, true, points);
  }
  for (const divider of dividers) {
    const gaps = divider.gaps.map((gap) => ({ from: gap.from, to: gap.to }));
    if (divider.x1 === divider.x2) {
      const lo = Math.min(divider.y1, divider.y2);
      const hi = Math.max(divider.y1, divider.y2);
      for (const [from, to] of runsAlong(lo, hi, gaps)) {
        runs.push({ x1: divider.x1, y1: from, x2: divider.x1, y2: to, interior: true });
        circlesOnRun(divider.x1, from, to, true, points);
      }
    } else {
      const lo = Math.min(divider.x1, divider.x2);
      const hi = Math.max(divider.x1, divider.x2);
      for (const [from, to] of runsAlong(lo, hi, gaps)) {
        runs.push({ x1: from, y1: divider.y1, x2: to, y2: divider.y1, interior: true });
        circlesOnRun(divider.y1, from, to, false, points);
      }
    }
  }
  return { runs, points };
}

/**
 * Vestíbulo em L atrás de porta N/S: quem entra vira de lado para sair e a
 * granada jogada de fora em linha reta morre na parede cheia do fundo.
 * Corredor mais largo que a porta (at±60), saída lateral de ~74px.
 */
function vestibuleDividers(
  side: 'N' | 'S',
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  at: number,
): RectDivider[] {
  const lo = Math.max(x0, at - 60);
  const hi = Math.min(x1, at + 60);
  if (side === 'S') {
    const top = y1 - 120;
    return [
      { x1: lo, y1: top, x2: lo, y2: y1, gaps: [] },
      { x1: hi, y1: top, x2: hi, y2: y1, gaps: [] },
      { x1: lo, y1: top, x2: hi, y2: top, gaps: [{ from: at, to: hi }] },
    ];
  }
  const bottom = y0 + 120;
  return [
    { x1: lo, y1: y0, x2: lo, y2: bottom, gaps: [] },
    { x1: hi, y1: y0, x2: hi, y2: bottom, gaps: [] },
    { x1: lo, y1: bottom, x2: hi, y2: bottom, gaps: [{ from: lo, to: at }] },
  ];
}

interface CityBuildingSpec {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  open: boolean;
  neon: CityNeon;
  doors: RectDoor[];
  // 'S' | 'N' = vestíbulo em L atrás da porta desse lado (só em prédio aberto).
  vestibule?: 'S' | 'N';
}

const CITY_SPECS: readonly CityBuildingSpec[] = [
  {
    name: 'Torre Norte', x0: 170, y0: 130, x1: 550, y1: 350,
    open: true, neon: 'cyan',
    doors: [
      { side: 'S', at: 340, width: 100 },
      { side: 'E', at: 250, width: 100 },
    ],
    vestibule: 'S',
  },
  {
    name: 'Galpão Norte', x0: 1330, y0: 130, x1: 1620, y1: 350,
    open: false, neon: 'purple', doors: [],
  },
  {
    name: 'Torre Leste', x0: 1850, y0: 130, x1: 2230, y1: 350,
    open: true, neon: 'magenta',
    doors: [
      { side: 'S', at: 2050, width: 100 },
      { side: 'W', at: 250, width: 100 },
    ],
    vestibule: 'S',
  },
  {
    name: 'Loja Oeste', x0: 780, y0: 500, x1: 1070, y1: 660,
    open: false, neon: 'magenta', doors: [],
  },
  {
    name: 'Torre Sul', x0: 170, y0: 1250, x1: 550, y1: 1450,
    open: true, neon: 'purple',
    doors: [
      { side: 'N', at: 340, width: 100 },
      { side: 'E', at: 1350, width: 100 },
    ],
    vestibule: 'N',
  },
  {
    name: 'Bloco Sul', x0: 1850, y0: 1250, x1: 2230, y1: 1450,
    open: false, neon: 'cyan', doors: [],
  },
];

const cityWallPoints: Array<{ x: number; y: number }> = [];
const cityBuildings: CityBuilding[] = [];
const cityWallRuns: HouseWallRun[] = [];

for (const spec of CITY_SPECS) {
  const dividers: RectDivider[] = [];
  if (spec.open && spec.vestibule) {
    const door = spec.doors.find((d) => d.side === spec.vestibule);
    if (door) dividers.push(...vestibuleDividers(spec.vestibule, spec.x0, spec.x1, spec.y0, spec.y1, door.at));
  }
  const built = buildRectWalls(spec.x0, spec.y0, spec.x1, spec.y1, spec.doors, dividers);
  cityWallPoints.push(...built.points);
  cityWallRuns.push(...built.runs);
  cityBuildings.push({
    name: spec.name, x0: spec.x0, y0: spec.y0, x1: spec.x1, y1: spec.y1,
    open: spec.open, neon: spec.neon, runs: built.runs,
  });
}

/** Prédios da cidade (para o renderer e para os testes de fresta). */
export const CITY_BUILDINGS: readonly CityBuilding[] = cityBuildings;

/** Trechos de parede da cidade para o renderer. */
export const CITY_WALL_RUNS: readonly HouseWallRun[] = cityWallRuns;

// Coberturas urbanas: carros/contêineres ('rock') e barreiras/postes
// ('tree'). Mesma física do Campo; o renderer desenha o visual da cidade.
const cityCoverData = [
  // Carros nas avenidas.
  { kind: 'rock', x: 400, y: 732, radius: 36 },
  { kind: 'rock', x: 900, y: 828, radius: 36 },
  { kind: 'rock', x: 1500, y: 732, radius: 36 },
  { kind: 'rock', x: 2000, y: 828, radius: 36 },
  { kind: 'rock', x: 1152, y: 300, radius: 34 },
  { kind: 'rock', x: 1248, y: 1150, radius: 34 },
  // Contêineres nos pátios leste e sul.
  { kind: 'rock', x: 1430, y: 560, radius: 50 },
  { kind: 'rock', x: 1550, y: 600, radius: 50 },
  { kind: 'rock', x: 820, y: 1330, radius: 48 },
  { kind: 'rock', x: 950, y: 1370, radius: 48 },
  // Barreiras na praça central e nas ruas secundárias.
  { kind: 'tree', x: 1095, y: 675, radius: 30 },
  { kind: 'tree', x: 1305, y: 675, radius: 30 },
  { kind: 'tree', x: 1095, y: 925, radius: 30 },
  { kind: 'tree', x: 1305, y: 925, radius: 30 },
  { kind: 'tree', x: 300, y: 1180, radius: 30 },
  { kind: 'tree', x: 2100, y: 420, radius: 30 },
  // Postes de neon (finos, r24).
  { kind: 'tree', x: 250, y: 660, radius: 24 },
  { kind: 'tree', x: 2150, y: 940, radius: 24 },
  { kind: 'tree', x: 1320, y: 200, radius: 24 },
  { kind: 'tree', x: 1080, y: 1400, radius: 24 },
  { kind: 'tree', x: 1620, y: 700, radius: 24 },
  { kind: 'tree', x: 560, y: 950, radius: 24 },
] as const;

const citySeen = new Set<string>();
const cityCircles = cityWallPoints.filter((point) => {
  const key = `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
  if (citySeen.has(key)) return false;
  citySeen.add(key);
  return true;
});

export const CITY_OBSTACLES: readonly Obstacle[] = [
  ...cityCoverData.map((obstacle, id) => ({ ...obstacle, id })),
  ...cityCircles.map((circle, index) => ({
    kind: 'wall' as const,
    x: circle.x,
    y: circle.y,
    radius: HOUSE.wallRadius,
    id: cityCoverData.length + index,
  })),
];

export const CITY_SPAWNS: readonly Vec2[] = [
  { x: 120, y: 780 },
  { x: 2280, y: 780 },
  { x: 1200, y: 120 },
  { x: 1200, y: 1480 },
  { x: 1200, y: 780 },
  { x: 665, y: 250 },
  { x: 1735, y: 1350 },
  { x: 420, y: 420 },
  { x: 1980, y: 1180 },
  { x: 665, y: 1180 },
];

// Power-ups espalhados (não tudo no centro): avenidas, secundárias e beco.
export const CITY_POWERUP_POINTS: readonly Vec2[] = [
  { x: 300, y: 780 },
  { x: 2100, y: 780 },
  { x: 1200, y: 210 },
  { x: 1200, y: 1300 },
  { x: 900, y: 1180 },
  { x: 1500, y: 420 },
  { x: 665, y: 780 },
];

/** Obstáculos do mapa ativo (padrão: Campo, compatível com o código atual). */
export function obstaclesFor(map: MapId): readonly Obstacle[] {
  return map === 'city' ? CITY_OBSTACLES : OBSTACLES;
}

/** Spawns do mapa ativo. */
export function spawnsFor(map: MapId): readonly Vec2[] {
  return map === 'city' ? CITY_SPAWNS : SPAWN_POINTS;
}

/** Pontos de power-up do mapa ativo. */
export function powerupPointsFor(map: MapId): readonly Vec2[] {
  return map === 'city' ? CITY_POWERUP_POINTS : POWERUP.spawnPoints;
}
