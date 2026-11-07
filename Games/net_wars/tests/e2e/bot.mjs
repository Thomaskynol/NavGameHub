// Aim-bot de teste p/ o E2E full (--flow=full). WS cru sobre `ws` (já do
// projeto): entra na sala como piloto normal e fuzila um alvo pelo nome com
// mira absoluta (o protocolo aceita yaw/pitch absolutos; o servidor aplica
// direto em tickShip). Serve p/ provocar morte/respawn/missil-damage no piloto
// do browser sem precisar de mira por mouse no headless (não-confiável).
// Kills do bot NÃO entram no placar (server exclui bots de scores()), logo o
// fim por timer com 0 kills humanos cai no caminho do empate — registrado.
import { WebSocket } from 'ws';

export function aimAngles(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.asin(Math.max(-1, Math.min(1, dy / dist))),
    dist,
  };
}

export class AimBot {
  constructor({ port, room, name = 'e2e-bot', target }) {
    this.port = port;
    this.room = room;
    this.name = name;
    this.target = target;
    this.seq = 0;
    this.snap = null;
    this.armed = false;
    this.id = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('bot: sem welcome em 5s')), 5000);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: this.name, room: this.room })));
      ws.on('message', (buf) => {
        let m;
        try { m = JSON.parse(String(buf)); } catch { return; }
        if (m.t === 'welcome') {
          if (m.error) { clearTimeout(timer); reject(new Error(`bot denied: ${m.error}`)); return; }
          this.id = m.id;
          clearTimeout(timer);
          this.timer = setInterval(() => this.tick(), 50);
          resolve(m);
        } else if (m.t === 'snapshot') {
          this.snap = m;
        } else if (m.t === 'event' && m.kind === 'kill' && this.killRes && m.b === this.targetId) {
          this.killRes(true);
        }
      });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }
  me() { return this.snap?.ships?.find((s) => s.id === this.id); }
  foe() { return this.snap?.ships?.find((s) => s.name === this.target && !s.goneAt); }
  tick() {
    if (this.ws.readyState !== 1) return;
    const me = this.me();
    const foe = this.foe();
    if (!me || !foe || me.alive === false) return; // sem looping fantasma
    if (foe.id && !this.targetId) this.targetId = foe.id;
    let w = 0, fire = 0, yaw = me.yaw, pitch = me.pitch;
    if (this.armed && foe.alive !== false) {
      const a = aimAngles(me, foe);
      yaw = a.yaw; pitch = a.pitch;
      w = a.dist > 25 ? 1 : 0; // fecha até 25u e fuzila (laser alcança 156u)
      fire = a.dist < 110 ? 1 : 0;
    }
    this.ws.send(JSON.stringify({
      t: 'input', seq: ++this.seq, w, s: 0, a: 0, d: 0,
      yaw, pitch, roll: 0, fire, boost: 0,
    }));
  }
  // arma a missão e resolve true quando o alvo morrer (false em timeoutMs).
  async killOnce(timeoutMs = 60000) {
    this.armed = true;
    const t0 = Date.now();
    for (;;) {
      const foe = this.foe();
      if (foe && foe.alive === false) { this.armed = false; this.idle(); return true; }
      if (Date.now() - t0 > timeoutMs) { this.armed = false; this.idle(); return false; }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  idle() {
    if (this.ws?.readyState === 1) {
      const me = this.me();
      this.ws.send(JSON.stringify({
        t: 'input', seq: ++this.seq, w: 0, s: 0, a: 0, d: 0,
        yaw: me?.yaw ?? 0, pitch: me?.pitch ?? 0, roll: 0, fire: 0, boost: 0,
      }));
    }
  }
  close() { clearInterval(this.timer); try { this.ws?.close(); } catch {} }
}
