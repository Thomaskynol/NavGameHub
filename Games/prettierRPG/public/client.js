'use strict';
/* PrettierRPG cliente v1 — vanilla, sem CDN, tudo local. PT-BR. */
const $ = (id) => document.getElementById(id);

/* ---------- armazenamento local seguro (modo privado pode bloquear) ---------- */
const Store = {
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------- áudio sintetizado (WebAudio, sem arquivos) ---------- */
const AudioX = {
  ctx: null,
  ativo: Store.get('prpg-som') !== '0',
  vol: Number(Store.get('prpg-vol', '60')) / 100,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tom(freq, dur = 0.12, tipo = 'sine', ganho = 0.2, quando = 0, desliza = 0) {
    if (!this.ativo) return;
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + quando;
    const o = c.createOscillator(), g = c.createGain();
    o.type = tipo; o.frequency.setValueAtTime(freq, t);
    if (desliza) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + desliza), t + dur);
    g.gain.setValueAtTime(Math.min(1, ganho * (this.vol * 2)), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  ui() { this.tom(660, 0.06, 'triangle', 0.15); },
  erro() { this.tom(180, 0.18, 'sawtooth', 0.18); },
  ataque() { this.tom(300, 0.08, 'square', 0.12, 0, -120); },
  acerto() { this.tom(220, 0.1, 'sawtooth', 0.16, 0, -80); this.tom(110, 0.12, 'sine', 0.2, 0.02); },
  skill() { this.tom(520, 0.14, 'triangle', 0.2, 0, 260); },
  cura() { this.tom(440, 0.12, 'sine', 0.18); this.tom(660, 0.16, 'sine', 0.16, 0.1); },
  morte() { this.tom(300, 0.3, 'sawtooth', 0.2, 0, -220); },
  respawn() { this.tom(330, 0.12, 'sine', 0.16, 0, 220); },
  vitoria() { [523, 659, 784].forEach((f, i) => this.tom(f, 0.18, 'triangle', 0.2, i * 0.13)); },
  derrota() { [400, 300, 200].forEach((f, i) => this.tom(f, 0.2, 'sine', 0.18, i * 0.14)); },
  wave() { this.tom(150, 0.4, 'sawtooth', 0.15, 0, 60); },
};

/* ---------- catálogo (docs/PRODUTO §§3, D–E; valores T8 Normal) ---------- */
const ARMAS = {
  battleaxe: { nome: 'Machado de Batalha', en: 'Elder’s Battleaxe', cor: '#b08945' },
  dagger: { nome: 'Adaga', en: 'Elder’s Dagger', cor: '#9aa5b1' },
  fire: { nome: 'Cajado de Fogo', en: 'Elder’s Fire Staff', cor: '#e0642b' },
  frost: { nome: 'Cajado de Gelo', en: 'Elder’s Frost Staff', cor: '#6ec6ff' },
  holy: { nome: 'Cajado Sagrado', en: 'Elder’s Holy Staff', cor: '#e8cf6a' },
};
const OFFHANDS = {
  shield: { nome: 'Escudo', en: 'Elder’s Shield', desc: '+50 CCR · +5,2% defesa vs jogadores/mobs · +20,5% ameaça. Sem ativa.' },
  tome: { nome: 'Tomo (Rosalia’s Diary)', en: 'Tome of Spells', desc: '+29 energia máx · +0,37/s regen · −2,1% tempo de conjuração. Sem ativa.' },
  torch: { nome: 'Tocha', en: 'Elder’s Torch', desc: '+12,3% vel. ataque básico · +0,6% recarga. Sem ativa.' },
};
const HEADS = {
  'mercenary-hood': { nome: 'Capuz Mercenário', cor: '#5d7a4a' },
  'soldier-helmet': { nome: 'Elmo Soldado', cor: '#8a8f96' },
  'scholar-cowl': { nome: 'Capuz Erudito', cor: '#7a5fc0' },
};
const CHESTS = {
  'mercenary-jacket': { nome: 'Jaqueta Mercenária', cor: '#5d7a4a' },
  'soldier-armor': { nome: 'Armadura Soldado', cor: '#8a8f96' },
  'scholar-robe': { nome: 'Túnica Erudita', cor: '#7a5fc0' },
};
const BOOTS = {
  'mercenary-shoes': { nome: 'Botas Mercenárias', cor: '#5d7a4a' },
  'soldier-boots': { nome: 'Botas Soldado', cor: '#8a8f96' },
  'scholar-sandals': { nome: 'Sandálias Eruditas', cor: '#7a5fc0' },
};
const CAPES = {
  bridgewatch: { nome: 'Capa Bridgewatch', cor: '#d8b24a', desc: 'Areia (passiva): ao usar E, lentidão −40% + −30% CCR em raio 5 m por 6 s. CD 75 s.' },
  'fort-sterling': { nome: 'Capa Fort Sterling', cor: '#9fd8ff', desc: 'Intocável (passiva): ao sofrer stun/silence/root, limpa CC (exceto DoT) + ~1 s intocável. CD 139 s.' },
  lymhurst: { nome: 'Capa Lymhurst', cor: '#7bc96f', desc: 'Reserva (passiva): ao cair abaixo de 40% energia, recupera 70% da máx em 10 s. CD 182 s.' },
  martlock: { nome: 'Capa Martlock', cor: '#7a9bb5', desc: 'Proteção (passiva): abaixo de 25% vida, +50% defesa 5 s. CD 225 s. Não é escudo de vida.' },
  thetford: { nome: 'Capa Thetford', cor: '#b46ae0', desc: 'Raio (passiva): ataques básicos podem soltar raio ~242 em até 4 alvos (9 m). CD interno ~15 s.' },
  caerleon: { nome: 'Capa Caerleon', cor: '#e05252', desc: 'Reinicia a recarga do 1º slot ao usar habilidade do 1º slot, 1× por ativação. CD ~60 s (hipótese).' },
};
/* Habilidades: alvo = inimigo|aliado|ponto|direcao|self|area */
const SKILLS = {
  'rending-strike': { slot: 'Q', nome: 'Golpe Dilacerante', en: 'Rending Strike', alvo: 'inimigo', alcance: 3, custo: 2, cd: 2, texto: '195 físico + sangramento ~83/6 s por carga (máx 3; com 3: −12% cura recebida 5 s).' },
  'rending-spin': { slot: 'Q', nome: 'Giro Dilacerante', en: 'Rending Spin', alvo: 'area', alcance: 5, custo: 3, cd: 3, texto: '231–264 físico ao redor (maior na borda 5 m). Aplica 1 carga em cada inimigo.' },
  'rending-rage': { slot: 'Q', nome: 'Fúria Dilacerante', en: 'Rending Rage', alvo: 'direcao', alcance: 9, custo: 4, cd: 1.2, texto: 'Combo 3 etapas em cone (janela 2,5 s): etapas 1-2 cone 3 m, 165 + carga; 3ª etapa salta ao ponto até 9 m, 165 + root em área 5 m (~1,6 s).' },
  'deadly-chop': { slot: 'W', nome: 'Corte Mortal', en: 'Deadly Chop', alvo: 'inimigo', alcance: 3, custo: 8, cd: 15, texto: '502 físico; −16% resistência 8 s. Conjura 0,4 s.' },
  'adrenaline-boost': { slot: 'W', nome: 'Adrenalina', en: 'Adrenaline Boost', alvo: 'self', alcance: 0, custo: 30, cd: 20, texto: '+25% dano, +40% movimento e vel. ataque até 9 s (cai após 3 s sem dano).' },
  'battle-rush': { slot: 'W', nome: 'Investida', en: 'Battle Rush', alvo: 'ponto', alcance: 12, custo: 36, cd: 18, texto: 'Dash 12 m: inimigos −20% cura 3 s; até 5 aliados +20% cura 4 s (raio 5 m).' },
  'internal-bleeding': { slot: 'W', nome: 'Hemorragia', en: 'Internal Bleeding', alvo: 'area', alcance: 6, custo: 26, cd: 15, texto: '193 direto + 66/0,5 s até 8 s em quem se move (raio 6 m).' },
  'raging-blades': { slot: 'W', nome: 'Lâminas Furiosas', en: 'Raging Blades', alvo: 'area', alcance: 5, custo: 30, cd: 12, texto: 'Aura 5 m 3 s: 73/0,5 s + +4% dano por inimigo (máx 10, 3 s).' },
  'blood-bandit': { slot: 'E', nome: 'Bandido Sangrento', en: 'Blood Bandit', alvo: 'direcao', alcance: 17, custo: 40, cd: 10, texto: 'Etapa 1: 528/627/726/825 por 0–3 cargas. Etapa 2 (9 s): 363 + cura 110/177/243/331. Mire na direção e clique.' },
  'sunder-armor': { slot: 'Q', nome: 'Armadura Rachada', en: 'Sunder Armor', alvo: 'inimigo', alcance: 2, custo: 3, cd: 2, texto: '230 físico; cargas −4% resistência vs players (−6% mobs), máx 3, 8 s.' },
  'deadly-swipe': { slot: 'Q', nome: 'Golpe Súbito', en: 'Deadly Swipe', alvo: 'ponto', alcance: 4.5, custo: 9, cd: 4, texto: 'Salto 4,5 m, 258 em área 3 m; +1 carga (+6% dano 8 s, máx 3); restaura 21 energia se acertar.' },
  'assassin-spirit': { slot: 'Q', nome: 'Espírito Assassino', en: 'Assassin Spirit', alvo: 'self', alcance: 0, custo: 6, cd: 1, texto: 'Liga/desliga até 15 s: +1 carga/2 s (−4% defesa; +6% dano 8 s, máx 3).' },
  'throwing-blades': { slot: 'W', nome: 'Lâminas Arremessadas', en: 'Throwing Blades', alvo: 'direcao', alcance: 12, custo: 11, cd: 15, texto: 'Cone 12 m, 207 físico; por inimigo único +15% mov +10% dano 5 s (máx 3).' },
  dash: { slot: 'W', nome: 'Avanço', en: 'Dash', alvo: 'ponto', alcance: 8, custo: 1, cd: 23.5, texto: 'Dash 8 m; +15% dano 4 s.' },
  'forbidden-stab': { slot: 'W', nome: 'Estocada Proibida', en: 'Forbidden Stab', alvo: 'inimigo', alcance: 2, custo: 24, cd: 15, texto: '290 físico; interrompe conjuração; nega cura 1,5 s.' },
  'shadow-edge': { slot: 'W', nome: 'Lâmina Sombria', en: 'Shadow Edge', alvo: 'direcao', alcance: 22, custo: 41, cd: 20, texto: 'Projétil 22 m; teleporta atrás do 1º inimigo; stun ~1,7 s. Acertar reduz CD 25%.' },
  'chain-slash': { slot: 'W', nome: 'Corte em Cadeia', en: 'Chain Slash', alvo: 'inimigo', alcance: 6, custo: 9, cd: 15, texto: 'Salta até 3 alvos (7 m): 379/482/689 por impacto. Imune/invisível no salto.' },
  'bloodthirsty-blade': { slot: 'E', nome: 'Lâmina Sanguinária', en: 'Bloodthirsty Blade', alvo: 'self', alcance: 0, custo: 48, cd: 20, texto: 'Cada AA soma 172 mágico vs player / 103 vs mob e rouba 100% desse bônus; +30% mov 6 s; auto-dano verdadeiro −2,5% vida máx/s.' },
  'fire-bolt': { slot: 'Q', nome: 'Dardo Ígneo', en: 'Fire Bolt', alvo: 'inimigo', alcance: 13, custo: 9, cd: 0, texto: '178 direto + queimadura 57/4 s (máx 5). Conjura 0,8 s.' },
  'burning-field': { slot: 'Q', nome: 'Campo Flamejante', en: 'Burning Field', alvo: 'ponto', alcance: 15, custo: 6, cd: 4, texto: '201 no impacto (raio 3 m) + campo 4 s: 158/0,5 s vs player (57 vs mob).' },
  'searing-flame': { slot: 'Q', nome: 'Chama Cortante', en: 'Searing Flame', alvo: 'direcao', alcance: 20, custo: 14, cd: 1.5, texto: 'Combo direcional de 3 acertos + finalizador (reseta 5s): 284 + 126/4s; finalizador 574 + 126. Precisa acertar para continuar.' },
  'flame-blast': { slot: 'W', nome: 'Explosão Ígnea', en: 'Flame Blast', alvo: 'aliado', alcance: 11, custo: 23, cd: 12, texto: 'Em aliado/si/inimigo 11 m; explosão 5 m após 1,6 s: 402 + 115 extra no primário; +60% mov 1,6 s se em aliado.' },
  'wall-of-flames': { slot: 'W', nome: 'Muralha de Chamas', en: 'Wall of Flames', alvo: 'direcao', alcance: 0, custo: 43, cd: 15, texto: 'Parede 5 s à frente (~14 m): toque = burn 417 mágico total/4 s + fuga 0,5 s (mob 1×/parede).' },
  'raging-flare': { slot: 'W', nome: 'Labareda', en: 'Raging Flare', alvo: 'direcao', alcance: 22, custo: 46, cd: 20, texto: 'Projétil 22 m, explosão 5 m: 588 + 184/3 s.' },
  'fire-wave': { slot: 'W', nome: 'Onda de Fogo', en: 'Fire Wave', alvo: 'direcao', alcance: 12, custo: 34, cd: 12, texto: 'Cone 12 m: 497 (+201 se alvo sob fogo) + empurrão ~5,6 m.' },
  'fire-artillery': { slot: 'W', nome: 'Artilharia Ígnea', en: 'Fire Artillery', alvo: 'inimigo', alcance: 18, custo: 46, cd: 15, texto: 'Canaliza orbes 18 m: 158 cada (raio 3 m) + fogo 6 s (43/0,5 s vs player, máx 4).' },
  pyroblast: { slot: 'E', nome: 'Piroexplosão', en: 'Pyroblast', alvo: 'ponto', alcance: 15, custo: 43, cd: 15, texto: 'Carrega até 1,2 s (raio 4 m): 402/689/976 + empurrão 3,5 m no total.' },
  frostbite: { slot: 'Q', nome: 'Mordida Gélida', en: 'Frostbite', alvo: 'direcao', alcance: 18, custo: 14, cd: 1.2, texto: '293; +1 carga/3 s (máx 3; com 3: stun ~1,1 s).' },
  'ice-shard': { slot: 'Q', nome: 'Estilhaço de Gelo', en: 'Ice Shard', alvo: 'ponto', alcance: 14, custo: 8, cd: 0, texto: '373 vs player / 258 vs mob em raio 3 m. Conjura 1,2 s.' },
  'frozen-surge': { slot: 'Q', nome: 'Surto Congelante', en: 'Frozen Surge', alvo: 'direcao', alcance: 16, custo: 14, cd: 3, texto: 'Faixa 16 m: 258 + lentidão 20%/3 s.' },
  'frost-bomb': { slot: 'W', nome: 'Bomba de Gelo', en: 'Frost Bomb', alvo: 'ponto', alcance: 11, custo: 29, cd: 10, texto: 'Lentidão 30% (5 m), explode após 1,6 s: 477 + lentidão 20%/5 s.' },
  'frost-beam': { slot: 'W', nome: 'Raio Gélido', en: 'Frost Beam', alvo: 'inimigo', alcance: 12, custo: 37, cd: 15, texto: 'Canal 2,7 s: 90/0,3 s em área 4 m + lentidão e −AA (máx 5, 2 s).' },
  'frost-nova': { slot: 'W', nome: 'Nova Gélida', en: 'Frost Nova', alvo: 'ponto', alcance: 11, custo: 34, cd: 20, texto: 'Teleporta 11 m (não atravessa parede): 201 + stun 1,4 s na origem (3 m). Imune 0,2 s.' },
  'frost-lance': { slot: 'W', nome: 'Lança Gélida', en: 'Frost Lance', alvo: 'direcao', alcance: 9, custo: 8, cd: 8, texto: 'Explode (3 m): 425; −12% resistência 3 s.' },
  'glacial-obelisk': { slot: 'W', nome: 'Obelisco Glacial', en: 'Glacial Obelisk', alvo: 'ponto', alcance: 12, custo: 23, cd: 16, texto: 'Objeto 6 s: até 10 aliados +20% dano e recarga (6 m). Reativa: 221 + lentidão 40%/4 s.' },
  'freezing-wind': { slot: 'E', nome: 'Vento Congelante', en: 'Freezing Wind', alvo: 'direcao', alcance: 12, custo: 46, cd: 18, texto: 'Cone 12 m: 574 + raiz 2,8 s.' },
  'generous-heal': { slot: 'Q', nome: 'Cura Generosa', en: 'Generous Heal', alvo: 'aliado', alcance: 15, custo: 18, cd: 1.5, texto: 'Cura 201; +5% cura recebida 4 s (máx 3).' },
  smite: { slot: 'Q', nome: 'Julgamento (Smite)', en: 'Smite', alvo: 'ponto', alcance: 13, custo: 11, cd: 3, texto: '330 vs player / 390 vs mob (2,5 m); próximo dano +109 em 3 s. CD −50% se acertar inimigo.' },
  'holy-flash': { slot: 'Q', nome: 'Clarão Sacro', en: 'Holy Flash', alvo: 'ponto', alcance: 13, custo: 23, cd: 3.5, texto: 'Cura 213 em até 10 aliados (raio 5 m).' },
  'sacred-pulse': { slot: 'W', nome: 'Pulso Sagrado', en: 'Sacred Pulse', alvo: 'aliado', alcance: 13, custo: 32, cd: 12, texto: 'Cura 81 (até 5, 5 m) + 321 vs players/482 vs mobs + empurrão 12,6 m.' },
  'holy-beam': { slot: 'W', nome: 'Feixe Sacro', en: 'Holy Beam', alvo: 'aliado', alcance: 12, custo: 37, cd: 12, texto: 'Canal 3 s em aliado (não em si): 101/0,5 s +12 por tick, até 959. Sem alvo válido no FFA solo.' },
  'holy-blessing': { slot: 'W', nome: 'Bênção Sacra', en: 'Holy Blessing', alvo: 'aliado', alcance: 13, custo: 23, cd: 15, texto: '+86 armadura e +30% cura recebida 4 s; imune a deslocamento.' },
  'holy-orb': { slot: 'W', nome: 'Orbe Sacro', en: 'Holy Orb', alvo: 'direcao', alcance: 25, custo: 29, cd: 15, texto: 'Projétil 25 m que cura 272 (até 10, 7 m) ao tocar aliado.' },
  reawaken: { slot: 'W', nome: 'Despertar', en: 'Reawaken', alvo: 'aliado', alcance: 12, custo: 66, cd: 30, texto: 'Levanta aliado caído com 30% vida. Conjura 1 s. Não ressuscita morto.' },
  'desperate-prayer': { slot: 'E', nome: 'Prece Desesperada', en: 'Desperate Prayer', alvo: 'aliado', alcance: 13, custo: 43, cd: 10, texto: 'Cura 201 (>40% vida) ou 443 (<40%). Se >40%: +5% cura 15 s (máx 3).' },
  /* armaduras */
  'energizing-shield': { slot: 'HEAD', nome: 'Escudo Energizante', en: 'Energizing Shield', alvo: 'self', alcance: 0, custo: 0, cd: 25, texto: 'Escudo 505/3 s + restaura 25% da energia faltante.' },
  cleanse: { slot: 'HEAD', nome: 'Purificar', en: 'Cleanse', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: 'Remove todos os debuffs purgáveis. Custo 0, CD 30 s.' },
  howl: { slot: 'HEAD', nome: 'Uivo', en: 'Howl', alvo: 'direcao', alcance: 8, custo: 0, cd: 30, texto: 'Cone 8 m: 163 mágico em área, lentidão 35%/4 s, −30% dano 4 s, interrompe conjuração.' },
  'stone-skin': { slot: 'HEAD', nome: 'Pele de Pedra', en: 'Stone Skin', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: '+Defesa ~33% por 4 s.' },
  block: { slot: 'HEAD', nome: 'Bloqueio', en: 'Block', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: 'Canaliza ~2,5 s imune a dano e CC (pode mover).' },
  'force-field': { slot: 'HEAD', nome: 'Campo de Força', en: 'Force Field', alvo: 'area', alcance: 6, custo: 0, cd: 30, texto: 'Onda 6 m: 177 mágico + empurrão 9 m. Ignora CCR. Conjura 0,5 s.' },
  'aegis-of-energy': { slot: 'HEAD', nome: 'Égide de Energia', en: 'Aegis of Energy', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: '+105 armadura/+28 MR 4 s; ao sofrer dano restaura 42 energia.' },
  'mend-wounds': { slot: 'CHEST', nome: 'Tratar Feridas', en: 'Mend Wounds', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: 'Canal 7 s fora de combate (−50% mov): 9% vida + 7,5% energia/s.' },
  'inferno-shield': { slot: 'CHEST', nome: 'Escudo Infernal', en: 'Inferno Shield', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: 'Escudo de chamas 5 s: reflete 20% do dano recebido como mágico em 4 m.' },
  bloodlust: { slot: 'CHEST', nome: 'Sede de Sangue', en: 'Bloodlust', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: 'Por 6 s: cada dano direto cura 30% do efetivo (limite 120/acerto, 600 no buff). Sem bônus flat por AA.' },
  taunt: { slot: 'CHEST', nome: 'Provocar', en: 'Taunt', alvo: 'inimigo', alcance: 8, custo: 15, cd: 20, texto: 'PvE: prioridade + ameaça (5 m). PvP: +20% dano e −25% defesa do alvo 3 s.' },
  fury: { slot: 'CHEST', nome: 'Fúria', en: 'Fury', alvo: 'self', alcance: 0, custo: 29, cd: 35, texto: '10 s: dano recebido gera até 8 cargas (+8% dano e +5% CC cada).' },
  'frost-shield': { slot: 'CHEST', nome: 'Escudo Gélido', en: 'Frost Shield', alvo: 'self', alcance: 0, custo: 26, cd: 40, texto: '+83 resistência 8 s; reflete 15%; lentidão 40%/2 s no atacante.' },
  'speed-caster': { slot: 'CHEST', nome: 'Conjurador Veloz', en: 'Speed Caster', alvo: 'self', alcance: 0, custo: 26, cd: 30, texto: '−50% conjuração e −70% energia 8 s.' },
  dodge: { slot: 'BOOTS', nome: 'Esquiva', en: 'Dodge', alvo: 'ponto', alcance: 5, custo: 0, cd: 20, texto: 'Salto 5 m; imune a dano/debuff/CC 0,8 s; +40% mov 5 s.' },
  'refreshing-sprint': { slot: 'BOOTS', nome: 'Corrida Refrescante', en: 'Refreshing Sprint', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: '+40% movimento e +20% recarga por 5 s.' },
  'break-free': { slot: 'BOOTS', nome: 'Libertação', en: 'Break Free', alvo: 'ponto', alcance: 12, custo: 0, cd: 30, texto: 'Dash 12 m que limpa CC; usável sob stun/silence.' },
  'rejuvenating-sprint': { slot: 'BOOTS', nome: 'Corrida Revigorante', en: 'Rejuvenating Sprint', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: '+80% mov 5 s; cura 40 vida/s durante o sprint.' },
  wanderlust: { slot: 'BOOTS', nome: 'Desejo de Viajar', en: 'Wanderlust', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: '+80% movimento por 8 s fora de combate; entrar em combate cancela.' },
  'energetic-sprint': { slot: 'BOOTS', nome: 'Corrida Enérgica', en: 'Energetic Sprint', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: '+80% mov 5 s; +11 energia/s.' },
  'focused-run': { slot: 'BOOTS', nome: 'Corrida Focada', en: 'Focused Run', alvo: 'self', alcance: 0, custo: 0, cd: 30, texto: 'Canal 4,5 s: +70% mov, imune a root/stun/slow, +11 energia/0,5 s.' },
};
const Q_POR_ARMA = {
  battleaxe: ['rending-strike', 'rending-spin', 'rending-rage'],
  dagger: ['sunder-armor', 'deadly-swipe', 'assassin-spirit'],
  fire: ['fire-bolt', 'burning-field', 'searing-flame'],
  frost: ['frostbite', 'ice-shard', 'frozen-surge'],
  holy: ['generous-heal', 'smite', 'holy-flash'],
};
const W_POR_ARMA = {
  battleaxe: ['deadly-chop', 'adrenaline-boost', 'battle-rush', 'internal-bleeding', 'raging-blades'],
  dagger: ['throwing-blades', 'dash', 'forbidden-stab', 'shadow-edge', 'chain-slash'],
  fire: ['flame-blast', 'wall-of-flames', 'raging-flare', 'fire-wave', 'fire-artillery'],
  frost: ['frost-bomb', 'frost-beam', 'frost-nova', 'frost-lance', 'glacial-obelisk'],
  holy: ['sacred-pulse', 'holy-beam', 'holy-blessing', 'holy-orb', 'reawaken'],
};
const E_POR_ARMA = {
  battleaxe: ['blood-bandit'], dagger: ['bloodthirsty-blade'], fire: ['pyroblast'],
  frost: ['freezing-wind'], holy: ['desperate-prayer'],
};
const PASSIVAS_ARMA = {
  battleaxe: ['deep-cuts', 'life-leech', 'increased-defense', 'aggressive-rush'],
  dagger: ['deep-cuts', 'life-leech', 'auto-attack-speed', 'aggressive-rush'],
  fire: ['burn', 'energetic', 'aggressive-caster', 'furious'],
  frost: ['frost', 'energetic', 'aggressive-caster', 'furious'],
  holy: ['adrenaline-driven-charity', 'energetic', 'magic-force', 'ascended'],
};
const NOMES_PASSIVA = {
  'deep-cuts': 'Cortes Profundos (a cada 4 AA: sangramento ~55)', 'life-leech': 'Sanguessuga (AA rouba 15% da vida perdida)',
  'increased-defense': 'Defesa Reforçada (a cada 5 AA: +29% resistência 2 s)', 'aggressive-rush': 'Ímpeto (a cada 4 AA: +8% dano 3 s)',
  'auto-attack-speed': 'Vel. Ataque (a cada 5 AA: +30% por 3 s)', burn: 'Queimadura (AA aplica 72/3 s)',
  energetic: 'Energético (AA restaura 3,6 energia)', 'aggressive-caster': 'Conjurador Agressivo (4 magias: −40% conjuração 3 s)',
  furious: 'Furioso (5 magias: +10% dano 4 s)', frost: 'Geada (após 4 magias, próximo AA enraíza ~1,2 s)',
  'adrenaline-driven-charity': 'Caridade Adrenalínica (4 magias: +20% cura 3 s)', 'magic-force': 'Força Mágica (5 magias: próximo AA empurra ~3 m)',
  ascended: 'Ascendido (+5% dano e cura lançada, contínuo)', 'balanced-mind': 'Mente Equilibrada (+1,5% dano/cura, +1% defesa)',
  swiftness: 'Agilidade (+6% vel. ataque)', 'quick-thinker': 'Pensamento Rápido (+2,5% recarga)',
  courier: 'Mensageiro (sem efeito prático sem peso; inerte)', toughness: 'Resistência (+defesa; elmo 2,5% / peito 5%)',
  authority: 'Autoridade (+duração CC; 5% elmo / 10% peito)', tenacity: 'Tenacidade (+CCR; 10% elmo / 20% peito)',
  'spirit-crush': 'Esmagar Espírito (AA −12% vida máx de mob 3 s; sem efeito PvP)', 'protective-instinct': 'Instinto Protetor (+400% ameaça PvE)',
  aggression: 'Agressão (+dano/cura; 3,5% capuz/bota, 8% túnica)', concentration: 'Concentração (−conjuração; 5% / 10% túnica)',
  efficiency: 'Eficiência (−energia; 6% / 12% túnica)',
};
const HEAD_SKILLS = {
  'mercenary-hood': ['energizing-shield', 'cleanse', 'howl'],
  'soldier-helmet': ['energizing-shield', 'stone-skin', 'block'],
  'scholar-cowl': ['energizing-shield', 'force-field', 'aegis-of-energy'],
};
const CHEST_SKILLS = {
  'mercenary-jacket': ['mend-wounds', 'inferno-shield', 'bloodlust'],
  'soldier-armor': ['mend-wounds', 'taunt', 'fury'],
  'scholar-robe': ['mend-wounds', 'frost-shield', 'speed-caster'],
};
const BOOTS_SKILLS = {
  'mercenary-shoes': ['dodge', 'refreshing-sprint', 'break-free'],
  'soldier-boots': ['dodge', 'rejuvenating-sprint', 'wanderlust'],
  'scholar-sandals': ['dodge', 'energetic-sprint', 'focused-run'],
};
const PASSIVAS_PECA = {
  'mercenary-hood': ['balanced-mind', 'swiftness', 'quick-thinker'],
  'mercenary-jacket': ['balanced-mind', 'swiftness', 'quick-thinker'],
  'mercenary-shoes': ['courier', 'balanced-mind', 'swiftness', 'quick-thinker'],
  'soldier-helmet': ['toughness', 'authority', 'tenacity'],
  'soldier-armor': ['toughness', 'authority', 'tenacity'],
  'soldier-boots': ['courier', 'toughness', 'authority', 'tenacity'],
  'scholar-cowl': ['aggression', 'concentration', 'efficiency'],
  'scholar-robe': ['aggression', 'concentration', 'efficiency'],
  'scholar-sandals': ['courier', 'aggression', 'concentration', 'efficiency'],
};
/* slots válidos (espelho do servidor v1; cliente aceita todos, servidor valida) */
const SLOTS = ['weapon', 'offhand', 'head', 'chest', 'boots', 'cape', 'q', 'w', 'e', 'passivaArma', 'passivaHead', 'passivaChest', 'passivaChest2', 'passivaBoots'];
const DEFAULT_BUILD = {
  weapon: 'battleaxe', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket',
  boots: 'mercenary-shoes', cape: 'caerleon', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit',
  passivaArma: 'deep-cuts', passivaHead: 'balanced-mind', passivaChest: 'balanced-mind',
  passivaBoots: 'balanced-mind',
  headSkill: 'energizing-shield', chestSkill: 'mend-wounds', bootsSkill: 'dodge',
};

/* ---------- ícones próprios (SVG gerado, sem cópia) ---------- */
/* Skills: Machado tem ícones próprios (motivo machado + marca da skill);
   demais skills usam marca geométrica por slot (provisório, funcional). */
const COR_SLOT = { Q: '#e8cf9a', W: '#ffb74d', E: '#e05252', HEAD: '#9fd8ff', CHEST: '#7bc96f', BOOTS: '#d8b24a' };
function iconeSkill(id) {
  const s = SKILLS[id]; if (!s) return '';
  const c = COR_SLOT[s.slot] || '#e8cf9a';
  const base = `<circle cx="16" cy="16" r="12" fill="#241c14" stroke="${c}" stroke-width="2.5"/>`;
  // Machado: motivo machado consistente (cabo + lâmina), marca varia por skill.
  const machadinho = (extra) =>
    `<g stroke-linecap="round"><line x1="12" y1="22" x2="19" y2="9" stroke="#8b5a2b" stroke-width="2.6"/>` +
    `<path d="M19 9 l7 2 -2 6 -5 -2Z" fill="#dfe7ee" stroke="#5a6b7a" stroke-width="1.2"/>${extra || ''}</g>`;
  const MARCAS_MACHADO = {
    'rending-strike': machadinho('<line x1="10" y1="12" x2="24" y2="22" stroke="#fff" stroke-width="1.6"/>'),
    'rending-spin': machadinho('<path d="M8 20 a8 8 0 1 1 3 6" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M11 26 l0 -4 4 1Z" fill="#fff"/>'),
    'rending-rage': machadinho('<line x1="9" y1="11" x2="15" y2="17" stroke="#fff" stroke-width="1.6"/><line x1="13" y1="10" x2="19" y2="16" stroke="#fff" stroke-width="1.6"/><line x1="17" y1="9" x2="23" y2="15" stroke="#fff" stroke-width="1.6"/>'),
    'deadly-chop': machadinho('<line x1="8" y1="9" x2="25" y2="24" stroke="#fff" stroke-width="2.6"/>'),
    'adrenaline-boost': machadinho('<path d="M21 20 l3 -5 3 5" fill="none" stroke="#7be495" stroke-width="2"/>'),
    'battle-rush': machadinho('<path d="M20 19 h7 m-3 -3 l3 3 -3 3" fill="none" stroke="#7cc4ff" stroke-width="1.8"/>'),
    'internal-bleeding': machadinho('<path d="M23 17 c2 3 2 5 0 6 c-2 -1 -2 -3 0 -6Z" fill="#e05252"/>'),
    'raging-blades': `<line x1="10" y1="22" x2="22" y2="10" stroke="#dfe7ee" stroke-width="2.4"/><line x1="22" y1="22" x2="10" y2="10" stroke="#dfe7ee" stroke-width="2.4"/>`,
    // E do Machado (2 usos): machado duplo — mesmo ícone nos 4 lugares (barra, seleção, detalhe, equipado).
    'blood-bandit': `<line x1="16" y1="6" x2="16" y2="26" stroke="#8b5a2b" stroke-width="2.6"/><path d="M16 8 l7 2 -2 6 -5 -2Z" fill="#dfe7ee" stroke="#5a6b7a" stroke-width="1.2"/><path d="M16 8 l-7 2 2 6 5 -2Z" fill="#cfd6dd" stroke="#5a6b7a" stroke-width="1.2"/>`,
  };
  if (MARCAS_MACHADO[id]) return base + MARCAS_MACHADO[id];
  // Provisório funcional p/ demais skills: forma do slot + ponto da arma.
  const FORMAS = {
    Q: '<line x1="10" y1="22" x2="22" y2="10" stroke="#fff" stroke-width="2.4"/>',
    W: '<path d="M16 8 l7 12 h-14Z" fill="none" stroke="#fff" stroke-width="2.2"/>',
    E: '<path d="M16 7 l6 9 -6 9 -6 -9Z" fill="none" stroke="#fff" stroke-width="2.2"/>',
    HEAD: '<path d="M11 9 h10 v6 a5 5 0 0 1 -10 0Z" fill="none" stroke="#fff" stroke-width="2"/>',
    CHEST: '<rect x="11" y="10" width="10" height="12" fill="none" stroke="#fff" stroke-width="2"/>',
    BOOTS: '<path d="M11 21 l5 -8 5 8" fill="none" stroke="#fff" stroke-width="2.2"/>',
  };
  return base + (FORMAS[s.slot] || FORMAS.Q);
}
function icone(id) {
  const arma = ARMAS[id]?.cor, off = { shield: '#8a8f96', tome: '#7a5fc0', torch: '#e08a2b' }[id];
  const cab = HEADS[id]?.cor || CHESTS[id]?.cor || BOOTS[id]?.cor, capa = CAPES[id]?.cor;
  let corpo = '';
  if (arma) {
    const formas = {
      battleaxe: '<rect x="14" y="4" width="4" height="24" fill="#8b5a2b"/><path d="M18 6 L30 10 L26 20 L18 16Z" fill="#cfd6dd" stroke="#5a6b7a"/>',
      dagger: '<rect x="15" y="14" width="3" height="12" fill="#5a3a1b"/><path d="M16 2 L19 14 L14 14Z" fill="#dfe7ee" stroke="#5a6b7a"/>',
      fire: '<rect x="15" y="12" width="3" height="16" fill="#6b4423"/><circle cx="16" cy="8" r="6" fill="#e0642b"/><circle cx="16" cy="8" r="2.5" fill="#ffd54f"/>',
      frost: '<rect x="15" y="12" width="3" height="16" fill="#3a5a6b"/><circle cx="16" cy="8" r="6" fill="#6ec6ff"/><path d="M16 3v10M11 8h10" stroke="#fff"/>',
      holy: '<rect x="15" y="12" width="3" height="16" fill="#6b5a23"/><circle cx="16" cy="8" r="6" fill="none" stroke="#e8cf6a" stroke-width="2.5"/><circle cx="16" cy="8" r="1.6" fill="#fff"/>',
    };
    corpo = formas[id] || '';
  } else if (off) {
    corpo = id === 'shield' ? '<rect x="9" y="6" width="14" height="18" rx="4" fill="#8a8f96" stroke="#3a3f45"/><circle cx="16" cy="15" r="3" fill="#3a3f45"/>'
      : id === 'tome' ? '<rect x="10" y="6" width="13" height="18" rx="1.5" fill="#7a5fc0"/><line x1="13" y1="11" x2="20" y2="11" stroke="#fff"/><line x1="13" y1="15" x2="20" y2="15" stroke="#fff"/>'
      : '<rect x="14" y="14" width="4" height="12" fill="#6b4423"/><circle cx="16" cy="9" r="5" fill="#e08a2b"/><circle cx="16" cy="9" r="2" fill="#ffe082"/>';
  } else if (cab) {
    const ehBota = id.includes('shoe') || id.includes('boot') || id.includes('sandal');
    const ehPeito = id.includes('jacket') || id.includes('armor') || id.includes('robe');
    corpo = ehBota ? '<path d="M8 18 h9 v-6 h6 v8 h-15Z" fill="' + cab + '" stroke="#000"/>'
      : ehPeito ? '<path d="M11 6 h10 l3 5 -3 2 v11 h-10 v-11 l-3 -2Z" fill="' + cab + '" stroke="#000"/>'
      : '<path d="M8 20 a8 9 0 0 1 16 0 l-2 6 h-12Z" fill="' + cab + '" stroke="#000"/>';
  } else if (capa) {
    corpo = '<path d="M10 4 h12 l2 22 -8 -4 -8 4Z" fill="' + capa + '" stroke="#000"/>';
  } else if (SKILLS[id]) {
    corpo = iconeSkill(id);
  } else {
    corpo = '<circle cx="16" cy="16" r="11" fill="#241c14" stroke="#888" stroke-width="2.5"/><text x="16" y="21" font-size="12" text-anchor="middle" fill="#888" font-family="serif">?</text>';
  }
  return '<svg viewBox="0 0 32 32" aria-hidden="true">' + corpo + '</svg>';
}

/* ---------- estado ---------- */
let ws = null, myId = null, mySecret = null, snap = null;
let mira = null; // {slot:'Q'|'W'|'E'|'HEAD'|'CHEST'|'BOOTS', skillId}
let pendentes = []; // fila de skills enviadas; som de sucesso SÓ ao aceite com evidência nova no snapshot
let projeteis = []; // visuais de projétil (L8 §8: machado do E) — SÓ no aceite; {x0,y0,x1,y1,t0,dur}
let zoom = 1.25, toastT = null; // zoom inicial legível (+25%) dentro do limite 0,5–2×
let equipeLocal = Store.get('prpg-equipe') || 'azul';
let flutuantes = []; // grupos {id, tipo:'dano'|'cura', soma, x, y, ate} — L7 §9.2: agrega ~1.5s
const JANELA_NUM = 1500; // dano e cura agrupados por entidade+tipo em janelas de 1,5 s, grupos separados
function numAcum(id, x, y, valor, tipo) {
  const agora = performance.now();
  // Janela FIXA 1,5 s: acumula sem renovar; ao expirar fecha e abre nova.
  // Dano e cura separados por entidade+tipo; sem limiar (pequenos reais contam).
  const g = flutuantes.find((f) => f.id === id && f.tipo === tipo && agora < f.ate);
  if (g) { g.soma += valor; g.x = x; g.y = y; }
  else flutuantes.push({ id, tipo, soma: valor, x, y, ate: agora + JANELA_NUM });
  // Política cap 24: expira primeiro; overflow corta a mais antiga (só sob rajada extrema).
  flutuantes = flutuantes.filter((f) => agora < f.ate);
  if (flutuantes.length > 24) flutuantes.splice(0, flutuantes.length - 24);
}
function numTexto(g) { return (g.tipo === 'cura' ? '+' : g.soma < 0 ? '−' : '') + Math.round(Math.abs(g.soma)); }
function numCor(g) { return g.tipo === 'cura' ? '#7be495' : '#ff6b6b'; }
let prevHp = new Map(), prevEn = new Map();
let prevMon = null, prevDum = null; // PvE: {hp, alive} do monstro / {hp} do boneco
let modoTreino = false;
let hub = null;
let editorRedeAberto = false; // treino em rede com editor aberto (servidor pausa o monstro)
let acabando = null; // {alvo, inicio} p/ detectar interrupção de finish
// shortcut: treino local usa números simplificados (AA/Q/W/E por arma); avisar equivalência parcial no help/toast.

function toast(msg, sonoro) {
  $('toast').textContent = msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => { $('toast').textContent = ''; }, 2800);
  if (sonoro === 'erro') AudioX.erro();
}
function erroTela(msg) {
  const emLobby = !$('tela-lobby').classList.contains('oculto');
  const alvo = emLobby ? $('lobby-erro') : $('menu-erro');
  if (alvo) alvo.textContent = msg;
  toast(msg, 'erro');
}

/* ---------- build: persistência/validação ---------- */
const ID_FIX = { 'adrenaline-charity': 'adrenaline-driven-charity', 'aegis-energy': 'aegis-of-energy' };
function migrarBuild(b) {
  const out = { ...DEFAULT_BUILD, ...b };
  for (const k of ['q', 'w', 'e', 'passivaArma', 'headSkill', 'passivaHead', 'chestSkill', 'passivaChest', 'passivaChest2', 'bootsSkill', 'passivaBoots']) {
    if (typeof out[k] === 'string' && ID_FIX[out[k]]) out[k] = ID_FIX[out[k]];
  }
  // Recuperação: slot fora do catálogo volta ao padrão (não quebra o editor).
  if (!ARMAS[out.weapon]) out.weapon = DEFAULT_BUILD.weapon;
  if (!Q_POR_ARMA[out.weapon].includes(out.q)) out.q = Q_POR_ARMA[out.weapon][0];
  if (!W_POR_ARMA[out.weapon].includes(out.w)) out.w = W_POR_ARMA[out.weapon][0];
  if (!E_POR_ARMA[out.weapon].includes(out.e)) out.e = E_POR_ARMA[out.weapon][0];
  if (!PASSIVAS_ARMA[out.weapon].includes(out.passivaArma)) out.passivaArma = PASSIVAS_ARMA[out.weapon][0];
  if (!OFFHANDS[out.offhand]) out.offhand = DEFAULT_BUILD.offhand;
  if (!HEADS[out.head]) out.head = DEFAULT_BUILD.head;
  if (!HEAD_SKILLS[out.head].includes(out.headSkill)) out.headSkill = HEAD_SKILLS[out.head][0];
  if (!PASSIVAS_PECA[out.head].includes(out.passivaHead)) out.passivaHead = PASSIVAS_PECA[out.head][0];
  if (!CHESTS[out.chest]) out.chest = DEFAULT_BUILD.chest;
  if (!CHEST_SKILLS[out.chest].includes(out.chestSkill)) out.chestSkill = CHEST_SKILLS[out.chest][0];
  if (out.chest === 'soldier-armor') {
    if (!['toughness', 'authority', 'tenacity'].includes(out.passivaChest)) out.passivaChest = 'toughness';
    if (!['spirit-crush', 'protective-instinct'].includes(out.passivaChest2)) out.passivaChest2 = 'spirit-crush';
  } else {
    if (!PASSIVAS_PECA[out.chest].includes(out.passivaChest)) out.passivaChest = PASSIVAS_PECA[out.chest][0];
    delete out.passivaChest2;
  }
  if (!BOOTS[out.boots]) out.boots = DEFAULT_BUILD.boots;
  if (!BOOTS_SKILLS[out.boots].includes(out.bootsSkill)) out.bootsSkill = BOOTS_SKILLS[out.boots][0];
  if (!PASSIVAS_PECA[out.boots].includes(out.passivaBoots)) out.passivaBoots = PASSIVAS_PECA[out.boots][0];
  if (!CAPES[out.cape]) out.cape = DEFAULT_BUILD.cape;
  return out;
}
function lerBuild() {
  try {
    const b = JSON.parse(Store.get('prpg-build', '{}'));
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ...DEFAULT_BUILD };
    return migrarBuild(b);
  } catch { // build corrompida: recupera com o padrão sem quebrar
    try { Store.del('prpg-build'); } catch {}
    return { ...DEFAULT_BUILD };
  }
}
const ARMA_CANON = { battleaxe: 'battleaxe', dagger: 'dagger', fire: 'fire-staff', frost: 'frost-staff', holy: 'holy-staff', 'fire-staff': 'fire-staff', 'frost-staff': 'frost-staff', 'holy-staff': 'holy-staff' };
const CAPA_CANON = { bridgewatch: 'cape-bridgewatch', 'fort-sterling': 'cape-fort-sterling', lymhurst: 'cape-lymhurst', martlock: 'cape-martlock', thetford: 'cape-thetford', caerleon: 'cape-caerleon', 'cape-bridgewatch': 'cape-bridgewatch', 'cape-fort-sterling': 'cape-fort-sterling', 'cape-lymhurst': 'cape-lymhurst', 'cape-martlock': 'cape-martlock', 'cape-thetford': 'cape-thetford', 'cape-caerleon': 'cape-caerleon' };
function buildParaServidor(b) {
  // Build completa (espelha validateBuild do servidor): todas as armas,
  // offhands, peças, capas, Q/W/E, passivas (incl. Soldier 2 passivas) e
  // ativas de armadura; Courier é inerte e segue selecionável.
  return {
    weapon: ARMA_CANON[b.weapon] || b.weapon, q: b.q, w: b.w, e: b.e,
    weaponPassive: b.passivaArma, offhand: b.offhand,
    head: b.head, headActive: b.headSkill, headPassive: b.passivaHead,
    chest: b.chest, chestActive: b.chestSkill, chestPassive: b.passivaChest,
    chestPassive2: b.chest === 'soldier-armor' ? b.passivaChest2 : undefined,
    boots: b.boots, bootsActive: b.bootsSkill, bootsPassive: b.passivaBoots,
    cape: CAPA_CANON[b.cape] || b.cape,
  };
}
/* Build efetiva: snapshot autoritativo quando em jogo em rede; senão local. */
function buildEfetiva() {
  const local = lerBuild();
  if (!modoTreino && snap && myId) {
    const eu = me();
    const sb = eu && eu.build;
    if (sb && typeof sb === 'object') {
      const canonInv = { 'fire-staff': 'fire', 'frost-staff': 'frost', 'holy-staff': 'holy', battleaxe: 'battleaxe', dagger: 'dagger' };
      const out = { ...local };
      if (sb.weapon && ARMAS[canonInv[sb.weapon] || sb.weapon]) out.weapon = canonInv[sb.weapon] || sb.weapon;
      if (sb.q && SKILLS[sb.q]) out.q = sb.q;
      if (sb.w && SKILLS[sb.w]) out.w = sb.w;
      if (sb.e && SKILLS[sb.e]) out.e = sb.e;
      const ha = sb.headActive || sb.hSkill, ca = sb.chestActive || sb.cSkill, ba = sb.bootsActive || sb.bSkill;
      if (ha && SKILLS[ha]) out.headSkill = ha;
      if (ca && SKILLS[ca]) out.chestSkill = ca;
      if (ba && SKILLS[ba]) out.bootsSkill = ba;
      return out;
    }
  }
  if (modoTreino && TR.jogador) return TR.jogador.build;
  return local;
}
function skillIdDoSlot(slot) {
  const b = buildEfetiva();
  if (slot === 'Q') return b.q;
  if (slot === 'W') return b.w;
  if (slot === 'E') return b.e;
  if (slot === 'HEAD') return b.headSkill;
  if (slot === 'CHEST') return b.chestSkill;
  if (slot === 'BOOTS') return b.bootsSkill;
  return null;
}
function cdDoSlot(slot) {
  if (modoTreino) {
    if (!TR.jogador) return 0;
    return (TR.jogador.cd[slot.toLowerCase()] || 0);
  }
  const eu = me();
  if (!eu || !eu.cd) return 0;
  if (slot === 'Q') return eu.cd.q || 0;
  if (slot === 'W') return eu.cd.w || 0;
  if (slot === 'E') return eu.cd.e || 0;
  if (slot === 'HEAD') return eu.cd.head || 0;
  if (slot === 'CHEST') return eu.cd.chest || 0;
  if (slot === 'BOOTS') return eu.cd.boots || 0;
  return 0;
}
function energiaAtual() {
  if (modoTreino) return TR.jogador ? TR.jogador.energy : 0;
  const eu = me();
  return eu ? (eu.energy ?? eu.en ?? 0) : 0;
}
function validarBuild(b) {
  const problemas = [];
  if (!ARMAS[b.weapon]) problemas.push('Arma inválida.');
  if (!OFFHANDS[b.offhand]) problemas.push('Mão secundária inválida.');
  if (!HEADS[b.head]) problemas.push('Cabeça inválida.');
  if (!CHESTS[b.chest]) problemas.push('Corpo inválido.');
  if (!BOOTS[b.boots]) problemas.push('Pés inválidos.');
  if (!CAPES[b.cape]) problemas.push('Capa inválida.');
  if (!Q_POR_ARMA[b.weapon]?.includes(b.q)) problemas.push('Q não pertence a esta arma.');
  if (!W_POR_ARMA[b.weapon]?.includes(b.w)) problemas.push('W não pertence a esta arma.');
  if (!E_POR_ARMA[b.weapon]?.includes(b.e)) problemas.push('E não pertence a esta arma.');
  if (!PASSIVAS_ARMA[b.weapon]?.includes(b.passivaArma)) problemas.push('Passiva da arma inválida.');
  if (!HEAD_SKILLS[b.head]?.includes(b.headSkill)) problemas.push('Ativa da cabeça inválida.');
  if (!PASSIVAS_PECA[b.head]?.includes(b.passivaHead)) problemas.push('Passiva da cabeça inválida.');
  if (!CHEST_SKILLS[b.chest]?.includes(b.chestSkill)) problemas.push('Ativa do corpo inválida.');
  if (!BOOTS_SKILLS[b.boots]?.includes(b.bootsSkill)) problemas.push('Ativa dos pés inválida.');
  if (!PASSIVAS_PECA[b.boots]?.includes(b.passivaBoots)) problemas.push('Passiva dos pés inválida.');
  if (b.chest === 'soldier-armor') {
    if (!['toughness', 'authority', 'tenacity'].includes(b.passivaChest)) problemas.push('1ª passiva do peito (Soldado) inválida.');
    if (!['spirit-crush', 'protective-instinct'].includes(b.passivaChest2)) problemas.push('2ª passiva do peito (Soldado) inválida.');
    if (b.passivaChest === b.passivaChest2) problemas.push('Passivas do peito devem diferir em grupo.');
  } else {
    if (!PASSIVAS_PECA[b.chest]?.includes(b.passivaChest)) problemas.push('Passiva do corpo inválida.');
    if (b.passivaChest2 != null) problemas.push('2ª passiva só existe na Soldier Armor.');
  }
  return { ok: problemas.length === 0, problemas };
}
function salvarBuild(b) { Store.set('prpg-build', JSON.stringify(b)); }

/* ---------- editor de build ---------- */
function selOpcoes(el, opcoes, atual, nomeFn) {
  el.innerHTML = '';
  for (const id of opcoes) {
    const o = document.createElement('option');
    o.value = id; o.textContent = nomeFn(id);
    if (id === atual) o.selected = true;
    el.appendChild(o);
  }
}
function nomeSkill(id) { const s = SKILLS[id]; return s ? `${s.nome} (${s.en})` : id; }
/* ---------- editor de build: 3 regiões (§3) ---------- */
let buildEdit = null, buildSlotSel = 'weapon';
// Estrutura p/ futura arma de 2 mãos bloquear a mão secundária (sem 2H nesta versão).
const ARMAS_2_MAOS = {}; // ex.: {'futuro-2h': true}
const ESPACOS = [
  { id: 'weapon', nome: 'Arma principal' },
  { id: 'offhand', nome: 'Mão secundária' },
  { id: 'head', nome: 'Cabeça' },
  { id: 'chest', nome: 'Armadura' },
  { id: 'boots', nome: 'Botas' },
  { id: 'cape', nome: 'Capa' },
];
const ITENS_ESPACO = () => ({
  weapon: Object.keys(ARMAS), offhand: Object.keys(OFFHANDS), head: Object.keys(HEADS),
  chest: Object.keys(CHESTS), boots: Object.keys(BOOTS), cape: Object.keys(CAPES),
});
const NOME_ITEM = {
  weapon: (id) => `${ARMAS[id].nome} · ${ARMAS[id].en}`,
  offhand: (id) => OFFHANDS[id].nome, head: (id) => HEADS[id].nome,
  chest: (id) => CHESTS[id].nome, boots: (id) => BOOTS[id].nome, cape: (id) => CAPES[id].nome,
};
const CHAVE_ESPACO = { weapon: 'weapon', offhand: 'offhand', head: 'head', chest: 'chest', boots: 'boots', cape: 'cape' };
function abrirBuild() {
  buildEdit = lerBuild();
  buildSlotSel = 'weapon';
  $('modal-build').classList.remove('oculto');
  AudioX.ui();
  renderBuildForm();
}
function renderBuildForm() {
  const b = buildEdit;
  // ESQUERDA: espaços
  const esq = $('build-esq'); esq.innerHTML = '<h4>Espaços</h4>';
  for (const e of ESPACOS) {
    const btn = document.createElement('button');
    btn.className = 'espaco' + (buildSlotSel === e.id ? ' sel' : '');
    btn.innerHTML = `<span class="icone">${icone(b[CHAVE_ESPACO[e.id]])}</span><span>${e.nome}</span><small>${esc(NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]]))}</small>`;
    btn.onclick = () => { buildSlotSel = e.id; AudioX.ui(); renderBuildForm(); };
    esq.appendChild(btn);
  }
  // CENTRO: itens do espaço + opções do item equipado
  const ct = $('build-centro'); ct.innerHTML = '';
  const esp = ESPACOS.find((e) => e.id === buildSlotSel) || ESPACOS[0];
  const h = document.createElement('h4'); h.textContent = esp.nome; ct.appendChild(h);
  const grade = document.createElement('div'); grade.className = 'build-itens'; ct.appendChild(grade);
  const bloqueado2M = esp.id === 'offhand' && ARMAS_2_MAOS[b.weapon];
  for (const id of ITENS_ESPACO()[esp.id]) {
    const card = document.createElement('button');
    card.className = 'item' + (b[CHAVE_ESPACO[esp.id]] === id ? ' sel' : '') + (bloqueado2M ? ' bloqueado' : '');
    card.innerHTML = `<span class="icone">${icone(id)}</span><span>${esc(NOME_ITEM[esp.id](id))}</span>`;
    card.title = NOME_ITEM[esp.id](id);
    card.onclick = () => {
      if (esp.id === 'offhand' && ARMAS_2_MAOS[b.weapon]) { toast('Arma de duas mãos bloqueia a mão secundária.', 'erro'); return; }
      b[CHAVE_ESPACO[esp.id]] = id;
      if (esp.id === 'weapon') {
        if (!Q_POR_ARMA[b.weapon].includes(b.q)) b.q = Q_POR_ARMA[b.weapon][0];
        if (!W_POR_ARMA[b.weapon].includes(b.w)) b.w = W_POR_ARMA[b.weapon][0];
        if (!E_POR_ARMA[b.weapon].includes(b.e)) b.e = E_POR_ARMA[b.weapon][0];
        if (!PASSIVAS_ARMA[b.weapon].includes(b.passivaArma)) b.passivaArma = PASSIVAS_ARMA[b.weapon][0];
      }
      if (esp.id === 'chest') {
        if (b.chest === 'soldier-armor') {
          if (!['toughness', 'authority', 'tenacity'].includes(b.passivaChest)) b.passivaChest = 'toughness';
          if (!['spirit-crush', 'protective-instinct'].includes(b.passivaChest2)) b.passivaChest2 = 'spirit-crush';
        } else delete b.passivaChest2;
        if (!CHEST_SKILLS[b.chest].includes(b.chestSkill)) b.chestSkill = CHEST_SKILLS[b.chest][0];
        if (!PASSIVAS_PECA[b.chest].includes(b.passivaChest)) b.passivaChest = PASSIVAS_PECA[b.chest][0];
      }
      AudioX.ui(); renderBuildForm();
    };
    grade.appendChild(card);
  }
  // opções (Q/W/E/passivas) do item equipado no espaço
  const opc = document.createElement('div'); opc.className = 'build-opcoes'; ct.appendChild(opc);
  const mkSel = (titulo, chave, opcoes, nomeFn) => {
    const lb = document.createElement('label'); lb.textContent = titulo;
    const s = document.createElement('select'); s.dataset.chave = chave;
    selOpcoes(s, opcoes, b[chave], nomeFn);
    const prev = document.createElement('span'); prev.className = 'icone'; prev.innerHTML = icone(b[chave]);
    s.onchange = () => { b[chave] = s.value; AudioX.ui(); renderBuildForm(); };
    opc.appendChild(lb);
    const wrap = document.createElement('span'); wrap.className = 'sel-icone';
    wrap.appendChild(prev); wrap.appendChild(s);
    opc.appendChild(wrap);
  };
  if (esp.id === 'weapon') {
    mkSel('Q', 'q', Q_POR_ARMA[b.weapon], nomeSkill);
    mkSel('W', 'w', W_POR_ARMA[b.weapon], nomeSkill);
    mkSel('E', 'e', E_POR_ARMA[b.weapon], nomeSkill);
    mkSel('Passiva da arma', 'passivaArma', PASSIVAS_ARMA[b.weapon], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'head') {
    mkSel('Ativa', 'headSkill', HEAD_SKILLS[b.head], nomeSkill);
    mkSel('Passiva', 'passivaHead', PASSIVAS_PECA[b.head], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'chest') {
    mkSel('Ativa', 'chestSkill', CHEST_SKILLS[b.chest], nomeSkill);
    mkSel('Passiva 1', 'passivaChest', b.chest === 'soldier-armor' ? ['toughness', 'authority', 'tenacity'] : PASSIVAS_PECA[b.chest], (id) => NOMES_PASSIVA[id] || id);
    if (b.chest === 'soldier-armor') mkSel('Passiva 2 (Soldado)', 'passivaChest2', ['spirit-crush', 'protective-instinct'], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'boots') {
    mkSel('Ativa', 'bootsSkill', BOOTS_SKILLS[b.boots], nomeSkill);
    mkSel('Passiva', 'passivaBoots', PASSIVAS_PECA[b.boots], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'offhand') {
    const p = document.createElement('p'); p.className = 'nota';
    p.textContent = b.offhand === 'torch' ? 'Tocha: sem ativa/passiva; bônus já aplicado nos atributos.' : 'Mão secundária: sem ativa/passiva selecionável; bônus já aplicado nos atributos.';
    opc.appendChild(p);
  } else if (esp.id === 'cape') {
    const p = document.createElement('p'); p.className = 'nota';
    p.textContent = 'Capa ' + CAPES[b.cape].nome + ': ' + CAPES[b.cape].desc;
    opc.appendChild(p);
  }
  // DIREITA: boneco + equipado
  desenharBonecoBuild(b);
  const eq = $('build-equipado'); eq.innerHTML = '<h4>Equipado</h4>';
  for (const e of ESPACOS) {
    const d = document.createElement('button'); d.type = 'button';
    d.className = 'eq-linha' + (buildSlotSel === e.id ? ' sel' : '');
    d.setAttribute('aria-label', `${e.nome}: ${NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]])}`);
    d.innerHTML = `<span class="icone">${icone(b[CHAVE_ESPACO[e.id]])}</span><span>${e.nome}<br><small>${esc(NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]]))}</small></span>`;
    d.onclick = () => { buildSlotSel = e.id; AudioX.ui(); renderBuildForm(); };
    eq.appendChild(d);
  }
  // skills equipadas (Q/W/E + ativas de armadura) com ícones — 4º lugar dos ícones
  const eqSkills = [['Q', b.q], ['W', b.w], ['E', b.e], ['4', b.headSkill], ['5', b.chestSkill], ['6', b.bootsSkill]];
  for (const [tecla, sid] of eqSkills) {
    const sk = SKILLS[sid]; if (!sk) continue;
    const d = document.createElement('div'); d.className = 'eq-linha eq-skill';
    d.innerHTML = `<span class="icone">${icone(sid)}</span><span>${tecla} · ${esc(sk.nome)}<br><small>${sk.alcance} m · ${sk.custo} en · CD ${sk.cd} s</small></span>`;
    eq.appendChild(d);
  }
  // detalhe: item do centro + Q/W/E equipados com dano/cura/alcance/custo/CD
  const detIds = [b.q, b.w, b.e, b.headSkill, b.chestSkill, b.bootsSkill];
  const det = detIds.map((id) => {
    const s = SKILLS[id]; if (!s) return '';
    return `<p><span class="icone det-icone">${icone(id)}</span><b>${s.slot} · ${s.nome}</b> <span class="etiqueta">${s.alvo}</span><br>${s.texto}<br>` +
      `<span class="nota">Alcance ${s.alcance} m · Custo ${s.custo} en · CD ${s.cd} s</span></p>`;
  }).join('');
  const v = validarBuild(b);
  $('build-detalhe').innerHTML = det +
    `<p><b>Atributos do kit (T8):</b> base 1200 vida / 120 energia + bônus das peças. ` +
    `Machado +95 vida; capuz +269/+98; jaqueta +539/+49; botas +269/+29. ` +
    `Passivas: ${(NOMES_PASSIVA[b.passivaArma] || '')} · ${(NOMES_PASSIVA[b.passivaHead] || '')} · ${(NOMES_PASSIVA[b.passivaChest] || '')}` +
    (b.chest === 'soldier-armor' ? ` · ${(NOMES_PASSIVA[b.passivaChest2] || '')}` : '') + `.</p>` +
    `<p class="nota">Capa ${CAPES[b.cape].nome}: ${CAPES[b.cape].desc}</p>`;
  $('build-erro').textContent = v.ok ? '' : '⚠ ' + v.problemas.join(' ');
  $('build-aviso-servidor').textContent = v.ok
    ? '✓ Build completa válida para o servidor (todas as armas/peças/capas; Courier é inerte).'
    : '⚠ Ajuste os campos marcados: o servidor valida a build completa.';
}
/* ---------- build principal inline no lobby (3 áreas, sem modal obrigatório) ---------- */
/* Mesmos dados e regras do modal (lerBuild/salvarBuild/validarBuild/buildParaServidor);
   o modal segue reutilizável no treino. Persistência imediata + envio ao servidor no lobby. */
let lobbySlotSel = 'weapon';
function garantirBuildEdit() { if (!buildEdit) buildEdit = lerBuild(); }
function aplicarMudancaBuild() {
  const v = validarBuild(buildEdit);
  salvarBuild(buildEdit); // localStorage = fonte do próximo join (criar/entrar)
  if (v.ok && ws && ws.readyState === 1 && snap && snap.state === 'lobby') {
    ws.send(JSON.stringify({ type: 'build', build: buildParaServidor(buildEdit) })); // servidor valida; trocar build limpa o pronto (§6)
  }
  renderLobbyBuild();
  renderMenuBuild();
  if (!$('modal-build').classList.contains('oculto')) renderBuildForm();
}
function renderLobbyBuild() {
  if (!$('lbuild-esq') || $('tela-lobby').classList.contains('oculto')) return;
  try {
    const foco = document.activeElement;
    if (foco && $('lobby-build-inline') && $('lobby-build-inline').contains(foco)) return; // não rouba o foco durante o uso
  } catch {}
  garantirBuildEdit();
  const b = buildEdit;
  const esq = $('lbuild-esq'); esq.innerHTML = '<h4>Espaços</h4>';
  for (const e of ESPACOS) {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'espaco' + (lobbySlotSel === e.id ? ' sel' : '');
    btn.innerHTML = `<span class="icone">${icone(b[CHAVE_ESPACO[e.id]])}</span><span>${e.nome}</span><small>${esc(NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]]))}</small>`;
    btn.onclick = () => { lobbySlotSel = e.id; AudioX.ui(); renderLobbyBuild(); };
    esq.appendChild(btn);
  }
  const ct = $('lbuild-centro'); ct.innerHTML = '';
  const esp = ESPACOS.find((e) => e.id === lobbySlotSel) || ESPACOS[0];
  const h = document.createElement('h4'); h.textContent = esp.nome; ct.appendChild(h);
  const grade = document.createElement('div'); grade.className = 'build-itens'; ct.appendChild(grade);
  for (const id of ITENS_ESPACO()[esp.id]) {
    const card = document.createElement('button'); card.type = 'button';
    card.className = 'item' + (b[CHAVE_ESPACO[esp.id]] === id ? ' sel' : '');
    card.innerHTML = `<span class="icone">${icone(id)}</span><span>${esc(NOME_ITEM[esp.id](id))}</span>`;
    card.title = NOME_ITEM[esp.id](id);
    card.onclick = () => {
      b[CHAVE_ESPACO[esp.id]] = id;
      if (esp.id === 'weapon') {
        if (!Q_POR_ARMA[b.weapon].includes(b.q)) b.q = Q_POR_ARMA[b.weapon][0];
        if (!W_POR_ARMA[b.weapon].includes(b.w)) b.w = W_POR_ARMA[b.weapon][0];
        if (!E_POR_ARMA[b.weapon].includes(b.e)) b.e = E_POR_ARMA[b.weapon][0];
        if (!PASSIVAS_ARMA[b.weapon].includes(b.passivaArma)) b.passivaArma = PASSIVAS_ARMA[b.weapon][0];
      }
      if (esp.id === 'chest') {
        if (b.chest === 'soldier-armor') {
          if (!['toughness', 'authority', 'tenacity'].includes(b.passivaChest)) b.passivaChest = 'toughness';
          if (!['spirit-crush', 'protective-instinct'].includes(b.passivaChest2)) b.passivaChest2 = 'spirit-crush';
        } else delete b.passivaChest2;
        if (!CHEST_SKILLS[b.chest].includes(b.chestSkill)) b.chestSkill = CHEST_SKILLS[b.chest][0];
        if (!PASSIVAS_PECA[b.chest].includes(b.passivaChest)) b.passivaChest = PASSIVAS_PECA[b.chest][0];
      }
      AudioX.ui(); aplicarMudancaBuild();
    };
    grade.appendChild(card);
  }
  const opc = document.createElement('div'); opc.className = 'build-opcoes'; ct.appendChild(opc);
  const mkSelL = (titulo, chave, opcoes, nomeFn) => {
    const lb = document.createElement('label'); lb.textContent = titulo;
    const s = document.createElement('select'); s.dataset.chave = chave;
    selOpcoes(s, opcoes, b[chave], nomeFn);
    const prev = document.createElement('span'); prev.className = 'icone'; prev.innerHTML = icone(b[chave]);
    s.onchange = () => { b[chave] = s.value; AudioX.ui(); aplicarMudancaBuild(); };
    opc.appendChild(lb);
    const wrap = document.createElement('span'); wrap.className = 'sel-icone';
    wrap.appendChild(prev); wrap.appendChild(s);
    opc.appendChild(wrap);
  };
  if (esp.id === 'weapon') {
    mkSelL('Q', 'q', Q_POR_ARMA[b.weapon], nomeSkill);
    mkSelL('W', 'w', W_POR_ARMA[b.weapon], nomeSkill);
    mkSelL('E', 'e', E_POR_ARMA[b.weapon], nomeSkill);
    mkSelL('Passiva da arma', 'passivaArma', PASSIVAS_ARMA[b.weapon], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'head') {
    mkSelL('Ativa', 'headSkill', HEAD_SKILLS[b.head], nomeSkill);
    mkSelL('Passiva', 'passivaHead', PASSIVAS_PECA[b.head], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'chest') {
    mkSelL('Ativa', 'chestSkill', CHEST_SKILLS[b.chest], nomeSkill);
    mkSelL('Passiva 1', 'passivaChest', b.chest === 'soldier-armor' ? ['toughness', 'authority', 'tenacity'] : PASSIVAS_PECA[b.chest], (id) => NOMES_PASSIVA[id] || id);
    if (b.chest === 'soldier-armor') mkSelL('Passiva 2 (Soldado)', 'passivaChest2', ['spirit-crush', 'protective-instinct'], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'boots') {
    mkSelL('Ativa', 'bootsSkill', BOOTS_SKILLS[b.boots], nomeSkill);
    mkSelL('Passiva', 'passivaBoots', PASSIVAS_PECA[b.boots], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'offhand') {
    const p = document.createElement('p'); p.className = 'nota';
    p.textContent = 'Mão secundária: sem ativa/passiva selecionável; bônus já aplicado nos atributos.';
    opc.appendChild(p);
  } else if (esp.id === 'cape') {
    const p = document.createElement('p'); p.className = 'nota';
    p.textContent = 'Capa ' + CAPES[b.cape].nome + ': ' + CAPES[b.cape].desc;
    opc.appendChild(p);
  }
  desenharBonecoBuild(b, 'lobby-boneco');
  const eq = $('lbuild-equipado'); eq.innerHTML = '<h4>Equipado</h4>';
  for (const e of ESPACOS) {
    const d = document.createElement('button'); d.type = 'button';
    d.className = 'eq-linha' + (lobbySlotSel === e.id ? ' sel' : '');
    d.setAttribute('aria-label', `${e.nome}: ${NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]])}`);
    d.innerHTML = `<span class="icone">${icone(b[CHAVE_ESPACO[e.id]])}</span><span>${e.nome}<br><small>${esc(NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]]))}</small></span>`;
    d.onclick = () => { lobbySlotSel = e.id; AudioX.ui(); renderLobbyBuild(); };
    eq.appendChild(d);
  }
  const detIds = [b.q, b.w, b.e, b.headSkill, b.chestSkill, b.bootsSkill];
  $('lobby-build-detalhe').innerHTML = detIds.map((id) => {
    const s = SKILLS[id]; if (!s) return '';
    return `<p><span class="icone det-icone">${icone(id)}</span><b>${s.slot} · ${s.nome}</b> <span class="etiqueta">${s.alvo}</span><br>${s.texto}<br>` +
      `<span class="nota">Alcance ${s.alcance} m · Custo ${s.custo} en · CD ${s.cd} s</span></p>`;
  }).join('');
  const v = validarBuild(b);
  $('lobby-build-erro').textContent = v.ok ? '' : '⚠ ' + v.problemas.join(' ');
}
/* Build inicial no menu (mesmos dados do lobby/modal: lerBuild/salvar/validar).
   3 áreas: esq controles+áudio+6 slots · centro grade+skills/passivas · dir boneco+equipado. */
function renderMenuBuild() {
  if (!$('mbuild-esq') || $('tela-menu').classList.contains('oculto')) return;
  try {
    const foco = document.activeElement;
    if (foco && $('mbuild-centro') && $('mbuild-centro').contains(foco)) return;
  } catch {}
  garantirBuildEdit();
  const b = buildEdit;
  syncMenuAudio();
  const espBox = $('mbuild-espacos');
  if (espBox) {
    espBox.innerHTML = '<h4>Espaços</h4>';
    for (const e of ESPACOS) {
      const btn = document.createElement('button'); btn.type = 'button';
      btn.className = 'espaco' + (lobbySlotSel === e.id ? ' sel' : '');
      btn.innerHTML = `<span class="icone">${icone(b[CHAVE_ESPACO[e.id]])}</span><span>${e.nome}</span><small>${esc(NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]]))}</small>`;
      btn.onclick = () => { lobbySlotSel = e.id; AudioX.ui(); renderMenuBuild(); };
      espBox.appendChild(btn);
    }
  }
  const ct = $('mbuild-centro'); ct.innerHTML = '';
  const esp = ESPACOS.find((e) => e.id === lobbySlotSel) || ESPACOS[0];
  const h = document.createElement('h4'); h.textContent = esp.nome + ' · skills/passivas'; ct.appendChild(h);
  const grade = document.createElement('div'); grade.className = 'build-itens'; ct.appendChild(grade);
  for (const id of ITENS_ESPACO()[esp.id]) {
    const card = document.createElement('button'); card.type = 'button';
    card.className = 'item' + (b[CHAVE_ESPACO[esp.id]] === id ? ' sel' : '');
    card.innerHTML = `<span class="icone">${icone(id)}</span><span>${esc(NOME_ITEM[esp.id](id))}</span>`;
    card.title = NOME_ITEM[esp.id](id);
    card.onclick = () => {
      b[CHAVE_ESPACO[esp.id]] = id;
      if (esp.id === 'weapon') {
        if (!Q_POR_ARMA[b.weapon].includes(b.q)) b.q = Q_POR_ARMA[b.weapon][0];
        if (!W_POR_ARMA[b.weapon].includes(b.w)) b.w = W_POR_ARMA[b.weapon][0];
        if (!E_POR_ARMA[b.weapon].includes(b.e)) b.e = E_POR_ARMA[b.weapon][0];
        if (!PASSIVAS_ARMA[b.weapon].includes(b.passivaArma)) b.passivaArma = PASSIVAS_ARMA[b.weapon][0];
      }
      if (esp.id === 'chest') {
        if (b.chest === 'soldier-armor') {
          if (!['toughness', 'authority', 'tenacity'].includes(b.passivaChest)) b.passivaChest = 'toughness';
          if (!['spirit-crush', 'protective-instinct'].includes(b.passivaChest2)) b.passivaChest2 = 'spirit-crush';
        } else delete b.passivaChest2;
        if (!CHEST_SKILLS[b.chest].includes(b.chestSkill)) b.chestSkill = CHEST_SKILLS[b.chest][0];
        if (!PASSIVAS_PECA[b.chest].includes(b.passivaChest)) b.passivaChest = PASSIVAS_PECA[b.chest][0];
      }
      AudioX.ui(); aplicarMudancaBuild();
    };
    grade.appendChild(card);
  }
  const opc = document.createElement('div'); opc.className = 'build-opcoes'; ct.appendChild(opc);
  const mkSelM = (titulo, chave, opcoes, nomeFn) => {
    const lb = document.createElement('label'); lb.textContent = titulo;
    const s = document.createElement('select'); s.dataset.chave = chave;
    selOpcoes(s, opcoes, b[chave], nomeFn);
    const prev = document.createElement('span'); prev.className = 'icone'; prev.innerHTML = icone(b[chave]);
    s.onchange = () => { b[chave] = s.value; AudioX.ui(); aplicarMudancaBuild(); };
    opc.appendChild(lb);
    const wrap = document.createElement('span'); wrap.className = 'sel-icone';
    wrap.appendChild(prev); wrap.appendChild(s);
    opc.appendChild(wrap);
  };
  if (esp.id === 'weapon') {
    mkSelM('Q', 'q', Q_POR_ARMA[b.weapon], nomeSkill);
    mkSelM('W', 'w', W_POR_ARMA[b.weapon], nomeSkill);
    mkSelM('E', 'e', E_POR_ARMA[b.weapon], nomeSkill);
    mkSelM('Passiva da arma', 'passivaArma', PASSIVAS_ARMA[b.weapon], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'head') {
    mkSelM('Ativa', 'headSkill', HEAD_SKILLS[b.head], nomeSkill);
    mkSelM('Passiva', 'passivaHead', PASSIVAS_PECA[b.head], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'chest') {
    mkSelM('Ativa', 'chestSkill', CHEST_SKILLS[b.chest], nomeSkill);
    mkSelM('Passiva 1', 'passivaChest', b.chest === 'soldier-armor' ? ['toughness', 'authority', 'tenacity'] : PASSIVAS_PECA[b.chest], (id) => NOMES_PASSIVA[id] || id);
    if (b.chest === 'soldier-armor') mkSelM('Passiva 2 (Soldado)', 'passivaChest2', ['spirit-crush', 'protective-instinct'], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'boots') {
    mkSelM('Ativa', 'bootsSkill', BOOTS_SKILLS[b.boots], nomeSkill);
    mkSelM('Passiva', 'passivaBoots', PASSIVAS_PECA[b.boots], (id) => NOMES_PASSIVA[id] || id);
  } else if (esp.id === 'offhand') {
    const p = document.createElement('p'); p.className = 'nota';
    p.textContent = 'Mão secundária: sem ativa/passiva selecionável; bônus já aplicado nos atributos.';
    opc.appendChild(p);
  } else if (esp.id === 'cape') {
    const p = document.createElement('p'); p.className = 'nota';
    p.textContent = 'Capa ' + CAPES[b.cape].nome + ': ' + CAPES[b.cape].desc;
    opc.appendChild(p);
  }
  desenharBonecoBuild(b, 'menu-boneco');
  const eq = $('mbuild-equipado'); eq.innerHTML = '<h4>Equipado (6 slots — clique troca o centro)</h4>';
  for (const e of ESPACOS) {
    const d = document.createElement('button'); d.type = 'button';
    d.className = 'eq-linha' + (lobbySlotSel === e.id ? ' sel' : '');
    d.setAttribute('aria-label', `${e.nome}: ${NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]])}`);
    d.innerHTML = `<span class="icone">${icone(b[CHAVE_ESPACO[e.id]])}</span><span>${e.nome}<br><small>${esc(NOME_ITEM[e.id](b[CHAVE_ESPACO[e.id]]))}</small></span>`;
    d.onclick = () => { lobbySlotSel = e.id; AudioX.ui(); renderMenuBuild(); };
    eq.appendChild(d);
  }
  const detIds = [b.q, b.w, b.e, b.headSkill, b.chestSkill, b.bootsSkill];
  $('menu-build-detalhe').innerHTML = detIds.map((id) => {
    const s = SKILLS[id]; if (!s) return '';
    return `<p><span class="icone det-icone">${icone(id)}</span><b>${s.slot} · ${s.nome}</b> <span class="etiqueta">${s.alvo}</span><br>${s.texto}<br>` +
      `<span class="nota">Alcance ${s.alcance} m · Custo ${s.custo} en · CD ${s.cd} s</span></p>`;
  }).join('');
  const v = validarBuild(b);
  $('menu-build-erro').textContent = v.ok ? '' : '⚠ ' + v.problemas.join(' ');
}
function syncMenuAudio() {
  try {
    const c = $('chk-som-menu'), r = $('rng-vol-menu');
    if (c) c.checked = AudioX.ativo;
    if (r) r.value = Math.round(AudioX.vol * 100);
  } catch {}
}
function desenharBonecoBuild(b, idCanvas) {
  const cv = $(idCanvas || 'build-boneco'); if (!cv) return;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#171208'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#0008';
  c.beginPath(); c.ellipse(110, 200, 46, 14, 0, 0, 7); c.fill();
  const antes = (typeof zoom !== 'undefined') ? zoom : 1;
  try {
    if (typeof desenharCorpo === 'function') {
      desenharCorpo(c, 110, 198, 13 * 1.4, { id: 'preview', x: 0, y: 0, hp: 1, maxHp: 1, alive: true, build: b }, '#58c96b');
    }
  } finally { /* zoom global intacto (só leitura) */ }
  void antes;
}

/* ---------- Hub (?hub=1&room=&name=&create=&expect=&slot=&hubUrl=&htok=) ---------- */
function parseHub() {
  const q = new URLSearchParams(location.search);
  if (q.get('hub') !== '1') return null;
  const h = {
    room: (q.get('room') || '').trim().toUpperCase(),
    name: (q.get('name') || '').trim(),
    create: /^(1|true|sim|yes)$/i.test(q.get('create') || ''),
    expect: q.get('expect') || '', slot: q.get('slot') || '', htok: q.get('htok') || '',
    hubUrl: (q.get('hubUrl') || '').trim(),
  };
  h.erros = [];
  if (!h.name) h.erros.push('Nome ausente (?name=). Preencha o apelido.');
  else if (h.name.length > 20) h.erros.push('Nome com mais de 20 caracteres.');
  // O Hub sempre supre ?room= (código da reserva); o jogo nunca gera outro
  // em silêncio — sem código válido, erro honesto em vez de sala própria.
  if (!/^[A-Z0-9]{4}$/.test(h.room)) h.erros.push('Sala inválida (?room= com 4 letras/números).');
  if (h.hubUrl) {
    try {
      const u = new URL(h.hubUrl);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocolo');
      h.hubUrlOk = u.toString();
    } catch { h.erros.push('hubUrl inválida (use http(s) completa).'); }
  }
  return h;
}
function wsURL() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + location.host; // sem localhost hardcoded
}

/* ---------- rede ---------- */
let treinoRedePendente = false; // PvE em rede tentado; sem servidor cai no local
function conectar(cbAberto, opts = {}) {
  if (ws && ws.readyState === 1) { cbAberto && cbAberto(); return; }
  ws = new WebSocket(wsURL());
  ws.onopen = () => { cbAberto && cbAberto(); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'joined') {
      treinoRedePendente = false;
      myId = m.id; mySecret = m.secret;
      try { sessionStorage.setItem('prpg-secret', mySecret); } catch {}
      $('tela-menu').classList.add('oculto');
      $('tela-jogo').classList.add('oculto');
      $('tela-lobby').classList.remove('oculto');
      $('lobby-codigo').textContent = m.code;
      toast(m.reconnected ? 'Reconectado! Bom retorno.' : 'Entrou na sala ' + m.code + '.');
      AudioX.ui();
    } else if (m.type === 'state') {
      snap = m.snap;
      try { snap._rx = performance.now(); } catch {} // base p/ progresso cast/chan (L3 §7)
      detectarDeltas(snap);
      render(snap);
    } else if (m.type === 'ack') {
      consumirAck(m); // ack por comando (aceito/recusado); pendentes consomem em FIFO
    } else if (m.type === 'event') {
      consumirEvento(m); // broadcast (A e B veem); sons seguem eventos
    } else if (m.type === 'error') {
      // Recusa do servidor (vale p/ 2º E, interrupção, sem-acerto e erro): descarta o
      // envio mais recente sem FX de sucesso; só o aviso de erro.
      if (pendentes.length && Date.now() - pendentes[pendentes.length - 1].t < 3000) pendentes.pop();
      // Colisão Hub (outra partida com o código): erro honesto, sem join cego nem nova sala.
      const msg = (hub && /CODE_TAKEN/.test(m.msg || ''))
        ? 'Sala ocupada por outra partida (CODE_TAKEN). Volte ao Hub e tente de novo.'
        : m.msg;
      erroTela(msg); AudioX.erro();
    } else if (m.type === 'left') {
      toast('Você saiu da sala.');
      location.search.includes('hub=1') ? mostrarMenu() : location.reload();
    }
  };
  ws.onclose = () => {
    if (treinoRedePendente) {
      treinoRedePendente = false;
      toast('Servidor inalcançável — treino local, números simplificados (fallback offline).', 'erro');
      iniciarTreino();
      return;
    }
    if (!modoTreino) toast('Conexão perdida. Recarregue para reconectar.');
  };
  ws.onerror = () => {
    if (treinoRedePendente) return; // onclose faz o fallback local com aviso
    erroTela('Falha de conexão com o servidor.');
  };
}
function entrarSala(nick, code, opts = {}) {
  modoTreino = false;
  $('painel-treino').classList.add('oculto');
  conectar(() => {
    const b = lerBuild();
    let secret = null; try { secret = sessionStorage.getItem('prpg-secret') || undefined; } catch {}
    const msg = {
      type: 'join', nick, room: code, build: buildParaServidor(b), secret,
      team: opts.team !== undefined ? opts.team : (equipeLocal === 'vermelha' ? 1 : 0),
    };
    if (opts.mode) msg.mode = opts.mode; // ex.: 'pve' no treino em rede
    if (opts.htok) msg.htok = opts.htok; // Hub: dono da reserva (CODE_TAKEN se divergir)
    ws.send(JSON.stringify(msg));
  });
}

/* ---------- ack/event do servidor (por comando; broadcast p/ sala) ---------- */
let lastAck = null, lastEvent = null; // leitura p/ E2E (como cada cliente recebeu)
let ackLog = []; // últimas acks p/ E2E (rajadas); cap 20
function voarMachado(pd, eu) {
  // L8 §8: projétil do E (machado) — visual 350 ms do jogador ao ponto mirado, SÓ no aceite do 1º uso
  if (!(pd.slot === 'E' && pd.skillId === 'blood-bandit' && !pd.e2)) return;
  let ax = pd.x, ay = pd.y;
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
    const al = (pd.alvo && snap.players.find((p) => p.id === pd.alvo)) || null;
    if (al) { ax = al.x; ay = al.y; }
    else if (snap.monster && snap.monster.alive) { ax = snap.monster.x; ay = snap.monster.y; }
  }
  if (Number.isFinite(ax) && Number.isFinite(ay)) {
    projeteis.push({ x0: eu.x, y0: eu.y, x1: ax, y1: ay, t0: performance.now(), dur: 350 });
    if (projeteis.length > 8) projeteis.shift();
  }
}
function consumirAck(a) {
  lastAck = a;
  if (a && a.type === 'ack') { ackLog.push(a); if (ackLog.length > 20) ackLog.shift(); }
  if (!a || modoTreino) return;
  if (a.action === 'skill') {
    // FIFO por slot (+alvo quando informado): consecutivos não sobrescrevem —
    // 1º ack consome o 1º envio, 2º ack o 2º (aceito/recusado cada um).
    const slot = String(a.slot || '').toUpperCase();
    const i = pendentes.findIndex((pd) => pd.slot === slot && (a.target === undefined || a.target === null || pd.alvo === a.target));
    if (i < 0) return; // sem pendente (já consumido pela inferência de snapshot)
    const [pd] = pendentes.splice(i, 1);
    const eu = me();
    if (a.ok) {
      AudioX.skill(); // som de sucesso SÓ no aceite
      if (eu) voarMachado(pd, eu);
      // aceito-absorvido: feedback de aceite+bloqueio sem fingir dano (número só sai de delta de HP, que não há)
      if ((a.absorbed || 0) > 0 && (a.dmg || 0) === 0 && (a.healed || 0) === 0) toast('Bloqueado — absorvido (sem dano).');
    } else {
      // recusado: sem FX sucesso. Motivo com erro legado junto (a maioria) chega pelo
      // {type:error}; só os sem erro legado (alcance/bloqueio → chase) avisam aqui.
      if (a.error === 'Fora de alcance.' || a.error === 'Obstáculo bloqueia.') toast((SKILLS[pd.skillId]?.nome || 'Habilidade') + ': ' + a.error + ' (aproximando…)', 'erro');
    }
    if (snap) hud(snap);
  } else if (a.action === 'finish') {
    if (!a.ok) { acabando = null; toast(a.error || 'Finalização recusada.', 'erro'); hudFinish(); }
  }
  // attack/move: sem fila — dano/números vêm do snapshot; sons vêm dos eventos.
}
function alvoPertoDoEvento(e) {
  if (!snap || !myId) return false;
  if (e.target === myId || e.src === myId) return true;
  const t = (snap.players || []).find((p) => p.id === e.target);
  if (t && estaPertoMim(t)) return true;
  if (e.target === '__monster__' && snap.monster && me() && Math.hypot(snap.monster.x - me().x, snap.monster.y - me().y) < 20) return true;
  return false;
}
function consumirEvento(e) {
  lastEvent = e;
  if (!e || modoTreino) return;
  // Sons seguem eventos (fonte única; deltas só geram números). Mute/volume no AudioX.
  if (e.kind === 'hit') {
    if (alvoPertoDoEvento(e)) AudioX.acerto();
    if ((e.healed || 0) > 0) {
      const t = (snap.players || []).find((p) => p.id === e.target);
      if (e.target === myId || e.target === '__dummy__' && e.src === myId || (t && snap && timeDe(t) !== null && timeDe(t) === timeDe(me()))) AudioX.cura();
    }
  }
  // blocked/miss/cast: sem som de sucesso; motivo já vem no ack/erro. Sem número falso (deltas de HP mandam).
}

/* ---------- deltas p/ números flutuantes ---------- */
function detectarDeltas(s) {
  if (!s || !s.players) return;
  // morte com editor aberto (ex.: DoT): fecha e avisa respawn 3 s no PvE
  const eu = s.players.find((p) => p.id === myId);
  if (eu && !eu.alive && editorRedeAberto) {
    editorRedeAberto = false;
    if (!$('modal-build').classList.contains('oculto')) fecharBuild(true);
    toast(s.mode === 'pve' ? 'Você caiu (DoT) com editor aberto — editor fechado, respawn em 3 s.' : 'Você caiu com editor aberto — editor fechado.');
  }
  // interrupção de finish visível (snapshot não expõe progresso; usa estado local + vítima)
  if (acabando && eu) {
    const vit = s.players.find((p) => p.id === acabando.alvo);
    const dt = Date.now() - acabando.inicio;
    if (!vit || (vit.alive === false && !caidoDe(vit))) {
      toast('Finalização concluída.');
      acabando = null;
    } else if (vit && !caidoDe(vit) && vit.alive !== false) {
      toast('Finalização encerrada (alvo levantou).');
      acabando = null;
    } else if (dt > 6000) {
      // passou dos 5 s e a vítima segue caída → servidor interrompeu (move/dano/skill/distância)
      toast('Finalização interrompida (você andou, sofreu dano, usou skill ou saiu do alcance).', 'erro');
      acabando = null;
    }
  }
  // aceite de skill (fallback p/ servidor sem ack): som SÓ com evidência NOVA no
  // snapshot — nunca por CD pré-existente. Com ack, o ack consome primeiro.
  // Vale p/ 1º uso (CD do slot cresceu vs baseline ou cast/chan novo surgiu) e p/ 2º E
  // (efeito da etapa 2 aplicado: dano no alvo OU cura em si vs baselines do envio).
  // Sumiço da janela eCombo por expiração/recusa sem efeito = sem FX sucesso. Rajadas enfileiram.
  if (pendentes.length && eu) {
    const agoraD = Date.now();
    const hpAlvoAgora = (id) => {
      if (!id || !s) return undefined;
      if (id === '__monster__') return s.monster ? s.monster.hp : undefined;
      if (id === '__dummy__') return s.dummy ? s.dummy.hp : undefined;
      const pl = s.players.find((p) => p.id === id);
      return pl ? pl.hp : undefined;
    };
    pendentes = pendentes.filter((pd) => {
      if (agoraD - pd.t > 3000) return false; // expirou sem evidência: descarta em silêncio
      const cd = eu.cd && eu.cd[pd.slot.toLowerCase()];
      const cresceu = cd !== undefined && cd > (pd.baseCd || 0);
      const castNovo = !pd.baseCast && !!eu.cast;
      const chanNovo = !pd.baseChan && !!eu.chan;
      // 2º E não gasta CD/energia: só vale dano no alvo ou cura em si (etapa 2 aplicada).
      let e2efeito = false;
      if (pd.e2) {
        const hAlvo = hpAlvoAgora(pd.alvo);
        if (hAlvo !== undefined && pd.alvoHp !== undefined && hAlvo < pd.alvoHp) e2efeito = true;
        if (pd.euHp !== undefined && eu.hp > pd.euHp) e2efeito = true;
      }
      if (cresceu || castNovo || chanNovo || e2efeito) {
        AudioX.skill();
        if (eu) voarMachado(pd, eu);
        return false; // aceite consumido
      }
      return true; // segue pendente
    });
  }
  for (const p of s.players) {
    const antes = prevHp.get(p.id);
    if (antes !== undefined && p.hp !== antes) {
      // Números vêm SÓ de delta de HP (sem som aqui — sons seguem eventos).
      const diff = p.hp - antes;
      if (diff < 0) {
        numAcum(p.id, p.x, p.y, diff, 'dano');
      } else if (diff > 0) {
        const souEu = p.id === myId;
        const mesmoTime = snap && timeDe(p) !== null && timeDe(me()) === timeDe(p);
        if (souEu || mesmoTime) {
          numAcum(p.id, p.x, p.y, diff, 'cura'); // soma; toda cura efetiva aparece (sem limiar)
        }
      }
    }
    prevHp.set(p.id, p.hp); prevEn.set(p.id, p.energy);
  }
  // PvE: monstro e boneco na MESMA janela fixa + privacidade (números reais, sem reset/respawn).
  const mo = s.monster;
  if (mo) {
    if (!mo.alive) prevMon = { hp: mo.hp, alive: false };
    else {
      if (prevMon && prevMon.alive && mo.hp !== prevMon.hp) {
        const diff = mo.hp - prevMon.hp;
        if (diff < 0) numAcum('__monster__', mo.x, mo.y, diff, 'dano'); // vermelho, todos veem
        else if (diff > 0) numAcum('__monster__', mo.x, mo.y, diff, 'cura'); // raro; monstro sem privacidade
      }
      prevMon = { hp: mo.hp, alive: true }; // morto→vivo (respawn cheio) não gera número
    }
  } else prevMon = null;
  const du = s.dummy;
  if (du) {
    if (prevDum && du.hp !== prevDum.hp) {
      const diff = du.hp - prevDum.hp;
      // boneco nunca recebe dano (sim §5): delta negativo = reset a 25%, sem número
      if (diff > 0) numAcum('__dummy__', du.x, du.y, diff, 'cura'); // verde; alvo cooperativo
    }
    prevDum = { hp: du.hp };
  } else prevDum = null;
  flutuantes = flutuantes.filter((f) => performance.now() < f.ate);
}
function me() { return snap?.players.find((p) => p.id === myId) || null; }
function estaPertoMim(p) {
  const m = me(); if (!m) return false;
  return Math.hypot(p.x - m.x, p.y - m.y) < 20;
}
function timeDe(p) {
  if (!p) return null;
  if (p.team !== undefined && p.team !== null) return p.team; // equipe 0 é válida (falsy, não ausência)
  if (p.equipa !== undefined && p.equipa !== null) return p.equipa;
  return null; // servidor v1: sem equipes → FFA
}
function ehAliado(p) {
  if (!p || p.id === myId) return true;
  const t1 = timeDe(me()), t2 = timeDe(p);
  if (t1 !== null && t2 !== null) return t1 === t2;
  return false; // FFA: todos os outros são inimigos
}

/* ---------- telas ---------- */
function mostrarMenu() {
  $('tela-menu').classList.remove('oculto');
  $('tela-lobby').classList.add('oculto');
  $('tela-jogo').classList.add('oculto');
  renderMenuBuild();
}
function render(s) {
  if (s.state === 'lobby') {
    $('tela-menu').classList.add('oculto');
    $('tela-jogo').classList.add('oculto');
    $('tela-lobby').classList.remove('oculto');
    $('lobby-codigo').textContent = s.code;
    $('lobby-modo').textContent = s.mode === '2v2' ? '2v2' : s.mode === 'pve' ? 'PvE' : 'FFA';
    renderLobby(s);
  } else {
    $('tela-lobby').classList.add('oculto');
    $('tela-menu').classList.add('oculto');
    $('tela-jogo').classList.remove('oculto');
    // Limpa toast do lobby ao iniciar (ex.: "Pronto! Aguardando…") — não persiste em jogo.
    try { $('toast').textContent = ''; clearTimeout(toastT); } catch {}
    ajustarCanvas(); // R1 §5: remediar 300x300 do load na entrada em jogo
    desenhar(s);
    hud(s);
    if (s.state === 'ended') mostrarResultado(s);
    else $('tela-result').classList.add('oculto');
  }
}
function nomeBuildCompleta(b) {
  if (!b) return '—';
  const partes = [];
  if (b.weapon && ARMAS[b.weapon]) partes.push(`<b>${ARMAS[b.weapon].nome}</b>`);
  if (b.offhand && OFFHANDS[b.offhand]) partes.push(OFFHANDS[b.offhand].nome);
  if (b.head && HEADS[b.head]) partes.push(HEADS[b.head].nome);
  if (b.chest && CHESTS[b.chest]) partes.push(CHESTS[b.chest].nome);
  if (b.boots && BOOTS[b.boots]) partes.push(BOOTS[b.boots].nome);
  if (b.cape && CAPES[b.cape]) partes.push(CAPES[b.cape].nome);
  const skills = [b.q, b.w, b.e].filter(Boolean).map((id) => SKILLS[id]?.nome || id).join(' · ');
  const pass = [b.passivaArma, b.passivaHead, b.passivaChest, b.passivaChest2, b.passivaBoots]
    .filter(Boolean).map((id) => NOMES_PASSIVA[id]?.split(' (')[0] || id).join(', ');
  return `${partes.join(' + ') || '—'}<br><span>Q/W/E: ${skills || '—'}</span>` +
    (pass ? `<br><span>Passivas: ${pass}</span>` : '') +
    ([b.headSkill, b.chestSkill, b.bootsSkill].some(Boolean)
      ? `<br><span>Ativas armadura: ${[b.headSkill, b.chestSkill, b.bootsSkill].filter(Boolean).map((id) => SKILLS[id]?.nome || id).join(' · ')}</span>` : '');
}
function renderLobby(s) {
  const div = $('lobby-lista');
  const bLocal = lerBuild();
  $('lobby-build-resumo').innerHTML =
    `<span class="build-chip">${icone(bLocal.weapon)} ${ARMAS[bLocal.weapon]?.nome}</span>` +
    `<span class="build-chip">${icone(bLocal.offhand)} ${OFFHANDS[bLocal.offhand]?.nome}</span>` +
    `<span class="build-chip">${icone(bLocal.cape)} ${CAPES[bLocal.cape]?.nome}</span>` +
    `<span class="build-chip">${icone(bLocal.q)} Q: ${SKILLS[bLocal.q]?.nome}</span>` +
    `<span class="build-chip">${icone(bLocal.w)} W: ${SKILLS[bLocal.w]?.nome}</span>` +
    `<span class="build-chip">${icone(bLocal.e)} E: ${SKILLS[bLocal.e]?.nome}</span>`;
  div.innerHTML = s.players.map((p) => {
    const eu = p.id === myId ? ' (você)' : '';
    const euSnap = s.players.find((x) => x.id === myId);
    const meuTime = euSnap ? timeDe(euSnap) : null;
    const tp = timeDe(p);
    const cls = p.id === myId ? 'eu' : (tp !== null && meuTime !== null && tp === meuTime ? 'aliado' : 'inimigo');
    const equipe = (p.team === 0 || p.team === 1) ? ` · Equipe ${p.team === 0 ? 'azul' : 'vermelha'}` : (p.id === myId ? ` · Equipe ${esc(equipeLocal)} (local)` : '');
    return `<div class="jog-linha"><div class="jog-topo"><span class="ponto ${cls}"></span><b>${esc(p.nick)}${eu}</b>` +
      `<span class="etiqueta">${p.ready ? 'Pronto ✓' : 'Preparando…'}</span><span class="nota">${equipe}${p.left ? ' · saiu' : ''}${p.disconnected ? ' · reconectando…' : ''}</span></div>` +
      `<div class="build-completa">${nomeBuildCompleta(p.build)}</div></div>`;
  }).join('') || '<p class="nota">Aguardando jogadores…</p>';
  renderLobbyBuild();
}
function esc(t) { return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function mostrarResultado(s) {
  const el = $('tela-result');
  el.classList.remove('oculto');
  const r = s.result;
  if (!r) { $('result-tabela').innerHTML = '<p class="nota">Calculando placar…</p>'; return; }
  const vitoriaMinha = (s.winners || []).includes(myId);
  $('result-titulo').textContent = r.winners?.length
    ? `🏆 Vencedor: ${(r.winners || []).join(', ')}` : 'Fim de partida';
  if (vitoriaMinha) AudioX.vitoria(); else AudioX.derrota();
  const linhas = (r.board || []).map((b) =>
    `<tr><td>${esc(b.nick)}</td><td>${b.kills}</td><td>${b.deaths}</td><td>${b.dmgDealt}</td><td>${b.dmgTaken}</td><td>${b.healDone}</td></tr>`).join('');
  $('result-tabela').innerHTML =
    `<table><tr><th>Jogador</th><th>Elim.</th><th>Mortes</th><th>Dano</th><th>Sofrido</th><th>Cura</th></tr>${linhas}</table>`;
}

/* ---------- isometria + desenho ---------- */
const cv = $('cv'), ctx = cv.getContext('2d');
const TILE = 30;
const OBST = [[44, 44, 12, 12], [18, 18, 6, 6], [76, 18, 6, 6], [18, 76, 6, 6], [76, 76, 6, 6]];
function w2s(wx, wy, px, py, w, h) {
  const t = TILE * zoom;
  return [w / 2 + (wx - wy) * t / 2 - (px - py) * t / 2,
    h / 2 + (wx + wy) * t / 4 - (px + py) * t / 4 - 40];
}
function s2w(sx, sy, px, py, w, h) {
  const t = TILE * zoom;
  const dx = (sx - w / 2) / (t / 2) + (px - py);
  const dy = (sy - h / 2 + 40) / (t / 4) + (px + py);
  return [(dy + dx) / 2, (dy - dx) / 2];
}
function ajustarCanvas() {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(300, r.width * dpr); cv.height = Math.max(300, r.height * dpr);
}
addEventListener('resize', () => { if (!$('tela-jogo').classList.contains('oculto')) { ajustarCanvas(); if (snap) desenhar(snap); } });

function corTime(p) {
  if (p.id === myId) return '#58c96b';  const t1 = timeDe(me()), t2 = timeDe(p);
  if (t1 !== null && t2 !== null) return t1 === t2 ? '#4aa8ff' : '#e05252';
  return '#e05252';
}
// Estado caído: snapshot envia downed como OBJETO {state,t} (sempre truthy!) ou
// treino local usa booleano. Centraliza aqui: caído = knocked OU caido OU downed ativo.
function caidoDe(p) {
  if (!p) return false;
  if (p.knocked || p.caido) return true;
  const d = p.downed;
  if (!d) return false;
  if (typeof d === 'object') return d.state !== 'up';
  return !!d;
}
function desenhar(s) {
  const eu = s.players.find((p) => p.id === myId) || TR.jogador || { x: 50, y: 50 };
  const W = cv.width, H = cv.height;
  // céu/pedra
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#241d13'); g.addColorStop(1, '#171208');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // grade de pedra: lajotas com variação tonal, chanfro e granulado (determinístico)
  const t = TILE * zoom;
  const agoraVis = (() => { try { return performance.now(); } catch { return 0; } })();
  for (let gx = 0; gx < 100; gx += 4) for (let gy = 0; gy < 100; gy += 4) {
    const [cx, cy] = w2s(gx + 2, gy + 2, eu.x, eu.y, W, H);
    if (cx < -80 || cy < -80 || cx > W + 80 || cy > H + 80) continue;
    const p1 = w2s(gx, gy, eu.x, eu.y, W, H), p2 = w2s(gx + 4, gy, eu.x, eu.y, W, H),
      p3 = w2s(gx + 4, gy + 4, eu.x, eu.y, W, H), p4 = w2s(gx, gy + 4, eu.x, eu.y, W, H);
    const hh = ((((gx * 73856093) ^ (gy * 19349663)) >>> 0) % 9) - 4; // -4..4
    const alt = ((gx + gy) / 4) % 2 === 0;
    const base = alt ? [43 + hh, 35 + hh, 24 + hh] : [38 + hh, 32 + hh, 23 + hh];
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.closePath();
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; ctx.fill();
    // chanfro: aresta superior clara, inferior escura
    ctx.strokeStyle = 'rgba(210,180,130,0.16)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    // granulado: 2 pontos determinísticos por lajota
    const hx = ((gx * 83492791) ^ (gy * 29712151)) >>> 0, hy = ((gx * 6137171) ^ (gy * 11001937)) >>> 0;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(p1[0] + (hx % 100) / 100 * (p3[0] - p1[0]), p1[1] + (hx % 70) / 100 * (p3[1] - p1[1]), 2, 2);
    ctx.fillStyle = 'rgba(220,200,160,0.10)';
    ctx.fillRect(p1[0] + (hy % 100) / 100 * (p3[0] - p1[0]), p1[1] + (hy % 80) / 100 * (p3[1] - p1[1]), 2, 2);
  }
  // borda da arena
  const c1 = w2s(0, 0, eu.x, eu.y, W, H), c2 = w2s(100, 0, eu.x, eu.y, W, H),
    c3 = w2s(100, 100, eu.x, eu.y, W, H), c4 = w2s(0, 100, eu.x, eu.y, W, H);
  ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.lineTo(c4[0], c4[1]); ctx.closePath();
  ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 3; ctx.stroke();
  // muralha com ameias ao longo das 4 bordas (decorativa, mesma colisão da borda)
  const bordas = [[c1, c2], [c2, c3], [c3, c4], [c4, c1]];
  for (const [q1, q2] of bordas) {
    ctx.strokeStyle = '#3a332a'; ctx.lineWidth = 10 * zoom; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.stroke();
    ctx.strokeStyle = '#57493a'; ctx.lineWidth = 6 * zoom;
    ctx.beginPath(); ctx.moveTo(q1[0], q1[1] - 2 * zoom); ctx.lineTo(q2[0], q2[1] - 2 * zoom); ctx.stroke();
    for (let k = 0; k <= 20; k++) { // ameias
      const mx = q1[0] + (q2[0] - q1[0]) * k / 20, my = q1[1] + (q2[1] - q1[1]) * k / 20;
      if (mx < -20 || my < -30 || mx > W + 20 || my > H + 20) continue;
      ctx.fillStyle = '#4a4034';
      ctx.fillRect(mx - 4 * zoom, my - 16 * zoom, 8 * zoom, 10 * zoom);
      ctx.fillStyle = '#655845';
      ctx.fillRect(mx - 4 * zoom, my - 16 * zoom, 8 * zoom, 3 * zoom);
    }
  }
  ctx.lineCap = 'butt';
  // tochas em nichos nas muralhas norte (7): poste + chama animada + halo
  const flick = 1 + 0.15 * Math.sin(agoraVis / 130) + 0.08 * Math.sin(agoraVis / 47);
  const tochas = [[15, 1.5], [35, 1.5], [55, 1.5], [75, 1.5], [98.5, 20], [98.5, 45], [98.5, 70]];
  for (const [tx, ty] of tochas) {
    const [sx, sy] = w2s(tx, ty, eu.x, eu.y, W, H);
    if (sx < -60 || sy < -90 || sx > W + 60 || sy > H + 90) continue;
    ctx.strokeStyle = '#2a2118'; ctx.lineWidth = 3 * zoom;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 16 * zoom); ctx.stroke();
    const fr = 5 * zoom * flick;
    const halo = ctx.createRadialGradient(sx, sy - 20 * zoom, 2, sx, sy - 20 * zoom, 42 * zoom);
    halo.addColorStop(0, 'rgba(255,170,60,0.20)'); halo.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(sx - 42 * zoom, sy - 20 * zoom - 42 * zoom, 84 * zoom, 84 * zoom);
    ctx.fillStyle = '#e8762b';
    ctx.beginPath(); ctx.ellipse(sx, sy - 20 * zoom, fr * 0.7, fr, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath(); ctx.ellipse(sx, sy - 19 * zoom, fr * 0.38, fr * 0.6, 0, 0, 7); ctx.fill();
  }
  // adereços de pedra (decorativos, sem colisão): mesa, estante, estátua, fonte
  const prop = (wx, wy, fn) => {
    const [sx, sy] = w2s(wx, wy, eu.x, eu.y, W, H);
    if (sx < -80 || sy < -120 || sx > W + 80 || sy > H + 80) return;
    ctx.fillStyle = '#0007';
    ctx.beginPath(); ctx.ellipse(sx, sy + 2 * zoom, 16 * zoom, 6 * zoom, 0, 0, 7); ctx.fill();
    fn(sx, sy);
  };
  prop(30, 9, (sx, sy) => { // mesa de guerra com mapa
    ctx.fillStyle = '#5d4a33'; ctx.fillRect(sx - 14 * zoom, sy - 14 * zoom, 28 * zoom, 5 * zoom);
    ctx.fillStyle = '#3e3222'; ctx.fillRect(sx - 12 * zoom, sy - 9 * zoom, 3 * zoom, 9 * zoom); ctx.fillRect(sx + 9 * zoom, sy - 9 * zoom, 3 * zoom, 9 * zoom);
    ctx.fillStyle = '#c9b98a'; ctx.fillRect(sx - 9 * zoom, sy - 13.5 * zoom, 18 * zoom, 4 * zoom);
    ctx.strokeStyle = '#8a764f'; ctx.lineWidth = 1; ctx.strokeRect(sx - 9 * zoom, sy - 13.5 * zoom, 18 * zoom, 4 * zoom);
  });
  prop(65, 9, (sx, sy) => { // estante com pergaminhos
    ctx.fillStyle = '#4a3d2c'; ctx.fillRect(sx - 10 * zoom, sy - 30 * zoom, 20 * zoom, 30 * zoom);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#2e2618'; ctx.fillRect(sx - 8 * zoom, sy - 26 * zoom + i * 9 * zoom, 16 * zoom, 6 * zoom);
      ctx.fillStyle = ['#a33', '#48c', '#ca3'][i]; ctx.fillRect(sx - 6 * zoom, sy - 25 * zoom + i * 9 * zoom, 12 * zoom, 4 * zoom);
    }
  });
  prop(9, 55, (sx, sy) => { // estátua de cavaleiro
    ctx.fillStyle = '#6e6455'; ctx.fillRect(sx - 7 * zoom, sy - 8 * zoom, 14 * zoom, 8 * zoom);
    ctx.fillStyle = '#7d7264'; ctx.fillRect(sx - 4 * zoom, sy - 26 * zoom, 8 * zoom, 18 * zoom);
    ctx.beginPath(); ctx.arc(sx, sy - 30 * zoom, 5 * zoom, 0, 7); ctx.fill();
  });
  prop(90, 90, (sx, sy) => { // fonte pequena
    ctx.fillStyle = '#57503f'; ctx.beginPath(); ctx.ellipse(sx, sy - 4 * zoom, 14 * zoom, 7 * zoom, 0, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(80,150,200,${0.55 + 0.15 * Math.sin(agoraVis / 400)})`;
    ctx.beginPath(); ctx.ellipse(sx, sy - 5 * zoom, 10 * zoom, 5 * zoom, 0, 0, 7); ctx.fill();
  });
  // luz quente ambiente sobre a cena
  const luz = ctx.createRadialGradient(W / 2, H * 0.35, 40, W / 2, H * 0.35, Math.max(W, H) * 0.75);
  luz.addColorStop(0, 'rgba(255,190,110,0.07)'); luz.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = luz; ctx.fillRect(0, 0, W, H);
  // wave (se servidor enviar e estiver ativa — sem círculo em PvE/lobby)
  const wave = s.wave || s.zona || null;
  if (wave && wave.r !== undefined && wave.active) {
    const [wx, wy] = w2s(wave.x ?? 50, wave.y ?? 50, eu.x, eu.y, W, H);
    ctx.beginPath(); ctx.ellipse(wx, wy, wave.r * t / 1.4, wave.r * t / 2.8, 0, 0, 7);
    ctx.strokeStyle = '#ffb74d'; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffb74d'; ctx.font = `${13 * zoom}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('◉ área segura — fique dentro', wx, wy - wave.r * t / 2.8 - 8);
  }
  // obstáculos: blocos de pedra legíveis
  for (const [ox, oy, ow, oh] of OBST) {
    const [cx, cy] = w2s(ox + ow / 2, oy + oh / 2, eu.x, eu.y, W, H);
    const ww = (ow + oh) * t / 2, hh = (ow + oh) * t / 4;
    ctx.fillStyle = '#0007';
    ctx.beginPath(); ctx.ellipse(cx + 6, cy + hh / 2, ww / 2, hh / 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a4238';
    ctx.fillRect(cx - ww / 2, cy - hh / 2 - 14 * zoom, ww, hh);
    ctx.fillStyle = '#5d5346';
    ctx.fillRect(cx - ww / 2, cy - hh / 2 - 20 * zoom, ww, 8 * zoom);
    ctx.fillStyle = '#6e6455';
    for (let bx = -ww / 2; bx < ww / 2; bx += 14 * zoom) ctx.fillRect(cx + bx, cy - hh / 2 - 14 * zoom, 2 * zoom, hh);
    ctx.strokeStyle = '#2c2620'; ctx.lineWidth = 2;
    ctx.strokeRect(cx - ww / 2, cy - hh / 2 - 20 * zoom, ww, hh + 8 * zoom);
  }
  // pontos de treino (monstro/boneco): local ou via servidor (PvE em rede)
  const lista = [...(s.players || [])];
  if (modoTreino) {
    if (TR.monstro.vivo) lista.push({ id: '__monster__', nick: 'Monstro 👹', x: TR.monstro.x, y: TR.monstro.y, hp: Math.ceil(TR.monstro.hp), maxHp: TR.monstro.max, energy: 0, maxEnergy: 1, alive: true, npc: 'monstro', build: { weapon: 'dagger' } });
    lista.push({ id: '__dummy__', nick: 'Boneco aliado ⛨', x: TR.boneco.x, y: TR.boneco.y, hp: Math.ceil(TR.boneco.hp), maxHp: TR.boneco.max, energy: 0, maxEnergy: 1, alive: true, npc: 'boneco', build: { weapon: 'holy' } });
  } else {
    if (s.monster && s.monster.alive) lista.push({ id: '__monster__', nick: 'Monstro 👹', x: s.monster.x, y: s.monster.y, hp: s.monster.hp, maxHp: s.monster.maxHp, energy: 0, maxEnergy: 1, alive: true, npc: 'monstro', build: { weapon: 'dagger' } });
    if (s.dummy) lista.push({ id: '__dummy__', nick: 'Boneco aliado ⛨', x: s.dummy.x, y: s.dummy.y, hp: s.dummy.hp, maxHp: s.dummy.maxHp, energy: 0, maxEnergy: 1, alive: true, npc: 'boneco', build: { weapon: 'holy' } });
  }
  const ps = [...lista].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const rotulos = []; // anti-sobreposição de nomes neste frame
  const alvoId = window._alvo || null;
  for (const p of ps) {
    const [sx, sy] = w2s(p.x, p.y, eu.x, eu.y, W, H);
    if (sx < -60 || sy < -80 || sx > W + 60 || sy > H + 80) continue;
    const r = 13 * zoom;
    const cor = p.npc === 'monstro' ? '#a33' : p.npc === 'boneco' ? '#4aa8ff' : corTime(p);
    ctx.fillStyle = '#0008';
    ctx.beginPath(); ctx.ellipse(sx, sy + 5 * zoom, r, r / 2.4, 0, 0, 7); ctx.fill();
    // corpo procedural (L4b §6): humanoide/monstro/boneco reconhecíveis
    desenharCorpo(ctx, sx, sy, r, p, cor);
    // contorno aliado/inimigo + alvo
    if (p.id === alvoId) { ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(sx, sy + 2 * zoom, r + 8, (r + 8) / 2.2, 0, 0, 7); ctx.stroke(); }
    else if (!p.npc) { ctx.strokeStyle = cor; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy + 2 * zoom, r + 3, (r + 3) / 2.2, 0, 0, 7); ctx.stroke(); }
    if (p.prot || p.protecao) { ctx.strokeStyle = '#90caf9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy + 2 * zoom, r + 13, (r + 13) / 2.2, 0, 0, 7); ctx.stroke(); }
    if (caidoDe(p)) {
      ctx.fillStyle = '#000c'; ctx.beginPath(); ctx.arc(sx, sy - 10 * zoom, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd54f'; ctx.font = `${14 * zoom}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('⏳', sx, sy - 4 * zoom);
    }
    // nome + barras (desempate vertical p/ não sobrepor rótulos vizinhos)
    ctx.font = `700 ${12 * zoom}px sans-serif`; ctx.textAlign = 'center';
    let nyN = -46 * zoom;
    for (const q of rotulos) { if (Math.abs(sx - q[0]) < 60 * zoom && Math.abs((sy + nyN) - q[1]) < 16 * zoom) nyN -= 16 * zoom; }
    rotulos.push([sx, sy + nyN]);
    ctx.lineWidth = 3 * zoom; ctx.strokeStyle = '#000c';
    ctx.strokeText(p.nick, sx, sy + nyN);
    ctx.fillStyle = '#fff';
    ctx.fillText(p.nick, sx, sy + nyN);
    const bw = 44 * zoom;
    ctx.fillStyle = '#111'; ctx.fillRect(sx - bw / 2, sy - 7 * zoom, bw, 6 * zoom);
    ctx.fillStyle = cor; ctx.fillRect(sx - bw / 2, sy - 7 * zoom, bw * Math.max(0, p.hp / Math.max(1, p.maxHp)), 6 * zoom);
    ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1;
    ctx.strokeRect(sx - bw / 2, sy - 7 * zoom, bw, 6 * zoom);
    if (p.maxEnergy > 1) {
      ctx.fillStyle = '#111'; ctx.fillRect(sx - bw / 2, sy - 1 * zoom, bw, 3.5 * zoom);
      ctx.fillStyle = '#42a5f5'; ctx.fillRect(sx - bw / 2, sy - 1 * zoom, bw * Math.max(0, p.energy / p.maxEnergy), 3.5 * zoom);
    }
    // conjuração/canal em curso (Layers 1/2): arco de progresso sobre a cabeça (L3 §7)
    let agoraMs = 0; try { agoraMs = performance.now(); } catch {}
    const rxDt = (s._rx && agoraMs >= s._rx) ? (agoraMs - s._rx) : 0;
    const progDe = (o) => {
      if (!o || !o.total) return null;
      const rest = Math.max(0, (o.until || 0) - (s.time || 0) - rxDt);
      return Math.min(1, Math.max(0, 1 - rest / o.total));
    };
    const pc = progDe(p.cast), ph = progDe(p.chan), prc = pc !== null ? pc : ph;
    if (prc !== null) {
      ctx.strokeStyle = p.chan ? '#7be495' : '#ffd54f'; ctx.lineWidth = 4 * zoom;
      ctx.beginPath(); ctx.arc(sx, sy - 10 * zoom, r + 9, -Math.PI / 2, -Math.PI / 2 + prc * Math.PI * 2); ctx.stroke();
    }
    // E de 2 usos armado (Layer 2): selo E2! + expiração (L3 §8)
    if (p.eCombo && p.eCombo.armed) {
      ctx.font = `700 ${11 * zoom}px sans-serif`;
      const txtE = `E2! ${(Math.max(0, p.eCombo.msLeft || 0) / 1000).toFixed(0)}s`;
      const wE = ctx.measureText(txtE).width + 12;
      ctx.fillStyle = '#000a'; ctx.fillRect(sx + r + 4, sy - 26 * zoom, wE, 14 * zoom);
      ctx.fillStyle = '#ffca28'; ctx.textAlign = 'center'; ctx.fillText(txtE, sx + r + 4 + wE / 2, sy - 15 * zoom);
    }
    // efeitos (se servidor enviar; senão nada — sem placeholder falso)
    const efs = p.effects || p.efeitos || [];
    if (efs.length) {
      ctx.font = `${10 * zoom}px sans-serif`;
      efs.slice(0, 3).forEach((e, i) => {
        const nome = typeof e === 'string' ? e : (e.nome || e.id || '?');
        ctx.fillStyle = '#000a';
        const wtxt = ctx.measureText(nome).width + 10;
        ctx.fillRect(sx - wtxt / 2, sy + (8 + i * 13) * zoom, wtxt, 12 * zoom);
        ctx.fillStyle = '#ffd54f'; ctx.fillText(nome, sx, sy + (17 + i * 13) * zoom);
      });
    }
  }
  // L8 §8: projéteis visuais (machado do E) — girando do jogador ao ponto mirado, 350 ms, SÓ no aceite.
  if (projeteis.length) {
    const agoraP = (() => { try { return performance.now(); } catch { return 0; } })();
    projeteis = projeteis.filter((pr) => agoraP - pr.t0 < pr.dur + 60);
    for (const pr of projeteis) {
      const k = Math.min(1, Math.max(0, (agoraP - pr.t0) / pr.dur));
      const wx = pr.x0 + (pr.x1 - pr.x0) * k, wy = pr.y0 + (pr.y1 - pr.y0) * k;
      const [qx, qy] = w2s(wx, wy, eu.x, eu.y, W, H);
      const rot = k * Math.PI * 4, zb = zoom;
      ctx.save(); ctx.translate(qx, qy); ctx.rotate(rot);
      ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 2.5 * zb;
      ctx.beginPath(); ctx.moveTo(-8 * zb, 0); ctx.lineTo(8 * zb, 0); ctx.stroke();
      ctx.fillStyle = '#e8eef4'; ctx.strokeStyle = '#5a636b'; ctx.lineWidth = 1.2 * zb;
      ctx.beginPath(); ctx.arc(9 * zb, 0, 6 * zb, -1.2, 1.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(-9 * zb, 0, 6 * zb, Math.PI - 1.2, Math.PI + 1.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  // indicador de mira por tipo (L6 §7): área real do servidor, vermelho = inválido.
  // Raios de área do servidor (skillParams): ponto/área usam centro no clique.
  const RAIO_AREA = { 'smite': 2.5, 'burning-field': 3, 'ice-shard': 0, 'frost-bomb': 5, 'frost-nova': 3, 'frozen-surge': 1.9, 'flame-blast': 5, 'fire-artillery': 3, 'wall-of-flames': 7, 'pyroblast': 4, 'glacial-obelisk': 6, 'sacred-pulse': 5, 'holy-flash': 5, 'holy-orb': 7, 'freezing-wind': 0, 'fire-wave': 0, 'frost-beam': 4 };
  const circMundo = (cx, cy, rM, cor, larg, tracejado) => {
    ctx.strokeStyle = cor; ctx.lineWidth = larg || 2;
    ctx.setLineDash(tracejado || []);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const [px, py] = w2s(cx + Math.cos(a) * rM, cy + Math.sin(a) * rM, eu.x, eu.y, W, H);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  if (mira && eu) {
    const sk = SKILLS[mira.skillId];
    if (sk) {
      const [ex, ey] = w2s(eu.x, eu.y, eu.x, eu.y, W, H);
      // anel de alcance ao redor do jogador (sempre)
      circMundo(eu.x, eu.y, sk.alcance, '#ffd54f88', 1.5, [6, 4]);
      // ponto do mouse em coords de mundo
      let mwx = null, mwy = null, mValido = true;
      if (mouseClient) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        [mwx, mwy] = s2w(mouseClient.x * dpr, mouseClient.y * dpr, eu.x, eu.y, W, H);
      }
      if (sk.alvo === 'area' || sk.alvo === 'ponto') {
        const raio = RAIO_AREA[mira.skillId] ?? 0;
        if (mwx !== null) {
          mValido = Math.hypot(mwx - eu.x, mwy - eu.y) <= sk.alcance + 0.5;
          if (raio > 0) circMundo(mwx, mwy, raio, mValido ? '#ffd54f' : '#ff5252', 2);
          else { const [mx, my] = w2s(mwx, mwy, eu.x, eu.y, W, H); ctx.strokeStyle = mValido ? '#ffd54f' : '#ff5252'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx - 8, my); ctx.lineTo(mx + 8, my); ctx.moveTo(mx, my - 8); ctx.lineTo(mx, my + 8); ctx.stroke(); }
        }
      } else if (sk.alvo === 'direcao') {
        // Cone real do servidor: ±30° (inCone, meio-ângulo padrão do sim) a partir
        // do jogador na direção do ponto clicado, até o alcance; multiacerto +
        // LOS (parede bloqueia no dealDamage). Cone vazio = 'Errou.' gasto.
        // Largura própria por skill e LOS não desenhados (ver NOTAS).
        let ang = -Math.PI / 2, ok = true;
        if (mwx !== null) {
          const dd = Math.hypot(mwx - eu.x, mwy - eu.y);
          if (dd > 0.3) ang = Math.atan2(mwy - eu.y, mwx - eu.x);
          ok = dd <= sk.alcance + 0.5;
          mValido = ok;
        }
        const cor = mValido ? '#ffd54f' : '#ff5252';
        for (const sgn of [-1, 1]) {
          const a2 = ang + sgn * (Math.PI / 6);
          const [qx, qy] = w2s(eu.x + Math.cos(a2) * sk.alcance, eu.y + Math.sin(a2) * sk.alcance, eu.x, eu.y, W, H);
          ctx.strokeStyle = cor; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(ex, ey - 10 * zoom); ctx.lineTo(qx, qy); ctx.stroke(); ctx.setLineDash([]);
        }
        circMundo(eu.x, eu.y, sk.alcance, cor + '', 1);
        // ponto clicado = x/y enviado (direção que o servidor usa); sem alvo prometido
        if (mwx !== null) {
          const [mx, my] = w2s(mwx, mwy, eu.x, eu.y, W, H);
          ctx.strokeStyle = mValido ? '#ffd54f' : '#ff5252'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(mx - 8, my); ctx.lineTo(mx + 8, my); ctx.moveTo(mx, my - 8); ctx.lineTo(mx, my + 8); ctx.stroke();
        }
      } else if (sk.alvo === 'inimigo' || sk.alvo === 'aliado') {
        if (mwx !== null) {
          mValido = Math.hypot(mwx - eu.x, mwy - eu.y) <= sk.alcance + 0.5;
          circMundo(mwx, mwy, 2, mValido ? (sk.alvo === 'aliado' ? '#4aa8ff' : '#ffd54f') : '#ff5252', 2);
        }
      } else if (sk.alvo === 'self') {
        circMundo(eu.x, eu.y, 2.5, '#4aa8ff', 2);
      }
    }
  }
  // flutuantes de dano/cura (um número por entidade+tipo a cada ~1,5 s; grupos separados)
  const agora = performance.now();
  ctx.textAlign = 'center';
  flutuantes = flutuantes.filter((f) => agora < f.ate);
  for (const f of flutuantes) {
    const [fx, fy] = w2s(f.x, f.y, eu.x, eu.y, W, H);
    const k = 1 - (f.ate - agora) / JANELA_NUM;
    ctx.font = `800 ${15 * zoom}px sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = '#000c';
    const txtN = numTexto(f);
    const ny = fy - (84 + k * 26) * zoom; // bem acima do nome (−46) p/ não sobrepor rótulos/barras
    ctx.strokeText(txtN, fx, ny);
    ctx.fillStyle = numCor(f);
    ctx.fillText(txtN, fx, ny);
  }
  // respawn / caído
  const mim = s.players?.find((p) => p.id === myId);
  if (mim && !mim.alive && s.state === 'playing') {
    const el = $('aviso-respawn'); el.classList.remove('oculto');
    el.innerHTML = caidoDe(mim)
      ? `⏳ Caído! Aguarde ajuda, levante ou finalização…<br><span class="nota">Aliado pode usar Despertar; inimigo pode finalizar canalizando 5 s.</span>`
      : `💀 Você caiu! Renascendo em ~5 s com proteção de 3 s…`;
  } else if (!modoTreino) $('aviso-respawn').classList.add('oculto');
  if (modoTreino) hudTreino();
}

/* ---------- L4b §6: personagem procedural próprio (sem assets externos) ---------- */
const viso = { pos: new Map(), hp: new Map(), flash: new Map() }; // facing + hit-flash por entidade
function desenharCorpo(c, sx, sy, r, p, cor) {
  const z = zoom, agora = performance.now();
  const morto = !p.alive;
  // facing: direção do movimento (8-way simplificada p/ espelhar); parado mantém última
  let st = viso.pos.get(p.id);
  if (!st) { st = { x: p.x, y: p.y, fx: 1, fase: Math.random() * 6 }; viso.pos.set(p.id, st); }
  const dx = p.x - st.x, dy = p.y - st.y, mov = Math.hypot(dx, dy);
  if (mov > 0.05) { st.fx = dx < -0.02 ? -1 : dx > 0.02 ? 1 : st.fx; st.fase += mov * 2.2; st.x = p.x; st.y = p.y; }
  const andando = mov > 0.05, bal = andando ? Math.sin(st.fase) : 0;
  const hpA = viso.hp.get(p.id);
  if (hpA !== undefined && p.hp < hpA && p.alive) viso.flash.set(p.id, agora);
  viso.hp.set(p.id, p.hp);
  const flash = agora - (viso.flash.get(p.id) || 0) < 180 && !morto;
  const F = (v) => v * z, fx = st.fx;
  if (p.npc === 'monstro') { // brutamontes: tronco largo, chifres, olhos, garras
    c.fillStyle = morto ? '#4a2a2a' : '#7a2e2e';
    c.beginPath(); c.ellipse(sx, sy - F(12), F(13), F(11), 0, 0, 7); c.fill();
    c.strokeStyle = '#2a0f0f'; c.lineWidth = F(2); c.stroke();
    c.fillStyle = morto ? '#4a2a2a' : '#93363a'; // cabeça
    c.beginPath(); c.arc(sx, sy - F(26), F(7), 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#2a0f0f'; // chifres
    c.beginPath(); c.moveTo(sx - F(6), sy - F(30)); c.lineTo(sx - F(11), sy - F(40)); c.lineTo(sx - F(2), sy - F(33)); c.fill();
    c.beginPath(); c.moveTo(sx + F(6), sy - F(30)); c.lineTo(sx + F(11), sy - F(40)); c.lineTo(sx + F(2), sy - F(33)); c.fill();
    if (!morto) { c.fillStyle = '#ffeb3b'; c.fillRect(sx - F(4), sy - F(28), F(3), F(3)); c.fillRect(sx + F(1), sy - F(28), F(3), F(3)); }
    c.strokeStyle = '#2a0f0f'; c.lineWidth = F(4); // braços c/ garras
    const g = andando ? bal * F(3) : 0;
    c.beginPath(); c.moveTo(sx - F(12), sy - F(14)); c.lineTo(sx - F(16), sy - F(2) + g); c.stroke();
    c.beginPath(); c.moveTo(sx + F(12), sy - F(14)); c.lineTo(sx + F(16), sy - F(2) - g); c.stroke();
    if (flash) { c.fillStyle = '#ffffff88'; c.beginPath(); c.ellipse(sx, sy - F(12), F(13), F(11), 0, 0, 7); c.fill(); }
    return;
  }
  if (p.npc === 'boneco') { // poste de treino: estaca + travessa + palha
    c.fillStyle = '#6b4423'; c.fillRect(sx - F(3), sy - F(34), F(6), F(36));
    c.fillRect(sx - F(12), sy - F(30), F(24), F(5));
    c.strokeStyle = '#4a2c14'; c.lineWidth = F(1.5); c.strokeRect(sx - F(3), sy - F(34), F(6), F(36));
    c.fillStyle = '#c9a86a'; c.beginPath(); c.arc(sx, sy - F(36), F(5), 0, 7); c.fill(); // topo palha
    c.strokeStyle = '#4a2c14'; c.lineWidth = F(1.5); c.stroke();
    return;
  }
  // humanoide: pés em sy; pernas → tronco (cor do time) → cabeça + elmo; arma mão direita
  const corT = morto ? '#555' : cor;
  const conj = !!(p.cast), can = !!p.chan;
  const pernaC = '#3a332c', pele = '#e0b48f';
  c.lineCap = 'round';
  const balP = andando ? bal * F(4) : 0;
  c.strokeStyle = pernaC; c.lineWidth = F(4.5); // pernas (ciclo de marcha)
  c.beginPath(); c.moveTo(sx - F(4), sy - F(11)); c.lineTo(sx - F(4) + balP, sy - F(1)); c.stroke();
  c.beginPath(); c.moveTo(sx + F(4), sy - F(11)); c.lineTo(sx + F(4) - balP, sy - F(1)); c.stroke();
  if (caidoDe(p)) { // caído: tronco deitado + ⏳ (anel já desenhado fora)
    c.fillStyle = morto ? '#555' : corT;
    c.beginPath(); c.ellipse(sx, sy - F(6), F(13), F(7), 0, 0, 7); c.fill();
    c.strokeStyle = '#000'; c.lineWidth = F(1.5); c.stroke();
    c.fillStyle = pele; c.beginPath(); c.arc(sx + F(13) * fx, sy - F(7), F(5.5), 0, 7); c.fill(); c.stroke();
    return;
  }
  c.fillStyle = morto ? '#555' : corT; // tronco
  c.strokeStyle = '#000'; c.lineWidth = F(1.5);
  c.beginPath();
  if (c.roundRect) c.roundRect(sx - F(7), sy - F(26), F(14), F(16), F(4));
  else c.rect(sx - F(7), sy - F(26), F(14), F(16));
  c.fill(); c.stroke();
  c.fillStyle = '#ffffff22'; c.fillRect(sx - F(7), sy - F(26), F(4), F(16)); // sombreado pano
  c.fillStyle = pele; // cabeça
  c.beginPath(); c.arc(sx, sy - F(31), F(6), 0, 7); c.fill(); c.stroke();
  const head = p.build?.head || ''; // elmo por peça
  if (head.includes('soldier')) { c.fillStyle = '#9aa2ab'; c.beginPath(); c.arc(sx, sy - F(33), F(6.5), Math.PI, 0); c.fill(); c.stroke(); c.fillRect(sx - F(7), sy - F(34), F(14), F(2)); }
  else if (head.includes('scholar')) { c.fillStyle = '#5b4a8a'; c.beginPath(); c.moveTo(sx - F(6), sy - F(31)); c.lineTo(sx + F(6), sy - F(31)); c.lineTo(sx, sy - F(42)); c.fill(); c.stroke(); }
  else { c.fillStyle = HEADS[head]?.cor || '#4a5d3a'; c.beginPath(); c.arc(sx, sy - F(32), F(6.8), Math.PI * 0.95, Math.PI * 2.05); c.fill(); }
  const sobe = (conj || can) ? -F(6) : 0; // conjurar/canalizar: braços erguidos
  const mx = sx + F(9) * fx, nx = sx - F(9) * fx;
  c.strokeStyle = morto ? '#555' : corT; c.lineWidth = F(4); // braço arma (direita p/ facing)
  c.beginPath(); c.moveTo(sx + F(6) * fx, sy - F(22)); c.lineTo(mx, sy - F(14) + sobe); c.stroke();
  c.strokeStyle = morto ? '#555' : corT; // braço escudo (esquerda)
  c.beginPath(); c.moveTo(sx - F(6) * fx, sy - F(22)); c.lineTo(nx, sy - F(14) + sobe); c.stroke();
  desenharEquip(c, sx, sy, r, p, { mx, nx, sobe, fx });
  if (flash) { c.fillStyle = '#ffffff99'; c.beginPath(); c.ellipse(sx, sy - F(20), F(13), F(17), 0, 0, 7); c.fill(); }
}

function desenharEquip(c, sx, sy, r, p, maos) {
  const z = zoom, M = maos || { mx: sx + r, nx: sx - r, sobe: 0, fx: 1 };
  const w = p.build?.weapon || (p.npc === 'monstro' ? 'dagger' : 'battleaxe');
  const hx = M.mx, hy = sy - 14 * zoom + (M.sobe || 0); // mão da arma
  c.lineCap = 'round';
  if (w === 'battleaxe') { // cabo + lâmina dupla + espigão: machado legível
    c.strokeStyle = '#6b4423'; c.lineWidth = 3.2 * z;
    c.beginPath(); c.moveTo(hx - 4 * z * M.fx, hy + 10 * z); c.lineTo(hx + 6 * z * M.fx, hy - 12 * z); c.stroke();
    const bx = hx + 6 * z * M.fx, by = hy - 12 * z, s2 = M.fx;
    c.fillStyle = '#e8eef4'; c.strokeStyle = '#2e3438'; c.lineWidth = 2 * z;
    for (const sgn of [1, -1]) { // duas lâminas em meia-lua
      c.beginPath();
      c.moveTo(bx, by - 4 * z);
      c.quadraticCurveTo(bx + 14 * z * s2, by - 11 * z * sgn, bx + 15 * z * s2, by + 1 * z * sgn);
      c.quadraticCurveTo(bx + 14 * z * s2, by + 6 * z * sgn, bx, by + 5 * z);
      c.closePath(); c.fill(); c.stroke();
    }
    c.strokeStyle = '#e8eef4'; c.lineWidth = 1 * z; // fio da lâmina
    for (const sgn of [1, -1]) {
      c.beginPath();
      c.quadraticCurveTo(bx + 14 * z * s2, by - 11 * z * sgn, bx + 15 * z * s2, by + 1 * z * sgn);
      c.stroke();
    }
    c.strokeStyle = '#5a636b'; c.lineWidth = 2 * z; // espigão traseiro
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - 7 * z * s2, by - 1 * z); c.stroke();
  } else if (w === 'dagger') {
    c.strokeStyle = '#8b5a2b'; c.lineWidth = 2.5 * z;
    c.beginPath(); c.moveTo(hx, hy + 2 * z); c.lineTo(hx + 2 * z * M.fx, hy + 7 * z); c.stroke();
    c.strokeStyle = '#dfe7ee'; c.lineWidth = 3 * z;
    c.beginPath(); c.moveTo(hx, hy + 2 * z); c.lineTo(hx + 10 * z * M.fx, hy - 8 * z); c.stroke();
    c.strokeStyle = '#5a636b'; c.lineWidth = 1.5 * z;
    c.beginPath(); c.moveTo(hx - 3 * z, hy); c.lineTo(hx + 3 * z, hy + 2 * z); c.stroke();
  } else if (w === 'fire' || w === 'frost' || w === 'holy') { // cajados: vara longa + foco
    const t = performance.now() / 300;
    c.strokeStyle = '#5a3d22'; c.lineWidth = 2.5 * z;
    c.beginPath(); c.moveTo(hx - 3 * z * M.fx, hy + 12 * z); c.lineTo(hx + 5 * z * M.fx, hy - 14 * z); c.stroke();
    const fx0 = hx + 5 * z * M.fx, fy0 = hy - 14 * z;
    if (w === 'fire') { // brasa pulsante
      const fl = 1 + 0.15 * Math.sin(t);
      c.fillStyle = '#e0642b'; c.beginPath(); c.arc(fx0, fy0, 5 * z * fl, 0, 7); c.fill();
      c.fillStyle = '#ffd54f'; c.beginPath(); c.arc(fx0, fy0, 2.4 * z * fl, 0, 7); c.fill();
    } else if (w === 'frost') { // cristal losango
      c.fillStyle = '#6ec6ff'; c.strokeStyle = '#2c6e9e'; c.lineWidth = 1.5 * z;
      c.beginPath(); c.moveTo(fx0, fy0 - 6 * z); c.lineTo(fx0 + 4 * z, fy0); c.lineTo(fx0, fy0 + 6 * z); c.lineTo(fx0 - 4 * z, fy0); c.closePath(); c.fill(); c.stroke();
    } else { // holy: anel dourado + brilho
      c.strokeStyle = '#e8cf6a'; c.lineWidth = 2.5 * z;
      c.beginPath(); c.arc(fx0, fy0, 5 * z, 0, 7); c.stroke();
      c.fillStyle = '#fff8dc'; c.beginPath(); c.arc(fx0, fy0, 1.8 * z, 0, 7); c.fill();
    }
  }
  const ox = M.nx, oy = sy - 14 * zoom + (M.sobe || 0); // mão secundária
  const off = p.build?.offhand;
  if (off === 'shield') { // escudo pipa c/ boss + friso do time
    c.fillStyle = '#8a8f96'; c.strokeStyle = '#3c4046'; c.lineWidth = 1.5 * z;
    c.beginPath(); c.moveTo(ox, oy - 9 * z); c.lineTo(ox + 7 * z, oy - 5 * z); c.lineTo(ox + 7 * z, oy + 5 * z); c.lineTo(ox, oy + 11 * z); c.lineTo(ox - 7 * z, oy + 5 * z); c.lineTo(ox - 7 * z, oy - 5 * z); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#4a4f55'; c.beginPath(); c.arc(ox, oy, 2.2 * z, 0, 7); c.fill();
  } else if (off === 'torch') { // tocha reconhecível: bastão + chama dupla animada
    const t = performance.now() / 280;
    c.strokeStyle = '#5a3d22'; c.lineWidth = 2.5 * z;
    c.beginPath(); c.moveTo(ox, oy + 9 * z); c.lineTo(ox, oy - 4 * z); c.stroke();
    const fl = 1 + 0.18 * Math.sin(t + ox);
    c.fillStyle = '#e08a2b';
    c.beginPath(); c.moveTo(ox, oy - 12 * z * fl);
    c.quadraticCurveTo(ox + 4.5 * z, oy - 6 * z, ox, oy - 2 * z);
    c.quadraticCurveTo(ox - 4.5 * z, oy - 6 * z, ox, oy - 12 * z * fl);
    c.fill();
    c.fillStyle = '#ffd54f';
    c.beginPath(); c.moveTo(ox, oy - 9 * z * fl);
    c.quadraticCurveTo(ox + 2.4 * z, oy - 5 * z, ox, oy - 3 * z);
    c.quadraticCurveTo(ox - 2.4 * z, oy - 5 * z, ox, oy - 9 * z * fl);
    c.fill();
  } else if (off === 'tome') { // grimório roxo c/ páginas + fecho
    c.fillStyle = '#7a5fc0'; c.strokeStyle = '#3d2c66'; c.lineWidth = 1.5 * z;
    c.beginPath();
    if (c.roundRect) c.roundRect(ox - 5 * z, oy - 7 * z, 10 * z, 13 * z, 1.5 * z);
    else c.rect(ox - 5 * z, oy - 7 * z, 10 * z, 13 * z);
    c.fill(); c.stroke();
    c.strokeStyle = '#d9cdf5'; c.lineWidth = 1 * z;
    c.beginPath(); c.moveTo(ox, oy - 7 * z); c.lineTo(ox, oy + 6 * z); c.stroke();
    c.fillStyle = '#e8cf6a'; c.fillRect(ox - 1.5 * z, oy - 2 * z, 3 * z, 3 * z);
  }
}

/* ---------- HUD ---------- */
function hud(s) {
  const mm = String(Math.floor(((s.endsIn ?? s.timeLeft ?? 0)) / 60000));
  const ss = String(Math.floor((((s.endsIn ?? s.timeLeft ?? 0)) % 60000) / 1000)).padStart(2, '0');
  $('hud-tempo').textContent = (s.endsIn == null && s.timeLeft == null) ? '⏱ ∞ (treino)' : `⏱ ${mm}:${ss}`;
  $('hud-fase').textContent = s.phase ? ` · ${s.phase}` : (s.state === 'ended' ? ' · fim' : '');
  const wv = s.wave;
  if (wv && wv.r !== undefined && wv.active && me()) {
    const el = $('hud-wave'); el.classList.remove('oculto');
    const fora = Math.hypot(me().x - (wv.x ?? 50), me().y - (wv.y ?? 50)) > wv.r;
    el.textContent = fora ? `🌊 FORA DA ÁREA — volte! (r=${Math.round(wv.r)})` : `🌊 área segura (r=${Math.round(wv.r)})`;
  }
  else $('hud-wave').classList.add('oculto');
  const ordem = [...(s.players || [])].sort((a, b) => b.kills - a.kills);
  $('hud-placar').textContent = ordem.map((p) => `${p.nick || p.name}: ${p.kills} elim.`).join(' · ') || '—';
  // PvE em rede: mostra dano/DPS/cura do servidor no painel de treino
  if (s.pve && !modoTreino) {
    $('painel-treino').classList.remove('oculto');
    $('tr-dano').textContent = Math.round(s.pve.dmgTotal);
    $('tr-dps').textContent = Number(s.pve.dps5).toFixed(1).replace('.', ',');
    $('tr-cura').textContent = Math.round(s.pve.healTotal);
    const mef = s.monster && (s.monster.effects || s.monster.efeitos);
    $('tr-efeitos').textContent = (mef && mef.length)
      ? mef.map((e) => typeof e === 'string' ? e : (e.nome || e.id)).join(', ')
      : 'sem efeitos';
  } else if (!modoTreino) {
    $('painel-treino').classList.add('oculto');
  }
  // faixa do editor em rede (monstro parado, efeitos/CDs continuam no servidor)
  const edFx = $('editor-faixa');
  if (edFx) {
    if (editorRedeAberto && s.mode === 'pve' && s.state === 'playing') {
      edFx.classList.remove('oculto');
      edFx.textContent = '🛠 Editor aberto — monstro parado (efeitos e recargas continuam)';
    } else edFx.classList.add('oculto');
  }
  // lateral: linhas compactas (nome + mini-barras + elims + selecionar)
  const lat = $('lista-combate');
  const alvoSel = window._alvo || null;
  lat.innerHTML = (s.players || []).map((p) => {
    const cls = p.id === myId ? 'eu' : (ehAliado(p) ? 'aliado-team' : 'inimigo');
    const nEf = (p.effects || p.efeitos || []).length;
    const estaCaido = caidoDe(p);
    const sel = alvoSel === p.id ? ' 🎯' : '';
    return `<div class="fileira ${cls}${alvoSel === p.id ? ' sel' : ''}" data-selecionar="${p.id}" role="button" tabindex="0" title="${esc(p.nick)} — clique para selecionar">` +
      `<span class="fnome">${p.id === myId ? '● ' : ''}${esc(p.nick)}${p.alive ? '' : ' 💀'}${sel}</span>` +
      `<span class="fbar hp"><i style="width:${100 * p.hp / Math.max(1, p.maxHp)}%"></i></span>` +
      `<span class="fnum">${p.kills} el.</span>` +
      (estaCaido ? `<span class="fcaido">caído</span>` : '') +
      (nEf ? `<span class="fef">${nEf} fx</span>` : '') +
      `</div>`;
  }).join('');
  lat.querySelectorAll('[data-selecionar]').forEach((b) => {
    const sel = () => {
      AudioX.ui();
      window._alvo = b.dataset.selecionar;
      toast('Alvo selecionado. Teclas usam o alvo válido; inimigo caído: F p/ finalizar; aliado caído: Despertar.');
      if (snap) hud(snap);
      hudFinish();
    };
    b.onclick = (ev) => { ev.stopPropagation(); sel(); };
    b.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); sel(); } };
  });
  // painéis jogador + alvo (topo-esquerda, compactos, §4.1)
  const eu = me();
  const cd = eu?.cd || { aa: 0, q: 0, w: 0, e: 0, head: 0, chest: 0, boots: 0 };
  const en = eu?.energy ?? eu?.en ?? 0;
  const b = buildEfetiva();
  const euP = eu;
  const chipEfs = (p) => (p.effects || p.efeitos || []).slice(0, 4).map((e) => {
    const nome = typeof e === 'string' ? e : (e.nome || e.id);
    const tipo = (e.tipo || '').includes('buff') ? 'buff' : (e.tipo || '').includes('escudo') ? 'escudo' : 'debuff';
    return `<span class="ef ${tipo}">${esc(nome)}${e.restante ? ' ' + Math.ceil(e.restante / 1000) + 's' : ''}</span>`;
  }).join('');
  if (euP) {
    $('painel-jogador').innerHTML =
      `<div class="pe-nome">${esc(euP.nick)} <span class="pe-k">· ${euP.kills} el.</span></div>` +
      `<div class="pe-bar hp"><i style="width:${100 * euP.hp / Math.max(1, euP.maxHp)}%"></i><span>${Math.ceil(euP.hp)}/${euP.maxHp}</span></div>` +
      `<div class="pe-bar en"><i style="width:${100 * euP.energy / Math.max(1, euP.maxEnergy)}%"></i><span>${Math.floor(euP.energy)}/${euP.maxEnergy}</span></div>` +
      (chipEfs(euP) ? `<div class="pe-efs">${chipEfs(euP)}</div>` : '');
  }
  const tAlvo = alvoSel && (s.players || []).find((p) => p.id === alvoSel);
  const pa = $('painel-alvo');
  if (tAlvo) {
    const rel = tAlvo.id === myId ? 'você' : (ehAliado(tAlvo) ? 'aliado' : 'inimigo');
    pa.classList.remove('oculto');
    pa.innerHTML =
      `<div class="pe-nome ${rel}">${rel === 'inimigo' ? '⚔ ' : rel === 'aliado' ? '⛨ ' : ''}${esc(tAlvo.nick)} <span class="pe-k">· ${rel}</span></div>` +
      `<div class="pe-bar hp"><i style="width:${100 * tAlvo.hp / Math.max(1, tAlvo.maxHp)}%"></i><span>${Math.ceil(tAlvo.hp)}/${tAlvo.maxHp}</span></div>` +
      `<div class="pe-bar en"><i style="width:${100 * tAlvo.energy / Math.max(1, tAlvo.maxEnergy)}%"></i><span>${Math.floor(tAlvo.energy)}/${tAlvo.maxEnergy}</span></div>` +
      (chipEfs(tAlvo) ? `<div class="pe-efs">${chipEfs(tAlvo)}</div>` : '') +
      (caidoDe(tAlvo) ? `<div class="pe-efs"><span class="ef debuff">caído — ${tAlvo.id === myId ? '' : (!ehAliado(tAlvo) ? 'F p/ finalizar' : 'use Despertar')}</span></div>` : '');
  } else pa.classList.add('oculto');
  // skills compactas: ícone SVG próprio + tecla + varredura de recarga + nº; detalhe no title (§4.2)
  const e2armado = !!(eu && eu.eCombo && eu.eCombo.armed && buildEfetiva().e === 'blood-bandit');
  const carta = (slot, titulo, skillId, cdMs) => {
    const sk = SKILLS[skillId];
    if (!sk) return '';
    const totalMs = Math.max(1, (sk.cd || 0) * 1000);
    const pct = Math.max(0, Math.min(100, (cdMs / totalMs) * 100));
    const e2 = slot === 'E' && e2armado;
    const semRecurso = e2 ? false : (en < sk.custo || cdMs > 0);
    const mirando = mira?.slot === slot ? ' mirando' : '';
    const tecla = slot === 'HEAD' ? '4' : slot === 'CHEST' ? '5' : slot === 'BOOTS' ? '6' : slot;
    const dica = `${titulo} (${tecla}) ${sk.nome} [${sk.en}] · alvo ${sk.alvo} · ${sk.alcance} m · ` +
      (e2 ? `2º uso livre ${(Math.max(0, (eu.eCombo.msLeft || 0)) / 1000).toFixed(0)} s` : `${sk.custo} en · CD ${sk.cd}s`) + ` — ${sk.texto}`;
    return `<div class="tile${semRecurso ? ' sem-recurso' : ''}${mirando}" data-slot="${slot}" role="button" tabindex="0" aria-label="${esc(dica)}" title="${esc(dica)}">` +
      `<span class="t-tecla">${tecla}</span><span class="t-icone">${icone(skillId)}</span>` +
      (e2 ? `<span class="t-e2">E·2 ${(Math.max(0, (eu.eCombo.msLeft || 0)) / 1000).toFixed(0)}s</span>` : '') +
      `<span class="t-nome">${esc(sk.nome)}</span>` +
      (cdMs > 0 && !e2 ? `<span class="t-cdvar" style="height:${pct}%"></span><span class="t-cdnum">${(cdMs / 1000).toFixed(cdMs < 10000 ? 1 : 0)}</span>` : '') + `</div>`;
  };
  const aaCd = cd.aa || 0;
  const aaPct = Math.max(0, Math.min(100, (aaCd / 600) * 100));
  $('barra-skills').innerHTML =
    `<div class="tile${aaCd > 0 ? ' sem-recurso' : ''}" data-slot="AA" role="button" tabindex="0" aria-label="Ataque básico — clique em um inimigo" title="Ataque básico — clique em um inimigo para atacar"><span class="t-tecla">✦</span><span class="t-icone">⚔</span><span class="t-nome">Ataque</span>${aaCd > 0 ? `<span class="t-cdvar" style="height:${aaPct}%"></span><span class="t-cdnum">${(aaCd / 1000).toFixed(1)}</span>` : ''}</div>` +
    carta('Q', 'Habilidade', b.q, cd.q) + carta('W', 'Habilidade', b.w, cd.w) + carta('E', 'Habilidade', b.e, cd.e) +
    carta('HEAD', 'Cabeça', b.headSkill, cd.head) + carta('CHEST', 'Corpo', b.chestSkill, cd.chest) + carta('BOOTS', 'Pés', b.bootsSkill, cd.boots);
  document.querySelectorAll('#barra-skills .tile').forEach((el) => {
    const agir = () => {
      const slot = el.dataset.slot;
      if (slot === 'AA') { toast('Clique em um inimigo para atacar.'); AudioX.ui(); return; }
      // motivo claro antes de armar mira: recarga ou energia (§4.2)
      const mapa = { Q: [b.q, cd.q], W: [b.w, cd.w], E: [b.e, cd.e], HEAD: [b.headSkill, cd.head], CHEST: [b.chestSkill, cd.chest], BOOTS: [b.bootsSkill, cd.boots] };
      const [sid, resto] = mapa[slot] || [];
      const skx = SKILLS[sid];
      // 2º E do Machado: janela do servidor (eCombo) dispensa CD1 e custo — só a janela vale.
      const e2livre = slot === 'E' && sid === 'blood-bandit' && eu && eu.eCombo && eu.eCombo.armed;
      if (skx && resto > 0 && !e2livre) { toast(`${skx.nome}: em recarga (${(resto / 1000).toFixed(1)} s).`, 'erro'); return; }
      if (skx && en < skx.custo && !e2livre) { toast(`${skx.nome}: sem energia (${skx.custo} precisa).`, 'erro'); return; }
      armarMira(slot);
    };
    el.onclick = agir;
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); agir(); } };
  });
  if (mira) {
    const sk = SKILLS[mira.skillId];
    const mi = $('mira-info'); mi.classList.remove('oculto');
    const extraDir = sk && sk.alvo === 'direcao' ? ' Cone ±30° até o alcance, com LOS; vazio = Errou (gasta). Sem dano antes do aceite.' : '';
    mi.innerHTML = sk
      ? `🎯 <b>${mira.slot} · ${esc(sk.nome)}</b> (${sk.alvo}, ${sk.alcance} m) — <b>clique para confirmar</b>, <b>Esc</b> cancela.${extraDir} ${esc(sk.texto)}`
      : 'Mira ativa — clique para confirmar, Esc cancela.';
  } else $('mira-info').classList.add('oculto');
  hudFinish();
}
function hudFinish() {
  const fx = $('finish-info');
  if (!fx) return;
  if (modoTreino) { fx.classList.add('oculto'); return; }
  if (!snap || !myId) { fx.classList.add('oculto'); return; }
  const eu = me();
  const alvo = (window._alvo && snap.players.find((p) => p.id === window._alvo)) || null;
  // snapshot não expõe progresso do finish; mostra estimativa local de 5 s (acabando)
  if (acabando) {
    const vitima = snap.players.find((p) => p.id === acabando.alvo);
    const dt = ((Date.now() - acabando.inicio) / 1000).toFixed(1);
    if (vitima && caidoDe(vitima)) {
      fx.classList.remove('oculto');
      fx.innerHTML = `⏳ Finalizando <b>${esc(vitima.nick)}</b>… ${dt}s/5 s (não ande/não use skill) <button class="mini btn-perigo" id="btn-cancel-finish">Cancelar</button>`;
      const bc = $('btn-cancel-finish');
      if (bc) bc.onclick = () => { ws.send(JSON.stringify({ type: 'move', x: eu.x, y: eu.y })); toast('Finalização cancelada (você moveu).'); acabando = null; hudFinish(); };
      return;
    }
  }
  if (alvo && caidoDe(alvo) && alvo.id !== myId && !ehAliado(alvo)) {
    fx.classList.remove('oculto');
    const onda = snap.wave && snap.wave.active;
    fx.innerHTML = `🎯 <b>${esc(alvo.nick)}</b> está caído. <button class="mini btn-perigo" id="btn-do-finish">Finalizar (5 s)</button>` +
      (onda ? ' <span class="nota">Onda ativa mata direto — sem caído na onda.</span>' : '') +
      (snap.mode === 'pve' ? ' <span class="nota">PvE mata direto (respawn 3 s) — sem finalização.</span>' : '');
    const bf = $('btn-do-finish');
    if (bf) bf.onclick = () => iniciarFinish(alvo.id);
    return;
  }
  if (alvo && caidoDe(alvo) && ehAliado(alvo) && alvo.id !== myId) {
    fx.classList.remove('oculto');
    fx.innerHTML = `💚 <b>${esc(alvo.nick)}</b> caído — use <b>Despertar (Reawaken, W)</b> nele (alcance 12 m, 30% vida).` +
      (snap.mode === 'pve' ? ' <span class="nota">PvE: sem aliado caído válido.</span>' : '');
    return;
  }
  fx.classList.add('oculto');
}
function iniciarFinish(alvoId) {
  if (modoTreino) { toast('Sem finalização no treino local.'); return; }
  if (!snap || !ws || ws.readyState !== 1) return;
  const eu = me();
  const alvo = snap.players.find((p) => p.id === alvoId);
  if (!alvo) { toast('Alvo inválido.', 'erro'); return; }
  if (!caidoDe(alvo)) { toast('Alvo não está caído (PvP/wave/PvE matam direto).', 'erro'); return; }
  if (ehAliado(alvo)) { toast('Só inimigos: aliado caído usa Despertar.', 'erro'); return; }
  if (snap.mode === 'pve') { toast('PvE mata direto (respawn 3 s) — sem finalização.', 'erro'); return; }
  const d = Math.hypot(eu.x - alvo.x, eu.y - alvo.y);
  if (d > 3.5) { toast('Aproxime-se (≤3 m) para finalizar.', 'erro'); return; }
  window._alvo = alvoId;
  acabando = { alvo: alvoId, inicio: Date.now() };
  ws.send(JSON.stringify({ type: 'finish', target: alvoId }));
  AudioX.skill();
  toast('Finalizando… 5 s (não ande, não use skill, não sofra dano).');
}
function armarMira(slot) {
  const skillId = skillIdDoSlot(slot);
  const sk = SKILLS[skillId];
  if (!sk) { toast('Habilidade inválida.'); return; }
  const eu = modoTreino ? TR.jogador : me();
  const enAtual = modoTreino ? (eu ? eu.energy : 0) : energiaAtual();
  const e2mira = !modoTreino && slot === 'E' && skillId === 'blood-bandit' && eu && eu.eCombo && eu.eCombo.armed;
  if (!e2mira && enAtual !== undefined && enAtual < sk.custo) {
    toast(`Sem energia para ${sk.nome} (precisa ${sk.custo}).`, 'erro');
    if (!modoTreino) return; // online: nem arma mira
  }
  if (sk.alvo === 'self') {
    confirmarSkill(slot, skillId, null); // aplica direto
    return;
  }
  // §4.1: com alvo selecionado válido, tecla dispara direto (sem exigir novo clique).
  // Direcional/ponto/área sempre pedem clique; servidor revalida tudo.
  if ((sk.alvo === 'inimigo' || sk.alvo === 'aliado') && window._alvo && !modoTreino && snap && me()) {
    const eu0 = me(), emPve0 = snap.mode === 'pve';
    let ok = false;
    if (emPve0 && window._alvo === '__monster__' && sk.alvo === 'inimigo' && snap.monster && snap.monster.alive) {
      ok = Math.hypot(eu0.x - snap.monster.x, eu0.y - snap.monster.y) <= sk.alcance + 0.5;
    } else if (emPve0 && window._alvo === '__dummy__' && sk.alvo === 'aliado' && snap.dummy) {
      ok = Math.hypot(eu0.x - snap.dummy.x, eu0.y - snap.dummy.y) <= sk.alcance + 0.5;
    } else {
      const t0 = snap.players.find((p) => p.id === window._alvo);
      if (t0 && !t0.left && t0.alive && !caidoDe(t0)) {
        const aliado = ehAliado(t0);
        if ((sk.alvo === 'inimigo' && !aliado) || (sk.alvo === 'aliado' && aliado && t0.id !== myId)) {
          ok = Math.hypot(eu0.x - t0.x, eu0.y - t0.y) <= sk.alcance + 0.5;
        }
      }
    }
    if (ok) { confirmarSkill(slot, skillId, window._alvo); return; }
    // seleção inválida/distante: cai na mira p/ novo clique (sem erro que bloqueie).
  }
  mira = { slot, skillId };
  AudioX.ui();
  if (!modoTreino && snap) hud(snap); else { hudTreino(); desenharTreinoVazio(); }
}

/* ---------- entrada: clique / teclado / zoom ---------- */
let mouseClient = null; // L6: posição do mouse p/ mira por tipo (coords CSS px no canvas)
cv.addEventListener('mousemove', (ev) => {
  const r = cv.getBoundingClientRect();
  mouseClient = { x: ev.clientX - r.left, y: ev.clientY - r.top };
});
cv.addEventListener('mouseleave', () => { mouseClient = null; });
cv.addEventListener('click', (ev) => {
  AudioX.ensure();
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const sx = (ev.clientX - r.left) * dpr, sy = (ev.clientY - r.top) * dpr;
  if (modoTreino) return cliqueTreino(sx, sy);
  if (!snap || !myId) return;
  const eu = me(); if (!eu || (!eu.alive && !caidoDe(eu))) return;
  const [wx, wy] = s2w(sx, sy, eu.x, eu.y, cv.width, cv.height);
  if (mira) { confirmarComClique(wx, wy); return; }
  // caído próximo? seleciona (p/ finish/ajuda) sem mover
  let caido = null, bdCaido = 1.8;
  for (const p of snap.players) {
    if (p.id === myId || p.left) continue;
    if (!caidoDe(p)) continue;
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d < bdCaido) { bdCaido = d; caido = p; }
  }
  if (caido) {
    window._alvo = caido.id;
    hud(snap);
    toast(ehAliado(caido) ? 'Aliado caído selecionado — use Despertar (Reawaken) nele.' : 'Inimigo caído selecionado — Finalizar (5 s).');
    AudioX.ui();
    return;
  }
  // inimigo próximo?
  let foe = null, best = 1.8;
  for (const p of snap.players) {
    if (p.id === myId || !p.alive || p.left) continue;
    if (ehAliado(p)) continue; // sem fogo amigo
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d < best) { best = d; foe = p; }
  }
  if (foe) { window._alvo = foe.id; ws.send(JSON.stringify({ type: 'attack', target: foe.id })); AudioX.ataque(); }
  else if (snap.mode === 'pve' && snap.monster && snap.monster.alive && Math.hypot(snap.monster.x - wx, snap.monster.y - wy) < 2.5) {
    window._alvo = '__monster__'; ws.send(JSON.stringify({ type: 'attack', target: '__monster__' })); AudioX.ataque();
  }
  else if (snap.mode === 'pve' && snap.dummy && Math.hypot(snap.dummy.x - wx, snap.dummy.y - wy) < 2.5) {
    window._alvo = '__dummy__';
    toast('Boneco é aliado: use habilidade de cura (ex.: Cajado Sagrado).');
  }
  else { window._alvo = null; ws.send(JSON.stringify({ type: 'move', x: +wx.toFixed(1), y: +wy.toFixed(1) })); }
});
function confirmarComClique(wx, wy) {
  const { slot, skillId } = mira;
  const sk = SKILLS[skillId];
  if (!sk) { mira = null; return; }
  const eu = me();
  let alvoId = null, melhor = 2.0;
  for (const p of snap.players) {
    if (p.id === myId) { if (sk.alvo === 'self') alvoId = myId; continue; }
    if (p.left) continue;
    const estaCaido = caidoDe(p);
    // Reawaken pode mirar caído; demais ignoram caído (exceto finish separado)
    if (!p.alive && !estaCaido) continue;
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d < melhor) {
      if (sk.alvo === 'inimigo' && !ehAliado(p) && !estaCaido) { melhor = d; alvoId = p.id; }
      if (sk.alvo === 'aliado' && ehAliado(p) && p.id !== myId) {
        const ehReaw = skillId === 'reawaken';
        if ((estaCaido && ehReaw) || (!estaCaido)) { melhor = d; alvoId = p.id; }
      }
    }
  }
  const emPve = snap.mode === 'pve';
  if (sk.alvo === 'inimigo' || sk.alvo === 'aliado') {
    // PvE em rede: monstro (__monster__) é o inimigo; boneco (__dummy__), o aliado de cura.
    if (emPve && sk.alvo === 'aliado' && snap.dummy) {
      if (skillId === 'reawaken') { toast('PvE: sem aliado caído válido.', 'erro'); return; }
      confirmarSkill(slot, skillId, '__dummy__'); return;
    }
    if (emPve && sk.alvo === 'inimigo' && snap.monster && snap.monster.alive && !alvoId) {
      const md = Math.hypot(eu.x - snap.monster.x, eu.y - snap.monster.y);
      if (md > sk.alcance + 0.5) { toast(`${sk.nome}: fora de alcance (${sk.alcance} m). Aproxime-se.`, 'erro'); return; }
      if (energiaAtual() < sk.custo) { toast(`${sk.nome}: sem energia (${sk.custo} precisa).`, 'erro'); return; }
      confirmarSkill(slot, skillId, '__monster__'); return;
    }
    if (!alvoId) {
      if (skillId === 'reawaken') {
        const dica = snap.mode === 'pve' ? 'PvE: sem aliado caído válido (exceção).' : 'Clique em um aliado caído (azul, ⏳).';
        toast(`${sk.nome}: ${dica} (Esc cancela).`, 'erro');
        return;
      }
      const dica = sk.alvo === 'aliado'
        ? (snap.players.length <= 1 ? 'Sem aliado válido (no FFA, Feixe Sacro não tem alvo — use outra habilidade).' : 'Clique em um aliado válido (azul).')
        : 'Clique em um inimigo válido (contorno vermelho).';
      toast(`${sk.nome}: ${dica} (Esc cancela).`, 'erro');
      return; // mantém mira, sem gastar
    }
    const palvo = snap.players.find((p) => p.id === alvoId);
    const dist = Math.hypot(eu.x - palvo.x, eu.y - palvo.y);
    if (dist > sk.alcance + 0.5) { toast(`${sk.nome}: fora de alcance (${sk.alcance} m). Aproxime-se.`, 'erro'); return; }
    if (energiaAtual() < sk.custo) { toast(`${sk.nome}: sem energia (${sk.custo} precisa).`, 'erro'); return; }
    confirmarSkill(slot, skillId, alvoId);
  } else if (sk.alvo === 'ponto' || sk.alvo === 'area') {
    // ponto/área: envia x,y + referência (inimigo próximo ou monstro no PvE)
    let ref = null, bd = 1e9;
    for (const p of snap.players) {
      if (p.id === myId || !p.alive || p.left || ehAliado(p)) continue;
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bd) { bd = d; ref = p; }
    }
    if (!ref && !(emPve && snap.monster && snap.monster.alive)) { toast(`${sk.nome}: sem inimigo na área — clique perto de um inimigo.`, 'erro'); return; }
    confirmarSkill(slot, skillId, ref ? ref.id : '__monster__', { x: wx, y: wy });
  } else if (sk.alvo === 'direcao') {
    let ref = null, bd = 1e9;
    for (const p of snap.players) {
      if (p.id === myId || !p.alive || p.left || ehAliado(p)) continue;
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bd) { bd = d; ref = p; }
    }
    if (!ref && !(emPve && snap.monster && snap.monster.alive)) { toast(`${sk.nome}: mire clicando na direção de um inimigo.`, 'erro'); return; }
    confirmarSkill(slot, skillId, ref ? ref.id : '__monster__', { x: wx, y: wy });
  } else if (sk.alvo === 'self') {
    confirmarSkill(slot, skillId, null);
  }
}
function confirmarSkill(slot, skillId, alvoId, ponto) {
  if (modoTreino) { usarSkillTreino(slot, skillId, alvoId); mira = null; hudTreino(); desenharTreino(); return; }
  // Contrato canônico: {type:'skill', slot:'Q|W|E|HEAD|CHEST|BOOTS', skill:id, target, x, y}
  const msg = { type: 'skill', slot, skill: skillId, target: alvoId };
  if (ponto && Number.isFinite(ponto.x) && Number.isFinite(ponto.y)) { msg.x = +ponto.x.toFixed(1); msg.y = +ponto.y.toFixed(1); }
  else if ((SKILLS[skillId] && (SKILLS[skillId].alvo === 'area' || SKILLS[skillId].alvo === 'ponto' || SKILLS[skillId].alvo === 'direcao')) && alvoId === '__monster__' && snap && snap.monster) {
    msg.x = +snap.monster.x.toFixed(1); msg.y = +snap.monster.y.toFixed(1);
  }
  ws.send(JSON.stringify(msg));
  // Enfileira (sem sobrescrever rajadas) com baselines p/ distinguir aceite de recusa no snapshot.
  const eu0 = me();
  const hpAlvo = (id) => {
    if (!id || !snap) return undefined;
    if (id === '__monster__') return snap.monster ? snap.monster.hp : undefined;
    if (id === '__dummy__') return snap.dummy ? snap.dummy.hp : undefined;
    const pl = snap.players.find((p) => p.id === id);
    return pl ? pl.hp : undefined;
  };
  pendentes.push({
    slot, skillId, t: Date.now(), x: msg.x, y: msg.y, alvo: alvoId,
    baseCd: eu0 && eu0.cd ? eu0.cd[slot.toLowerCase()] : undefined,
    baseCast: !!(eu0 && eu0.cast), baseChan: !!(eu0 && eu0.chan),
    e2: !!(skillId === 'blood-bandit' && eu0 && eu0.eCombo && eu0.eCombo.armed),
    euHp: eu0 ? eu0.hp : undefined, alvoHp: hpAlvo(alvoId),
  });
  if (pendentes.length > 5) pendentes.shift();
  AudioX.ui(); // clique; som de sucesso SÓ no aceite (ack/event), nunca na recusa
  mira = null;
  hud(snap);
}
addEventListener('keydown', (ev) => {
  if (!$('tela-jogo').classList.contains('oculto') === false) return;
  if ($('tela-jogo').classList.contains('oculto')) return;
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const k = ev.key.toLowerCase();
  if (k === 'escape') {
    if (mira) { mira = null; toast('Mira cancelada.'); if (snap) hud(snap); else { hudTreino(); desenharTreino(); } }
    window._alvo = null;
    return;
  }
  if (['q', 'w', 'e'].includes(k)) {
    ev.preventDefault();
    armarMira(k.toUpperCase());
  }
  if (k === '4') { ev.preventDefault(); armarMira('HEAD'); }
  if (k === '5') { ev.preventDefault(); armarMira('CHEST'); }
  if (k === '6') { ev.preventDefault(); armarMira('BOOTS'); }
  if (k === 'f') {
    if (window._alvo && !modoTreino && snap) {
      const al = snap.players.find((p) => p.id === window._alvo);
      if (al && caidoDe(al)) { ev.preventDefault(); iniciarFinish(al.id); }
    }
  }
});
cv.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  zoom = Math.min(2, Math.max(0.5, zoom * (ev.deltaY > 0 ? 0.9 : 1.1)));
  if (snap) desenhar(snap); else desenharTreino();
}, { passive: false });

/* ---------- treino PvE local (sem servidor) ---------- */
const TR = {
  jogador: null, monstro: null, boneco: null,
  dmgTotal: 0, janela: [], curaTotal: 0, efeitos: [],
  timer: null, aberto: false,
};
function danoArma(armaId, slot) {
  const b = { battleaxe: { aa: 98, q: 195, w: 502, e: 640 }, dagger: { aa: 55, q: 230, w: 290, e: 380 }, fire: { aa: 53, q: 178, w: 402, e: 689 }, frost: { aa: 53, q: 293, w: 477, e: 574 }, holy: { aa: 53, q: 330, w: 321, e: 443 } };
  const v = (b[armaId] || b.battleaxe)[slot];
  if (v !== undefined) return v;
  // fallback local p/ ativas de armadura (simplificado, avisado): 150
  return 150;
}
function iniciarTreino() {
  modoTreino = true; snap = null; try { ws && ws.close(); } catch {} editorRedeAberto = false;
  $('tela-menu').classList.add('oculto'); $('tela-lobby').classList.add('oculto');
  $('tela-jogo').classList.remove('oculto'); $('tela-result').classList.add('oculto');
  $('painel-treino').classList.remove('oculto');
  $('hud-fase').textContent = ' · treino';
  const b = lerBuild();
  TR.jogador = { id: 'eu', nick: $('in-nick').value.trim() || 'Você', x: 50, y: 60, hp: 2372, max: 2372, energy: 296, maxEn: 296, cd: { q: 0, w: 0, e: 0, aa: 0, head: 0, chest: 0, boots: 0 }, build: b };
  TR.monstro = { x: 55, y: 55, hp: 1200, max: 1200, vivo: true, voltaEm: 0, atkEm: 0 };
  TR.boneco = { x: 46, y: 56, hp: 300, max: 1200 };
  TR.dmgTotal = 0; TR.janela = []; TR.curaTotal = 0; TR.efeitos = []; TR.ultimoCombate = 0;
  ajustarCanvas();
  toast('Treino solo local: números simplificados (equivalência parcial). Clique no monstro, Q/W/E p/ skills.');
  clearInterval(TR.timer);
  TR.timer = setInterval(passoTreino, 100);
  hudTreino(); desenharTreino();
}
function passoTreino() {
  if (!modoTreino || TR.aberto) return; // editor pausa o monstro; efeitos/CDs continuam
  const agora = Date.now();
  const J = TR.jogador, M = TR.monstro;
  // regen natural: 1%/s de vida e energia fora de combate; em combate, 0% vida + 0,5% energia/s
  const emCombate = agora - (TR.ultimoCombate || 0) <= 10000;
  const taxaHp = emCombate ? 0 : 0.01, taxaEn = emCombate ? 0.005 : 0.01;
  J.hp = Math.min(J.max, J.hp + J.max * taxaHp * 0.1);
  J.energy = Math.min(J.maxEn, J.energy + J.maxEn * taxaEn * 0.1);
  for (const k of ['q', 'w', 'e', 'aa', 'head', 'chest', 'boots']) J.cd[k] = Math.max(0, (J.cd[k] || 0) - 100);
  if (!M.vivo) {
    if (agora >= M.voltaEm) {
      M.vivo = true; M.hp = M.max; M.x = 50 + Math.random() * 8; M.y = 44 + Math.random() * 8;
      TR.dmgTotal = 0; TR.janela = []; TR.efeitos = [];
      toast('Monstro voltou! Contadores de dano zerados.');
    }
    hudTreino(); desenharTreino();
    return;
  }
  // monstro persegue e ataca de perto
  const d = Math.hypot(M.x - J.x, M.y - J.y);
  if (d > 2.2) { M.x += (J.x - M.x) / d * 0.35; M.y += (J.y - M.y) / d * 0.35; }
  else if (agora >= M.atkEm) {
    M.atkEm = agora + 1500;
    J.hp -= 80; TR.ultimoCombate = agora; // sofrer dano entra em combate (R2 §9.1)
    numAcum('eu', J.x, J.y, -80, 'dano');
    AudioX.acerto();
    if (J.hp <= 0) {
      J.hp = J.max; J.x = 50; J.y = 60; J.energy = J.maxEn;
      toast('Você caiu! Reapareceu em 3 s com vida cheia (treino).');
      AudioX.respawn();
      if (TR.aberto) fecharBuild();
    }
  }
  // boneco: se chegou a 100%, espera 5 s e volta a 25%
  if (TR.boneco.hp >= TR.boneco.max && !TR.boneco.espera) {
    TR.boneco.espera = agora + 5000;
  }
  if (TR.boneco.espera && agora >= TR.boneco.espera) {
    TR.boneco.hp = TR.boneco.max * 0.25; TR.boneco.espera = 0;
    toast('Boneco voltou a 25% de vida.');
  }
  TR.janela = TR.janela.filter((e) => agora - e.quando < 5000);
  hudTreino(); desenharTreino();
}
function cliqueTreino(sx, sy) {
  const J = TR.jogador;
  const [wx, wy] = s2w(sx, sy, J.x, J.y, cv.width, cv.height);
  if (mira) {
    const { slot, skillId } = mira;
    const sk = SKILLS[skillId];
    const dm = Math.hypot(TR.monstro.x - wx, TR.monstro.y - wy);
    const db = Math.hypot(TR.boneco.x - wx, TR.boneco.y - wy);
    if (sk.alvo === 'aliado') {
      if (db < 2.5) { usarSkillTreino(slot, skillId, '__dummy__'); mira = null; }
      else toast(`${sk.nome}: clique no boneco aliado ⛨ (Esc cancela).`, 'erro');
    } else if (sk.alvo === 'self') { usarSkillTreino(slot, skillId, null); mira = null; }
    else {
      if (dm < 3 || TR.monstro.vivo === false) { if (dm < 4) { usarSkillTreino(slot, skillId, '__monster__'); mira = null; } else toast('Fora de alcance.', 'erro'); }
      else if (dm < Math.max(3, sk.alcance)) { usarSkillTreino(slot, skillId, '__monster__'); mira = null; }
      else toast(`${sk.nome}: fora de alcance (${sk.alcance} m).`, 'erro');
    }
    hudTreino(); desenharTreino();
    return;
  }
  const dm = Math.hypot(TR.monstro.x - wx, TR.monstro.y - wy);
  const db = Math.hypot(TR.boneco.x - wx, TR.boneco.y - wy);
  if (TR.monstro.vivo && dm < 2.5) {
    ataqueBasicoTreino('__monster__');
  } else if (db < 2.5) {
    toast('Boneco é aliado: use habilidade de cura (ex.: Cajado Sagrado) ou clique no monstro para atacar.');
  } else {
    J.x = Math.min(99, Math.max(1, wx)); J.y = Math.min(99, Math.max(1, wy));
    AudioX.ui();
    desenharTreino();
  }
}
function ataqueBasicoTreino(alvo) {
  const J = TR.jogador;
  if (J.cd.aa > 0) { toast('Ataque básico em recarga.'); return; }
  J.cd.aa = 900;
  const d = danoArma(J.build.weapon, 'aa');
  aplicarDanoTreino(alvo, d);
  AudioX.ataque();
}
function usarSkillTreino(slot, skillId, alvo) {
  const J = TR.jogador, sk = SKILLS[skillId];
  if (!sk) return;
  const cdMs = (J.cd[slot.toLowerCase()] || 0);
  if (cdMs > 0) { toast(`${sk.nome}: em recarga (${(cdMs / 1000).toFixed(1)} s).`, 'erro'); return; }
  if (J.energy < sk.custo) { toast(`${sk.nome}: sem energia (precisa ${sk.custo}).`, 'erro'); return; }
  // valida alvo (treino local: monstro=inimigo, boneco=aliado; self direto)
  if (sk.alvo === 'inimigo' && alvo !== '__monster__') { toast(`${sk.nome}: precisa de inimigo (o monstro).`, 'erro'); return; }
  if (sk.alvo === 'aliado' && alvo !== '__dummy__' && alvo !== null) { toast(`${sk.nome}: precisa de aliado (o boneco). No FFA solo, Feixe Sacro não tem alvo.`, 'erro'); return; }
  J.energy -= sk.custo;
  J.cd[slot.toLowerCase()] = sk.cd * 1000;
  AudioX.skill();
  const ehCura = /cura|heal|prece|generous|holy-flash|sacred|orb|desperate|mend|rejuvenat/i.test(skillId) || (J.build.weapon === 'holy' && (slot === 'Q' || slot === 'E'));
  const chaveDano = (slot === 'Q' || slot === 'W' || slot === 'E') ? slot.toLowerCase() : null;
  const valorBase = chaveDano ? danoArma(J.build.weapon, chaveDano) : danoArma(J.build.weapon, 'q');
  if (ehCura && (alvo === '__dummy__' || sk.alvo === 'self' || alvo === null)) {
    const valor = chaveDano ? danoArma(J.build.weapon, chaveDano) : 150;
    if (alvo === '__dummy__') {
      const eff = Math.min(valor, TR.boneco.max - TR.boneco.hp);
      TR.boneco.hp += eff; TR.curaTotal += eff;
      numAcum('boneco', TR.boneco.x, TR.boneco.y, eff, 'cura');
      AudioX.cura();
    } else {
      const eff = Math.min(valor, J.max - J.hp);
      J.hp += eff; TR.curaTotal += eff;
      numAcum('eu', J.x, J.y, eff, 'cura');
      AudioX.cura();
    }
  } else if (alvo === '__monster__' && TR.monstro.vivo) {
    const valor = valorBase;
    aplicarDanoTreino('__monster__', valor);
    if (slot === 'Q' && J.build.weapon === 'battleaxe') {
      TR.efeitos = [{ nome: 'sangramento', ate: Date.now() + 6000 }];
    }
  } else if (!alvo && sk.alvo === 'self') {
    toast(`${sk.nome} ativado em você.`);
  }
  hudTreino(); desenharTreino();
}
function aplicarDanoTreino(alvo, valor) {
  if (alvo === '__monster__' && TR.monstro.vivo) {
    TR.monstro.hp -= valor; TR.ultimoCombate = Date.now(); // causar dano entra em combate (R2 §9.1)
    TR.dmgTotal += valor;
    TR.janela.push({ quando: Date.now(), valor });
    numAcum('monstro', TR.monstro.x, TR.monstro.y, -valor, 'dano');
    AudioX.acerto();
    if (TR.monstro.hp <= 0) {
      TR.monstro.vivo = false; TR.monstro.voltaEm = Date.now() + 30000;
      TR.efeitos = [];
      toast('Monstro derrotado! Volta em 30 s. Dano zerado no retorno.');
      AudioX.morte();
    }
  }
}
function hudTreino() {
  const J = TR.jogador; if (!J) return;
  $('hud-tempo').textContent = '⏱ ∞ (treino)';
  const ordem = [{ nick: J.nick, kills: 0 }];
  $('hud-placar').textContent = `Treino solo · ${J.nick}`;
  const agora = Date.now();
  const soma5 = TR.janela.filter((e) => agora - e.quando < 5000).reduce((a, e) => a + e.valor, 0);
  $('tr-dano').textContent = Math.round(TR.dmgTotal);
  $('tr-dps').textContent = (soma5 / 5).toFixed(1).replace('.', ',');
  $('tr-cura').textContent = Math.round(TR.curaTotal);
  $('tr-efeitos').textContent = TR.efeitos.length ? TR.efeitos.map((e) => e.nome).join(', ') : 'sem efeitos';
  $('lista-combate').innerHTML =
    `<div class="cartao eu"><div class="nome"><span>● ${esc(J.nick)}</span><span>${Math.ceil(J.hp)}/${J.max}</span></div>` +
    `<div class="barra hp"><i style="width:${100 * J.hp / J.max}%"></i></div>` +
    `<div class="barra en"><i style="width:${100 * J.energy / J.maxEn}%"></i></div></div>` +
    (TR.monstro.vivo
      ? `<div class="cartao inimigo"><div class="nome"><span>👹 Monstro</span><span>${Math.ceil(TR.monstro.hp)}/${TR.monstro.max}</span></div><div class="barra hp"><i style="width:${100 * TR.monstro.hp / TR.monstro.max}%"></i></div></div>`
      : `<div class="cartao"><div class="nome"><span>👹 Monstro</span><span>volta em ${Math.ceil((TR.monstro.voltaEm - Date.now()) / 1000)} s</span></div></div>`) +
    `<div class="cartao aliado-team"><div class="nome"><span>⛨ Boneco</span><span>${Math.ceil(TR.boneco.hp)}/${TR.boneco.max}</span></div><div class="barra hp"><i style="width:${100 * TR.boneco.hp / TR.boneco.max}%"></i></div><div class="nota">Aliado imóvel p/ testar cura (cura real). A 100% volta a 25% em 5 s.</div></div>`;
  const b = TR.jogador.build;
  const carta = (slot, skillId) => {
    const sk = SKILLS[skillId]; if (!sk) return '';
    const cdMs = J.cd[slot.toLowerCase()] || 0;
    const tecla = slot === 'HEAD' ? '4' : slot === 'CHEST' ? '5' : slot === 'BOOTS' ? '6' : slot;
    const dica = `${slot} (${tecla}) ${sk.nome} [${sk.en}] · alvo ${sk.alvo} · ${sk.alcance} m · ${sk.custo} en · CD ${sk.cd}s — ${sk.texto}`;
    return `<div class="tile${cdMs > 0 || J.energy < sk.custo ? ' sem-recurso' : ''}${mira?.slot === slot ? ' mirando' : ''}" data-slot="${slot}" role="button" tabindex="0" aria-label="${esc(dica)}" title="${esc(dica)}">` +
      `<span class="t-tecla">${tecla}</span><span class="t-icone">${icone(skillId)}</span><span class="t-nome">${esc(sk.nome)}</span>` +
      (cdMs > 0 ? `<span class="t-cdvar" style="height:${Math.max(0, Math.min(100, (cdMs / Math.max(1, (sk.cd || 0) * 1000)) * 100))}%"></span><span class="t-cdnum">${(cdMs / 1000).toFixed(1)}</span>` : '') + `</div>`;
  };
  $('barra-skills').innerHTML =
    `<div class="tile" data-slot="AA" role="button" tabindex="0" aria-label="Ataque básico — clique no monstro" title="Ataque básico — clique no monstro"><span class="t-tecla">✦</span><span class="t-icone">⚔</span><span class="t-nome">Ataque</span></div>` +
    carta('Q', b.q) + carta('W', b.w) + carta('E', b.e) +
    carta('HEAD', b.headSkill) + carta('CHEST', b.chestSkill) + carta('BOOTS', b.bootsSkill);
  document.querySelectorAll('#barra-skills .tile').forEach((el) => {
    el.onclick = () => {
      const slot = el.dataset.slot;
      if (slot === 'AA') { toast('Clique no monstro para atacar.'); return; }
      armarMira(slot);
    };
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.onclick(); } };
  });
  $('mira-info').classList.toggle('oculto', !mira);
  if (mira) {
    const sk = SKILLS[mira.skillId];
    if (sk) $('mira-info').innerHTML = `🎯 <b>${mira.slot} · ${esc(sk.nome)}</b> (${sk.alvo}) — <b>clique para confirmar</b>, <b>Esc</b> cancela.`;
  }
}
function desenharTreino() {
  desenhar({
    players: [{ id: 'eu', nick: TR.jogador.nick, x: TR.jogador.x, y: TR.jogador.y, hp: TR.jogador.hp, maxHp: TR.jogador.max, energy: TR.jogador.energy, maxEnergy: TR.jogador.maxEn, alive: true, build: TR.jogador.build, kills: 0 }],
    state: 'playing', endsIn: null, wave: null,
  });
}
function desenharTreinoVazio() { if (TR.jogador) desenharTreino(); }

/* ---------- fiação UI ---------- */
function mostrarAjuda() { $('modal-ajuda').classList.remove('oculto'); }
function fecharBuild(silencioso) {
  $('modal-build').classList.add('oculto');
  TR.aberto = false;
  if (editorRedeAberto && ws && ws.readyState === 1 && !silencioso) {
    try { ws.send(JSON.stringify({ type: 'editor', open: false })); } catch {}
  }
  if (!silencioso) editorRedeAberto = false;
  if (snap && !modoTreino) hud(snap);
}
$('btn-ajuda').onclick = () => { AudioX.ui(); mostrarAjuda(); };
$('btn-ajuda-jogo').onclick = () => { AudioX.ui(); mostrarAjuda(); };
$('btn-ajuda-fechar').onclick = () => { AudioX.ui(); $('modal-ajuda').classList.add('oculto'); };
$('btn-criar').onclick = () => {
  const nick = $('in-nick').value.trim();
  if (!nick) { erroTela('Escolha um apelido.'); return; }
  const vb = validarBuild(lerBuild());
  if (!vb.ok) { erroTela('⚠ Build inválida: ' + vb.problemas.join(' ')); return; }
  const modo = ($('in-modo') && $('in-modo').value) || 'ffa';
  AudioX.ui(); entrarSala(nick, '', { mode: ['ffa', '2v2', 'pve'].includes(modo) ? modo : 'ffa' });
};
$('btn-entrar').onclick = () => {
  const nick = $('in-nick').value.trim();
  const code = $('in-code').value.trim().toUpperCase();
  if (!nick) { erroTela('Escolha um apelido.'); return; }
  if (!/^[A-Z0-9]{4}$/.test(code)) { erroTela('Código com 4 letras/números (ou Criar sala).'); return; }
  const vb = validarBuild(lerBuild());
  if (!vb.ok) { erroTela('⚠ Build inválida: ' + vb.problemas.join(' ')); return; }
  AudioX.ui(); entrarSala(nick, code);
};
$('btn-treino').onclick = () => {
  AudioX.ui();
  const nick = $('in-nick').value.trim() || 'Você';
  // PvE em rede primeiro (usa o snapshot do servidor); sem servidor,
  // cai no treino local com aviso (fallback offline).
  treinoRedePendente = true;
  entrarSala(nick, '', { mode: 'pve' });
};
$('btn-pronto').onclick = () => {
  const b = lerBuild();
  const v = validarBuild(b);
  if (!v.ok) { $('lobby-erro').textContent = '⚠ ' + v.problemas.join(' '); AudioX.erro(); return; }
  AudioX.ui();
  ws.send(JSON.stringify({ type: 'build', build: buildParaServidor(b) }));
  ws.send(JSON.stringify({ type: 'ready', ready: true }));
  toast('Pronto! Aguardando os demais…');
};
for (const [id, modo] of [['btn-modo-ffa', 'ffa'], ['btn-modo-2v2', '2v2'], ['btn-modo-pve', 'pve']]) {
  const el = $(id);
  if (el) el.onclick = () => {
    AudioX.ui();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'mode', mode: modo }));
    else toast('Entre em uma sala para trocar o modo.');
  };
}
$('btn-build').onclick = abrirBuild;
$('btn-equipe').onclick = () => {
  equipeLocal = equipeLocal === 'azul' ? 'vermelha' : 'azul';
  Store.set('prpg-equipe', equipeLocal);
  if (ws && ws.readyState === 1 && snap && snap.state === 'lobby' && snap.mode === '2v2') {
    ws.send(JSON.stringify({ type: 'team', team: equipeLocal === 'azul' ? 0 : 1 }));
    toast(`Equipe ${equipeLocal} (2v2). Trocar de equipe limpa o pronto.`);
  } else {
    toast(`Equipe local: ${equipeLocal} (vale no 2v2; nesta sala é só indicador).`);
  }
  if (snap) renderLobby(snap);
};
function pedirSair(texto, acao) {
  if (confirm(texto)) { AudioX.ui(); acao(); }
}
$('btn-sair-lobby').onclick = () => pedirSair('Sair da sala? Sua vaga libera na hora.', () => ws.send(JSON.stringify({ type: 'leave' })));
$('btn-sair-jogo').onclick = () => {
  if (modoTreino) { pedirSair('Encerrar o treino e voltar ao menu?', () => { clearInterval(TR.timer); modoTreino = false; mostrarMenu(); }); return; }
  pedirSair('Sair da partida? Saída voluntária remove na hora e você não conta como vencedor.', () => ws.send(JSON.stringify({ type: 'leave' })));
};
$('btn-voltar-lobby').onclick = () => {
  AudioX.ui();
  $('tela-result').classList.add('oculto');
  if (modoTreino) { mostrarMenu(); return; }
  ws.send(JSON.stringify({ type: 'return' }));
};
$('btn-build-salvar').onclick = () => {
  const v = validarBuild(buildEdit);
  if (!v.ok) { $('build-erro').textContent = '⚠ ' + v.problemas.join(' '); AudioX.erro(); return; }
  salvarBuild(buildEdit); // persiste última build sem divergir (localStorage = fonte p/ próximo join)
  AudioX.ui();
  toast('Build salva neste navegador.');
  if (modoTreino && TR.jogador) {
    // aplica preservando % de vida/energia e CDs restantes
    const J = TR.jogador;
    const pctHp = J.hp / J.max, pctEn = J.energy / J.maxEn;
    const cds = { ...J.cd };
    J.build = { ...buildEdit };
    J.hp = J.max * pctHp; J.energy = J.maxEn * pctEn;
    J.cd = { q: 0, w: 0, e: 0, aa: 0, head: 0, chest: 0, boots: 0, ...cds };
    fecharBuild();
    hudTreino(); desenharTreino();
    toast('Build aplicada no treino (vida/energia e CDs preservados).');
  } else if (!modoTreino && snap && snap.mode === 'pve' && snap.state !== 'lobby' && ws && ws.readyState === 1) {
    // treino em rede fora do lobby: build + editor (servidor preserva %HP/EN e CDs)
    ws.send(JSON.stringify({ type: 'build', build: buildParaServidor(buildEdit) }));
    ws.send(JSON.stringify({ type: 'editor', open: false }));
    editorRedeAberto = false;
    fecharBuild(true);
    toast('Build aplicada no servidor (vida/energia e CDs preservados).');
    if (snap) hud(snap);
  } else if (snap && snap.state === 'lobby' && ws) {
    ws.send(JSON.stringify({ type: 'build', build: buildParaServidor(buildEdit) }));
    fecharBuild();
    renderLobby(snap);
  } else {
    fecharBuild();
  }
};
$('btn-build-fechar').onclick = () => {
  AudioX.ui();
  if (!modoTreino && snap && snap.mode === 'pve' && snap.state !== 'lobby' && ws && ws.readyState === 1 && editorRedeAberto) {
    try { ws.send(JSON.stringify({ type: 'editor', open: false })); } catch {}
    editorRedeAberto = false;
    toast('Editor fechado — monstro retomou.');
  }
  fecharBuild(true);
  editorRedeAberto = false;
};
function zerarDanoRedeOuLocal() {
  AudioX.ui();
  if (!modoTreino && ws && ws.readyState === 1 && snap && snap.pve) {
    ws.send(JSON.stringify({ type: 'pveReset' })); // sem heal:true — só dano/DPS
    toast('Dano/DPS zerados no servidor (cura mantida).');
    return;
  }
  TR.dmgTotal = 0; TR.janela = []; hudTreino(); toast('Dano/DPS zerados (cura mantida).');
}
function zerarCuraRedeOuLocal() {
  AudioX.ui();
  if (!modoTreino && ws && ws.readyState === 1 && snap && snap.pve) {
    ws.send(JSON.stringify({ type: 'pveReset', heal: true })); // servidor zera SÓ a cura (dano/DPS mantidos)
    toast('Cura zerada no servidor (dano/DPS mantidos).');
    return;
  }
  TR.curaTotal = 0; hudTreino(); toast('Cura zerada (dano mantido).');
}
if ($('btn-treino-zerar-dano')) $('btn-treino-zerar-dano').onclick = zerarDanoRedeOuLocal;
if ($('btn-treino-zerar-cura')) $('btn-treino-zerar-cura').onclick = zerarCuraRedeOuLocal;
if ($('btn-treino-zerar')) $('btn-treino-zerar').onclick = zerarDanoRedeOuLocal; // compat legado
$('btn-treino-build').onclick = () => {
  AudioX.ui();
  if (modoTreino && TR.jogador) {
    TR.aberto = true; buildEdit = { ...TR.jogador.build };
    $('modal-build').classList.remove('oculto'); renderBuildForm();
    return;
  }
  if (!modoTreino && snap && snap.mode === 'pve' && ws && ws.readyState === 1) {
    // editor no treino em rede: abre com botões reais, monstro para (efeitos/CDs continuam no servidor)
    buildEdit = lerBuild();
    $('modal-build').classList.remove('oculto'); renderBuildForm();
    try { ws.send(JSON.stringify({ type: 'editor', open: true })); } catch {}
    editorRedeAberto = true;
    toast('Editor aberto — monstro parado (efeitos e recargas continuam).');
    if (snap) hud(snap);
    return;
  }
  toast('Abra o treino (rede ou solo) para editar a build em jogo.', 'erro');
};
$('btn-treino-sair').onclick = () => {
  if (!modoTreino) { // PvE em rede: sai da sala pelo protocolo (com confirm)
    pedirSair('Encerrar o treino e sair da sala?', () => { try { ws.send(JSON.stringify({ type: 'leave' })); } catch {} });
    return;
  }
  pedirSair('Encerrar o treino?', () => { clearInterval(TR.timer); modoTreino = false; mostrarMenu(); });
};
$('btn-som-jogo').onclick = () => {
  AudioX.ativo = !AudioX.ativo;
  $('chk-som').checked = AudioX.ativo;
  Store.set('prpg-som', AudioX.ativo ? '1' : '0');
  $('btn-som-jogo').textContent = AudioX.ativo ? '🔊' : '🔇';
  toast(AudioX.ativo ? 'Som ativado.' : 'Som mutado.');
};
$('chk-som').onchange = (e) => {
  AudioX.ativo = e.target.checked;
  Store.set('prpg-som', AudioX.ativo ? '1' : '0');
  $('btn-som-jogo').textContent = AudioX.ativo ? '🔊' : '🔇';
};
$('rng-vol').oninput = (e) => {
  AudioX.vol = Number(e.target.value) / 100;
  Store.set('prpg-vol', e.target.value);
};
  if ($('chk-som-menu')) $('chk-som-menu').onchange = (e) => {
    AudioX.ativo = e.target.checked;
    Store.set('prpg-som', AudioX.ativo ? '1' : '0');
    $('chk-som').checked = AudioX.ativo;
    $('btn-som-jogo').textContent = AudioX.ativo ? '🔊' : '🔇';
  };
  if ($('rng-vol-menu')) $('rng-vol-menu').oninput = (e) => {
    AudioX.vol = Number(e.target.value) / 100;
    Store.set('prpg-vol', e.target.value);
    $('rng-vol').value = e.target.value;
  };
/* boot */
(function boot() {
  $('chk-som').checked = AudioX.ativo;
  $('rng-vol').value = Math.round(AudioX.vol * 100);
  $('btn-som-jogo').textContent = AudioX.ativo ? '🔊' : '🔇';
  syncMenuAudio();
  garantirBuildEdit();
  renderMenuBuild();
  hub = parseHub();
  if (hub) {
    const av = $('hub-aviso'); av.classList.remove('oculto');
    av.innerHTML = `Modo Hub ativo · sala <b>${esc(hub.room || '(nova)')}</b> · jogador <b>${esc(hub.name || '—')}</b>` +
      (hub.expect ? ` · esperando ${esc(hub.expect)}` : '') + (hub.slot ? ` · vaga ${esc(hub.slot)}` : '') +
      (hub.erros.length ? `<br>⚠ ${hub.erros.join('<br>⚠ ')}` : '');
    if (hub.name) $('in-nick').value = hub.name;
    if (hub.room) $('in-code').value = hub.room;
    if (hub.hubUrlOk) {
      const bv = $('btn-hub-voltar'); bv.classList.remove('oculto');
      bv.onclick = () => { location.href = hub.hubUrlOk; };
    }
    const lh = $('lobby-hub-info');
    if (hub.hubUrlOk || hub.slot || hub.expect) {
      // mostra após entrar; guarda p/ lobby
      setTimeout(() => {
        if (!$('tela-lobby').classList.contains('oculto')) {
          lh.classList.remove('oculto');
          lh.innerHTML = `Hub: ${hub.slot ? `vaga ${esc(hub.slot)} · ` : ''}${hub.expect ? `esperando ${esc(hub.expect)} · ` : ''}` +
            (hub.hubUrlOk ? `<button id="btn-hub-voltar2" class="mini">↩ Voltar ao Hub</button>` : '');
          const b2 = $('btn-hub-voltar2');
          if (b2) b2.onclick = () => { location.href = hub.hubUrlOk; };
        }
      }, 1500);
    }
    // auto entra sem pedir nome/código (usa o código da reserva do Hub, ambos create=1|0)
    if (!hub.erros.length) {
      setTimeout(() => entrarSala(hub.name, hub.room, { htok: hub.htok || undefined }), 500);
    } else {
      erroTela(hub.erros.join(' '));
    }
  }
  ajustarCanvas();
})();
// Hook p/ E2E (§10): expõe snapshot/ws p/ clique preciso no monstro e leitura autoritativa.
// Não altera o jogo; só leitura + envio pelo mesmo protocolo.
try {
  window.__prpg = {
    get snap() { return snap; },
    get myId() { return myId; },
    get wsState() { return ws ? ws.readyState : -1; },
    get lastAck() { return lastAck; },
    get lastEvent() { return lastEvent; },
    get ackLog() { return ackLog; },
    get flut() { try { return flutuantes.map((f) => ({ id: f.id, tipo: f.tipo, soma: Math.round(f.soma) })); } catch { return []; } },
    send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); },
  };
} catch {}
