// Asfalto Vivo — parâmetros do modo Hub (hub/PROTOCOLO.md, seção "Parâmetros
// passados ao jogo"): `?hub=1&room=&name=&create=1|0&expect=&slot=&color=&hubUrl=`.
// Puro (recebe o search) p/ ser testável em node --test sem DOM.

import { COLORS } from '../../shared/constants.js';

// Cor da URL (?color=) como hex da paleta; inválida → null (servidor escolhe).
function hubColor(raw) {
  const s = String(raw || '').toLowerCase();
  const hit = COLORS.find((c) => c.hex.toLowerCase() === s || c.id === s);
  return hit ? hit.hex : null;
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
    };
  } catch { return null; }
}
