// Asfalto Vivo — HUD da corrida (painel sobre o canvas 3D).
// Pinta somente a partir do payload de hud.update (não inventa dados).

import { h, clear, fmtTime, clamp } from './dom.js';

export function createHud() {
  const nitroFill = h('div', { class: 'nitro-fill' });
  const nitroPct = h('span', { class: 'pct', text: '0%' });
  const nitroBox = h('div', { class: 'hud-nitro' },
    h('div', { class: 'hud-nitro-head' },
      h('span', { text: 'Nitro' }),
      nitroPct,
    ),
    h('div', { class: 'nitro-track' }, nitroFill),
  );

  const timeMain = h('div', { class: 'hud-time-main', text: '0:00.00' });
  const lapTimeEl = h('b', { text: '—' });
  const bestTimeEl = h('b', { text: '—' });
  const timers = h('div', { class: 'hud-timers' },
    timeMain,
    h('div', { class: 'hud-time-sub' },
      h('span', {}, 'Volta ', lapTimeEl),
      h('span', {}, 'Melhor ', bestTimeEl),
    ),
  );

  const placeEl = h('span', { class: 'v', text: '—' });
  const lapEl = h('span', { class: 'v', text: '—' });
  const chips = h('div', { class: 'hud-chips' },
    h('div', { class: 'hud-chip' }, placeEl, h('span', { class: 'k', text: 'Posição' })),
    h('div', { class: 'hud-chip' }, lapEl, h('span', { class: 'k', text: 'Volta' })),
  );

  const speedEl = h('span', { class: 'num', text: '0' });
  const speed = h('div', { class: 'hud-speed' }, speedEl, h('span', { class: 'unit', text: 'km/h' }));

  const canvas = h('canvas', { class: 'hud-map', width: 220, height: 220, 'aria-hidden': 'true' });
  const mapWrap = h('div', { class: 'hud-map-wrap' }, canvas);
  const left = h('div', { class: 'hud-left' }, mapWrap, speed);

  const boardRows = h('div', { class: 'hud-board-rows' });
  const board = h('div', { class: 'hud-board' },
    h('div', { class: 'hud-board-head' }, h('span', { text: 'Classificação' }), h('span', { id: 'hud-board-total', text: '' })),
    boardRows,
  );

  const countdownEl = h('div', { class: 'hud-countdown', 'aria-live': 'assertive' });
  const notices = h('div', { class: 'hud-notices', 'aria-live': 'polite' });
  const invalidEl = h('div', { class: 'hud-invalid', text: 'Volta inválida', role: 'status' });

  const root = h('div', { class: 'hud', hidden: true },
    timers, chips, left, nitroBox, board, countdownEl, notices, invalidEl,
  );

  let lastPayload = null;
  let resizeHandler = null;
  let selfId = null;

  function drawMinimap(p) {
    const mm = p && p.minimap;
    if (!mm || !mm.polyline || mm.polyline.length < 2 || !mm.bounds) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = canvas.clientWidth || 160;
    if (canvas.width !== Math.round(cssSize * dpr)) {
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
    }
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.scale(dpr, dpr);
    const S = cssSize;
    const pad = S * 0.1;
    const { minX, minZ, maxX, maxZ } = mm.bounds;
    const spanX = Math.max(maxX - minX, 1e-3);
    const spanZ = Math.max(maxZ - minZ, 1e-3);
    const scale = (S - pad * 2) / Math.max(spanX, spanZ);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const tx = (x) => S / 2 + (x - cx) * scale;
    const tz = (z) => S / 2 + (z - cz) * scale;

    // traçado
    ctx.beginPath();
    mm.polyline.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(tx(x), tz(z));
      else ctx.lineTo(tx(x), tz(z));
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(238,241,246,0.28)';
    ctx.lineWidth = Math.max(2, S * 0.02);
    ctx.lineJoin = 'round';
    ctx.stroke();

    // linha de chegada (primeiro ponto do polyline)
    const [sx, sz] = mm.polyline[0];
    const [nx, nz] = mm.polyline[1] || [sx + 1, sz];
    const ang = Math.atan2(tz(nz) - tz(sz), tx(nx) - tx(sx));
    ctx.save();
    ctx.translate(tx(sx), tz(sz));
    ctx.rotate(ang);
    ctx.fillStyle = '#eef1f6';
    const ks = Math.max(3, S * 0.03);
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(-ks / 2 + (i % 2) * (ks / 2), (i < 2 ? -ks : 0) + (i % 2) * 0, ks / 2, ks);
    }
    ctx.restore();

    // adversários
    for (const o of mm.others || []) {
      ctx.beginPath();
      ctx.arc(tx(o.x), tz(o.z), Math.max(3, S * 0.025), 0, Math.PI * 2);
      ctx.fillStyle = o.color || '#9aa3b5';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(11,13,18,0.85)';
      ctx.stroke();
    }

    // seu carro: anel + seta na direção
    if (mm.you) {
      const yx = tx(mm.you.x);
      const yz = tz(mm.you.z);
      const r = Math.max(5, S * 0.038);
      ctx.beginPath();
      ctx.arc(yx, yz, r, 0, Math.PI * 2);
      ctx.strokeStyle = p.youColor || '#ffc24b';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.translate(yx, yz);
      ctx.rotate(-(mm.you.heading || 0)); // mundo XZ visto de cima: +z para baixo no canvas
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.lineTo(r * 0.62, r * 0.7);
      ctx.lineTo(0, r * 0.35);
      ctx.lineTo(-r * 0.62, r * 0.7);
      ctx.closePath();
      ctx.fillStyle = p.youColor || '#ffc24b';
      ctx.fill();
      ctx.restore();
    }
  }

  function renderBoard(p) {
    clear(boardRows);
    const rows = p.standings || [];
    const totalEl = board.querySelector('#hud-board-total');
    if (totalEl) totalEl.textContent = `${p.total ?? rows.length} pilotos`;
    for (const r of rows) {
      const isYou = (selfId != null && r.id === selfId) || (r.color != null && r.color === p.youColor);
      const status = r.fin
        ? h('span', { class: 'st st-fin', text: 'FIN' })
        : r.dnf
          ? h('span', { class: 'st st-dnf', text: 'DNF' })
          : h('span', {});
      boardRows.append(h('div', { class: `hud-row${isYou ? ' is-you' : ''}` },
        h('span', { class: 'p', text: r.place != null ? String(r.place) : '—' }),
        h('span', { class: 'dot', style: { background: r.color || '#666' }, title: '' }),
        h('span', { class: 'n', text: r.dname || '' }),
        h('span', { class: 'lap', text: r.lap != null ? `V${r.lap}` : '' }),
        status,
      ));
    }
  }

  const api = {
    root,
    visible(v) {
      root.hidden = !v;
      if (v && lastPayload) drawMinimap(lastPayload);
    },
    update(payload) {
      if (!payload) return;
      lastPayload = payload;
      if (payload.speedKmh != null) speedEl.textContent = String(Math.round(payload.speedKmh));
      if (payload.place != null && payload.total != null) {
        placeEl.textContent = `${payload.place}/${payload.total}`;
      }
      if (payload.lap != null && payload.laps != null) {
        lapEl.textContent = `${payload.lap}/${payload.laps}`;
      }
      timeMain.textContent = fmtTime(payload.raceTimeMs);
      lapTimeEl.textContent = fmtTime(payload.lapTimeMs);
      bestTimeEl.textContent = payload.bestLapMs != null ? fmtTime(payload.bestLapMs) : '—';
      const nit = clamp(payload.nitro ?? 0, 0, 1);
      nitroFill.style.transform = `scaleX(${nit})`;
      nitroPct.textContent = `${Math.round(nit * 100)}%`;
      nitroBox.classList.toggle('active', !!payload.nitroActive);
      renderBoard(payload);
      if (!root.hidden) drawMinimap(payload);
    },
    notice(text, kind = 'info', ms = 2600) {
      const n = h('div', { class: `hud-notice ${kind}`, text: String(text ?? '') });
      notices.append(n);
      while (notices.children.length > 3) notices.firstChild.remove();
      if (ms > 0) {
        setTimeout(() => {
          n.classList.add('leaving');
          setTimeout(() => n.remove(), 220);
        }, ms);
      }
    },
    countdown(n) {
      if (n == null) {
        countdownEl.classList.remove('show', 'go');
        countdownEl.textContent = '';
        return;
      }
      countdownEl.classList.toggle('go', n === 0);
      countdownEl.textContent = n === 0 ? 'LARGADA!' : String(n);
      countdownEl.classList.remove('show');
      // reflow para reiniciar a animação
      void countdownEl.offsetWidth;
      countdownEl.classList.add('show');
      if (n === 0) {
        setTimeout(() => {
          if (countdownEl.textContent === 'LARGADA!') {
            countdownEl.classList.remove('show', 'go');
          }
        }, 900);
      }
    },
    setInvalidLap(on) {
      invalidEl.classList.toggle('show', !!on);
    },
    setSelf(id) {
      selfId = id ?? null;
      if (lastPayload) renderBoard(lastPayload);
    },
    dispose() {
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      lastPayload = null;
    },
  };

  resizeHandler = () => { if (lastPayload && !root.hidden) drawMinimap(lastPayload); };
  window.addEventListener('resize', resizeHandler);

  return api;
}
