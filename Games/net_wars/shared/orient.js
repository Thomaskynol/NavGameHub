// Orientação comum servidor/cliente (fonte única — evita divergência de eixos).
// Convenção: Euler YXZ → q = Ry(yaw)·Rx(pitch)·Rz(roll); nariz local = -Z.
// O servo calcula o nariz como forward(yaw, pitch) (roll não muda o nariz);
// o cliente deriva yaw/pitch/roll de um quaternion — os dois coincidem por
// construção (testado em tests/orient.test.js).

export const TAU = Math.PI * 2;

export function wrapPi(a) {
  // [-π, π] com período 2π (forward() é 2π-periódico em yaw e pitch)
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

// forward a partir de yaw/pitch (convenção Three: -Z frente com yaw=0)
export function forward(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// ---- quaternion mínimo (sem dependência de THREE p/ rodar em Node/testes) ----
export function quatFromEuler(yaw, pitch, roll) {
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cx = Math.cos(pitch * 0.5), sx = Math.sin(pitch * 0.5);
  const cz = Math.cos(roll * 0.5), sz = Math.sin(roll * 0.5);
  // Ry·Rx·Rz
  return {
    x: cy * sx * cz + sy * cx * sz,
    y: sy * cx * cz - cy * sx * sz,
    z: cy * cx * sz - sy * sx * cz,
    w: cy * cx * cz + sy * sx * sz,
  };
}

export function quatMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatAxis(axis, ang) {
  const h = ang * 0.5, s = Math.sin(h);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

export function rotateVec(q, v) {
  // v' = q·v·q⁻¹
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

// Euler YXZ canônico (pitch em [-π/2, π/2]; nos polos roll vira 0 e o yaw
// absorve — a orientação/nariz é preservado, sem "flip" visual).
// Extração via matriz de rotação (cf. THREE.Euler.setFromRotationMatrix 'YXZ':
// pitch = asin(-m23), yaw = atan2(m13, m33), roll = atan2(m21, m22);
// polo: yaw = atan2(-m31, m11)). Normaliza o quat de entrada.
export function eulerFromQuat(q) {
  let { x, y, z, w } = q;
  const n = Math.hypot(x, y, z, w);
  if (n > 0) { x /= n; y /= n; z /= n; w /= n; } else { x = 0; y = 0; z = 0; w = 1; }
  const s = 2 * (w * x - y * z); // -m23
  const pitch = Math.asin(Math.max(-1, Math.min(1, s)));
  if (Math.abs(s) < 0.9999999) {
    return {
      yaw: Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)),
      pitch,
      roll: Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z)),
    };
  }
  return { yaw: Math.atan2(2 * (w * y - x * z), 1 - 2 * (y * y + z * z)), pitch, roll: 0 };
}

// Giro do piloto em função do mouse: dx>0 (direita) vira à direita RELATIVO À
// NAVE (sobre o eixo local de cima), dy<0 (mouse p/ cima) sobe o nariz —
// independente da rolagem: com a nave banqueada, "direita do mouse" continua
// sendo a direita do cockpit (rolagem influencia os eixos de pilotagem).
// k = radianos por pixel (sensibilidade).
export function applyMouseTurn(q, dxPx, dyPx, k) {
  const yawLocal = -dxPx * k;   // sobre +Y local: nariz p/ +X local (direita)
  const pitchLocal = -dyPx * k; // sobre +X local: nariz p/ +Y local (cima)
  const qy = quatAxis({ x: 0, y: 1, z: 0 }, yawLocal);
  const qx = quatAxis({ x: 1, y: 0, z: 0 }, pitchLocal);
  return quatMul(q, quatMul(qy, qx));
}

// Normaliza ângulos recebidos da rede (evita valores extremos/lixo; seno/cosseno
// de número gigante é impreciso). Período 2π preservado.
export function normalizeAngles(yaw, pitch, roll) {
  return { yaw: wrapPi(yaw), pitch: wrapPi(pitch), roll: wrapPi(roll) };
}
