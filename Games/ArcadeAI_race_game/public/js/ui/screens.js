// Asfalto Vivo — telas do jogo (home, join, lobby, loading, wait, results,
// settings, help, tt_select, pause). Cada tela apenas desenha e emite ações
// via ctx.emit; a integração (main.js) é quem muda o estado real.

import { h, clear, fmtTime, clamp } from './dom.js';
import { loadSettings, saveSettings, loadRecords } from '../store.js';
import {
  COLORS, MAX_PLAYERS, LAPS_MIN, LAPS_MAX, LAPS_DEFAULT, ROOM_CODE_CHARS,
} from '/shared/constants.js';

// Nomes das pistas fixos na UI (shared/tracks.js é de outra lane; ids canônicos).
export const TRACK_OPTIONS = [
  { id: 'costeiro', name: 'Circuito Costeiro', tag: 'Diurna · litoral · curvas abertas' },
  { id: 'industrial', name: 'Distrito Industrial', tag: 'Técnica · chicanes · trechos estreitos' },
];

const SCREENS = ['home', 'join', 'lobby', 'loading', 'wait', 'race', 'pause', 'results', 'settings', 'help', 'tt_select'];

export function createUI(ctx) {
  const mount = ctx.mount;
  const els = {};            // screen name -> element
  let current = null;
  let lastMode = 'multi';    // 'multi' | 'tt' — adapta o menu de pausa
  let pendingRoomCode = ctx.urlRoom || '';  // convite via ?room=
  let state = null;          // último updateRoom(state)
  let selfId = null;         // id deste piloto na sala (via show('lobby'|'wait', {you}))
  let roomCode = '';         // código da sala atual
  let pauseOpen = false;
  let helpFrom = null;       // 'pause' quando o help foi aberto do menu de pausa

  const connPill = h('div', { class: 'conn pill pill-warn', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'glyph glyph-tri' }),
    h('span', { class: 'conn-msg', text: '' }),
  );
  const toastWrap = h('div', { class: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
  const pauseLayer = h('div', { hidden: true });

  function screenEl(name) {
    if (!els[name]) {
      els[name] = h('section', {
        class: name === 'race' ? 'screen race-screen' : 'screen',
        'data-screen': name, hidden: true, tabindex: '-1',
      });
      mount.append(els[name]);
    }
    return els[name];
  }

  // ---------- helpers de estado ----------
  function me() {
    return state?.players?.find((p) => p.id === selfId) || null;
  }
  function isHost() {
    return !!(selfId != null && state && state.hostId === selfId);
  }
  function connectedCount() {
    return (state?.players || []).filter((p) => p.conn !== 'away').length;
  }
  function takenColors() {
    const set = new Set();
    for (const p of state?.players || []) {
      if (p.id !== selfId && p.conn !== 'away' && p.color) set.add(p.color);
    }
    return set;
  }

  function render(name, data) {
    const el = screenEl(name);
    clear(el);
    el.hidden = false;
    // foco na tela antes do renderer (que pode mover o foco para um input)
    if (name !== 'race') el.focus({ preventScroll: true });
    const R = renderers[name];
    if (R) R(el, data || {});
    return el;
  }

  function showScreen(name, data) {
    for (const n of Object.keys(els)) els[n].hidden = n !== name;
    current = name;
    render(name, data);
    if (name !== 'pause') closePause(true);
    ctx.hud.visible(name === 'race');
  }

  // ---------- componentes ----------
  function brandBlock() {
    return h('div', { class: 'brand' },
      h('div', { class: 'brand-row' },
        h('h1', { class: 'brand-title' }, 'ASFALTO ', h('span', { class: 'hot', text: 'VIVO' })),
      ),
      h('div', { class: 'brand-strip', 'aria-hidden': 'true' }),
      h('p', { class: 'brand-tag', text: 'Corrida arcade multiplayer' }),
    );
  }

  function swatchList(selectedHex, onPick, { disableTaken = false } = {}) {
    const taken = disableTaken ? takenColors() : new Set();
    const list = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Cor do carro' });
    for (const c of COLORS) {
      const used = taken.has(c.hex);
      const b = h('button', {
        type: 'button',
        class: 'swatch',
        role: 'radio',
        'aria-checked': c.hex === selectedHex ? 'true' : 'false',
        'aria-label': `Cor ${c.name}${used ? ' (em uso)' : ''}`,
        title: used ? `${c.name} — em uso` : c.name,
        style: { background: c.hex },
        disabled: used || undefined,
        onClick: () => onPick(c.hex),
      });
      list.append(b);
    }
    return list;
  }

  function colorPickerBlock(currentHex, onPick, note) {
    return h('div', { class: 'field' },
      h('span', { class: 'field-label', id: 'lbl-cor', text: 'Cor do carro' }),
      swatchList(currentHex, onPick),
      h('p', { class: 'pallete-note', text: note || 'Cada cor é exclusiva por sala — no lobby ela pode ficar indisponível.' }),
    );
  }

  function nicknameField(settings, onInput) {
    const input = h('input', {
      class: 'input',
      type: 'text',
      maxlength: '16',
      placeholder: 'Ex.: Turbineiro',
      autocomplete: 'off',
      spellcheck: 'false',
      value: settings.nickname || '',
      'aria-label': 'Apelido (até 16 caracteres)',
      onInput: (e) => onInput(e.target.value),
    });
    return h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'Apelido' }),
      input,
      h('span', { class: 'hint', text: 'Até 16 caracteres. Fica salvo neste navegador.' }),
    );
  }

  // ---------- renderers ----------
  const renderers = {
    home(el, data) {
      const settings = loadSettings();
      if (data.roomCode) pendingRoomCode = String(data.roomCode).toUpperCase();
      let color = settings.color;

      const refreshSwatches = () => {
        const host = el.querySelector('.swatches')?.parentElement;
        if (!host) return;
        const fresh = colorPickerBlock(color, (hex) => {
          color = hex;
          saveSettings({ color: hex });
          refreshSwatches();
        });
        host.replaceWith(fresh);
      };

      const name = () => (el.querySelector('input[type=text]')?.value || '').trim();

      const menu = h('div', { class: 'home-menu' },
        pendingRoomCode
          ? h('div', { class: 'invite-banner' },
            h('span', { class: 'glyph glyph-tri', 'aria-hidden': 'true' }),
            h('p', { class: 'invite-text' },
              'Você foi convidado para a sala ', h('strong', { text: pendingRoomCode }), '.'),
            h('button', {
              type: 'button', class: 'btn btn-primary btn-sm',
              onClick: () => ctx.emit({ type: 'join_url', name: name(), color }),
              text: 'Entrar na sala',
            }),
          )
          : null,
        h('button', {
          type: 'button', class: 'btn btn-primary btn-lg btn-block',
          onClick: () => ctx.emit({ type: 'create', name: name(), color }),
        }, 'Criar sala'),
        h('button', {
          type: 'button', class: 'btn btn-block',
          onClick: () => { saveSettings({ nickname: name() }); showScreen('join', { code: pendingRoomCode }); },
        }, 'Entrar em sala'),
        h('button', {
          type: 'button', class: 'btn btn-block',
          onClick: () => { lastMode = 'tt'; saveSettings({ nickname: name() }); showScreen('tt_select', { name: name(), color }); },
        }, 'Contra o relógio'),
        h('div', { class: 'btn-row', style: { marginTop: '4px' } },
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onClick: () => { saveSettings({ nickname: name() }); ctx.emit({ type: 'open_settings' }); showScreen('settings'); },
          }, 'Configurações'),
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onClick: () => { saveSettings({ nickname: name() }); ctx.emit({ type: 'open_help' }); showScreen('help'); },
          }, 'Como jogar'),
        ),
      );

      el.append(h('div', { class: 'home-layout' },
        h('div', { class: 'home-id' },
          brandBlock(),
          h('div', { style: { marginTop: '18px' } },
            nicknameField(settings, (v) => saveSettings({ nickname: v }))),
          colorPickerBlock(color, (hex) => {
            color = hex;
            saveSettings({ color: hex });
            refreshSwatches();
          }),
        ),
        menu,
      ));
    },

    join(el, data) {
      const codeInput = h('input', {
        class: 'input input-code',
        type: 'text',
        maxlength: '6',
        placeholder: '······',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': 'Código da sala, 6 caracteres',
        value: (data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
      });
      const errMsg = h('p', { class: 'error-msg', role: 'alert', text: data.error ? String(data.error) : '' });

      codeInput.addEventListener('input', () => {
        const clean = codeInput.value.toUpperCase().replace(new RegExp(`[^${ROOM_CODE_CHARS}]`, 'g'), '').slice(0, 6);
        if (clean !== codeInput.value) codeInput.value = clean;
      });
      const submit = () => {
        const code = codeInput.value.toUpperCase();
        if (code.length !== 6) {
          errMsg.textContent = 'O código tem 6 caracteres.';
          codeInput.focus();
          return;
        }
        ctx.emit({ type: 'join_submit', code });
      };
      codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

      el.append(h('div', { class: 'card' },
        h('h2', { class: 'screen-title', text: 'Entrar em sala' }),
        h('p', { class: 'screen-sub', text: 'Digite o código de 6 caracteres enviado pelo organizador.' }),
        h('div', { class: 'panel panel-accent code-form' },
          h('div', { class: 'field' },
            h('span', { class: 'field-label', text: 'Código da sala' }),
            codeInput,
          ),
          errMsg,
          h('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: submit, text: 'Entrar' }),
        ),
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-back',
            onClick: () => { ctx.emit({ type: 'join_back' }); showScreen('home'); },
            text: 'Voltar',
          }),
        ),
      ));
      codeInput.focus();
    },

    lobby(el, data) {
      if (data) {
        if (data.room || data.code) roomCode = String(data.room || data.code).toUpperCase();
        if (data.you != null) selfId = data.you;
      }
      ctx.hud.setSelf?.(selfId);
      lastMode = 'multi';
      const st = state || {};
      const players = st.players || [];
      const max = st.max || MAX_PLAYERS;
      const laps = clamp(st.laps ?? LAPS_DEFAULT, LAPS_MIN, LAPS_MAX);
      const trackId = st.track || TRACK_OPTIONS[0].id;
      const host = isHost();
      const myself = me();
      const ready = !!myself?.ready;
      const nConn = connectedCount();
      const allReady = nConn >= 2 && players.filter((p) => p.conn !== 'away').every((p) => p.ready);

      const statusText =
        st.status === 'countdown' ? 'Preparando largada'
          : st.status === 'race' ? 'Corrida em andamento'
            : st.status === 'results' ? 'Corrida encerrada'
              : allReady ? 'Preparando largada' : 'Aguardando jogadores';

      // --- coluna esquerda: código + participantes ---
      const codeEl = h('span', { class: 'room-code', text: roomCode || '------' });
      const copyBtn = h('button', {
        type: 'button', class: 'btn btn-sm',
        onClick: async () => {
          const link = `${location.origin}/?room=${roomCode}`;
          let ok = false;
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(link);
              ok = true;
            }
          } catch { ok = false; }
          if (!ok) {
            const ta = h('textarea', { style: { position: 'fixed', opacity: '0' }, value: link });
            document.body.append(ta);
            ta.select();
            try { ok = document.execCommand('copy'); } catch { ok = false; }
            ta.remove();
          }
          ctx.toast(ok ? 'Convite copiado!' : `Não foi possível copiar. Link: ${link}`, ok ? 'ok' : 'warn');
          ctx.emit({ type: 'lobby_copy' });
        },
      }, 'Copiar convite');

      const playerList = h('div', { class: 'players', role: 'list' });
      for (const p of players) {
        const isYou = p.id === selfId;
        const isAway = p.conn === 'away';
        playerList.append(h('div', {
          class: `player-list-row player-row${isYou ? ' is-you' : ''}${isAway ? ' is-away' : ''}`,
          role: 'listitem',
        },
          h('span', { class: 'dot dot-lg', style: { background: p.color || '#666' } }),
          h('span', { class: 'player-name', text: p.dname || '' }),
          p.id === st.hostId ? h('span', { class: 'player-host', text: '◆ organizador' }) : h('span'),
          isYou ? h('span', { class: 'tag tag-you', text: 'você' }) : h('span'),
          isAway
            ? h('span', { class: 'tag tag-away' },
              h('span', { class: 'glyph glyph-tri', 'aria-hidden': 'true' }),
              ' ausente')
            : p.ready
              ? h('span', { class: 'tag tag-ready' }, h('span', { class: 'glyph glyph-diamond' }), ' pronto')
              : h('span', { class: 'tag', text: 'aguardando' }),
        ));
      }
      for (let i = players.length; i < max; i++) {
        playerList.append(h('div', { class: 'player-row', style: { opacity: '0.4' } },
          h('span', { class: 'dot dot-lg', style: { background: 'transparent', border: '1px dashed var(--ink-faint)' } }),
          h('span', { class: 'player-name', style: { color: 'var(--ink-faint)', fontWeight: '400' }, text: 'vaga livre' }),
          h('span'), h('span'), h('span'),
        ));
      }

      const colorField = colorPickerBlock(myself?.color || loadSettings().color, (hex) => {
        ctx.emit({ type: 'lobby_color', color: hex });
        // otimista: swatches seguem a ordem de COLORS; o próximo updateRoom confirma
        const idx = COLORS.findIndex((c) => c.hex === hex);
        el.querySelectorAll('.swatch').forEach((sw, i) => {
          sw.setAttribute('aria-checked', i === idx ? 'true' : 'false');
        });
      }, 'Cada cor é exclusiva na sala. Cores em uso ficam bloqueadas.');

      // --- coluna direita: pista, voltas, ações ---
      const trackBox = h('div', { class: 'track-choice', role: 'radiogroup', 'aria-label': 'Pista' });
      for (const t of TRACK_OPTIONS) {
        trackBox.append(h('button', {
          type: 'button',
          class: 'track-opt',
          role: 'radio',
          'aria-checked': t.id === trackId ? 'true' : 'false',
          disabled: host ? undefined : true,
          'data-fkey': `track-${t.id}`,
          onClick: () => { if (host) ctx.emit({ type: 'lobby_track', trackId: t.id }); },
        },
          h('span', { class: 't-name', text: t.name }),
          h('span', { class: 't-tag', text: t.tag }),
        ));
      }

      const lapsValue = h('span', { class: 'step-value', text: String(laps) });
      const lapsBox = h('div', { class: 'stepper' },
        h('button', {
          type: 'button', class: 'step-btn', 'aria-label': 'Diminuir voltas',
          disabled: host && laps > LAPS_MIN ? undefined : true,
          'data-fkey': 'laps-minus',
          onClick: () => { if (host && laps > LAPS_MIN) ctx.emit({ type: 'lobby_laps', laps: laps - 1 }); },
          text: '−',
        }),
        lapsValue,
        h('button', {
          type: 'button', class: 'step-btn', 'aria-label': 'Aumentar voltas',
          disabled: host && laps < LAPS_MAX ? undefined : true,
          'data-fkey': 'laps-plus',
          onClick: () => { if (host && laps < LAPS_MAX) ctx.emit({ type: 'lobby_laps', laps: laps + 1 }); },
          text: '+',
        }),
        h('span', { class: 'hint', text: `voltas (${LAPS_MIN}–${LAPS_MAX})` }),
      );

      let startReason = '';
      if (nConn < 2) startReason = 'É preciso pelo menos 2 jogadores conectados.';
      else if (!allReady) startReason = 'Todos os pilotos precisam estar prontos.';

      const startBlock = h('div', { class: 'start-block' },
        h('button', {
          type: 'button',
          class: 'btn btn-primary btn-block',
          disabled: host && !startReason ? undefined : true,
          onClick: () => ctx.emit({ type: 'lobby_start' }),
          text: 'Iniciar corrida',
        }),
        h('p', {
          class: 'start-reason',
          text: host ? startReason : 'Aguardando o organizador iniciar a corrida.',
        }),
      );

      el.append(h('div', { class: 'lobby-layout' },
        h('div', { class: 'lobby-col' },
          h('div', { class: 'panel panel-accent' },
            h('div', { class: 'room-code-row' },
              h('div', {},
                h('p', { class: 'section-label', text: 'Código da sala' }),
                codeEl,
              ),
              copyBtn,
            ),
          ),
          h('div', { class: 'panel scroll-y', style: { maxHeight: '42vh' } },
            h('div', { class: 'lobby-status-row', style: { marginBottom: '10px' } },
              h('p', { class: 'section-label', style: { margin: 0 }, text: 'Pilotos' }),
              h('span', { class: 'seats', text: `${nConn}/${max} ocupadas` }),
            ),
            playerList,
          ),
          colorField,
        ),
        h('div', { class: 'lobby-col' },
          h('div', { class: 'panel' },
            h('p', { class: 'section-label', text: 'Pista' }),
            trackBox,
            host ? null : h('p', { class: 'host-note', text: 'Somente o organizador escolhe a pista e as voltas.' }),
            h('p', { class: 'section-label', style: { marginTop: '14px' }, text: 'Voltas' }),
            lapsBox,
          ),
          h('div', { class: 'panel' },
            h('p', { class: 'section-label', text: 'Status da sala' }),
            h('p', { style: { fontWeight: '700', marginBottom: '12px' }, text: statusText }),
            h('button', {
              type: 'button',
              class: `btn btn-block ${ready ? '' : 'btn-primary'}`,
              disabled: myself ? undefined : true,
              onClick: () => ctx.emit({ type: 'lobby_ready', ready: !ready }),
              text: ready ? 'Despronto' : 'Pronto',
            }),
            startBlock,
            h('button', {
              type: 'button', class: 'btn btn-danger btn-block',
              onClick: () => ctx.emit({ type: 'lobby_leave' }),
              text: 'Sair da sala',
            }),
          ),
        ),
      ));
    },

    loading(el, data) {
      el.append(h('div', { class: 'center-stack' },
        h('h2', { class: 'screen-title', text: data.title || 'Preparando a largada' }),
        h('p', { class: 'screen-sub', text: data.text || 'Carregando a pista e os carros…' }),
        h('div', { class: 'loadbar', role: 'progressbar', 'aria-label': 'Carregando' }),
        data.hubUrl ? h('a', {
          class: 'btn btn-block',
          href: String(data.hubUrl),
          target: '_top',
          rel: 'noreferrer',
          text: 'Voltar à sala do Hub',
        }) : null,
      ));
    },

    wait(el) {
      ctx.hud.setSelf?.(selfId);
      const st = state || {};
      const players = st.players || [];
      const board = h('div', { class: 'wait-board panel panel-accent' });
      board.append(h('p', { class: 'section-label', text: 'Pilotos na sala' }));
      for (const p of players) {
        board.append(h('div', { class: `player-row${p.conn === 'away' ? ' is-away' : ''}${p.id === selfId ? ' is-you' : ''}` },
          h('span', { class: 'dot dot-lg', style: { background: p.color || '#666' } }),
          h('span', { class: 'player-name', text: p.dname || '' }),
          p.id === st.hostId ? h('span', { class: 'player-host', text: '◆ organizador' }) : h('span'),
          p.id === selfId ? h('span', { class: 'tag tag-you', text: 'você' }) : h('span'),
          p.conn === 'away'
            ? h('span', { class: 'tag tag-away', text: 'ausente' })
            : h('span', { class: 'tag', text: st.status === 'race' ? 'correndo' : 'aguardando' }),
        ));
      }
      el.append(h('div', { class: 'center-stack' },
        h('h2', { class: 'screen-title', text: 'Aguardando a próxima corrida…' }),
        h('p', { class: 'screen-sub', text: 'A corrida atual está em andamento. Você entra na próxima.' }),
        board,
        h('button', {
          type: 'button', class: 'btn btn-danger',
          onClick: () => ctx.emit({ type: 'lobby_leave' }),
          text: 'Sair da sala',
        }),
      ));
    },

    tt_select(el, data) {
      lastMode = 'tt';
      const settings = loadSettings();
      const name = data.name ?? settings.nickname;
      const color = data.color ?? settings.color;
      const records = loadRecords();
      let picked = TRACK_OPTIONS[0].id;

      const cards = h('div', { class: 'tt-tracks', role: 'radiogroup', 'aria-label': 'Escolha da pista' });
      const refresh = () => {
        clear(cards);
        for (const t of TRACK_OPTIONS) {
          const rec = records[t.id];
          cards.append(h('button', {
            type: 'button',
            class: 'tt-track',
            role: 'radio',
            'aria-checked': t.id === picked ? 'true' : 'false',
            'data-fkey': `tt-${t.id}`,
            onClick: () => { picked = t.id; refresh(); },
          },
            h('span', { class: 't-name', text: t.name }),
            h('span', { class: 't-tag', text: t.tag }),
            h('span', { class: 'tt-best', text: rec ? `Recorde: ${fmtTime(rec.bestLapMs)}` : 'Recorde: —' }),
          ));
        }
      };
      refresh();

      el.append(h('div', { class: 'card card-wide' },
        h('h2', { class: 'screen-title', text: 'Contra o relógio' }),
        h('p', { class: 'screen-sub', text: 'Escolha a pista e bata o melhor tempo de volta. Sem adversários, só você e o cronômetro.' }),
        cards,
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn btn-primary btn-lg',
            onClick: () => ctx.emit({ type: 'tt_start', trackId: picked, name, color }),
            text: 'Começar',
          }),
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-back',
            onClick: () => { ctx.emit({ type: 'back_home' }); showScreen('home'); },
            text: 'Voltar',
          }),
        ),
      ));
    },

    results(el, data) {
      const rows = data.rows || [];
      const table = h('table', { class: 'results-table' },
        h('thead', {},
          h('tr', {},
            h('th', { text: 'Pos.' }),
            h('th', { text: 'Piloto' }),
            h('th', { style: { textAlign: 'right' }, text: 'Tempo total' }),
            h('th', { style: { textAlign: 'right' }, text: 'Melhor volta' }),
          ),
        ),
      );
      const tbody = h('tbody');
      for (const r of rows) {
        const dnf = !!r.dnf;
        tbody.append(h('tr', { class: r.id === selfId ? 'r-you' : '' },
          h('td', {}, h('span', {
            class: `place-medal${r.place === 1 ? ' place-1' : r.place === 2 ? ' place-2' : r.place === 3 ? ' place-3' : ''}`,
            text: r.place != null ? String(r.place) : '—',
          })),
          h('td', {}, h('div', { class: 'results-name-cell' },
            h('span', { class: 'dot', style: { background: r.color || '#666' } }),
            h('span', { class: 'r-name', title: r.dname || '', text: r.dname || '' }),
            r.id === selfId ? h('span', { class: 'tag tag-you', text: 'você' }) : null,
          )),
          h('td', { class: `num${dnf ? ' r-dnf' : ''}`, text: dnf ? 'Não concluiu' : fmtTime(r.timeMs) }),
          h('td', { class: `num${!r.bestMs ? ' r-dnf' : ''}`, text: r.bestMs != null ? fmtTime(r.bestMs) : '—' }),
        ));
      }
      table.append(tbody);

      el.append(h('div', { class: 'card card-wide' },
        h('h2', { class: 'screen-title', text: 'Resultado da corrida' }),
        data.reason ? h('p', { class: 'results-reason' },
          h('span', { class: 'glyph glyph-diamond', style: { color: 'var(--accent-2)' } }),
          String(data.reason)) : null,
        h('div', { class: 'panel panel-accent scroll-y', style: { maxHeight: '52vh' } }, table),
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn btn-primary',
            onClick: () => ctx.emit({ type: 'results_lobby' }),
            text: 'Voltar ao lobby',
          }),
          h('button', {
            type: 'button', class: 'btn btn-danger',
            onClick: () => ctx.emit({ type: 'results_leave' }),
            text: 'Sair da sala',
          }),
        ),
        data.hubUrl ? h('div', { class: 'btn-row' },
          h('a', {
            class: 'btn btn-block',
            href: String(data.hubUrl),
            target: '_top',
            rel: 'noreferrer',
            text: 'Voltar à sala do Hub',
          }),
        ) : null,
      ));
    },

    settings(el) {
      const s = loadSettings();

      const volFill = (input, v01) => input.style.setProperty('--fill', `${Math.round(v01 * 100)}%`);
      const volInput = h('input', {
        type: 'range', min: '0', max: '100', step: '1',
        value: String(Math.round(s.volume * 100)),
        'aria-label': 'Volume geral',
      });
      const volVal = h('span', { class: 'slider-value', text: `${Math.round(s.volume * 100)}%` });
      volFill(volInput, s.volume);
      volInput.addEventListener('input', () => {
        const v = Number(volInput.value) / 100;
        volVal.textContent = `${volInput.value}%`;
        volFill(volInput, v);
        commit({ volume: v });
      });

      const muteBtn = h('button', {
        type: 'button', class: 'btn btn-sm',
        'aria-pressed': s.muted ? 'true' : 'false',
      }, s.muted ? 'Ativar som' : 'Silenciar');
      muteBtn.addEventListener('click', () => {
        const muted = muteBtn.getAttribute('aria-pressed') !== 'true';
        muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
        muteBtn.textContent = muted ? 'Ativar som' : 'Silenciar';
        commit({ muted });
      });

      const QUALITIES = [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']];
      let quality = s.quality;
      const segBox = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Qualidade visual' });
      const renderSeg = () => {
        clear(segBox);
        for (const [id, label] of QUALITIES) {
          segBox.append(h('button', {
            type: 'button', class: 'seg', role: 'radio',
            'aria-checked': id === quality ? 'true' : 'false',
            'data-fkey': `q-${id}`,
            onClick: () => { quality = id; renderSeg(); commit({ quality: id }); },
            text: label,
          }));
        }
      };
      renderSeg();

      const fxInput = h('input', {
        type: 'range', min: '0', max: '100', step: '1',
        value: String(Math.round(s.fxIntensity * 100)),
        'aria-label': 'Intensidade de efeitos e tremor',
      });
      const fxVal = h('span', { class: 'slider-value', text: `${Math.round(s.fxIntensity * 100)}%` });
      volFill(fxInput, s.fxIntensity);
      fxInput.addEventListener('input', () => {
        const v = Number(fxInput.value) / 100;
        fxVal.textContent = `${fxInput.value}%`;
        volFill(fxInput, v);
        commit({ fxIntensity: v });
      });

      const steerInput = h('input', {
        type: 'range', min: '20', max: '200', step: '5',
        value: String(Math.round(s.steerSensitivity * 100)),
        'aria-label': 'Sensibilidade de direção',
      });
      const steerVal = h('span', { class: 'slider-value', text: `${Math.round(s.steerSensitivity * 100)}%` });
      volFill(steerInput, s.steerSensitivity);
      steerInput.addEventListener('input', () => {
        const v = Number(steerInput.value) / 100;
        steerVal.textContent = `${steerInput.value}%`;
        volFill(steerInput, v);
        commit({ steerSensitivity: v });
      });

      function commit(patch) {
        saveSettings(patch);          // persistência local
        ctx.emit({ type: 'settings_change', patch }); // aplica em runtime
      }

      el.append(h('div', { class: 'card' },
        h('h2', { class: 'screen-title', text: 'Configurações' }),
        h('div', { class: 'panel panel-accent settings-grid scroll-y', style: { maxHeight: '58vh' } },
          h('div', { class: 'setting-block' },
            h('div', { class: 'setting-head' },
              h('span', { class: 'setting-name', text: 'Volume' }),
              muteBtn,
            ),
            h('div', { class: 'slider-row' }, volInput, volVal),
          ),
          h('div', { class: 'setting-block' },
            h('span', { class: 'setting-name', text: 'Qualidade visual' }),
            segBox,
          ),
          h('div', { class: 'setting-block' },
            h('span', { class: 'setting-name', text: 'Efeitos e tremor de câmera' }),
            h('div', { class: 'slider-row' }, fxInput, fxVal),
          ),
          h('div', { class: 'setting-block' },
            h('span', { class: 'setting-name', text: 'Sensibilidade de direção' }),
            h('div', { class: 'slider-row' }, steerInput, steerVal),
          ),
        ),
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn btn-primary btn-back',
            onClick: () => { ctx.emit({ type: 'settings_back' }); showScreen('home'); },
            text: 'Voltar',
          }),
        ),
      ));
    },

    help(el) {
      const controls = [
        [['W', '↑'], 'Acelerar'],
        [['S', '↓'], 'Frear; com velocidade baixa, marcha à ré'],
        [['A', 'D', '←', '→'], 'Estereçar / virar'],
        [['Espaço'], 'Freio de mão — inicia e controla derrapagens'],
        [['Shift'], 'Nitro — aceleração extra enquanto houver carga'],
        [['R'], 'Recuperar o carro ao último ponto seguro da pista'],
        [['Esc'], 'Abrir ou fechar o menu durante a corrida'],
      ];
      const list = h('div', { class: 'controls-list' });
      for (const [keys, desc] of controls) {
        list.append(h('div', { class: 'control-row' },
          h('div', { class: 'keys' }, keys.map((k) => h('span', { class: 'kbd', text: k }))),
          h('span', { class: 'control-desc', text: desc }),
        ));
      }

      el.append(h('div', { class: 'card' },
        h('h2', { class: 'screen-title', text: 'Como jogar' }),
        h('div', { class: 'panel panel-accent scroll-y', style: { maxHeight: '60vh' } },
          h('p', { class: 'section-label', text: 'Controles' }),
          list,
          h('p', { class: 'section-label', style: { marginTop: '16px' }, text: 'Dicas de corrida' }),
          h('div', { class: 'tips' },
            h('p', { class: 'tip' }, h('strong', { text: 'Nitro: ' }), 'a barra enche sozinha quando você não usa. Solte o botão para recarregar; sem carga, o efeito para.'),
            h('p', { class: 'tip' }, h('strong', { text: 'Derrapagem: ' }), 'aperte o freio de mão na entrada da curva e contra-estereze para controlar o rabo. Solte tudo para recuperar a aderência.'),
            h('p', { class: 'tip' }, h('strong', { text: 'Fora da pista: ' }), 'grama, areia e acostamento deixam o carro mais lento. Volte ao asfalto assim que puder.'),
            h('p', { class: 'tip' }, h('strong', { text: 'Recuperação (R): ' }), 'recoloca o carro no último ponto válido, apontado para frente. Não pula checkpoints nem conta volta.'),
          ),
        ),
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn btn-primary btn-back',
            onClick: () => {
              ctx.emit({ type: 'help_back' });
              if (helpFrom === 'pause') {
                helpFrom = null;
                showScreen('race');
                openPause();
              } else {
                showScreen('home');
              }
            },
            text: 'Voltar',
          }),
        ),
      ));
    },
  };

  // ---------- pausa (overlay sobre a corrida) ----------
  function openPause() {
    if (pauseOpen) return;
    pauseOpen = true;
    clear(pauseLayer);
    pauseLayer.hidden = false;
    const isTT = lastMode === 'tt';
    const box = h('div', { class: 'pause-menu panel panel-accent', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu de pausa' },
      h('h2', { class: 'screen-title', text: 'Pausa' }),
      isTT ? h('button', {
        type: 'button', class: 'btn btn-primary btn-block',
        onClick: () => { closePause(); ctx.emit({ type: 'tt_restart' }); },
        text: 'Reiniciar tentativa',
      }) : h('button', {
        type: 'button', class: 'btn btn-primary btn-block',
        onClick: () => { closePause(); ctx.emit({ type: 'pause_resume' }); },
        text: 'Continuar',
      }),
      isTT ? h('button', {
        type: 'button', class: 'btn btn-block',
        onClick: () => { closePause(); ctx.emit({ type: 'tt_change_track' }); },
        text: 'Trocar de pista',
      }) : h('button', {
        type: 'button', class: 'btn btn-block',
        onClick: () => {
          closePause();
          helpFrom = 'pause';
          ctx.emit({ type: 'pause_help' });
          showScreen('help');
        },
        text: 'Como jogar',
      }),
      h('button', {
        type: 'button', class: 'btn btn-danger btn-block',
        onClick: () => {
          closePause();
          if (isTT) ctx.emit({ type: 'tt_quit' });
          else ctx.emit({ type: 'pause_quit' });
        },
        text: isTT ? 'Sair do modo relógio' : 'Sair da corrida',
      }),
    );
    pauseLayer.append(h('div', { class: 'pause-overlay' }, box));
    box.querySelector('button')?.focus();
  }

  function closePause(silent) {
    if (!pauseOpen && silent) { pauseLayer.hidden = true; return; }
    pauseOpen = false;
    pauseLayer.hidden = true;
    clear(pauseLayer);
  }

  // ---------- API interna ----------
  return {
    show(name, data) {
      if (!SCREENS.includes(name)) return;
      if (name === 'pause') { openPause(); return; }
      showScreen(name, data);
    },
    updateRoom(newState) {
      state = newState || null;
      if (current === 'lobby' || current === 'wait') {
        // re-render reativo, preservando foco de quem estiver no teclado
        const fkey = document.activeElement?.dataset?.fkey;
        render(current, {});
        if (fkey) {
          const target = els[current]?.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`);
          if (target) target.focus({ preventScroll: true });
        }
      }
    },
    setConn(status, msg) {
      const map = {
        connecting: ['Conectando…', 'pill-warn'],
        online: [null, ''],
        reconnecting: [msg || 'Conexão perdida — tentando reconectar…', 'pill-warn'],
        offline: [msg || 'Sem conexão. Recarregue a página ou tente novamente.', 'pill-err'],
      };
      const [text, cls] = map[status] || [msg || status, 'pill-warn'];
      if (!text) { connPill.classList.remove('show'); return; }
      connPill.className = `conn pill ${cls} show`;
      connPill.querySelector('.conn-msg').textContent = text;
    },
    toast(msg, kind = 'ok') {
      const t = h('div', { class: `toast toast-${kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'warn'}`, text: String(msg ?? '') });
      toastWrap.append(t);
      setTimeout(() => {
        t.classList.add('leaving');
        setTimeout(() => t.remove(), 220);
      }, kind === 'err' ? 4200 : 2800);
    },
    openPause,
    closePause,
    isPauseOpen: () => pauseOpen,
    setSelf(id) { if (id != null) selfId = id; },
    setRoomCode(code) { if (code) roomCode = String(code).toUpperCase(); },
    getSelfId: () => selfId,
    mount,
    connPill,
    toastWrap,
    pauseLayer,
    screenEl,
  };
}
