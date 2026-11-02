import { ARENA, DUEL_ARENA, HOUSE, HOUSE_DOORS, HOUSE_WALL_RUNS, OBSTACLES, PLAYER } from '@vava/shared';
import type { Obstacle } from '@vava/shared';
import type { Effects } from './effects.js';
import { mulberry32 } from './rng.js';

export interface RenderPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  aim: number;
  weapon: string;
  shooting: boolean;
  scale: number;
  invincible: boolean;
  invisible: boolean;
  health: number;
  alive: boolean;
  protected: boolean;
  isSelf: boolean;
  duel: boolean;
}

export interface RenderBullet {
  id: number;
  x: number;
  y: number;
  angle: number;
}

export interface RenderGrenade {
  id: number;
  x: number;
  y: number;
}

export interface RenderDrop {
  id: number;
  x: number;
  y: number;
  weapon?: string;
}

export interface RenderPowerup {
  id: number;
  x: number;
  y: number;
  type: string;
}

export interface RenderFrame {
  dt: number;
  now: number;
  camera: { x: number; y: number; scale: number };
  players: RenderPlayer[];
  bullets: RenderBullet[];
  grenades: RenderGrenade[];
  drops: RenderDrop[];
  powerups: RenderPowerup[];
  dropTargets: { x: number; y: number }[];
  selfId: string | null;
  mouse: { x: number; y: number };
  hitMarker: 'hit' | 'kill' | null;
  showCrosshair: boolean;
  duelActive: boolean;
}

interface PlayerAnimation {
  x: number;
  y: number;
  phase: number;
  facing: number;
}

interface RockShape {
  id: number;
  points: Array<{ x: number; y: number }>;
}

interface GrassPatch {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
  alpha: number;
}

interface Flower {
  x: number;
  y: number;
  size: number;
  color: string;
}

const decorRng = mulberry32(0x5eedcafe);

const rockShapes: RockShape[] = OBSTACLES.filter((obstacle) => obstacle.kind === 'rock').map(
  (obstacle) => {
    const rng = mulberry32(1000 + obstacle.id * 97);
    const points: Array<{ x: number; y: number }> = [];
    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const radius = obstacle.radius * (0.82 + rng() * 0.22);
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
    return { id: obstacle.id, points };
  },
);

const grassPatches: GrassPatch[] = Array.from({ length: 62 }, () => ({
  x: ARENA.inset + 40 + decorRng() * (ARENA.width - 2 * ARENA.inset - 80),
  y: ARENA.inset + 40 + decorRng() * (ARENA.height - 2 * ARENA.inset - 80),
  rx: 40 + decorRng() * 150,
  ry: 22 + decorRng() * 90,
  color: decorRng() > 0.55 ? '#5d8844' : '#3f6530',
  alpha: 0.1 + decorRng() * 0.1,
}));

const flowers: Flower[] = Array.from({ length: 120 }, () => {
  const palette = ['#e8d37a', '#f1eee0', '#cf8cae', '#8eb7d2', '#e8d37a'];
  return {
    x: ARENA.inset + 24 + decorRng() * (ARENA.width - 2 * ARENA.inset - 48),
    y: ARENA.inset + 24 + decorRng() * (ARENA.height - 2 * ARENA.inset - 48),
    size: 1.6 + decorRng() * 1.6,
    color: palette[Math.floor(decorRng() * palette.length)] ?? '#f1eee0',
  };
});

const smallStones = Array.from({ length: 36 }, () => ({
  x: ARENA.inset + 30 + decorRng() * (ARENA.width - 2 * ARENA.inset - 60),
  y: ARENA.inset + 30 + decorRng() * (ARENA.height - 2 * ARENA.inset - 60),
  radius: 2 + decorRng() * 4,
}));

const obstaclesByDepth = [...OBSTACLES].sort((a, b) => a.y - b.y);

function shade(hex: string, factor: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = Math.round(parseInt(clean.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(clean.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(clean.slice(4, 6), 16) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly grassPattern: CanvasPattern | null;
  private readonly soilPattern: CanvasPattern | null;
  private readonly animations = new Map<string, PlayerAnimation>();

  width = 0;
  height = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não disponível.');
    this.ctx = ctx;
    this.grassPattern = this.createGrassPattern();
    this.soilPattern = this.createSoilPattern();
    this.resize();
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) return;

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  render(frame: RenderFrame, effects: Effects): void {
    this.resize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#182313';
    ctx.fillRect(0, 0, this.width, this.height);

    const shake = effects.getShakeOffset();
    ctx.save();
    ctx.translate(this.width / 2 + shake.x, this.height / 2 + shake.y);
    ctx.scale(frame.camera.scale, frame.camera.scale);
    ctx.translate(-frame.camera.x, -frame.camera.y);

    this.drawWorld(frame);
    effects.renderGround(ctx);

    this.updateAnimations(frame);
    this.drawPlayers(frame);
    this.drawFlames(frame);
    this.drawBullets(frame);
    this.drawGrenades(frame);
    this.drawDrops(frame);
    this.drawPowerups(frame);
    effects.render(ctx);

    ctx.restore();
    this.drawDropArrows(frame);
    this.drawCrosshair(frame);
  }

  private drawWorld(frame: RenderFrame): void {
    const ctx = this.ctx;
    const viewWidth = this.width / frame.camera.scale;
    const viewHeight = this.height / frame.camera.scale;
    const left = frame.camera.x - viewWidth / 2 - 140;
    const top = frame.camera.y - viewHeight / 2 - 140;
    const right = frame.camera.x + viewWidth / 2 + 140;
    const bottom = frame.camera.y + viewHeight / 2 + 140;

    // Solo em volta da arena.
    ctx.fillStyle = this.soilPattern ?? '#655039';
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    ctx.fillStyle = this.grassPattern ?? '#4d7638';
    ctx.fillRect(
      ARENA.inset,
      ARENA.inset,
      ARENA.width - ARENA.inset * 2,
      ARENA.height - ARENA.inset * 2,
    );

    // Trilha de terra pisoteada junto à cerca.
    ctx.save();
    ctx.strokeStyle = 'rgba(127, 96, 58, 0.38)';
    ctx.lineWidth = 11;
    ctx.strokeRect(
      ARENA.inset + 11,
      ARENA.inset + 11,
      ARENA.width - ARENA.inset * 2 - 22,
      ARENA.height - ARENA.inset * 2 - 22,
    );
    ctx.restore();

    for (const patch of grassPatches) {
      if (patch.x + patch.rx < left || patch.x - patch.rx > right) continue;
      if (patch.y + patch.ry < top || patch.y - patch.ry > bottom) continue;
      ctx.globalAlpha = patch.alpha;
      ctx.fillStyle = patch.color;
      ctx.beginPath();
      ctx.ellipse(patch.x, patch.y, patch.rx, patch.ry, 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const flower of flowers) {
      if (flower.x < left || flower.x > right || flower.y < top || flower.y > bottom) continue;
      this.drawFlower(flower.x, flower.y, flower.size, flower.color);
    }

    for (const stone of smallStones) {
      if (stone.x < left || stone.x > right || stone.y < top || stone.y > bottom) continue;
      ctx.fillStyle = 'rgba(66, 70, 57, 0.55)';
      ctx.beginPath();
      ctx.ellipse(stone.x, stone.y, stone.radius, stone.radius * 0.7, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawHouseFloor();
    this.drawFence();
    if (frame.duelActive) {
      // Ringue off-map: só existe visualmente durante o duelo.
      ctx.save();
      ctx.fillStyle = this.soilPattern ?? '#655039';
      ctx.fillRect(DUEL_ARENA.minX - 120, DUEL_ARENA.minY - 120, DUEL_ARENA.maxX - DUEL_ARENA.minX + 240, DUEL_ARENA.maxY - DUEL_ARENA.minY + 240);
      ctx.restore();
      this.drawDuelRing(true);
    }

    for (const obstacle of obstaclesByDepth) {
      // Paredes da casa: a colisão usa os círculos, o visual é o drawHouseWalls.
      if (obstacle.kind === 'wall') continue;
      if (
        obstacle.x + obstacle.radius * 1.4 < left ||
        obstacle.x - obstacle.radius * 1.4 > right ||
        obstacle.y + obstacle.radius * 1.4 < top ||
        obstacle.y - obstacle.radius * 1.4 > bottom
      ) {
        continue;
      }
      if (obstacle.kind === 'rock') {
        this.drawRock(obstacle);
      } else {
        this.drawTree(obstacle);
      }
    }
    this.drawHouseWalls();
  }

  private drawFence(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#6b4c30';
    ctx.lineWidth = 3;
    ctx.fillStyle = '#4a3522';

    const railY = 22;
    ctx.beginPath();
    ctx.moveTo(0, railY);
    ctx.lineTo(ARENA.width, railY);
    ctx.moveTo(0, 34);
    ctx.lineTo(ARENA.width, 34);
    ctx.moveTo(0, ARENA.height - 22);
    ctx.lineTo(ARENA.width, ARENA.height - 22);
    ctx.moveTo(0, ARENA.height - 34);
    ctx.lineTo(ARENA.width, ARENA.height - 34);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(railY, 0);
    ctx.lineTo(railY, ARENA.height);
    ctx.moveTo(34, 0);
    ctx.lineTo(34, ARENA.height);
    ctx.moveTo(ARENA.width - 22, 0);
    ctx.lineTo(ARENA.width - 22, ARENA.height);
    ctx.moveTo(ARENA.width - 34, 0);
    ctx.lineTo(ARENA.width - 34, ARENA.height);
    ctx.stroke();

    const posts: Array<{ x: number; y: number }> = [];
    for (let x = 0; x <= ARENA.width; x += 92) {
      posts.push({ x, y: 28 });
      posts.push({ x, y: ARENA.height - 28 });
    }
    for (let y = 92; y < ARENA.height; y += 92) {
      posts.push({ x: 28, y });
      posts.push({ x: ARENA.width - 28, y });
    }

    for (const post of posts) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      ctx.arc(post.x + 2, post.y + 3, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5d422a';
      ctx.beginPath();
      ctx.arc(post.x, post.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7b5a38';
      ctx.beginPath();
      ctx.arc(post.x - 1, post.y - 1, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHouseFloor(): void {
    const ctx = this.ctx;
    const { x0, y0, x1, y1 } = HOUSE;
    const w = x1 - x0;
    const h = y1 - y0;
    ctx.save();
    // Sombra do beiral.
    ctx.fillStyle = 'rgba(8, 12, 6, 0.3)';
    ctx.beginPath();
    ctx.roundRect(x0 - 8 + 7, y0 - 8 + 9, w + 16, h + 16, 6);
    ctx.fill();
    // Chão interno: terra batida, levemente diferente da grama.
    ctx.fillStyle = '#6e5a36';
    ctx.beginPath();
    ctx.roundRect(x0 - 8, y0 - 8, w + 16, h + 16, 6);
    ctx.fill();
    ctx.fillStyle = '#655133';
    ctx.fillRect(x0, y0, w, h);
    // Tábuas.
    ctx.strokeStyle = 'rgba(52, 38, 20, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let y = y0 + 26; y < y1; y += 26) {
      ctx.moveTo(x0 + 4, y);
      ctx.lineTo(x1 - 4, y);
    }
    ctx.stroke();
    // Contorno do beiral (telhado visto de cima).
    ctx.strokeStyle = '#3f2d1c';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.roundRect(x0 - 8, y0 - 8, w + 16, h + 16, 6);
    ctx.stroke();
    ctx.strokeStyle = '#7b5a38';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x0 - 8, y0 - 8, w + 16, h + 16, 6);
    ctx.stroke();
    ctx.restore();
  }

  private drawHouseWalls(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    // Divisórias primeiro (mais finas), externas por cima nos encontros.
    for (const pass of [true, false]) {
      for (const run of HOUSE_WALL_RUNS) {
        if (run.interior !== pass) continue;
        ctx.strokeStyle = '#3f2d1c';
        ctx.lineWidth = run.interior ? 30 : 40;
        ctx.beginPath();
        ctx.moveTo(run.x1, run.y1);
        ctx.lineTo(run.x2, run.y2);
        ctx.stroke();
        ctx.strokeStyle = run.interior ? '#6b4c30' : '#7b5a38';
        ctx.lineWidth = run.interior ? 20 : 28;
        ctx.beginPath();
        ctx.moveTo(run.x1, run.y1);
        ctx.lineTo(run.x2, run.y2);
        ctx.stroke();
      }
    }
    // Soleiras + batentes nas portas (vãos visíveis).
    for (const door of HOUSE_DOORS) {
      const horizontal = door.side === 'N' || door.side === 'S';
      const fixed =
        door.side === 'N' ? HOUSE.y0
        : door.side === 'S' ? HOUSE.y1
        : door.side === 'W' ? HOUSE.x0
        : HOUSE.x1;
      ctx.fillStyle = '#8a6b42';
      if (horizontal) ctx.fillRect(door.from, fixed - 9, door.to - door.from, 18);
      else ctx.fillRect(fixed - 9, door.from, 18, door.to - door.from);
      ctx.fillStyle = '#3f2d1c';
      for (const edge of [door.from, door.to]) {
        if (horizontal) {
          ctx.fillRect(edge - 4, fixed - 13, 8, 26);
          ctx.fillStyle = '#7b5a38';
          ctx.fillRect(edge - 2, fixed - 11, 4, 22);
          ctx.fillStyle = '#3f2d1c';
        } else {
          ctx.fillRect(fixed - 13, edge - 4, 26, 8);
          ctx.fillStyle = '#7b5a38';
          ctx.fillRect(fixed - 11, edge - 2, 22, 4);
          ctx.fillStyle = '#3f2d1c';
        }
      }
    }
    ctx.restore();
  }

  private drawDuelRing(active: boolean): void {
    const ctx = this.ctx;
    const { minX, maxX, minY, maxY } = DUEL_ARENA;
    const w = maxX - minX;
    const h = maxY - minY;
    ctx.save();
    // Piso escuro do ringue.
    ctx.fillStyle = active ? 'rgba(24, 10, 16, 0.85)' : 'rgba(20, 16, 12, 0.6)';
    ctx.fillRect(minX, minY, w, h);
    // Cordas: duas linhas internas claras.
    ctx.strokeStyle = active ? '#ef7ba8' : 'rgba(239, 123, 168, 0.4)';
    ctx.lineWidth = active ? 4 : 2.5;
    ctx.strokeRect(minX + 8, minY + 8, w - 16, h - 16);
    ctx.strokeStyle = active ? 'rgba(245, 242, 230, 0.85)' : 'rgba(245, 242, 230, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(minX + 18, minY + 18, w - 36, h - 36);
    // Cantos.
    ctx.fillStyle = active ? '#ef7ba8' : 'rgba(239, 123, 168, 0.45)';
    for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = active ? 'rgba(245, 184, 208, 0.9)' : 'rgba(245, 184, 208, 0.4)';
    ctx.font = '700 16px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DUELO', (minX + maxX) / 2, minY - 18);
    ctx.restore();
  }

  private drawFlower(x: number, y: number, size: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * size, y + Math.sin(angle) * size, size * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#d9b85b';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawRock(obstacle: Obstacle): void {
    const ctx = this.ctx;
    const shape = rockShapes.find((item) => item.id === obstacle.id);
    if (!shape) return;

    ctx.save();
    ctx.translate(obstacle.x, obstacle.y);

    ctx.fillStyle = 'rgba(8, 12, 6, 0.26)';
    ctx.beginPath();
    ctx.ellipse(9, 12, obstacle.radius * 1.03, obstacle.radius * 0.8, 0.22, 0, Math.PI * 2);
    ctx.fill();

    const path = () => {
      ctx.beginPath();
      shape.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
    };

    path();
    ctx.fillStyle = '#6c7168';
    ctx.fill();
    ctx.strokeStyle = '#3b3e37';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.scale(0.72, 0.72);
    ctx.translate(-2, -3);
    path();
    ctx.fillStyle = '#8b9084';
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.ellipse(
      -obstacle.radius * 0.25,
      -obstacle.radius * 0.3,
      obstacle.radius * 0.22,
      obstacle.radius * 0.12,
      -0.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.strokeStyle = 'rgba(42, 45, 38, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-obstacle.radius * 0.1, -obstacle.radius * 0.05);
    ctx.lineTo(obstacle.radius * 0.12, obstacle.radius * 0.18);
    ctx.lineTo(obstacle.radius * 0.05, obstacle.radius * 0.34);
    ctx.stroke();

    ctx.restore();
  }

  private drawTree(obstacle: Obstacle): void {
    const ctx = this.ctx;
    const r = obstacle.radius;

    ctx.save();
    ctx.translate(obstacle.x, obstacle.y);

    ctx.fillStyle = 'rgba(8, 12, 6, 0.28)';
    ctx.beginPath();
    ctx.ellipse(10, 13, r * 1.12, r * 0.9, 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4b3524';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.19, 0, Math.PI * 2);
    ctx.fill();

    const lobes: Array<[number, number, number]> = [
      [-0.28, 0.02, 0.7],
      [0.28, 0.08, 0.67],
      [0.02, -0.27, 0.72],
      [-0.05, 0.29, 0.62],
      [0.02, 0.02, 0.8],
    ];

    for (const [ox, oy, scale] of lobes) {
      const lx = ox * r;
      const ly = oy * r;
      const lr = scale * r;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fillStyle = lr > 0.6 * r ? '#35622f' : '#2c5229';
      ctx.fill();
      ctx.strokeStyle = 'rgba(25, 51, 24, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(124, 171, 92, 0.32)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.36, r * 0.22, -0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(96, 142, 72, 0.5)';
    for (let i = 0; i < 5; i += 1) {
      const angle = i * 2.4;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * r * 0.45, Math.sin(angle) * r * 0.38, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private updateAnimations(frame: RenderFrame): void {
    const dt = Math.max(frame.dt, 1 / 240);
    for (const player of frame.players) {
      let anim = this.animations.get(player.id);
      if (!anim) {
        anim = { x: player.x, y: player.y, phase: 0, facing: player.aim };
        this.animations.set(player.id, anim);
        continue;
      }

      const dx = player.x - anim.x;
      const dy = player.y - anim.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 120) {
        anim.x = player.x;
        anim.y = player.y;
        anim.phase = 0;
      } else if (distance > 0.08) {
        anim.x = player.x;
        anim.y = player.y;
        anim.phase += distance * 0.1;
        anim.facing = Math.atan2(dy, dx);
      }

      anim.x = player.x;
      anim.y = player.y;
      const speed = distance / dt;
      // Rastro do dash revelaria o fantasma: invisível alheio não deixa rastro.
      if (speed > 520 && !(player.invisible && !player.isSelf)) {
        this.drawDashTrail(player, anim);
      }
    }
  }

  private drawDashTrail(player: RenderPlayer, anim: PlayerAnimation): void {
    const ctx = this.ctx;
    ctx.save();
    for (let i = 1; i <= 2; i += 1) {
      ctx.globalAlpha = 0.13 / i;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(
        player.x - Math.cos(anim.facing) * i * 13,
        player.y - Math.sin(anim.facing) * i * 13,
        PLAYER.radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPlayers(frame: RenderFrame): void {
    const ctx = this.ctx;
    // Invisível alheio não renderiza (nem sombra, arma ou nome); hitbox intacta no servidor.
    const alive = frame.players.filter((player) => player.alive && !(player.invisible && !player.isSelf));

    for (const player of alive) {
      ctx.save();
      ctx.fillStyle = 'rgba(6, 10, 4, 0.24)';
      ctx.beginPath();
      ctx.ellipse(player.x + 3, player.y + 5, 14, 10, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const sorted = [...alive].sort((a, b) => a.y - b.y);
    for (const player of sorted) {
      this.drawPlayer(player, frame);
    }
  }

  private drawPlayer(player: RenderPlayer, frame: RenderFrame): void {
    const ctx = this.ctx;
    const anim = this.animations.get(player.id) ?? {
      x: player.x,
      y: player.y,
      phase: 0,
      facing: player.aim,
    };
    const gait = Math.sin(anim.phase) * 4.5;
    const sleeveColor = shade(player.color, 0.7);

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.scale(player.scale || 1, player.scale || 1);
    // Dono se vê transparente (~40%) para saber que está invisível.
    if (player.invisible && player.isSelf) ctx.globalAlpha = 0.4;

    if (player.protected) {
      const pulse = 0.55 + Math.sin(frame.now * 0.009) * 0.2;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#6fe3dc';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER.radius + 9, frame.now * 0.0015, frame.now * 0.0015 + Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (player.invincible) {
      const pulse = 0.6 + Math.sin(frame.now * 0.012) * 0.25;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#4dd0c8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Pernas
    ctx.save();
    ctx.rotate(anim.facing);
    ctx.fillStyle = '#202a27';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        side * gait * 0.55,
        side * 6.1,
        3.7,
        7,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();

    // Torso
    ctx.beginPath();
    ctx.arc(0, 0, 10.6, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10, 14, 8, 0.72)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-2.5, -3, 5.4, Math.PI * 1.02, Math.PI * 1.62);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Braços, arma, cabeça
    ctx.save();
    ctx.rotate(player.aim);

    ctx.strokeStyle = 'rgba(10, 14, 8, 0.5)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1, -8.2);
    ctx.lineTo(15, -3.2);
    ctx.moveTo(-1, 8.2);
    ctx.lineTo(15, 3.2);
    ctx.stroke();

    ctx.strokeStyle = sleeveColor;
    ctx.lineWidth = 5.6;
    ctx.beginPath();
    ctx.moveTo(-1, -8.2);
    ctx.lineTo(14.5, -3.1);
    ctx.moveTo(-1, 8.2);
    ctx.lineTo(14.5, 3.1);
    ctx.stroke();

    this.drawWeapon(player.weapon);

    this.drawHands(player.weapon);

    ctx.fillStyle = '#3a2a20';
    ctx.beginPath();
    ctx.arc(2.8, 0, 5.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(25, 16, 11, 0.65)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#e7b787';
    ctx.beginPath();
    ctx.arc(6.4, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(96, 59, 39, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 233, 205, 0.3)';
    ctx.beginPath();
    ctx.arc(7.1, -1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();

    if (!player.isSelf) {
      this.drawNameplate(player, frame);
    }
  }

  // Armas com silhueta própria (só visual: hitbox e mira seguem no servidor).
  private drawWeapon(weapon: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = 'round';
    switch (weapon) {
      case 'shotgun': {
        // Cano duplo, longa, com pump de madeira e bocas de latão.
        ctx.fillStyle = '#5d422a';
        ctx.beginPath();
        ctx.roundRect(7.5, -2, 6.5, 4, 1.5);
        ctx.fill();
        ctx.fillStyle = '#2b3033';
        ctx.strokeStyle = '#14181a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(13, -2.8, 8, 5.6, 1.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#8a5a33';
        ctx.strokeStyle = '#4a2f18';
        ctx.beginPath();
        ctx.roundRect(21, -3.4, 7, 6.8, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#3a4147';
        ctx.fillRect(28, -3.2, 9, 2.4);
        ctx.fillRect(28, 0.8, 9, 2.4);
        ctx.save();
        ctx.shadowColor = 'rgba(242, 208, 107, 0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#f2d06b';
        ctx.fillRect(35.6, -3.4, 1.8, 2.8);
        ctx.fillRect(35.6, 0.6, 1.8, 2.8);
        ctx.restore();
        break;
      }
      case 'minigun': {
        // Pesada: caixa larga, 3 canos finos e tambor embaixo.
        ctx.fillStyle = '#23282c';
        ctx.strokeStyle = '#0e1113';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(9, -4.2, 14, 8.4, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ef6461';
        ctx.fillRect(10.5, -1, 5, 2);
        ctx.fillStyle = '#15191d';
        ctx.fillRect(23, -3.4, 14, 1.7);
        ctx.fillRect(23, -0.9, 14, 1.7);
        ctx.fillRect(23, 1.6, 14, 1.7);
        ctx.save();
        ctx.shadowColor = 'rgba(239, 100, 97, 0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ff8b80';
        ctx.fillRect(36.4, -3.6, 1.6, 2.1);
        ctx.fillRect(36.4, -1.1, 1.6, 2.1);
        ctx.fillRect(36.4, 1.4, 1.6, 2.1);
        ctx.restore();
        ctx.fillStyle = '#3f484d';
        ctx.strokeStyle = '#14181a';
        ctx.beginPath();
        ctx.arc(13, 7.5, 5.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ef6461';
        ctx.beginPath();
        ctx.arc(13, 7.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'flamethrower': {
        // Lança-chamas: tanque vermelho + bico largo com anel laranja.
        ctx.fillStyle = '#b3402a';
        ctx.strokeStyle = '#5f1f12';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(5.5, -4, 8.5, 8, 2.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#d4694e';
        ctx.fillRect(7, -3, 2.5, 6);
        ctx.strokeStyle = '#2a1a12';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(8, 4);
        ctx.quadraticCurveTo(13, 6.5, 18, 2.8);
        ctx.stroke();
        ctx.fillStyle = '#4a4d52';
        ctx.strokeStyle = '#22252a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(14, -2.8, 16, 5.6, 2);
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.shadowColor = 'rgba(255, 138, 60, 0.95)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ff8a3c';
        ctx.fillRect(28.5, -3.2, 3, 6.4);
        ctx.fillStyle = '#ffd27d';
        ctx.beginPath();
        ctx.arc(32.4, 0, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'unarmed':
        break;
      case 'pistol':
      default: {
        // Pistola: fina e curta, com mira ciano neon.
        ctx.fillStyle = '#2b3033';
        ctx.strokeStyle = '#14181a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(12.5, -2.1, 13.5, 4.2, 1.2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#4a545a';
        ctx.fillRect(14.5, -1.7, 8, 1.1);
        ctx.save();
        ctx.shadowColor = 'rgba(111, 227, 220, 0.95)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#6fe3dc';
        ctx.fillRect(24.6, -1.1, 2.2, 2.2);
        ctx.restore();
        ctx.fillStyle = '#20262a';
        ctx.beginPath();
        ctx.roundRect(11.8, 1.8, 4.2, 5.4, 1);
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  private drawHands(weapon: string): void {
    const ctx = this.ctx;
    // Punho dianteiro acompanha o comprimento da arma; desarmado vira guarda.
    const gripX =
      weapon === 'shotgun' ? 24
      : weapon === 'minigun' ? 19
      : weapon === 'flamethrower' ? 22
      : weapon === 'unarmed' ? 12.5
      : 15.5;
    ctx.fillStyle = '#e5b486';
    ctx.strokeStyle = 'rgba(96, 59, 39, 0.55)';
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(gripX, side * 2.3, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawNameplate(player: RenderPlayer, frame: RenderFrame): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(player.x, player.y - 38);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 13, 7, 0.75)';
    ctx.strokeText(player.name, 0, 0);
    ctx.fillStyle = 'rgba(245, 242, 230, 0.92)';
    ctx.fillText(player.name, 0, 0);

    const width = 42;
    const health = Math.max(0, Math.min(1, player.health / PLAYER.maxHealth));
    ctx.fillStyle = 'rgba(8, 13, 7, 0.55)';
    ctx.beginPath();
    ctx.roundRect(-width / 2, 10, width, 4, 2);
    ctx.fill();
    ctx.fillStyle = health > 0.55 ? '#8ed77e' : health > 0.28 ? '#f0b45b' : '#f06d62';
    ctx.beginPath();
    ctx.roundRect(-width / 2, 10, Math.max(1, width * health), 4, 2);
    ctx.fill();
    ctx.restore();

    if (player.protected) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#6fe3dc';
      ctx.font = '600 8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PROTEGIDO', player.x, player.y + 28);
      ctx.restore();
    }

    const blink = Math.sin(frame.now * 0.004) > 0;
    if (blink && player.health <= 25) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#f06d62';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawGrenades(frame: RenderFrame): void {
    const ctx = this.ctx;
    ctx.save();
    for (const grenade of frame.grenades) {
      ctx.fillStyle = 'rgba(40, 48, 34, 0.35)';
      ctx.beginPath();
      ctx.arc(grenade.x + 2, grenade.y + 3, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#5f6b4a';
      ctx.strokeStyle = '#2a3020';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(grenade.x, grenade.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#b7c39a';
      ctx.beginPath();
      ctx.arc(grenade.x - 2, grenade.y - 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPowerups(frame: RenderFrame): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const powerup of frame.powerups ?? []) {
      const color = this.powerupColor(powerup.type);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(powerup.x + 2, powerup.y + 3, 13, 10, 0.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#10180e';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(powerup.x, powerup.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.font = '700 12px ui-monospace, monospace';
      ctx.fillText(this.powerupLabel(powerup.type), powerup.x, powerup.y - 1);
      ctx.restore();

      const tag = this.powerupTag(powerup.type);
      ctx.font = '700 8px ui-monospace, monospace';
      const tw = ctx.measureText(tag).width + 10;
      ctx.fillStyle = 'rgba(8, 13, 7, 0.85)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(powerup.x - tw / 2, powerup.y + 15, tw, 13, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(tag, powerup.x, powerup.y + 22);
    }
    ctx.restore();
  }

  private powerupColor(type: string): string {
    switch (type) {
      case 'speed': return '#5aa9e6';
      case 'heal': return '#74c69d';
      case 'shield': return '#4dd0c8';
      case 'damage': return '#e76f51';
      case 'cooldown': return '#a78bfa';
      case 'grenade': return '#f2d06b';
      case 'duel': return '#ef7ba8';
      case 'giant': return '#f4a259';
      case 'lifesteal': return '#ef6461';
      default: return '#ffffff';
    }
  }

  private powerupLabel(type: string): string {
    switch (type) {
      case 'speed': return '»';
      case 'heal': return '+';
      case 'shield': return '◈';
      case 'damage': return '✸';
      case 'cooldown': return '∞';
      case 'grenade': return '●';
      case 'duel': return '⚔';
      case 'giant': return '▲';
      case 'lifesteal': return '♥';
      default: return '?';
    }
  }

  private powerupTag(type: string): string {
    switch (type) {
      case 'speed': return 'VEL';
      case 'heal': return 'VIDA';
      case 'shield': return 'ESCUDO';
      case 'damage': return 'DANO';
      case 'cooldown': return 'TURBO';
      case 'grenade': return 'GRANADA';
      case 'duel': return 'DUELO';
      case 'giant': return 'GIGANTE';
      case 'lifesteal': return 'SUGA';
      default: return '?';
    }
  }

  private drawDrops(frame: RenderFrame): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const drop of frame.drops) {
      const style = this.dropStyle(drop.weapon);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(drop.x + 3, drop.y + 4, 14, 11, 0.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#141a10';
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(drop.x - 13, drop.y - 13, 26, 26, 5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = style.color;
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.fillText(style.icon, drop.x, drop.y - 1);
      ctx.restore();

      ctx.font = '700 8px ui-monospace, monospace';
      const tw = ctx.measureText(style.tag).width + 10;
      ctx.fillStyle = 'rgba(8, 13, 7, 0.85)';
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(drop.x - tw / 2, drop.y + 15, tw, 13, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.color;
      ctx.fillText(style.tag, drop.x, drop.y + 22);
    }
    ctx.restore();
  }

  private dropStyle(weapon: string | undefined): { color: string; icon: string; tag: string } {
    switch (weapon) {
      case 'flamethrower': return { color: '#ff8a3c', icon: 'F', tag: 'FOGO' };
      case 'shotgun': return { color: '#8ed77e', icon: 'S', tag: 'SHOT' };
      case 'minigun': return { color: '#6fe3dc', icon: 'M', tag: 'MINI' };
      default: return { color: '#f2d06b', icon: '?', tag: 'ARMA' };
    }
  }

  private drawFlames(frame: RenderFrame): void {
    const ctx = this.ctx;
    for (const player of frame.players) {
      if (!player.alive || player.weapon !== 'flamethrower' || !player.shooting) continue;
      if (player.invisible && !player.isSelf) continue;
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.aim);
      const gradient = ctx.createLinearGradient(0, 0, 360, 0);
      gradient.addColorStop(0, 'rgba(255, 210, 120, 0.9)');
      gradient.addColorStop(0.5, 'rgba(255, 120, 40, 0.55)');
      gradient.addColorStop(1, 'rgba(255, 60, 20, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(18, -10);
      ctx.lineTo(360, -55);
      ctx.lineTo(360, 55);
      ctx.lineTo(18, 10);
      ctx.closePath();
      ctx.fill();

      // partículas de fogo
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i += 1) {
        const t = Math.random();
        const x = 24 + t * 330;
        const y = (Math.random() - 0.5) * (12 + t * 46);
        const size = 2 + Math.random() * (4 - t * 2);
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.fillStyle = t < 0.4 ? '#fff0a0' : t < 0.7 ? '#ff9a3c' : '#ff5a1f';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawBullets(frame: RenderFrame): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    for (const bullet of frame.bullets) {
      const tailX = bullet.x - Math.cos(bullet.angle) * 18;
      const tailY = bullet.y - Math.sin(bullet.angle) * 18;
      ctx.strokeStyle = 'rgba(255, 216, 130, 0.82)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255, 196, 92, 0.85)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(bullet.x, bullet.y);
      ctx.stroke();
      ctx.fillStyle = '#fff2c4';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawDropArrows(frame: RenderFrame): void {
    const ctx = this.ctx;
    const targets = frame.dropTargets ?? [];
    if (targets.length === 0) return;
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (const target of targets) {
      const sx = (target.x - frame.camera.x) * frame.camera.scale + cx;
      const sy = (target.y - frame.camera.y) * frame.camera.scale + cy;
      const margin = 48;
      if (sx >= margin && sx <= this.width - margin && sy >= margin && sy <= this.height - margin) continue;
      const angle = Math.atan2(sy - cy, sx - cx);
      const radius = Math.min(this.width, this.height) / 2 - 52;
      const ax = cx + Math.cos(angle) * radius;
      const ay = cy + Math.sin(angle) * radius;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.fillStyle = '#f2d06b';
      ctx.strokeStyle = 'rgba(8, 12, 6, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -10);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawCrosshair(frame: RenderFrame): void {
    if (!frame.showCrosshair) return;
    const ctx = this.ctx;
    const { x, y } = frame.mouse;
    const gap = 5;
    const length = 7;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(8, 12, 6, 0.55)';
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x + dx * gap, y + dy * gap);
      ctx.lineTo(x + dx * (gap + length), y + dy * (gap + length));
      ctx.stroke();
    }

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(250, 247, 235, 0.95)';
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x + dx * gap, y + dy * gap);
      ctx.lineTo(x + dx * (gap + length), y + dy * (gap + length));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(250, 247, 235, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
    ctx.fill();

    if (frame.hitMarker) {
      const color = frame.hitMarker === 'kill' ? '#ff6256' : '#ffd27d';
      const size = frame.hitMarker === 'kill' ? 9 : 7;
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - size, y - size);
      ctx.lineTo(x - 3, y - 3);
      ctx.moveTo(x + size, y - size);
      ctx.lineTo(x + 3, y - 3);
      ctx.moveTo(x - size, y + size);
      ctx.lineTo(x - 3, y + 3);
      ctx.moveTo(x + size, y + size);
      ctx.lineTo(x + 3, y + 3);
      ctx.stroke();
    }

    ctx.restore();
  }

  private createGrassPattern(): CanvasPattern | null {
    const tile = document.createElement('canvas');
    tile.width = 256;
    tile.height = 256;
    const ctx = tile.getContext('2d');
    if (!ctx) return null;
    const rng = mulberry32(0x9a1f2b);

    ctx.fillStyle = '#4c7538';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 22; i += 1) {
      ctx.globalAlpha = 0.05 + rng() * 0.06;
      ctx.fillStyle = rng() > 0.5 ? '#628b48' : '#3c5d2c';
      ctx.beginPath();
      ctx.ellipse(
        rng() * 256,
        rng() * 256,
        20 + rng() * 45,
        10 + rng() * 24,
        rng() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    for (let i = 0; i < 820; i += 1) {
      const x = rng() * 256;
      const y = rng() * 256;
      const length = 2.5 + rng() * 6;
      const lean = (rng() - 0.5) * 3;
      ctx.strokeStyle =
        rng() > 0.66 ? 'rgba(138, 177, 98, 0.42)' : 'rgba(53, 89, 41, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean, y - length);
      ctx.stroke();
    }

    return this.ctx.createPattern(tile, 'repeat');
  }

  private createSoilPattern(): CanvasPattern | null {
    const tile = document.createElement('canvas');
    tile.width = 128;
    tile.height = 128;
    const ctx = tile.getContext('2d');
    if (!ctx) return null;
    const rng = mulberry32(0x441133);

    ctx.fillStyle = '#67513a';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 320; i += 1) {
      ctx.fillStyle =
        rng() > 0.5 ? 'rgba(53, 41, 28, 0.32)' : 'rgba(126, 99, 68, 0.28)';
      const size = 0.6 + rng() * 2.2;
      ctx.beginPath();
      ctx.arc(rng() * 128, rng() * 128, size, 0, Math.PI * 2);
      ctx.fill();
    }

    return this.ctx.createPattern(tile, 'repeat');
  }
}
