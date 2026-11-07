// HUD: mira real, vida+escudo, arma+míssil+lock, boost (servidor), bônus 15s,
// kills/deaths, relógio do servidor, placar (FFA e times), onda/restam/vivos,
// avisos, radar + indicadores fora-de-tela (posição atual, sem lead).
// Sem assistência de mira / sem lead indicator.
import { SHIELD_MAX, BOOST_MAX, MISSILE_COOLDOWN_S } from '../shared/constants.js';

const EFFECT_NAMES = {
  cadence: 'Cadência', triple: 'Tiro triplo', overload: 'Sobrecarga',
  propulsion: 'Propulsão', repair: 'Reparo', shield: 'Escudo',
};

export function createHud(audio) {
  const $ = (id) => document.getElementById(id);
  const el = {
    hpNum: $('hp-num'), hpFill: $('hp-fill'), shFill: $('sh-fill'), shRow: $('shield-row'),
    timer: $('match-timer'), mode: $('match-mode'), wave: $('wave-info'),
    meKda: $('me-kda'), bonus: $('bonus-box'), bonusT: $('bonus-t'),
    roster: $('roster'), teams: $('team-score'),
    laserState: $('w-laser'), weaponName: $('w-name'), missileState: $('w-missile'),
    missileCd: $('missile-cd'), lock: $('lock-ind'), boostFill: $('boost-fill'),
    warns: $('warns'), radar: $('radar'), offscreen: $('offscreen'),
    score: $('scoreboard'), scoreRows: $('score-rows'),
    conn: $('conn'), ping: $('ping'),
    hitmark: $('hitmarker'), dmg: $('dmg-vignette'),
    fps: $('fps'),
  };
  const rctx = el.radar.getContext('2d');
  // mortes vêm do servidor (scores[].deaths, incrementado no damage()) — sem contagem local
  const bonusTimers = new Map(); // type -> until (ms), renovável 15s
  let lastHp = 100;
  let lastShield = 0;
  let frames = 0, fpsT = performance.now();

  function toast(msg, cls = '') {
    const d = document.createElement('div');
    d.className = 'warn ' + cls;
    d.textContent = msg;
    el.warns.appendChild(d);
    while (el.warns.children.length > 3) el.warns.firstChild.remove();
    setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 400); }, 2400);
  }

  function hitmarker() {
    el.hitmark.classList.remove('show');
    void el.hitmark.offsetWidth;
    el.hitmark.classList.add('show');
  }

  function damageFlash() {
    el.dmg.classList.remove('show');
    void el.dmg.offsetWidth;
    el.dmg.classList.add('show');
  }

  // scores: {players+teams} (teams) ou plano {id:{...}} (ffa/survival)
  function playersOf(scores) {
    if (!scores) return {};
    return scores.players || scores;
  }

  function drawRadar(items) {
    const W = el.radar.width, H = el.radar.height;
    const cx = W / 2, cy = H / 2;
    rctx.clearRect(0, 0, W, H);
    rctx.strokeStyle = 'rgba(120,180,255,.25)';
    rctx.beginPath(); rctx.arc(cx, cy, W * 0.48, 0, 7); rctx.stroke();
    rctx.beginPath(); rctx.arc(cx, cy, W * 0.24, 0, 7); rctx.stroke();
    // centro = você (sem ponto, como no original) + linha branca de direção
    // de voo: p/ frente neste radar é +y (contatos à frente aparecem abaixo).
    rctx.strokeStyle = 'rgba(240,248,255,.9)';
    rctx.lineWidth = 1;
    rctx.beginPath(); rctx.moveTo(cx - 4, cy); rctx.lineTo(cx + 4, cy); rctx.stroke();
    rctx.beginPath(); rctx.moveTo(cx, cy); rctx.lineTo(cx, cy + 14); rctx.stroke();
    const R = W * 0.46, RANGE = 220;
    for (const it of items.slice(0, 40)) {
      let px = (it.x / RANGE) * R;
      let pz = (it.z / RANGE) * R;
      const d = Math.hypot(px, pz);
      if (d > R) { px *= R / d; pz *= R / d; }
      const sx = cx + px, sy = cy + pz;
      if (it.kind === 'foe') rctx.fillStyle = '#ff5d73';
      else if (it.kind === 'ally') rctx.fillStyle = '#51ff7a';
      else if (it.kind === 'missile') rctx.fillStyle = '#ffcc33';
      else if (it.kind === 'incoming') rctx.fillStyle = '#ff2200';
      else if (it.kind === 'pickup') rctx.fillStyle = '#b47aff';
      else rctx.fillStyle = 'rgba(255,120,90,.8)';
      const sz = it.kind === 'shot' ? 1.6 : it.kind === 'incoming' ? 4 : 3;
      rctx.beginPath(); rctx.arc(sx, sy, sz, 0, 7); rctx.fill();
      if (it.up !== 0 && it.kind !== 'shot') {
        // haste vertical do original (base = x,y na grade, altura = eixo):
        // aqui o radar só recebe ternário (acima/abaixo de ±8m), então haste
        // de comprimento fixo — shortcut: passar dy contínuo p/ haste ∝ altura.
        const tip = sy + (it.up > 0 ? -10 : 10);
        rctx.strokeStyle = 'rgba(200,230,255,.9)';
        rctx.lineWidth = 1;
        rctx.beginPath(); rctx.moveTo(sx, sy); rctx.lineTo(sx, tip); rctx.stroke();
        rctx.fillStyle = 'rgba(200,230,255,.9)';
        rctx.font = '9px system-ui';
        rctx.fillText(it.up > 0 ? '▲' : '▼', sx - 4, tip + (it.up > 0 ? -2 : 10));
      }
    }
  }

  function drawOffscreen(items) {
    el.offscreen.innerHTML = '';
    for (const it of items.slice(0, 6)) {
      const d = document.createElement('div');
      d.className = `os-arrow ${it.cls}${it.above ? ' above' : it.below ? ' below' : ''}`;
      d.style.left = `${it.x}px`;
      d.style.top = `${it.y}px`;
      d.textContent = it.above ? '▲' : it.below ? '▼' : '◆';
      el.offscreen.appendChild(d);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    toast, hitmarker, damageFlash,
    onKill(a, b, names) {
      if (a && names) toast(`☠ ${names[a] || '?'} ▸ ${names[b] || '?'}`, 'kill');
    },
    onDeath() { damageFlash(); },
    onPickup(kind, mine, name) {
      if (mine && kind && EFFECT_NAMES[kind] && kind !== 'repair' && kind !== 'shield') {
        bonusTimers.set(kind, performance.now() + 15000);
      }
      if (mine) audio.pickup();
      else if (name) toast(`✦ ${name} pegou ${EFFECT_NAMES[kind] || kind}`, '');
    },
    onBonusEnd(kind) {
      bonusTimers.delete(kind);
      audio.powerDown();
      toast(`${EFFECT_NAMES[kind] || 'Bônus'} encerrado`, '');
    },
    resetMatch() {
      bonusTimers.clear();
      lastHp = 100;
    },
    update(snap, myId, extra = {}) {
      const me = (snap.ships || []).find((s) => s.id === myId);
      const hp = me ? Math.max(0, me.hp ?? 100) : 0;
      if (me && (hp < lastHp || (me.shield ?? 0) < lastShield)) damageFlash();
      lastHp = hp; lastShield = me?.shield ?? 0;
      el.hpNum.textContent = me ? (me.alive === false ? (me.waiting ? 'AGUARDE' : 'DESTRUÍDO') : hp) : '--';
      el.hpFill.style.width = `${hp}%`;
      el.hpFill.style.background = hp > 50 ? 'linear-gradient(90deg,#2be36b,#7dffb0)' : hp > 25 ? 'linear-gradient(90deg,#e6a92b,#ffdd7d)' : 'linear-gradient(90deg,#e63a3a,#ff8d8d)';
      const sh = me?.shield ?? 0;
      el.shRow.style.display = sh > 0 ? 'flex' : 'none';
      el.shFill.style.width = `${Math.max(0, Math.min(100, (sh / SHIELD_MAX) * 100))}%`;

      // relógio (servidor é autoridade; survival não tem timer)
      if (snap.mode === 'survival') {
        el.timer.textContent = '∞';
        el.timer.classList.remove('urgent');
      } else {
        const total = Math.max(0, snap.endsInS ?? 0);
        el.timer.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
        el.timer.classList.toggle('urgent', total <= 30 && !snap.over);
      }
      const modeName = { ffa: 'LIVRE P/ TODOS', teams: 'EQUIPES RED × BLUE', survival: 'SOBREVIVÊNCIA CO-OP' }[snap.mode] || 'ARENA';
      el.mode.textContent = modeName;

      // onda / restam / vivos
      let waveTxt = '';
      if (snap.mode === 'survival') {
        const bots = (snap.ships || []).filter((s) => s.bot && s.alive).length;
        const alive = (snap.ships || []).filter((s) => !s.bot && s.alive !== false).length;
        waveTxt = `ONDA ${snap.wave || 0} · bots ${bots} · vivos ${alive}`;
      } else {
        const alive = (snap.ships || []).filter((s) => s.alive !== false && !s.waiting).length;
        waveTxt = `${alive} vivo${alive === 1 ? '' : 's'} na arena`;
      }
      el.wave.textContent = waveTxt;

      // placar pessoal + bônus ativos (15s renovável)
      const sc = playersOf(snap.scores);
      const mySc = myId && sc[myId];
      el.meKda.textContent = `ABATES ${mySc ? mySc.kills : 0} · MORTES ${mySc ? (mySc.deaths || 0) : 0}`;
      for (const [kind, until] of [...bonusTimers]) {
        if (performance.now() > until) this.onBonusEnd(kind);
      }
      const activeFx = [...bonusTimers.entries()].map(([k, u]) => [k, Math.ceil((u - performance.now()) / 1000)]);
      const snapFx = (me?.effects || []).filter((k) => !bonusTimers.has(k) && EFFECT_NAMES[k] && k !== 'repair' && k !== 'shield');
      if (activeFx.length || snapFx.length) {
        el.bonus.style.display = 'flex';
        el.bonusT.textContent = [...activeFx.map(([k, s]) => `${EFFECT_NAMES[k]} ${s}s`), ...snapFx.map((k) => EFFECT_NAMES[k])].join(' · ');
      } else {
        el.bonus.style.display = 'none';
      }
      if (me?.warn && !extra._warned) {
        extra._warned = true;
        toast('⚠ MÍSSIL COM LOCK EM VOCÊ!', 'bad');
        audio.lockAlert();
        setTimeout(() => { extra._warned = false; }, 3000);
      }

      // classificação (mortes = autoridade do servidor via scores)
      const rows = Object.entries(sc)
        .map(([id, e]) => ({ id, name: e.name || '?', kills: e.kills || 0, deaths: e.deaths || 0, team: e.team }))
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const teamTag = (r) => (snap.mode === 'teams' && r.team ? `<i class="${r.team}">${r.team === 'red' ? 'R' : 'B'}</i> ` : '');
      el.roster.innerHTML = rows.slice(0, 6).map((r, i) =>
        `<div class="rrow${r.id === myId ? ' me' : ''}"><span>${i + 1}. ${teamTag(r)}${escapeHtml(r.name)}${r.id === snap.hostId ? ' ♛' : ''}</span><span>${r.kills}◇${r.deaths}</span></div>`
      ).join('') || '<div class="rrow">—</div>';

      // placar de times (soma dos kills, igual ao servidor)
      if (snap.mode === 'teams' && snap.scores?.teams) {
        const t = snap.scores.teams;
        el.teams.style.display = 'flex';
        el.teams.innerHTML = `<span class="t-red">■ RED ${t.red}</span><span class="t-blue">■ BLUE ${t.blue}</span>`;
      } else {
        el.teams.style.display = 'none';
      }

      // arma atual + míssil + lock + boost (tudo autoridade do servidor)
      const weapon = me?.weapon ?? 1;
      el.weaponName.textContent = weapon === 2 ? 'MÍSSIL' : 'LASER';
      el.weaponName.classList.toggle('missel', weapon === 2);
      const mslCd = extra.missileCd ?? 0;
      el.missileState.textContent = mslCd > 0 ? 'RECARREGANDO' : 'PRONTO [E]';
      el.missileState.classList.toggle('ready', mslCd <= 0);
      el.missileCd.style.width = `${mslCd > 0 ? (1 - mslCd / MISSILE_COOLDOWN_S) * 100 : 100}%`;
      const lock = extra.lock || 'none';
      el.lock.textContent = lock === 'on' ? '◉ LOCK' : '○ sem alvo';
      el.lock.classList.toggle('on', lock === 'on');
      const boost = me ? (me.boost ?? BOOST_MAX) / BOOST_MAX : 1;
      el.boostFill.style.width = `${Math.round(boost * 100)}%`;
      el.boostFill.classList.toggle('low', boost < 0.25);

      // radar + indicadores fora-de-tela
      drawRadar(extra.radar || []);
      drawOffscreen(extra.offscreen || []);

      // conexão
      const age = extra.snapAgeMs ?? 0;
      if (!extra.connected) {
        el.conn.style.display = 'flex';
        el.conn.innerHTML = `<span>⏳ conectando…</span>`;
      } else if (age > 800) {
        el.conn.style.display = 'flex';
        el.conn.innerHTML = `<span>⚠ CONEXÃO INSTÁVEL${extra.ping != null ? ` · ${extra.ping}ms` : ''}</span>`;
      } else {
        el.conn.style.display = 'none';
      }
      if (extra.ping != null) { el.ping.textContent = `${extra.ping}ms · ${snap.mode || ''}`; el.ping.style.display = 'block'; }
      else el.ping.style.display = 'none';

      frames++;
      const ft = performance.now();
      if (ft - fpsT > 1000) {
        el.fps.textContent = `${frames}fps`;
        frames = 0; fpsT = ft;
      }
    },
    setScoreVisible(v, snap, myId) {
      el.score.style.display = v ? 'flex' : 'none';
      if (!v || !snap) return;
      const sc = playersOf(snap.scores);
      const rows = Object.entries(sc)
        .map(([id, e]) => ({ id, name: e.name || '?', kills: e.kills || 0, deaths: e.deaths || 0, team: e.team }))
        .sort((a, b) => b.kills - a.kills);
      el.scoreRows.innerHTML = rows.map((r, i) =>
        `<div class="srow${r.id === myId ? ' me' : ''}"><span>${i + 1}. ${r.team ? `[${r.team.toUpperCase()}] ` : ''}${escapeHtml(r.name)}${r.id === snap.hostId ? ' ♛' : ''}</span><span>${r.kills} abates · ${r.deaths} mortes</span></div>`
      ).join('') || '—';
    },
  };
}
