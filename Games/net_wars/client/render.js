// Cena Three: arena fiel aos obstáculos do servidor (STATION/ASTEROIDS de
// shared/constants — mesma fonte da colisão server-side) + naves + projéteis +
// power-ups reais do snapshot + câmera chase. Campos futuros: tolerados via || [].
import * as THREE from 'three';
import { WORLD_BOUND, STATION, ASTEROIDS, POWERUP_SPOTS, TP_SHIP_DROP } from '../shared/constants.js';
import { tpFrame, fpFrame, createTpCam, gunSolution, desiredSolution, clampAim, radarRel } from './camera.js';

const BOUND_WARN = WORLD_BOUND - 50;

const KIND_COLORS = {
  cadence: 0x44ccff, triple: 0xb47aff, overload: 0xff4d2e,
  propulsion: 0xffcc33, repair: 0x51ff7a, shield: 0x8fe3ff,
};

function makeLabel(text, color = '#fff') {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 56;
  const cx = cv.getContext('2d');
  cx.font = 'bold 30px system-ui, sans-serif';
  cx.textAlign = 'center';
  cx.shadowColor = 'rgba(0,0,0,.9)'; cx.shadowBlur = 6;
  cx.fillStyle = color;
  cx.fillText(String(text).slice(0, 16) || '?', 128, 38);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(11, 2.4, 1);
  sp.position.y = 3.4;
  return sp;
}

export function createRenderer(getSettings) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, getSettings().quality === 'low' ? 1 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.domElement.id = 'game-canvas';
  document.getElementById('stage').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060d);
  scene.fog = new THREE.FogExp2(0x04060d, 0.0011);
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 3000);
  camera.position.set(0, 8, 30);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  scene.add(new THREE.AmbientLight(0x8a90b8, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(120, 200, 60);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x44ccff, 0.5);
  rim.position.set(-150, -60, -120);
  scene.add(rim);

  // ---- fundo: estrelas ----
  {
    const g = new THREE.BufferGeometry();
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 1400;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 1400;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 1400;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9db4ff, size: 1.6, sizeAttenuation: false })));
  }

  // colisores p/ câmera: esferas do servidor (mesma fonte da colisão real);
  // formato {x,y,z,r} = o que freeDistAlongRay espera
  const colliders = [{ x: STATION.x, y: STATION.y, z: STATION.z, r: STATION.r },
    ...ASTEROIDS.map((a) => ({ x: a.x, y: a.y, z: a.z, r: a.r }))];

  // ---- ARENA: estação compacta dentro da esfera de colisão (passagens largas
  // ao redor), núcleo holográfico no centro (não-sólido, translúcido),
  // asteroides nos pontos do servidor, rotas acima/abaixo, limites visíveis ----
  const arena = new THREE.Group();
  scene.add(arena);
  {
    const hull = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.7, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x161d33, roughness: 0.8, metalness: 0.4 });
    const glowCyan = new THREE.MeshBasicMaterial({ color: 0x44ccff });
    const R = STATION.r;

    const station = new THREE.Group();
    station.position.set(STATION.x, STATION.y, STATION.z);
    const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.2, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0x66ddff }));
    core.name = 'station-core';
    station.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, R * 0.08, 10, 40),
      new THREE.MeshStandardMaterial({ color: 0x3a4a72, roughness: 0.5, metalness: 0.7, emissive: 0x113355, emissiveIntensity: 0.7 }));
    ring.rotation.x = Math.PI / 2;
    station.add(ring);
    // 4 braços curtos dentro da esfera de colisão (estrutura compacta, entorno livre)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(R * 0.75, R * 0.3, R * 0.3), i % 2 ? dark : hull);
      arm.position.set(Math.cos(a) * R * 0.5, 0, Math.sin(a) * R * 0.5);
      arm.rotation.y = -a + Math.PI / 2;
      station.add(arm);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), glowCyan);
      lamp.position.set(Math.cos(a) * R * 0.85, R * 0.2, Math.sin(a) * R * 0.85);
      station.add(lamp);
    }
    const beacon = new THREE.PointLight(0x44ccff, 2, R * 9);
    station.add(beacon);
    arena.add(station);

    // núcleo de navegação no centro: holograma translúcido = claramente não-sólido
    const holo = new THREE.Mesh(new THREE.TorusGeometry(22, 1.2, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0.35 }));
    holo.rotation.x = Math.PI / 2;
    holo.name = 'holo-ring';
    arena.add(holo);
    const holoCore = new THREE.Mesh(new THREE.SphereGeometry(4, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.4 }));
    holoCore.name = 'arena-core';
    arena.add(holoCore);

    // docas / beacons coloridos nos eixos (orientação rápida)
    const poleCols = [0xff4d6d, 0x51ff7a, 0xffcc33, 0xb47aff];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 120, 8),
        new THREE.MeshBasicMaterial({ color: poleCols[i] }));
      pole.position.set(Math.cos(a) * 250, 0, Math.sin(a) * 250);
      arena.add(pole);
    }

    // rotas acima/abaixo (guias tracejados sobre o centro)
    for (const y of [55, -55]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * 70, y + Math.sin(a * 2) * 8, Math.sin(a) * 70));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: y > 0 ? 0x44ccff : 0xffcc33, dashSize: 6, gapSize: 5, transparent: true, opacity: 0.65 }));
      line.computeLineDistances();
      arena.add(line);
    }

    // asteroides exatamente nos pontos do servidor (mesmo raio da colisão)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.95, metalness: 0.05 });
    const rockMat2 = new THREE.MeshStandardMaterial({ color: 0x465062, roughness: 0.95, metalness: 0.08 });
    ASTEROIDS.forEach((a, i) => {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(a.r, 1), i % 2 ? rockMat : rockMat2);
      rock.position.set(a.x, a.y, a.z);
      rock.rotation.set(i * 1.3, i * 0.7, i * 0.4);
      rock.scale.y = 0.8;
      arena.add(rock);
    });

    // limites visíveis + grades
    arena.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(WORLD_BOUND * 2, WORLD_BOUND * 2, WORLD_BOUND * 2)),
      new THREE.LineBasicMaterial({ color: 0x2b6cff, transparent: true, opacity: 0.35 })));
    const grid = new THREE.GridHelper(WORLD_BOUND * 2, 14, 0x1c3a66, 0x10203c);
    grid.position.y = -WORLD_BOUND;
    grid.material.transparent = true; grid.material.opacity = 0.5;
    arena.add(grid);
    const gridTop = grid.clone(); gridTop.position.y = WORLD_BOUND;
    arena.add(gridTop);

    // pads de spawn próximos à origem (servidor spawna em rnd(30))
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pad = new THREE.Mesh(new THREE.RingGeometry(2.5, 3.4, 20),
        new THREE.MeshBasicMaterial({ color: 0x51ff7a, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
      pad.position.set(Math.cos(a) * 24, (i % 2 ? 14 : -14), Math.sin(a) * 24);
      pad.rotation.x = Math.PI / 2;
      pad.name = 'spawn-pad';
      arena.add(pad);
    }
  }

  // ---- power-ups: 6 posições fixas (POWERUP_SPOTS), estilo pelo snapshot ----
  const powMeshes = new Map();
  for (const p of POWERUP_SPOTS) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(2.2),
      new THREE.MeshBasicMaterial({ color: KIND_COLORS[p.type] ?? 0xffffff, transparent: true, opacity: 0.9 }));
    m.position.set(p.x, p.y, p.z);
    m.userData = { type: p.type, phase: Math.random() * 6 };
    arena.add(m);
    powMeshes.set(p.type, m);
  }

  // ---- naves ----
  const ships = new Map();
  function shipMesh(colorHex) {
    const g = new THREE.Group();
    let color = '#44ccff';
    try { color = new THREE.Color(colorHex || '#44ccff').getStyle(); } catch {}
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2138, roughness: 0.6, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 3.6), mat);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.7, 4), mat);
    nose.rotation.x = -Math.PI / 2; nose.position.z = -2.6;
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xdffcff }));
    cockpit.position.set(0, 0.75, -0.4);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.22, 1.3), dark);
    wing.position.z = 0.9;
    const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 1.1), mat);
    tipL.position.set(-2.3, 0.3, 0.9);
    const tipR = tipL.clone(); tipR.position.x = 2.3;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.4, 1.2), mat);
    fin.position.set(0, 0.8, 1.2);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.9 });
    const fL = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.2, 8), flameMat);
    fL.rotation.x = Math.PI / 2; fL.position.set(-0.55, 0, 2.8);
    const fR = fL.clone(); fR.position.x = 0.55;
    // escudo: bolha visível quando shield>0 ou logo após acerto
    const shield = new THREE.Mesh(new THREE.SphereGeometry(3.4, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    // anel de equipe (só modo teams)
    const teamRing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.28, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    teamRing.rotation.x = Math.PI / 2;
    teamRing.position.y = -1.6;
    teamRing.visible = false;
    g.add(body, nose, cockpit, wing, tipL, tipR, fin, fL, fR, shield, teamRing);
    g.userData = { fL, fR, flameMat, shield, teamRing, hitT: -10 };
    return g;
  }

  // ---- projéteis ----
  const lasers = new Map();
  const laserGeo = new THREE.CylinderGeometry(0.22, 0.22, 7, 6);
  laserGeo.rotateX(Math.PI / 2);
  const missiles = new Map();
  const missilePrev = new Map(); // id -> {x,y,z} p/ orientar pelo deslocamento

  // ---- marca arma ◆: ponto de impacto do raio do NARIZ (trajetória real do
  // servidor: mesma origem no nariz +3m + mesmo forward() + mesmos colisores
  // do tick; o laser nasce no nariz e morre no 1º impacto). Estados:
  // bloqueado = ◆ forte na superfície; vazio = ◆ fraco no ponto máximo;
  // muito-perto = ◆ dim pequeno a AIM_MIN_DIST (fisicamente inalcançável,
  // sem blob). Vale nas 2 câmeras.
  const gunMark = new THREE.Mesh(new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.35, depthTest: false }));
  gunMark.visible = false;
  gunMark.renderOrder = 5;
  scene.add(gunMark);

  // ---- efeitos: pool de explosões ----
  const booms = [];
  for (let i = 0; i < 10; i++) {
    const grp = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0 }));
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(1, 0.3, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0 }));
    grp.add(ball, ringM);
    grp.visible = false;
    scene.add(grp);
    booms.push({ grp, ball, ringM, t: 99 });
  }
  let boomIdx = 0;
  function explode(x, y, z, big = 1, color = 0xffaa33) {
    if (getSettings().reduceFx && big < 1) return;
    const b = booms[boomIdx++ % booms.length];
    b.grp.position.set(x, y, z);
    b.grp.visible = true;
    b.t = 0; b.big = big;
    b.ball.material.color.setHex(color);
  }

  const camPos = new THREE.Vector3(0, 8, 30);
  const camLook = new THREE.Vector3();
  // FP (cockpit, padrão NetWars 1993): câmera RÍGIDA dentro do cockpit, ship-locked
  // (atitude = nariz, up = up da nave, sem auto-nivelar, sem damp).
  // TP (estilo War Thunder): chase atrás/acima com suavização (posição + up
  // interpolados) p/ dar peso de avião; bank da nave inclina o horizonte.
  const tmpV = new THREE.Vector3();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const shipUpV = new THREE.Vector3(0, 1, 0);
  const smPos = new THREE.Vector3(0, 8, 30);
  const smUp = new THREE.Vector3(0, 1, 0);
  const tpSm = createTpCam(); // estado do smoothing TP (matemática em camera.js)
  let lastCamMode = '';
  let ownMesh = null;
  let aimData = null; // {gun, desired} mundo+tela do último frame (→ window.__nw.aim, Lane N)

  // Projeção mundo→tela partilhada: HUD via project() + stash __nw.aim.
  function projectToScreen(x, y, z) {
    tmpV.set(x, y, z).project(camera);
    const behind = tmpV.z > 1;
    return {
      x: (tmpV.x * 0.5 + 0.5) * innerWidth,
      y: (-tmpV.y * 0.5 + 0.5) * innerHeight,
      visible: !behind && Math.abs(tmpV.x) < 0.95 && Math.abs(tmpV.y) < 0.9,
      behind,
    };
  }

  return {
    canvas: renderer.domElement,
    get camPos() { return camPos; },
    get camUp() { return { x: camera.up.x, y: camera.up.y, z: camera.up.z }; },
    get shipUp() {
      if (!ownMesh) return null;
      shipUpV.set(0, 1, 0).applyQuaternion(ownMesh.quaternion);
      return { x: shipUpV.x, y: shipUpV.y, z: shipUpV.z };
    },
    explode,
    flashShip(id) {
      const e = ships.get(id);
      if (e) e.mesh.userData.hitT = performance.now() / 1000;
    },
    worldSize: WORLD_BOUND,
    boundWarn(p) {
      return Math.abs(p.x) > BOUND_WARN || Math.abs(p.y) > BOUND_WARN || Math.abs(p.z) > BOUND_WARN;
    },
    radar(snap, myId) {
      const me = (snap.ships || []).find((s) => s.id === myId);
      if (!me) return [];
      const out = [];
      const push = (x, z, up, kind) => {
        const r = radarRel(me.yaw, x - me.x, z - me.z);
        out.push({ x: r.x, z: r.z, up, kind });
      };
      const foeOf = (s) => {
        if (s.bot) return me.team === 'bots' ? 'ally' : 'foe';
        if (snap.mode === 'teams' && me.team) return s.team === me.team ? 'ally' : 'foe';
        if (snap.mode === 'survival') return 'ally';
        return 'foe';
      };
      for (const s of snap.ships || []) {
        if (s.id === myId || s.alive === false) continue;
        push(s.x, s.z, s.y > me.y + 8 ? 1 : s.y < me.y - 8 ? -1 : 0, foeOf(s));
      }
      for (const l of snap.lasers || []) push(l.x, l.z, 0, 'shot');
      for (const mm of snap.missiles || []) push(mm.x, mm.z, mm.y > me.y + 8 ? 1 : mm.y < me.y - 8 ? -1 : 0, mm.target === myId ? 'incoming' : 'missile');
      for (const p of snap.powerups || []) if (p.active) push(p.x, p.z, p.y > me.y + 8 ? 1 : p.y < me.y - 8 ? -1 : 0, 'pickup');
      return out;
    },
    project(x, y, z) {
      return projectToScreen(x, y, z);
    },
    get aim() { return aimData; },
    render(snap, myId, fx, local) {
      const dt = Math.min(0.05, fx.dt || 0.016);
      const t = performance.now() / 1000;
      const reduceFx = !!getSettings().reduceFx;
      // Mira local (60fps): usa ângulos do mouse imediatamente; snapshot (10Hz)
      // só posiciona. Sem isso a mira anda aos pulos no ritmo do WS.
      const lyaw = local ? local.yaw : null;

      const holo = arena.getObjectByName('holo-ring');
      if (holo) holo.rotation.z += dt * 0.3;
      const core = arena.getObjectByName('arena-core');
      if (core) { const s = 1 + Math.sin(t * 2.2) * 0.15; core.scale.set(s, s, s); }
      const sc = arena.getObjectByName('station-core');
      if (sc) { const s = 1 + Math.sin(t * 3) * 0.08; sc.scale.set(s, s, s); }

      // power-ups reais: pulsa quando ativo, fantasma apagado em respawn
      for (const p of snap.powerups || []) {
        const m = powMeshes.get(p.type);
        if (!m) continue;
        m.visible = true;
        m.material.opacity = p.active ? 0.9 : 0.15;
        m.scale.setScalar(p.active ? 1 : 0.6);
        if (p.active) {
          m.rotation.y += dt * 2;
          m.position.y += Math.sin(t * 2 + m.userData.phase) * dt * 2;
        }
      }

      // naves
      const seen = new Set();
      let me = null;
      ownMesh = null;
      const tpMode = (getSettings().camMode || 'fp') === 'tp';
      for (const s of snap.ships || []) {
        seen.add(s.id);
        let e = ships.get(s.id);
        if (!e) {
          const mesh = shipMesh(s.color);
          const tag = (s.name || '?') + (s.bot ? ' [BOT]' : '');
          const label = makeLabel(tag, s.id === myId ? '#8fe3ff' : s.bot ? '#ff9a9a' : '#ffffff');
          mesh.add(label);
          scene.add(mesh);
          e = { mesh, label, lastName: tag };
          ships.set(s.id, e);
        }
        if (e.lastName !== (s.name + (s.bot ? 'b' : ''))) {
          e.mesh.remove(e.label);
          const tag = (s.name || '?') + (s.bot ? ' [BOT]' : '');
          e.label = makeLabel(tag, s.id === myId ? '#8fe3ff' : s.bot ? '#ff9a9a' : '#ffffff');
          e.mesh.add(e.label);
          e.lastName = s.name + (s.bot ? 'b' : '');
        }
        const mesh = e.mesh;
        const dead = s.alive === false || s.waiting;
        const isOwn = s.id === myId;
        const fpMode = (getSettings().camMode || 'fp') !== 'tp';
        mesh.visible = !dead && !s.goneAt;
        if (!mesh.visible) continue;
        // Nave própria usa posição E atitude preditas locais (60fps); demais, o snapshot.
        const own = (s.id === myId && local && local.x !== undefined) ? local : null;
        mesh.position.set(own ? own.x : s.x, own ? own.y : s.y, own ? own.z : s.z);
        // TP: nave própria deslocada p/ baixo (só visual) p/ não cobrir a mira
        if (isOwn && tpMode) mesh.position.y -= TP_SHIP_DROP;
        mesh.rotation.order = 'YXZ';
        // R = Ry(yaw)·Rx(pitch)·Rz(roll): Rx(+p) leva o nariz (-Z) p/ +Y,
        // igual ao forward() do servidor. (Era -pitch: visual invertido.)
        const vyaw = (s.id === myId && lyaw !== null) ? local.yaw : s.yaw;
        const vpitch = (s.id === myId && lyaw !== null) ? local.pitch : s.pitch;
        // Roll próprio: integrador local fluido (60fps, sem degraus de 10Hz e
        // sem retorno elástico); só ressincroniza em teleporte/respawn.
        const vroll = (s.id === myId && lyaw !== null && local.roll !== undefined) ? local.roll : (s.roll || 0);
        mesh.rotation.set(vpitch, vyaw, vroll);
        const u = mesh.userData;
        // propulsor reage ao boost real (servidor é autoridade)
        const boosting = (s.boost ?? 100) < 99.5;
        const fs = (0.55 + (boosting ? 1.9 : 0.25)) * (reduceFx ? 0.7 : 1);
        u.fL.scale.set(1, fs, 1); u.fR.scale.set(1, fs, 1);
        u.flameMat.color.setHex(boosting ? 0xffcc44 : 0x66d9ff);
        const shieldOn = (s.shield || 0) > 0 || (t - u.hitT < 0.6);
        u.shield.material.opacity += ((shieldOn ? 0.35 : 0) - u.shield.material.opacity) * Math.min(1, dt * 10);
        // anel de equipe
        if (s.team === 'red' || s.team === 'blue') {
          u.teamRing.visible = true;
          u.teamRing.material.color.setHex(s.team === 'red' ? 0xff4d6d : 0x44ccff);
        } else u.teamRing.visible = false;
        if (s.id === myId) { me = s; ownMesh = mesh; }
        // FP cockpit: esconde a nave própria (não bloqueia a visão interna)
        if (isOwn && fpMode && mesh.visible) mesh.visible = false;
      }
      for (const [id, e] of ships) {
        if (!seen.has(id)) { scene.remove(e.mesh); ships.delete(id); }
      }

      // lasers: bastão brilhante orientado pela direção (leitura prioritária)
      const lseen = new Set();
      for (const l of snap.lasers || []) {
        lseen.add(l.id);
        let m = lasers.get(l.id);
        if (!m) {
          m = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: 0xff5040 }));
          scene.add(m);
          lasers.set(l.id, m);
        }
        m.position.set(l.x, l.y, l.z);
        tmpV.set(l.dx, l.dy, l.dz).normalize();
        m.quaternion.setFromUnitVectors(Z_AXIS, tmpV);
        const pulse = reduceFx ? 1 : 1 + Math.sin(t * 30) * 0.15;
        m.scale.set(pulse, pulse, 1);
      }
      for (const [id, m] of lasers) {
        if (!lseen.has(id)) { scene.remove(m); lasers.delete(id); }
      }

      // mísseis reais: cone âmbar distinto; orienta pelo deslocamento (snapshot não traz dir)
      const mseen = new Set();
      for (const mm of snap.missiles || []) {
        mseen.add(mm.id);
        let m = missiles.get(mm.id);
        if (!m) {
          m = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.8, 6),
            new THREE.MeshBasicMaterial({ color: 0xffcc33 }));
          scene.add(m);
          missiles.set(mm.id, m);
        }
        const prev = missilePrev.get(mm.id);
        m.position.set(mm.x, mm.y, mm.z);
        if (prev) {
          tmpV.set(mm.x - prev.x, mm.y - prev.y, mm.z - prev.z);
          if (tmpV.lengthSq() > 1e-6) m.quaternion.setFromUnitVectors(Y_AXIS, tmpV.normalize());
        } else {
          m.rotation.z += dt * 9;
        }
        missilePrev.set(mm.id, { x: mm.x, y: mm.y, z: mm.z });
      }
      for (const [id, m] of missiles) {
        if (!mseen.has(id)) { scene.remove(m); missiles.delete(id); missilePrev.delete(id); }
      }

      // explosões curtas (~0.6s)
      for (const b of booms) {
        if (!b.grp.visible) continue;
        b.t += dt;
        const k = b.t / 0.6;
        if (k >= 1) { b.grp.visible = false; continue; }
        const big = b.big || 1;
        b.ball.scale.setScalar(1 + k * 9 * big);
        b.ball.material.opacity = 0.85 * (1 - k);
        b.ringM.scale.setScalar(1 + k * 13 * big);
        b.ringM.material.opacity = 0.7 * (1 - k);
        b.ringM.lookAt(camera.position);
      }

      // ---- marca arma ◆ + stash ○/◆ p/ window.__nw.aim (Lane N publica) ----
      // ◆ = impacto do raio do NARIZ local 60fps (gunSolution: origem no nariz
      // +3m como o laser do servidor, mesmos colisores do tick). Em curva o
      // nariz move a cada frame — sem salto de 10Hz. ○ = ponto do DESEJO
      // (desiredSolution, regras turn.js); em FP desejo == nariz.
      aimData = null;
      if (me && local && me.alive !== false && !me.waiting) {
        const ox = local.x !== undefined ? local.x : me.x;
        const oy = local.y !== undefined ? local.y : me.y;
        const oz = local.z !== undefined ? local.z : me.z;
        const g = gunSolution({ x: ox, y: oy, z: oz }, local.yaw, local.pitch, colliders);
        gunMark.position.set(g.point.x, g.point.y, g.point.z);
        gunMark.visible = true;
        gunMark.material.opacity = !g.blocked ? 0.3 : (g.near ? 0.55 : 0.95);
        gunMark.rotation.y += dt * 3;
        gunMark.scale.setScalar(g.near ? 0.6 : (!g.blocked ? 0.7 : 1));
        const gp = projectToScreen(g.point.x, g.point.y, g.point.z);
        const gc = clampAim(gp.x, gp.y, gp.behind, innerWidth, innerHeight);
        const yawD = (local.dyaw !== undefined && Number.isFinite(local.dyaw)) ? local.dyaw : local.yaw;
        const pitD = (local.dpitch !== undefined && Number.isFinite(local.dpitch)) ? local.dpitch : local.pitch;
        const d = desiredSolution({ x: ox, y: oy, z: oz }, yawD, pitD, colliders);
        const dp = projectToScreen(d.x, d.y, d.z);
        const dc = clampAim(dp.x, dp.y, dp.behind, innerWidth, innerHeight);
        aimData = {
          gun: { x: g.point.x, y: g.point.y, z: g.point.z, dist: g.dist, blocked: g.blocked, near: g.near, sx: gc.x, sy: gc.y, edge: gc.edge, behind: gp.behind, visible: gp.visible },
          desired: { x: d.x, y: d.y, z: d.z, dist: d.dist, free: d.free, state: d.state, sx: dc.x, sy: dc.y, edge: dc.edge, behind: dp.behind, visible: dp.visible },
        };
      } else {
        gunMark.visible = false;
      }

      // ---- câmera ----
      // FP (cockpit, padrão NetWars 1993): RÍGIDA dentro do cockpit — atitude =
      // nariz (yaw/pitch/roll locais 60fps), up = up da nave, sem damp/lerp,
      // sem auto-nivelar. Resposta instantânea ao mouse (perseguição rápida).
      // TP (estilo War Thunder): chase atrás/acima COM suavização (posição + up
      // interpolados) p/ peso de avião; bank inclina o horizonte. Colisão com
      // cenário encurta o offset (P0-6: nunca além da distância livre, com
      // re-teste do ponto suavizado + lookAt paralelo ancorado na câmera
      // suavizada). Troca de modo/teleporte dá snap (sem voo longo). ----
      if (me) {
        const mode = (getSettings().camMode || 'fp') === 'tp' ? 'tp' : 'fp';
        const cyw = lyaw !== null ? local.yaw : me.yaw;
        const cpi = lyaw !== null ? local.pitch : me.pitch;
        const croll = (lyaw !== null && local.roll !== undefined) ? local.roll : (me.roll || 0);
        const hasPred = !!(local && local.x !== undefined);
        const px0 = hasPred ? local.x : me.x;
        const py0 = hasPred ? local.y : me.y;
        const pz0 = hasPred ? local.z : me.z;
        if (mode === 'fp') {
          // cockpit: olho FP_EYE_BACK atrás da origem SOBRE o eixo do nariz,
          // olhando PARALELO ao nariz → centro da tela = linha de tiro em
          // qualquer distância/obstáculo (sem supor convergência).
          lastCamMode = 'fp';
          const f = fpFrame({ x: px0, y: py0, z: pz0 }, cyw, cpi, croll, colliders);
          camPos.set(f.cam.x, f.cam.y, f.cam.z);
          camera.position.copy(camPos);
          camLook.set(f.look.x, f.look.y, f.look.z);
          camera.up.set(f.up.x, f.up.y, f.up.z);
          camera.lookAt(camLook);
        } else {
          // TP: câmera olha AO LONGO do nariz (paralela), não para a nave:
          // o ponto de fuga da direção do tiro cai no centro exato — a ✛
          // central é para onde a bala vai em qualquer alcance. A nave
          // aparece abaixo do centro (só visual, TP_SHIP_DROP) p/ não cobrir a mira.
          // Posição VERDADEIRA (px0..pz0, sem DROP) p/ colisão — DROP é mesh-only.
          const snap = !!((local && local.snap) || lastCamMode !== 'tp');
          const f = tpFrame({ x: px0, y: py0, z: pz0 }, cyw, cpi, croll, dt, tpSm, colliders, WORLD_BOUND, snap);
          lastCamMode = 'tp';
          smPos.set(f.cam.x, f.cam.y, f.cam.z);
          smUp.set(f.up.x, f.up.y, f.up.z);
          camPos.copy(smPos);
          camera.position.copy(smPos);
          camLook.set(f.look.x, f.look.y, f.look.z);
          camera.up.copy(smUp);
          camera.lookAt(camLook);
        }
      } else {
        // sem nave própria (morto/esperando): órbita lenta do centro
        const a = t * 0.08;
        camera.position.set(Math.cos(a) * 180, 70, Math.sin(a) * 180);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        camPos.copy(camera.position);
      }

      renderer.render(scene, camera);
    },
  };
}
