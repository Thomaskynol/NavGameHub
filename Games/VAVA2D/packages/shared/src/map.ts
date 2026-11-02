import type { Obstacle, Vec2 } from './types.js';

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
