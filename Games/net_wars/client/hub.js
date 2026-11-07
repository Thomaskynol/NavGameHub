// Hub (?hub=1): overlay compacto, polling de /__hub/state a cada 2s.
// Não pede nome/sala de novo: main.js já preencheu via query/session.
// Botão voltar usa hubUrl validada (só http/https).
export function initHub() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('hub') !== '1') return null;
  const box = document.getElementById('hub-box');
  box.style.display = 'block';
  const list = document.getElementById('hub-list');
  const back = document.getElementById('hub-back');
  const hubUrl = qs.get('hubUrl') || '';
  let valid = '';
  try {
    const u = new URL(hubUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') valid = hubUrl;
  } catch {}
  if (valid) {
    back.style.display = 'inline-block';
    back.onclick = () => { location.href = valid; };
  }
  async function poll() {
    try {
      const r = await fetch('/__hub/state', { cache: 'no-store' });
      const j = await r.json();
      const rooms = j.rooms || [];
      list.innerHTML = rooms.length
        ? rooms.map((x) => `<div>◈ ${escapeHtml(x.room)} — ${x.players} jog · ${x.endsInS}s</div>`).join('')
        : '<div>nenhuma sala ativa</div>';
      document.getElementById('hub-up').textContent = `up ${j.uptimeS || 0}s`;
    } catch {
      list.innerHTML = '<div>hub offline (jogo local continua)</div>';
    }
  }
  poll();
  const t = setInterval(poll, 2000);
  return { stop() { clearInterval(t); } };
}

export function hubParams() {
  const qs = new URLSearchParams(location.search);
  return {
    hub: qs.get('hub') === '1',
    room: qs.get('room') || '',
    name: qs.get('name') || '',
    color: qs.get('color') || '',
    create: qs.get('create') || '',
    mode: qs.get('mode') || '',
    expect: Number(qs.get('expect')) || 0,
    slot: qs.get('slot') || '',
    hubUrl: qs.get('hubUrl') || '',
    htok: qs.get('htok') || '',
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Entrada automática na partida no modo Hub (pura, testável em node):
// create=1 (criador) fica no lobby e inicia quando a turma chega;
// create=0 (convidado) entra direto; sem create (link direto) segue expect.
export function shouldAutoEnter({ create = '', expect = 0 } = {}) {
  if (create === '1') return false;
  if (create === '0') return true;
  return Number(expect) <= 1;
}
