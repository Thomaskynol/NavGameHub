import { ARENA, PISTOL, pointBlockedByObstacle } from '@vava/shared';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Tracer {
  x: number;
  y: number;
  angle: number;
  life: number;
}

interface Flash {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
}

interface DamageNumber {
  x: number;
  y: number;
  value: number;
  life: number;
  maxLife: number;
}

interface DropMarker {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

interface Decal {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class Effects {
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private numbers: DamageNumber[] = [];
  private decals: Decal[] = [];
  private dropMarkers: DropMarker[] = [];
  private shake = 0;

  clear(): void {
    this.particles = [];
    this.tracers = [];
    this.flashes = [];
    this.numbers = [];
    this.decals = [];
    this.dropMarkers = [];
    this.shake = 0;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  spawnShot(x: number, y: number, angle: number): void {
    this.flashes.push({ x, y, angle, life: 0.07, maxLife: 0.07 });
    for (let i = 0; i < 3; i += 1) {
      const spread = angle + randomBetween(-0.55, 0.55);
      const speed = randomBetween(40, 150);
      this.particles.push({
        x,
        y,
        vx: Math.cos(spread) * speed,
        vy: Math.sin(spread) * speed,
        life: randomBetween(0.08, 0.18),
        maxLife: 0.18,
        size: randomBetween(1, 2.4),
        color: i === 0 ? '#ffd27d' : '#f4a259',
      });
    }
  }

  spawnTracer(x: number, y: number, angle: number): void {
    // Flash curto: a bala real vem do snapshot (sem duplicar).
    this.tracers.push({ x, y, angle, life: 0.09 });
  }

  spawnHit(x: number, y: number): void {
    for (let i = 0; i < 7; i += 1) {
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(35, 170);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomBetween(0.15, 0.35),
        maxLife: 0.35,
        size: randomBetween(1.2, 2.8),
        color: i % 3 === 0 ? '#ffcf7a' : i % 3 === 1 ? '#d98545' : '#9d3f32',
      });
    }
  }

  spawnKill(x: number, y: number, color: string): void {
    for (let i = 0; i < 22; i += 1) {
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(30, 210);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomBetween(0.35, 0.8),
        maxLife: 0.8,
        size: randomBetween(1.5, 4),
        color: i % 4 === 0 ? color : i % 3 === 0 ? '#8e352d' : '#6d3028',
      });
    }
    for (let i = 0; i < 2; i += 1) {
      this.decals.push({
        x: x + randomBetween(-14, 14),
        y: y + randomBetween(-10, 10),
        radius: randomBetween(10, 22),
        life: 22,
        maxLife: 22,
        color: 'rgba(92, 28, 24, 0.38)',
      });
    }
    this.addShake(0.55);
  }

  spawnExplosion(x: number, y: number, radius: number): void {
    for (let i = 0; i < 90; i += 1) {
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(40, 420);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomBetween(0.4, 1.1),
        maxLife: 1.1,
        size: randomBetween(1.5, 5),
        color:
          i % 5 === 0
            ? '#ffe08a'
            : i % 4 === 0
              ? '#ff9a4d'
              : i % 3 === 0
                ? '#c94a3a'
                : i % 2 === 0
                  ? '#6b6b5a'
                  : '#3a3a32',
      });
    }
    for (let i = 0; i < 6; i += 1) {
      this.decals.push({
        x: x + randomBetween(-radius * 0.25, radius * 0.25),
        y: y + randomBetween(-radius * 0.25, radius * 0.25),
        radius: randomBetween(radius * 0.35, radius * 0.75),
        life: 30,
        maxLife: 30,
        color: i % 2 === 0 ? 'rgba(40, 38, 30, 0.45)' : 'rgba(92, 28, 24, 0.35)',
      });
    }
    this.addShake(0.9);
  }

  spawnDamageNumber(x: number, y: number, value: number): void {
    this.numbers.push({
      x: x + randomBetween(-7, 7),
      y: y - 18,
      value,
      life: 0.75,
      maxLife: 0.75,
    });
  }

  spawnDropWarning(x: number, y: number): void {
    this.dropMarkers.push({ x, y, life: 5, maxLife: 5 });
  }

  getDropMarkers(): { x: number; y: number }[] {
    return this.dropMarkers.map((marker) => ({ x: marker.x, y: marker.y }));
  }

  update(dt: number): void {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const drag = Math.exp(-4 * dt);
      particle.vx *= drag;
      particle.vy *= drag;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);

    for (const tracer of this.tracers) {
      tracer.life -= dt;
      tracer.x += Math.cos(tracer.angle) * PISTOL.bulletSpeed * dt;
      tracer.y += Math.sin(tracer.angle) * PISTOL.bulletSpeed * dt;
      if (
        tracer.x < ARENA.inset ||
        tracer.y < ARENA.inset ||
        tracer.x > ARENA.width - ARENA.inset ||
        tracer.y > ARENA.height - ARENA.inset ||
        pointBlockedByObstacle(tracer.x, tracer.y, 2)
      ) {
        tracer.life = 0;
      }
    }
    this.tracers = this.tracers.filter((tracer) => tracer.life > 0);

    for (const flash of this.flashes) flash.life -= dt;
    this.flashes = this.flashes.filter((flash) => flash.life > 0);

    for (const number of this.numbers) {
      number.life -= dt;
      number.y -= 24 * dt;
    }
    this.numbers = this.numbers.filter((number) => number.life > 0);

    for (const decal of this.decals) decal.life -= dt;
    this.decals = this.decals.filter((decal) => decal.life > 0);

    for (const marker of this.dropMarkers) marker.life -= dt;
    this.dropMarkers = this.dropMarkers.filter((marker) => marker.life > 0);

    this.shake = Math.max(0, this.shake - dt * 2.4);
  }

  getShakeOffset(): { x: number; y: number } {
    if (this.shake <= 0.001) return { x: 0, y: 0 };
    const magnitude = this.shake * this.shake * 11;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * magnitude;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  renderGround(ctx: CanvasRenderingContext2D): void {
    for (const decal of this.decals) {
      const alpha = Math.min(1, decal.life / 4);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = decal.color;
      ctx.beginPath();
      ctx.ellipse(decal.x, decal.y, decal.radius, decal.radius * 0.68, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.lineCap = 'round';

    for (const tracer of this.tracers) {
      const tailLength = 19;
      const tailX = tracer.x - Math.cos(tracer.angle) * tailLength;
      const tailY = tracer.y - Math.sin(tracer.angle) * tailLength;
      ctx.strokeStyle = 'rgba(255, 220, 140, 0.75)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255, 196, 92, 0.8)';
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tracer.x, tracer.y);
      ctx.stroke();
      ctx.fillStyle = '#fff2c4';
      ctx.beginPath();
      ctx.arc(tracer.x, tracer.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const flash of this.flashes) {
      const α = Math.max(0, flash.life / flash.maxLife);
      ctx.save();
      ctx.translate(flash.x, flash.y);
      ctx.rotate(flash.angle);
      ctx.globalAlpha = α;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffe6a3';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(14, -4.5);
      ctx.lineTo(22, 0);
      ctx.lineTo(14, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 175, 83, 0.7)';
      ctx.beginPath();
      ctx.arc(4, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const particle of this.particles) {
      const α = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = α;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (0.5 + α * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const marker of this.dropMarkers) {
      const alpha = Math.max(0, marker.life / marker.maxLife);
      ctx.save();
      ctx.globalAlpha = 0.35 + alpha * 0.45;
      ctx.strokeStyle = '#ef6461';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef6461';
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DROP', marker.x, marker.y - 42);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 13px ui-monospace, monospace';
    ctx.lineWidth = 3;
    for (const number of this.numbers) {
      const α = Math.max(0, number.life / number.maxLife);
      ctx.globalAlpha = α;
      ctx.strokeStyle = 'rgba(15, 20, 10, 0.85)';
      ctx.strokeText(`-${number.value}`, number.x, number.y);
      ctx.fillStyle = '#ffd27d';
      ctx.fillText(`-${number.value}`, number.x, number.y);
    }

    ctx.restore();
  }
}
