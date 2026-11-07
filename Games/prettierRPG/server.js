'use strict';

// Servidor autoritativo PrettierRPG v1: http estático + WebSocket + Hub.
// Autoridade: movimento, vida, dano, recargas, placar (§2). Dono lane núcleo.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const sim = require('./lib/sim');
const hub = require('./lib/hub');
const { validateBuild, DEFAULT_BUILD, ITEMS } = require('./lib/build');

// Converte build do cliente (ids curtos ou canônicos; nomes de campo PT-BR ou
// canônicos) p/ esquema canônico do build.js antes de validar.
const WEAPON_MAP = { battleaxe: 'battleaxe', dagger: 'dagger', fire: 'fire-staff', frost: 'frost-staff', holy: 'holy-staff', 'fire-staff': 'fire-staff', 'frost-staff': 'frost-staff', 'holy-staff': 'holy-staff' };
const CAPE_MAP = { bridgewatch: 'cape-bridgewatch', 'fort-sterling': 'cape-fort-sterling', lymhurst: 'cape-lymhurst', martlock: 'cape-martlock', thetford: 'cape-thetford', caerleon: 'cape-caerleon', 'cape-bridgewatch': 'cape-bridgewatch', 'cape-fort-sterling': 'cape-fort-sterling', 'cape-lymhurst': 'cape-lymhurst', 'cape-martlock': 'cape-martlock', 'cape-thetford': 'cape-thetford', 'cape-caerleon': 'cape-caerleon' };
function toCanonicalBuild(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pick = (...ks) => { for (const k of ks) if (r[k] !== undefined) return r[k]; return undefined; };
  const out = { ...DEFAULT_BUILD };
  const set = (k, v) => { if (v !== undefined) out[k] = v; };
  const w = pick('weapon');
  if (w !== undefined) out.weapon = WEAPON_MAP[w] || w;
  set('q', pick('q')); set('w', pick('w')); set('e', pick('e'));
  set('weaponPassive', pick('weaponPassive', 'passivaArma', 'wPass'));
  set('offhand', pick('offhand'));
  set('head', pick('head'));
  set('headActive', pick('headActive', 'headSkill', 'hSkill'));
  set('headPassive', pick('headPassive', 'passivaHead', 'hPass'));
  set('chest', pick('chest'));
  set('chestActive', pick('chestActive', 'chestSkill', 'cSkill'));
  set('chestPassive', pick('chestPassive', 'passivaChest', 'cPass1'));
  set('chestPassive2', pick('chestPassive2', 'passivaChest2', 'cPass2'));
  set('boots', pick('boots'));
  set('bootsActive', pick('bootsActive', 'bootsSkill', 'bSkill'));
  set('bootsPassive', pick('bootsPassive', 'passivaBoots', 'bPass'));
  const cape = pick('cape');
  if (cape !== undefined) out.cape = CAPE_MAP[cape] || cape;
  // Tolerância a build parcial: chave NÃO enviada herda padrão só se válida
  // para o item escolhido; se obsoleta (ex.: passiva do machado com cajado),
  // cai na primeira opção do item. Valor EXPLÍCITO inválido continua rejeitado.
  const has = (k) => r[k] !== undefined;
  const wItem = ITEMS[out.weapon];
  if (wItem && wItem.skills) {
    if (!has('q') && !wItem.skills.q.includes(out.q)) out.q = wItem.skills.q[0];
    if (!has('w') && !wItem.skills.w.includes(out.w)) out.w = wItem.skills.w[0];
    if (!has('e') && !wItem.skills.e.includes(out.e)) out.e = wItem.skills.e[0];
    if (!has('weaponPassive') && !has('passivaArma') && !has('wPass') && !wItem.skills.passive.includes(out.weaponPassive)) out.weaponPassive = wItem.skills.passive[0];
  }
  for (const [slot, actK, pasK, actAliases, pasAliases] of [
    ['head', 'headActive', 'headPassive', ['headSkill', 'hSkill'], ['passivaHead', 'hPass']],
    ['chest', 'chestActive', 'chestPassive', ['chestSkill', 'cSkill'], ['passivaChest', 'cPass1']],
    ['boots', 'bootsActive', 'bootsPassive', ['bootsSkill', 'bSkill'], ['passivaBoots', 'bPass']],
  ]) {
    const item = ITEMS[out[slot]];
    if (!item || !item.skills) continue;
    const actSent = has(actK) || actAliases.some(has);
    const pasSent = has(pasK) || pasAliases.some(has);
    if (!actSent && !item.skills.active.includes(out[actK])) out[actK] = item.skills.active[0];
    if (!pasSent && !item.skills.passive.includes(out[pasK])) out[pasK] = item.skills.passive[0];
  }
  if (out.chest === 'soldier-armor') {
    const p2 = ITEMS['soldier-armor'].skills.passive2;
    if (!has('chestPassive2') && !has('passivaChest2') && !has('cPass2') && !p2.includes(out.chestPassive2)) out.chestPassive2 = p2[0];
  } else if (!has('chestPassive2') && !has('passivaChest2') && !has('cPass2')) delete out.chestPassive2;
  return out;
}

const PORT = Number(process.env.PORT || 8094);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function serve(req, res) {
  const url = new URL(req.url, 'http://x');
  // Health p/ sonda do Hub (2xx): sem segredo, sem estado.
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, game: 'prettierrpg' }));
    return;
  }
  // --- Hub lado-servidor (idempotente, sem quebrar modo independente) ---
  if (url.pathname === '/__hub/state' && req.method === 'GET') {
    const r = hub.stateOf(rooms, url.searchParams.get('room'), url.searchParams.get('htok'));
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(r.body));
    return;
  }
  if (url.pathname === '/__hub/close' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = hub.closeRoom(rooms, url.searchParams.get('room'), url.searchParams.get('htok'), req.headers['x-hub-secret']);
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r.body));
    });
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('negado'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// code -> { match, conns, secrets, pendingRemove, returned, creatorId }
const rooms = new Map();

function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('');
  } while (rooms.has(c));
  return c;
}

function getRoom(code) { return rooms.get(String(code || '').toUpperCase()); }

function broadcast(room) {
  const snap = sim.snapshot(room.match);
  const msg = JSON.stringify({ type: 'state', snap });
  for (const ws of room.conns.values()) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// Protocolo ack/event compatível (tarefa E/eventos): cada comando gera ack ao
// emissor (aceito/recusado com motivo) + evento broadcast aos relevantes.
// Mantém {type:error} legado e {type:state}; adiciona {type:ack}/{type:event}
// e snap.seq/events. Sem dano duplicado: sim é a única que aplica dano.
function sendAck(ws, action, r, extra = {}) {
  const msg = { type: 'ack', action, ok: !!r.ok, error: r.error || null };
  if (r.dmg !== undefined) msg.dmg = r.dmg;
  if (r.absorbed !== undefined) msg.absorbed = r.absorbed;
  if (r.healed !== undefined) msg.healed = r.healed;
  if (r.casting) msg.casting = true;
  if (r.charging) msg.charging = true;
  Object.assign(msg, extra);
  send(ws, msg);
}
function emitEvent(room, evt) {
  const e = sim.pushEvent(room.match, evt);
  const msg = JSON.stringify({ type: 'event', ...e });
  for (const ws of room.conns.values()) {
    if (ws.readyState === 1) ws.send(msg);
  }
  return e;
}
// Classifica resultado de dano/cura p/ evento: absorvido total vira bloqueio
// (aceito sem fingir dano HP); visibilidade de cura segue snapshot (HP visível).
function hitKind(r) {
  if (!r || !r.ok) return 'blocked';
  if ((r.absorbed || 0) > 0 && (r.dmg || 0) === 0) return 'blocked';
  return 'hit';
}

// cross-lane fix: filtra !left (sala vazia = sem ativos).
function removeIfEmpty(code, room) {
  const active = [...room.match.players.values()].filter((p) => !p.left);
  if (active.length === 0) {
    for (const t of room.pendingRemove.values()) clearTimeout(t);
    rooms.delete(code); // código liberado (§6)
    hub.forget(code); // dono hub liberado junto (sem reserva fantasma)
    return true;
  }
  return false;
}

function pickCreator(room) {
  const act = [...room.match.players.values()].filter((p) => !p.left);
  if (!act.length) return null;
  if (!act.some((p) => p.id === room.creatorId)) room.creatorId = act[0].id; // substituição (§6)
  return room.creatorId;
}

function handleJoin(ws, msg) {
  const nick = String(msg.nick || '').trim().slice(0, 20);
  if (!nick) return send(ws, { type: 'error', msg: 'Escolha um apelido.' });
  const rawBuild = msg.build && typeof msg.build === 'object' ? msg.build : {};
  // Validação completa: todas as armas/offhands/peças/capas, Soldier 2
  // passivas, Courier inerte (validateBuild); sim confirma interno.
  const canon = toCanonicalBuild(rawBuild);
  const v = validateBuild(canon);
  if (!v.ok) return send(ws, { type: 'error', msg: 'Build inválida: ' + v.error });
  const vf = sim.validateFullBuild(canon);
  if (!vf.ok) return send(ws, { type: 'error', msg: 'Build inválida: ' + vf.error });
  const build = vf.build;

  let code = String(msg.room || '').trim().toUpperCase();
  const htok = hub.validHtok(msg.htok);
  const mode = ['ffa', '2v2', 'pve'].includes(msg.mode) ? msg.mode : 'ffa';
  let room;
  if (!code) {
    // Standalone: código próprio aleatório (intocado; htok sem código do Hub é ignorado).
    code = newCode();
    room = { match: sim.createMatch(code, { mode }), conns: new Map(), secrets: new Map(), pendingRemove: new Map(), returned: new Set(), creatorId: null };
    rooms.set(code, room);
  } else if (!getRoom(code)) {
    // Criação dirigida pelo Hub: usa EXATAMENTE o código suprido (+htok como
    // dono, registrado já na criação); nunca gera outro em silêncio.
    if (!htok) return send(ws, { type: 'error', msg: 'Sala não encontrada. Confira o código.' });
    if (!/^[A-Z0-9]{4}$/.test(code)) return send(ws, { type: 'error', msg: 'Código de sala inválido.' });
    room = { match: sim.createMatch(code, { mode }), conns: new Map(), secrets: new Map(), pendingRemove: new Map(), returned: new Set(), creatorId: null };
    rooms.set(code, room);
    hub.remember(code, htok);
  } else {
    // Sala existe: mesmo código + mesmo htok entra/resume (retentativa
    // legítima); htok divergente/ausente => CODE_TAKEN, sem join cego.
    room = getRoom(code);
    const owner = hub.ownerOf(code);
    if (owner ? htok !== owner : !!htok) {
      return send(ws, { type: 'error', msg: 'CODE_TAKEN: sala ocupada por outra partida.' });
    }
  }
  const m = room.match;

  // Reconexão: mesmo apelido + segredo dentro de 30s, sem tomar vaga por nick (§11).
  // cross-lane fix: ignora left (quem saiu voluntariamente não volta).
  for (const [pid, p] of m.players) {
    if (p.nick.toLowerCase() === nick.toLowerCase()) {
      if (!p.left && p.disconnected && msg.secret && room.secrets.get(pid) === msg.secret) {
        clearTimeout(room.pendingRemove.get(pid));
        room.pendingRemove.delete(pid);
        p.disconnected = false;
        room.conns.set(pid, ws);
        ws.pid = pid; ws.code = code;
        send(ws, { type: 'joined', code, id: pid, secret: msg.secret, reconnected: true });
        broadcast(room);
        return;
      }
      return send(ws, { type: 'error', msg: 'Apelido já usado nesta sala.' });
    }
  }

  const team = (m.mode === '2v2' && (msg.team === 0 || msg.team === 1)) ? msg.team : null;
  const r = sim.joinPlayer(m, crypto.randomUUID(), nick, build, team);
  if (!r.ok) return send(ws, { type: 'error', msg: r.error });
  const pid = [...m.players.keys()].pop();
  if (!room.creatorId) room.creatorId = pid;
  const secret = crypto.randomBytes(16).toString('hex');
  room.secrets.set(pid, secret);
  room.conns.set(pid, ws);
  ws.pid = pid; ws.code = code;
  send(ws, { type: 'joined', code, id: pid, secret });
  broadcast(room);
}

const server = http.createServer(serve);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.pid = null; ws.code = null;
  ws.msgCount = 0;
  const rlReset = setInterval(() => { ws.msgCount = 0; }, 1000);
  ws.on('close', () => {
    clearInterval(rlReset);
    if (!ws.pid || !ws.code) return;
    const room = rooms.get(ws.code);
    if (!room) return;
    room.conns.delete(ws.pid);
    const p = room.match.players.get(ws.pid);
    if (!p) { removeIfEmpty(ws.code, room); return; }
    if (room.match.state === 'lobby') {
      sim.leavePlayer(room.match, ws.pid); // lobby: sai imediatamente (§11)
      room.secrets.delete(ws.pid);
      pickCreator(room);
      removeIfEmpty(ws.code, room);
      broadcast(room);
    } else {
      // Partida: reserva identidade/vaga por 30s (§11); parado e vulnerável.
      p.disconnected = true;
      p.dest = null;
      const t = setTimeout(() => {
        room.pendingRemove.delete(ws.pid);
        const pl = room.match.players.get(ws.pid);
        if (pl && pl.disconnected && !pl.left) {
          sim.leavePlayer(room.match, ws.pid);
          room.secrets.delete(ws.pid);
          pickCreator(room);
          removeIfEmpty(ws.code, room);
          broadcast(room);
        }
      }, 30000);
      room.pendingRemove.set(ws.pid, t);
      broadcast(room);
    }
  });
  ws.on('message', (raw) => {
    ws.msgCount += 1;
    if (ws.msgCount > 30) return; // limitador (§14)
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    try {
      if (msg.type === 'join') return handleJoin(ws, msg);
      const room = ws.code ? rooms.get(ws.code) : null;
      const p = room && ws.pid ? room.match.players.get(ws.pid) : null;
      if (!room || !p) return send(ws, { type: 'error', msg: 'Entre em uma sala primeiro.' });
      const m = room.match;
      switch (msg.type) {
        case 'ready': {
          const r = sim.setReady(m, ws.pid, !!msg.ready);
          sendAck(ws, 'ready', r);
          if (!r.ok && r.error) send(ws, { type: 'error', msg: r.error });
          break;
        }
        case 'team': {
          const r = sim.setTeam(m, ws.pid, msg.team);
          if (!r.ok && r.error) send(ws, { type: 'error', msg: r.error });
          break;
        }
        case 'mode': {
          if (room.creatorId !== ws.pid) { send(ws, { type: 'error', msg: 'Só o criador muda o modo.' }); break; }
          const r = sim.setMode(m, ws.pid, msg.mode);
          if (!r.ok && r.error) send(ws, { type: 'error', msg: r.error });
          break;
        }
        case 'build': {
          // §9: no treino PvE a build pode mudar a qualquer momento (editor abre
          // sempre); fora dele, só no lobby. Em jogo preserva % de vida/energia
          // e os CDs restantes de cada espaço.
          const pveGame = m.mode === 'pve' && m.state !== 'lobby';
          if (m.state !== 'lobby' && !pveGame) return send(ws, { type: 'error', msg: 'Build só pode mudar no lobby.' });
          const canonB = toCanonicalBuild({ ...(p.build || {}), ...(msg.build || {}) });
          const vb = validateBuild(canonB);
          if (!vb.ok) return send(ws, { type: 'error', msg: 'Build inválida: ' + vb.error });
          const vfB = sim.validateFullBuild(canonB);
          if (!vfB.ok) return send(ws, { type: 'error', msg: 'Build inválida: ' + vfB.error });
          if (pveGame) {
            const st0 = sim.statsFor(p.build);
            const hpPct = st0.maxHp ? p.hp / st0.maxHp : 1;
            const enPct = st0.maxEnergy ? p.energy / st0.maxEnergy : 1;
            p.build = vfB.build;
            const st1 = sim.statsFor(p.build);
            p.maxHp = st1.maxHp; p.hp = Math.min(st1.maxHp, st1.maxHp * hpPct);
            p.maxEnergy = st1.maxEnergy; p.energy = Math.min(st1.maxEnergy, st1.maxEnergy * enPct);
          } else {
            p.build = vfB.build;
            p.ready = false; // alterar build limpa pronto (§6)
          }
          break;
        }
        case 'move': {
          const r = sim.moveCommand(m, ws.pid, msg.x, msg.y);
          p.chase = null;
          sendAck(ws, 'move', r, { x: msg.x, y: msg.y });
          if (!r.ok && r.error) send(ws, { type: 'error', msg: r.error });
          emitEvent(room, { kind: r.ok ? 'move' : 'blocked', action: 'move', src: ws.pid, x: msg.x, y: msg.y, ok: !!r.ok, error: r.error || null });
          break;
        }
        case 'attack': {
          // Seção 5: monstro pelo MESMO motor (basicAttack com '__monster__';
          // sem valores fixos no servidor).
          if (msg.target === '__monster__' && m.mode === 'pve') {
            const r = sim.basicAttack(m, ws.pid, '__monster__');
            // Perseguição continua com alvo válido: fora de alcance OU
            // bloqueado por parede (o monstro contorna; o ataque dispara
            // quando houver linha de tiro). Sem gasto sem acerto.
            if (!r.ok && (r.error === 'Fora de alcance.' || r.error === 'Obstáculo bloqueia.')) p.chase = { target: '__monster__', kind: 'aa' };
            else p.chase = null;
            sendAck(ws, 'attack', r, { target: msg.target });
            if (!r.ok && r.error && r.error !== 'Fora de alcance.') send(ws, { type: 'error', msg: r.error });
            emitEvent(room, { kind: hitKind(r), action: 'attack', src: ws.pid, target: msg.target, ok: !!r.ok, error: r.error || null, dmg: r.dmg || 0, absorbed: r.absorbed || 0 });
            break;
          }
          const r = sim.basicAttack(m, ws.pid, msg.target);
          if (!r.ok && (r.error === 'Fora de alcance.' || r.error === 'Obstáculo bloqueia.')) p.chase = { target: msg.target, kind: 'aa' };
          else p.chase = null;
          sendAck(ws, 'attack', r, { target: msg.target });
          if (!r.ok && r.error && r.error !== 'Fora de alcance.') send(ws, { type: 'error', msg: r.error });
          emitEvent(room, { kind: hitKind(r), action: 'attack', src: ws.pid, target: msg.target, ok: !!r.ok, error: r.error || null, dmg: r.dmg || 0, absorbed: r.absorbed || 0 });
          break;
        }
        case 'skill': {
          const slot = String(msg.slot || '').toUpperCase();
          if (!['Q', 'W', 'E', 'HEAD', 'CHEST', 'BOOTS', 'FINISH'].includes(slot)) {
            const re = { ok: false, error: 'Habilidade inválida.' };
            send(ws, { type: 'error', msg: re.error });
            sendAck(ws, 'skill', re, { slot });
            emitEvent(room, { kind: 'blocked', action: 'skill', src: ws.pid, slot, ok: false, error: re.error });
            break;
          }
          // Contrato canônico: msg.skill (quando enviado) deve ser a skill
          // equipada no slot; divergente rejeita sem gastar.
          if (slot !== 'FINISH' && msg.skill != null) {
            const nb = sim.normBuild(p.build);
            const exp = slot === 'Q' ? nb.q : slot === 'W' ? nb.w : slot === 'E' ? nb.e
              : slot === 'HEAD' ? nb.hSkill : slot === 'CHEST' ? nb.cSkill : nb.bSkill;
            if (msg.skill !== exp) {
              const re = { ok: false, error: 'Habilidade inválida.' };
              send(ws, { type: 'error', msg: re.error });
              sendAck(ws, 'skill', re, { slot });
              emitEvent(room, { kind: 'blocked', action: 'skill', src: ws.pid, slot, ok: false, error: re.error });
              break;
            }
          }
          // Seção 5: '__monster__'/'__dummy__' vão ao mesmo motor (sim valida,
          // gasta e aplica com split PvP/PvE); sem tabela fixa nem autocura-desfeita.
          const r = sim.useSkill(m, ws.pid, slot, msg.target, { x: msg.x, y: msg.y });
          if (!r.ok && (r.error === 'Fora de alcance.' || r.error === 'Obstáculo bloqueia.')) {
            // chase só com alvo (ponto puro sem alvo não persegue; miss direcional é final).
            if (msg.target) p.chase = { target: msg.target, kind: 'skill', slot };
            else p.chase = null;
          } else p.chase = null;
          sendAck(ws, 'skill', r, { slot, target: msg.target, x: msg.x, y: msg.y });
          if (!r.ok && r.error && r.error !== 'Fora de alcance.') send(ws, { type: 'error', msg: r.error });
          // Lançamento/direção/impacto/bloqueio: casting→cast, Errou→miss,
          // absorvido total→blocked, dano/cura efetiva→hit; toggled, buffs e
          // efeito-zero→cast (sem som de acerto indevido).
          let kind = 'cast';
          if (!r.ok) kind = (r.error === 'Errou.') ? 'miss' : 'blocked';
          else if (r.casting || r.charging) kind = 'cast';
          else if ((r.absorbed || 0) > 0 && (r.dmg || 0) === 0 && !(r.healed > 0)) kind = 'blocked';
          else if ((r.dmg || 0) > 0 || (r.healed || 0) > 0) kind = 'hit';
          else kind = 'cast';
          emitEvent(room, { kind, action: 'skill', src: ws.pid, slot, target: msg.target || null, x: msg.x ?? null, y: msg.y ?? null, ok: !!r.ok, error: r.error || null, dmg: r.dmg || 0, absorbed: r.absorbed || 0, healed: r.healed || 0 });
          break;
        }
        case 'finish': {
          const r = sim.useSkill(m, ws.pid, 'FINISH', msg.target);
          sendAck(ws, 'finish', r, { target: msg.target });
          if (!r.ok && r.error) send(ws, { type: 'error', msg: r.error });
          emitEvent(room, { kind: r.ok ? 'cast' : 'blocked', action: 'finish', src: ws.pid, target: msg.target || null, ok: !!r.ok, error: r.error || null });
          break;
        }
        case 'editor': {
          if (m.mode !== 'pve') { send(ws, { type: 'error', msg: 'Editor só no treino.' }); break; }
          p.editorOpen = !!msg.open; // monstro para; efeitos continuam (§9)
          break;
        }
        case 'pveReset': {
          if (m.mode !== 'pve') break;
          sim.pveResetStats(m, !!msg.heal); // §3.4: resets independentes
          break;
        }
        case 'leave':
          // Saída voluntária: remove imediatamente (§7/§11).
          if (room.pendingRemove.has(ws.pid)) clearTimeout(room.pendingRemove.get(ws.pid));
          room.pendingRemove.delete(ws.pid);
          room.conns.delete(ws.pid);
          sim.leavePlayer(m, ws.pid);
          room.secrets.delete(ws.pid);
          pickCreator(room);
          ws.pid = null; ws.code = null;
          send(ws, { type: 'left' });
          removeIfEmpty(room.match.code, room);
          broadcast(room);
          return;
        case 'return':
          // Pós-jogo: voltar ao lobby; quando todos ativos voltam (ou 30s), libera.
          // cross-lane fix: ignora left.
          room.returned.add(ws.pid);
          if (m.state === 'ended' && activeDone(m, room)) {
            m.state = 'lobby'; m.result = null; m.winnerIds = []; m.endsAt = m.mode === 'pve' ? null : m.durationMs; m.autoReturnAt = null;
            for (const pl of m.players.values()) if (!pl.left) pl.ready = false;
            room.returned.clear();
          }
          break;
        default:
          return send(ws, { type: 'error', msg: 'Mensagem desconhecida.' });
      }
      broadcast(room);
    } catch (e) {
      send(ws, { type: 'error', msg: 'Falha ao processar: ' + e.message });
    }
  });
});

function activeDone(m, room) {
  return [...m.players.values()].filter((p) => !p.left).every((id) => room.returned.has(id.id));
}

// Loop autoritativo 20Hz; broadcast ~10Hz.
let tickN = 0;
setInterval(() => {
  for (const [code, room] of rooms) {
    const m = room.match;
    if (m.state !== 'playing' && m.state !== 'ended') continue;
    if (m.state === 'playing') {
      for (const p of m.players.values()) {
        if (!p.chase || !p.alive || p.disconnected || p.left || p.knocked) continue;
        const t = p.chase.target === '__monster__' && m.monster ? { x: m.monster.x, y: m.monster.y, alive: m.monster.alive } : m.players.get(p.chase.target);
        if (!t || !t.alive) { p.chase = null; continue; }
        // Alcance da fonte: AA do catálogo; skill E usa o alcance da skill equipada.
        const nb = sim.normBuild(p.build);
        let range = (sim.aaStatsFor(p.build.weapon) || {}).range || 3;
        if (p.chase.kind === 'skill' && p.chase.slot === 'E') {
          const pr = sim.skillParams(nb.e);
          range = (pr && Number.isFinite(pr.range)) ? pr.range : 17;
        }
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d <= range) {
          if (p.chase.kind === 'aa') {
            if (p.chase.target === '__monster__') {
              const r = sim.basicAttack(m, p.id, '__monster__');
              if (r.ok) {
                emitEvent(room, { kind: hitKind(r), action: 'attack', src: p.id, target: '__monster__', ok: true, dmg: r.dmg || 0, absorbed: r.absorbed || 0, via: 'chase' });
              }
              else if (r.error !== 'Em recarga.' && r.error !== 'Obstáculo bloqueia.') p.chase = null;
            } else {
              const r = sim.basicAttack(m, p.id, p.chase.target);
              if (r.ok) {
                emitEvent(room, { kind: hitKind(r), action: 'attack', src: p.id, target: p.chase.target, ok: true, dmg: r.dmg || 0, absorbed: r.absorbed || 0, via: 'chase' });
              }
              else if (r.error !== 'Em recarga.' && r.error !== 'Obstáculo bloqueia.') p.chase = null;
            }
          } else {
            const r = sim.useSkill(m, p.id, p.chase.slot, p.chase.target);
            if (r.ok) emitEvent(room, { kind: ((r.casting || r.charging) || !((r.dmg || 0) > 0 || (r.healed || 0) > 0)) ? 'cast' : 'hit', action: 'skill', src: p.id, slot: p.chase.slot, target: p.chase.target, ok: true, via: 'chase' });
            if (r.ok || (r.error && r.error !== 'Em recarga.' && r.error !== 'Fora de alcance.' && r.error !== 'Obstáculo bloqueia.')) p.chase = null;
          }
        } else {
          sim.moveCommand(m, p.id, t.x, t.y);
        }
      }
    }
    const before = m.state;
    sim.tick(m, 50);
    if (before === 'ended' && m.state === 'lobby') room.returned.clear();
    tickN += 1;
    if (tickN % 2 === 0 || m.state !== before) broadcast(room);
  }
}, 50);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} ocupada. Tente outra: PORT=8095 bash start.sh`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`PrettierRPG em http://${HOST}:${PORT}`);
});

module.exports = { server, rooms };
