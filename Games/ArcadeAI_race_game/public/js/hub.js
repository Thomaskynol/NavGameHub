// Asfalto Vivo — parâmetros do modo Hub (hub/PROTOCOLO.md, seção "Parâmetros
// passados ao jogo"): `?hub=1&room=&name=&create=1|0&expect=&slot=&color=&hubUrl=&htok=`.
// Puro (recebe o search) p/ ser testável em node --test sem DOM.
//
// O que o jogo garante no modo Hub (R2-parte-Arcade + R4):
// - `htok` (token opaco do launch) vira dono da sala no servidor: criar com
//   código livre guarda o dono; recriar o mesmo código com o mesmo htok é
//   retentativa legítima (entra/resume, sem duplicata); com htok diferente é
//   CODE_TAKEN e o cliente mostra erro honesto (SEM join cego na sala alheia).
// - Se `sessionStorage.av.session` for da mesma partida (mesmo room + name +
//   token), o boot retoma identidade/vaga via `resume` (entra até em sala
//   cheia); sessão expirada/ausente → create/join normal honesto.
// - Fechamento pelo Hub (`POST /__hub/close`) exige o mesmo htok da sala.

import { COLORS } from '../../shared/constants.js';

// Cor da URL (?color=) como hex da paleta; inválida → null (servidor escolhe).
function hubColor(raw) {
  const s = String(raw || '').toLowerCase();
  const hit = COLORS.find((c) => c.hex.toLowerCase() === s || c.id === s);
  return hit ? hit.hex : null;
}

// Dono da partida (?htok=): opaco, 1..64 chars [A-Za-z0-9_-]; outro formato → null.
function hubToken(raw) {
  const s = String(raw ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

export function parseHubParams(search) {
  try {
    const q = new URLSearchParams(search);
    if (q.get('hub') !== '1') return null;
    return {
      room: String(q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
      name: String(q.get('name') || '').replace(/\s+/g, ' ').trim().slice(0, 16),
      create: q.get('create') === '1',
      expect: Math.max(0, Number(q.get('expect')) || 0),
      slot: Math.max(0, Number(q.get('slot')) || 0),
      color: hubColor(q.get('color')),
      hubUrl: q.get('hubUrl') ?? '',
      htok: hubToken(q.get('htok')),
    };
  } catch { return null; }
}

// Decisão pura do boot Hub diante da sessão guardada: retoma (resume) só se
// for da mesma partida (mesmo room + name) com token; senão começa do zero.
// Testável em node --test; main.js só executa o resultado.
export function hubResumeAction(hub, sess) {
  if (hub && sess && sess.room === hub.room && sess.name === hub.name && sess.token) {
    return { type: 'resume', room: sess.room, token: sess.token };
  }
  return { type: 'fresh' };
}
