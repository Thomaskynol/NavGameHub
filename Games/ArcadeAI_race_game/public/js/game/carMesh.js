/**
 * public/js/game/carMesh.js — modelo low-poly do carro (three.js, browser only).
 * Fachada (ARCHITECTURE.md §6, fase 2 do engine):
 *   buildCarMesh(colorHex) => { group, setSteer(a), setWheelSpin(dist),
 *                               setTilt(roll, pitch) }
 *   buildNameTag(text, colorHex) => THREE.Sprite (canvas; máx ~12 chars)
 * Carroceria: caixa + cabine em cunha + para-choques; 4 rodas em cilindro
 * (dianteiras orientáveis ±0.5 rad); MeshStandard flat + sombra simples.
 */
import * as THREE from '/vendor/three.module.js';

const WHEEL_R = 0.42;
const WHEEL_W = 0.34;
const STEER_MAX = 0.5; // rad — conforme SPEC §9

function taperedBoxGeometry(w, h, d, topScaleX, topScaleZ, topShiftZ) {
  // caixa com o topo afinado (cunha de cabine) p/ silhouette estilizada
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * topScaleX);
      pos.setZ(i, pos.getZ(i) * topScaleZ + topShiftZ);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export function buildCarMesh(colorHex = '#e5484d') {
  const group = new THREE.Group();

  const paint = new THREE.MeshStandardMaterial({
    color: colorHex, flatShading: true, metalness: 0.15, roughness: 0.55,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#23262e', flatShading: true, metalness: 0.05, roughness: 0.85,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: '#86b6d6', flatShading: true, metalness: 0.2, roughness: 0.25,
  });
  const lampWhite = new THREE.MeshStandardMaterial({
    color: '#f5f0d8', flatShading: true, emissive: '#3a3620', roughness: 0.4,
  });
  const lampRed = new THREE.MeshStandardMaterial({
    color: '#d8323a', flatShading: true, emissive: '#300607', roughness: 0.4,
  });

  // corpo inclinável (roll/pitch) sob as rodas — tilt não afeta rodas
  const body = new THREE.Group();
  group.add(body);

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.2), paint);
  chassis.position.y = 0.52;
  body.add(chassis);

  const cabin = new THREE.Mesh(
    taperedBoxGeometry(1.5, 0.55, 1.8, 0.55, 0.55, -0.08), glass);
  cabin.position.set(0, 1.02, -0.2);
  body.add(cabin);

  const bumperGeo = new THREE.BoxGeometry(1.96, 0.28, 0.32);
  const bumperF = new THREE.Mesh(bumperGeo, dark);
  bumperF.position.set(0, 0.36, 2.06);
  body.add(bumperF);
  const bumperR = new THREE.Mesh(bumperGeo, dark);
  bumperR.position.set(0, 0.36, -2.06);
  body.add(bumperR);

  const lampGeo = new THREE.BoxGeometry(0.32, 0.14, 0.08);
  for (const sx of [-0.58, 0.58]) {
    const hl = new THREE.Mesh(lampGeo, lampWhite);
    hl.position.set(sx, 0.62, 2.11);
    body.add(hl);
    const tl = new THREE.Mesh(lampGeo, lampRed);
    tl.position.set(sx, 0.62, -2.11);
    body.add(tl);
  }

  // rodas: cilindro com eixo já em X; dianteiras em pivô de esterço
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 12);
  wheelGeo.rotateZ(Math.PI / 2); // eixo do cilindro → X (lateral)
  const wheels = []; // rodações acumuladas (dist em metros)
  const steerPivots = [];
  const wheelPos = [
    [0.95, 1.32, true], [-0.95, 1.32, true],
    [0.95, -1.35, false], [-0.95, -1.35, false],
  ];
  for (const [wx, wz, isFront] of wheelPos) {
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheels.push(wheel);
    if (isFront) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, WHEEL_R, wz);
      pivot.add(wheel);
      steerPivots.push(pivot);
      group.add(pivot);
    } else {
      wheel.position.set(wx, WHEEL_R, wz);
      group.add(wheel);
    }
  }

  for (const m of [chassis, cabin, bumperF, bumperR, ...wheels]) m.castShadow = true;
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  return {
    group,
    /** a em radianos (motor envia steer01 * 0.5); clamp ±0.5 */
    setSteer(a) {
      const y = Math.max(-STEER_MAX, Math.min(STEER_MAX, a || 0));
      for (const p of steerPivots) p.rotation.y = y;
    },
    /** dist percorrida desde a última chamada (m); gira as 4 rodas */
    setWheelSpin(dist) {
      if (!dist) return;
      const d = (dist / WHEEL_R);
      for (const w of wheels) w.rotation.x += d;
    },
    /** inclinação visual do corpo: roll (rad, curva) e pitch (rad, frenagem) */
    setTilt(roll = 0, pitch = 0) {
      body.rotation.z = Math.max(-0.18, Math.min(0.18, roll || 0));
      body.rotation.x = Math.max(-0.12, Math.min(0.12, pitch || 0));
    },
  };
}

export function buildNameTag(text, colorHex = '#ffffff') {
  const label = String(text == null ? '' : text).slice(0, 12);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const c2d = canvas.getContext('2d');
  const font = 'bold 38px system-ui, "Segoe UI", Arial, sans-serif';
  c2d.font = font;
  const tw = Math.min(236, c2d.measureText(label).width + 26);
  const bx = (256 - tw) / 2;
  const r = 12;
  c2d.fillStyle = 'rgba(10, 12, 16, 0.72)'; // fundo escuro semi-transparente
  c2d.beginPath();
  c2d.moveTo(bx + r, 8);
  c2d.arcTo(bx + tw, 8, bx + tw, 64, r);
  c2d.arcTo(bx + tw, 64, bx, 64, r);
  c2d.arcTo(bx, 64, bx, 8, r);
  c2d.arcTo(bx, 8, bx + tw, 8, r);
  c2d.closePath();
  c2d.fill();
  c2d.font = font;
  c2d.textAlign = 'center';
  c2d.textBaseline = 'middle';
  c2d.fillStyle = 'rgba(0,0,0,0.55)';
  c2d.fillText(label, 129, 37);
  c2d.fillStyle = colorHex;
  c2d.fillText(label, 128, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(2.3, 2.3 * (72 / 256), 1);
  return sprite;
}
