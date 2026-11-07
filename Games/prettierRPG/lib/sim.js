'use strict';

// Simulação autoritativa (pura, sem rede): FFA + 2v2 + PvE treino.
// Fonte: docs/PRODUTO.md §§3-4,6-14 + anexos. Valores T8 Normal IP1100.
// APROX marcadas com `shortcut:` (origem + quando ajustar).

const { maxHpFor, maxEnergyFor, validateBuild, DEFAULT_BUILD } = require('./build');
const world = require('./world');
// Fonte única de números: data/equipment.json via lib/catalog.js.
// O sim consulta o catálogo (getSkill/getItem/calcStats); tabelas locais abaixo
// são apenas fallbacks quando o catálogo não cobre um campo.
const catalog = require('./catalog');

const TICK_RATE = 20;
const MOVE_SPEED = 6; // u/s. shortcut: pressuposto operacional, ajustar com teste.
const RESPAWN_MS = 5000;
const PVE_RESPAWN_MS = 3000;
const PROT_MS = 3000;
const MATCH_MS = 5 * 60 * 1000;
const COMBAT_MS = 10000;
const WAVE_START_MS = 120000;
const WAVE_END_MS = 240000;
const WAVE_CENTER = [50, 50];
const WAVE_R0 = 50;
const DOWNED_MS = 15000;
const GETUP_MS = 5000;
const FINISH_MS = 5000;
const RECONNECT_MS = 30000;

// Machado (D.2, AP138). Valores estruturados (custo/CD/alcance) vêm do
// catálogo via skillParams(); magnitudes de efeito seguem o texto de efeito
// do catálogo (effect/formula). shortcut: custo Q=2 (arquivo 1,6; tooltip não confirmado).
const SK = {
  AA: { range: 3, dmg: 98, cd: 1000 / 1.1, cost: 0 },
  Q: { range: 3, dmg: 195, bleed: 83, bleedMs: 6000, cost: 2, cd: 2000 },
  // shortcut: W −16% resistência como +16% dano recebido 8s (Armor/MR exato pendente, F.1).
  W: { range: 3, dmg: 502, cost: 8, cd: 15000, vulnPct: 0.16, vulnMs: 8000 },
  // shortcut: E direcional em cone 30°/17m + LOS (cura etapa2 pelo 1º atingido); cone exato Albion pendente (CATALOGO S1).
  E: {
    range: 17, cost: 40, cd: 10000, stage2Ms: 9000,
    dmgByStacks: [528, 627, 726, 825],
    hit2: 363, healByStacks: [110, 177, 243, 331],
  },
};

// ---- Catálogo como fonte única (conversão short↔canônico + consultas) ----
// Interno do sim usa ids curtos (fire/frost/holy, bridgewatch…); o catálogo
// usa ids canônicos (fire-staff, cape-bridgewatch…). normBuild normaliza para
// curto; simToCanonBuild converte de volta p/ calcStats/validateBuild.
const WEAPON_TO_CANON = { battleaxe: 'battleaxe', dagger: 'dagger', fire: 'fire-staff', frost: 'frost-staff', holy: 'holy-staff', 'fire-staff': 'fire-staff', 'frost-staff': 'frost-staff', 'holy-staff': 'holy-staff' };
const WEAPON_TO_SHORT = { battleaxe: 'battleaxe', dagger: 'dagger', fire: 'fire', frost: 'frost', holy: 'holy', 'fire-staff': 'fire', 'frost-staff': 'frost', 'holy-staff': 'holy' };
const CAPE_TO_CANON = { bridgewatch: 'cape-bridgewatch', 'fort-sterling': 'cape-fort-sterling', lymhurst: 'cape-lymhurst', martlock: 'cape-martlock', thetford: 'cape-thetford', caerleon: 'cape-caerleon', 'cape-bridgewatch': 'cape-bridgewatch', 'cape-fort-sterling': 'cape-fort-sterling', 'cape-lymhurst': 'cape-lymhurst', 'cape-martlock': 'cape-martlock', 'cape-thetford': 'cape-thetford', 'cape-caerleon': 'cape-caerleon' };
const CAPE_TO_SHORT = { bridgewatch: 'bridgewatch', 'fort-sterling': 'fort-sterling', lymhurst: 'lymhurst', martlock: 'martlock', thetford: 'thetford', caerleon: 'caerleon', 'cape-bridgewatch': 'bridgewatch', 'cape-fort-sterling': 'fort-sterling', 'cape-lymhurst': 'lymhurst', 'cape-martlock': 'martlock', 'cape-thetford': 'thetford', 'cape-caerleon': 'caerleon' };
function canonWeapon(w) { return WEAPON_TO_CANON[w] || w; }
function shortWeapon(w) { return WEAPON_TO_SHORT[w] || w; }
function canonCape(c) { return CAPE_TO_CANON[c] || c; }
function shortCape(c) { return CAPE_TO_SHORT[c] || c; }

// Parâmetros estruturados de uma skill direto do catálogo (custo/CD/alcance).
// Retorna null se a skill não existe no catálogo.
function skillParams(skillId) {
  const sk = catalog.getSkill(skillId);
  if (!sk) return null;
  return { id: sk.id, cost: sk.cost, cdMs: Math.round(sk.cd * 1000), range: sk.range, radius: sk.radius, castMs: Math.round((sk.cast || 0) * 1000) };
}

// Atributos do ataque básico direto do item do catálogo (aa/aaSpeed/range).
function aaStatsFor(weapon) {
  const fb = {
    battleaxe: { dmg: 98, cd: 1000 / 1.1, range: 3, type: 'phys' },
    dagger: { dmg: 55, cd: 500, range: 2, type: 'phys' },
    fire: { dmg: 53, cd: 1000 / 1.35, range: 9, type: 'magic' },
    frost: { dmg: 53, cd: 1000 / 1.35, range: 9, type: 'magic' },
    holy: { dmg: 53, cd: 1000 / 1.35, range: 9, type: 'magic' },
  };
  const short = shortWeapon(weapon);
  const base = fb[short] || fb.battleaxe;
  const it = catalog.getItem(canonWeapon(weapon));
  if (!it || !it.stats) return { ...base };
  const st = it.stats;
  return {
    dmg: Number.isFinite(st.aa) ? st.aa : base.dmg,
    cd: st.aaSpeed ? 1000 / st.aaSpeed : base.cd,
    range: Number.isFinite(st.range) ? st.range : base.range,
    type: /staff/i.test(canonWeapon(weapon)) ? 'magic' : (short === 'battleaxe' || short === 'dagger' ? 'phys' : base.type),
  };
}

// Converte build interna (curta) p/ esquema canônico do build.js/catalog.
function simToCanonBuild(n) {
  return {
    weapon: canonWeapon(n.weapon),
    q: n.q, w: n.w, e: n.e,
    weaponPassive: n.wPass || n.weaponPassive,
    offhand: n.offhand,
    head: n.head, headActive: n.hSkill || n.headActive, headPassive: n.hPass || n.headPassive,
    chest: n.chest, chestActive: n.cSkill || n.chestActive,
    chestPassive: n.cPass1 || n.chestPassive, chestPassive2: n.cPass2 || n.chestPassive2,
    boots: n.boots, bootsActive: n.bSkill || n.bootsActive, bootsPassive: n.bPass || n.bootsPassive,
    cape: canonCape(n.cape),
  };
}

// ---- Catálogo jogável (APROX: números do PRODUTO anexos; geometria exata pendente) ----
const WEAPONS = ['battleaxe', 'dagger', 'fire', 'frost', 'holy'];
const OFFHANDS = ['shield', 'tome', 'torch'];
const HEADS = ['mercenary-hood', 'soldier-helmet', 'scholar-cowl'];
const CHESTS = ['mercenary-jacket', 'soldier-armor', 'scholar-robe'];
const BOOTS = ['mercenary-shoes', 'soldier-boots', 'scholar-sandals'];
const CAPES = ['bridgewatch', 'fort-sterling', 'lymhurst', 'martlock', 'thetford', 'caerleon'];

// Ativas de armadura por item (D.7). shortcut: valores pendentes usam conservadores testáveis.
const ARMOR_SKILLS = {
  'mercenary-hood': ['energizing-shield', 'cleanse', 'howl'],
  'soldier-helmet': ['energizing-shield', 'stone-skin', 'block'],
  'scholar-cowl': ['energizing-shield', 'force-field', 'aegis-of-energy'],
  'mercenary-jacket': ['mend-wounds', 'inferno-shield', 'bloodlust'],
  'soldier-armor': ['mend-wounds', 'taunt', 'fury'],
  'scholar-robe': ['mend-wounds', 'frost-shield', 'speed-caster'],
  'mercenary-shoes': ['dodge', 'refreshing-sprint', 'break-free'],
  'soldier-boots': ['dodge', 'rejuvenating-sprint', 'wanderlust'],
  'scholar-sandals': ['dodge', 'energetic-sprint', 'focused-run'],
};
const WEAPON_Q = {
  battleaxe: ['rending-strike', 'rending-spin', 'rending-rage'],
  dagger: ['sunder-armor', 'deadly-swipe', 'assassin-spirit'],
  fire: ['fire-bolt', 'burning-field', 'searing-flame'],
  frost: ['frostbite', 'ice-shard', 'frozen-surge'],
  holy: ['generous-heal', 'smite', 'holy-flash'],
};
const WEAPON_W = {
  battleaxe: ['deadly-chop', 'adrenaline-boost', 'battle-rush', 'internal-bleeding', 'raging-blades'],
  dagger: ['throwing-blades', 'dash', 'forbidden-stab', 'shadow-edge', 'chain-slash'],
  fire: ['flame-blast', 'wall-of-flames', 'raging-flare', 'fire-wave', 'fire-artillery'],
  frost: ['frost-bomb', 'frost-beam', 'frost-nova', 'frost-lance', 'glacial-obelisk'],
  holy: ['sacred-pulse', 'holy-beam', 'holy-blessing', 'holy-orb', 'reawaken'],
};
const WEAPON_E = {
  battleaxe: ['blood-bandit'], dagger: ['bloodthirsty-blade'], fire: ['pyroblast'],
  frost: ['freezing-wind'], holy: ['desperate-prayer'],
};
// Passivas válidas (contínuas ou por contador; Courier inerte sem peso — §14).
const WEAPON_PASS = {
  battleaxe: ['deep-cuts', 'life-leech', 'increased-defense', 'aggressive-rush'],
  dagger: ['deep-cuts', 'life-leech', 'auto-attack-speed', 'aggressive-rush'],
  fire: ['burn', 'energetic', 'aggressive-caster', 'furious'],
  frost: ['frost', 'energetic', 'aggressive-caster', 'furious'],
  holy: ['adrenaline-driven-charity', 'energetic', 'magic-force', 'ascended'],
};
const ARMOR_PASS = {
  'mercenary-hood': ['balanced-mind', 'swiftness', 'quick-thinker'],
  'mercenary-jacket': ['balanced-mind', 'swiftness', 'quick-thinker'],
  'mercenary-shoes': ['courier', 'balanced-mind', 'swiftness', 'quick-thinker'],
  'soldier-helmet': ['toughness', 'authority', 'tenacity'],
  'soldier-armor': ['toughness', 'authority', 'tenacity', 'spirit-crush', 'protective-instinct'],
  'soldier-boots': ['courier', 'toughness', 'authority', 'tenacity'],
  'scholar-cowl': ['aggression', 'concentration', 'efficiency'],
  'scholar-robe': ['aggression', 'concentration', 'efficiency'],
  'scholar-sandals': ['courier', 'aggression', 'concentration', 'efficiency'],
};

const EXT_DEFAULTS = {
  cape: 'bridgewatch',
  hSkill: null, cSkill: null, bSkill: null, // null = primeira opção do item
  wPass: null, hPass: null, cPass1: null, bPass: null,
};

// Bônus de itens (C.1–C.3 + E.1; shortcut: regen% como flat+pequeno%).
const ITEM_HP = {
  battleaxe: 95, dagger: 0, fire: 0, frost: 0, holy: 0,
  'mercenary-hood': 269, 'soldier-helmet': 269, 'scholar-cowl': 269,
  'mercenary-jacket': 539, 'soldier-armor': 539, 'scholar-robe': 539,
  'mercenary-shoes': 269, 'soldier-boots': 269, 'scholar-sandals': 269,
};
const ITEM_EN = {
  battleaxe: 0, dagger: 0, fire: 0, frost: 0, holy: 0,
  shield: 0, tome: 29, torch: 0,
  'mercenary-hood': 98, 'soldier-helmet': 98, 'scholar-cowl': 98,
  'mercenary-jacket': 49, 'soldier-armor': 49, 'scholar-robe': 49,
  'mercenary-shoes': 29, 'soldier-boots': 29, 'scholar-sandals': 29,
};

function normBuild(b) {
  const base = { ...DEFAULT_BUILD, ...(b || {}) };
  const out = { ...EXT_DEFAULTS, ...base };
  // Aceita esquema canônico (build.js/catalog) e normaliza p/ interno curto.
  // Passiva/ativa canônica do DEFAULT só vale p/ o item do DEFAULT; se o item
  // foi trocado sem passiva explícita, reseta (evita passiva obsoleta).
  const inp = b || {};
  const pairs = [
    ['wPass', 'weaponPassive', 'weapon'], ['hPass', 'headPassive', 'head'],
    ['cPass1', 'chestPassive', 'chest'], ['cPass2', 'chestPassive2', 'chest'],
    ['bPass', 'bootsPassive', 'boots'], ['hSkill', 'headActive', 'head'],
    ['cSkill', 'chestActive', 'chest'], ['bSkill', 'bootsActive', 'boots'],
  ];
  for (const [sh, ca, slot] of pairs) {
    if (inp[sh] !== undefined) continue; // curto explícito vence
    if (inp[ca] !== undefined) { out[sh] = inp[ca]; continue; }
    if (inp[slot] !== undefined) out[sh] = null; // item trocou: default canônico obsoleto
    else if (out[ca] !== undefined && (out[sh] === undefined || out[sh] === null)) out[sh] = out[ca];
  }
  out.weapon = shortWeapon(out.weapon);
  out.cape = shortCape(out.cape);
  // armor skills default = primeira opção do item
  if (!out.hSkill) out.hSkill = (ARMOR_SKILLS[out.head] || [])[0] || 'energizing-shield';
  if (!out.cSkill) out.cSkill = (ARMOR_SKILLS[out.chest] || [])[0] || 'mend-wounds';
  if (!out.bSkill) out.bSkill = (ARMOR_SKILLS[out.boots] || [])[0] || 'dodge';
  if (!CAPES.includes(out.cape)) out.cape = 'bridgewatch';
  return out;
}

function validateFullBuild(b) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'build inválida' };
  const n = normBuild(b);
  if (!WEAPONS.includes(n.weapon)) return { ok: false, error: `arma inválida: ${n.weapon}` };
  if (!(WEAPON_Q[n.weapon] || []).includes(n.q)) return { ok: false, error: `Q inválido: ${n.q}` };
  if (!(WEAPON_W[n.weapon] || []).includes(n.w)) return { ok: false, error: `W inválido: ${n.w}` };
  if (!(WEAPON_E[n.weapon] || []).includes(n.e)) return { ok: false, error: `E inválido: ${n.e}` };
  if (!OFFHANDS.includes(n.offhand)) return { ok: false, error: `offhand inválida: ${n.offhand}` };
  if (!HEADS.includes(n.head)) return { ok: false, error: `head inválido` };
  if (!CHESTS.includes(n.chest)) return { ok: false, error: `chest inválido` };
  if (!BOOTS.includes(n.boots)) return { ok: false, error: `boots inválido` };
  if (!(ARMOR_SKILLS[n.head] || []).includes(n.hSkill)) return { ok: false, error: `head skill inválida` };
  if (!(ARMOR_SKILLS[n.chest] || []).includes(n.cSkill)) return { ok: false, error: `chest skill inválida` };
  if (!(ARMOR_SKILLS[n.boots] || []).includes(n.bSkill)) return { ok: false, error: `boots skill inválida` };
  if (!CAPES.includes(n.cape)) return { ok: false, error: `capa inválida` };
  if (n.wPass && !(WEAPON_PASS[n.weapon] || []).includes(n.wPass)) return { ok: false, error: 'passiva arma inválida' };
  if (n.hPass && !(ARMOR_PASS[n.head] || []).includes(n.hPass)) return { ok: false, error: 'passiva head inválida' };
  if (n.cPass1 && !(ARMOR_PASS[n.chest] || []).includes(n.cPass1)) return { ok: false, error: 'passiva chest inválida' };
  if (n.bPass && !(ARMOR_PASS[n.boots] || []).includes(n.bPass)) return { ok: false, error: 'passiva boots inválida' };
  // Soldier Armor: 2ª passiva (spirit-crush/protective-instinct), grupos distintos.
  const P2 = ['spirit-crush', 'protective-instinct'];
  const P1 = ['toughness', 'authority', 'tenacity'];
  if (n.chest === 'soldier-armor') {
    const p2 = n.cPass2;
    if (p2 !== undefined && p2 !== null) {
      if (!P2.includes(p2)) return { ok: false, error: `2ª passiva inválida: ${p2} (exige spirit-crush/protective-instinct)` };
      if (n.cPass1 === p2) return { ok: false, error: 'passivas do peito devem diferir em grupo' };
    }
    if (n.cPass1 !== undefined && n.cPass1 !== null && !P1.includes(n.cPass1) && !P2.includes(n.cPass1)) {
      return { ok: false, error: 'passiva chest inválida' };
    }
  } else if (n.cPass2 !== undefined && n.cPass2 !== null) {
    return { ok: false, error: '2ª passiva só existe na Soldier Armor' };
  }
  // Courier é inerte (sem peso/inventário nesta versão): aceita sem bônus.
  // Compat: base antiga (machado) continua válida pelo validador legado quando sem extras.
  return { ok: true, build: n };
}

function statsFor(build) {
  // Fonte única: calcStats do catálogo (base 1200HP/120EN + bônus dos itens).
  const n = normBuild(build);
  try {
    const st = catalog.calcStats(simToCanonBuild(n));
    if (Number.isFinite(st.maxHp) && Number.isFinite(st.maxEnergy)) {
      return { maxHp: st.maxHp, maxEnergy: st.maxEnergy };
    }
  } catch { /* fallback legado abaixo */ }
  let hp = 1200 + (ITEM_HP[n.weapon] || 0) + (ITEM_HP[n.head] || 0) + (ITEM_HP[n.chest] || 0) + (ITEM_HP[n.boots] || 0);
  let en = 120 + (ITEM_EN[n.offhand] || 0) + (ITEM_EN[n.head] || 0) + (ITEM_EN[n.chest] || 0) + (ITEM_EN[n.boots] || 0) + 20; // capa +20
  return { maxHp: hp, maxEnergy: en };
}

// Modificadores contínuos de build+passivas+offhand (F.2; shortcut: soma simples, sem caps).
function modsFor(p) {
  const b = normBuild(p.build);
  const m = {
    dmgMul: 1, healCast: 0, healRecv: 0, cdr: 0, castMul: 1, costMul: 1,
    defensePct: 0, armor: 0, mr: 0, ccr: 0, ccDur: 0, moveMul: 1, aaSpeed: 1, threat: 1,
    physBonus: 0, magicBonus: 0,
  };
  // Itens: bônus de dano/cura por jaqueta/túnica (C.3).
  if (b.chest === 'mercenary-jacket') { m.dmgMul *= 1.20; m.healCast += 0.20; }
  if (b.chest === 'soldier-armor') { m.dmgMul *= 1.10; m.healCast += 0.10; m.ccDur += 0.40; }
  if (b.chest === 'scholar-robe') { m.dmgMul *= 1.40; m.healCast += 0.40; m.armor += 133; m.mr += 159; m.ccr += 127; }
  if (b.chest === 'soldier-armor') { m.armor += 236; m.mr += 193; m.ccr += 156; }
  if (b.chest === 'mercenary-jacket') { m.armor += 188; m.mr += 188; m.ccr += 138; }
  if (b.offhand === 'shield') m.defensePct += 0.052;
  if (b.offhand === 'torch') { m.aaSpeed *= 1.123; m.cdr += 0.006; }
  if (b.offhand === 'tome') m.castMul *= (1 - 0.021);
  // Robe/sandals regen tratadas no tick via flat.
  const apply = (id) => {
    switch (id) {
      case 'balanced-mind': m.dmgMul *= 1.015; m.healCast += 0.015; m.defensePct += 0.01; break;
      case 'swiftness': m.aaSpeed *= 1.06; break;
      case 'quick-thinker': m.cdr += 0.025; break;
      case 'toughness': m.defensePct += (b.chest === 'soldier-armor' && b.cPass1 === 'toughness') ? 0.05 : 0.025; break;
      case 'authority': m.ccDur += (b.chest === 'soldier-armor' && b.cPass1 === 'authority') ? 0.10 : 0.05; break;
      case 'tenacity': m.ccr += (b.chest === 'soldier-armor' && b.cPass1 === 'tenacity') ? 20 : 10; break;
      case 'aggression': m.dmgMul *= (b.chest === 'scholar-robe' && b.cPass1 === 'aggression') ? 1.08 : 1.035; m.healCast += (b.chest === 'scholar-robe' && b.cPass1 === 'aggression') ? 0.08 : 0.035; break;
      case 'concentration': m.castMul *= (b.chest === 'scholar-robe' && b.cPass1 === 'concentration') ? 0.90 : 0.95; break;
      case 'efficiency': m.costMul *= (b.chest === 'scholar-robe' && b.cPass1 === 'efficiency') ? 0.88 : 0.94; break;
      case 'protective-instinct': m.threat *= 5; break; // +400% (D)
      case 'courier': break; // inerte sem efeito (tooltip informa)
      case 'ascended': m.dmgMul *= 1.05; m.healCast += 0.05; break; // +5% dano/cura contínuo (D.6)
      default: break;
    }
  };
  [b.wPass, b.hPass, b.cPass1, b.cPass2, b.bPass].forEach((x) => x && apply(x));
  // Buffs temporários somam aqui (lidos de p.buffs no cálculo final).
  return m;
}

function effCD(p, baseMs) {
  const mods = modsFor(p);
  let rate = mods.cdr;
  for (const bf of (p.buffs || [])) if (bf.cdr) rate += bf.cdr;
  if (p.glacialBuffUntil && p.glacialBuffUntil > 0) rate += 0.20;
  return baseMs / (1 + Math.max(0, rate));
}
function effCost(p, base) {
  const mods = modsFor(p);
  let mul = mods.costMul;
  if (p.speedCasterUntil && p.speedCasterUntil > 0) mul *= 0.30; // −70%
  return Math.max(0, base * mul);
}
function effCast(p, baseMs) {
  const mods = modsFor(p);
  let mul = mods.castMul;
  for (const bf of (p.buffs || [])) if (bf.castMul) mul *= bf.castMul;
  if (p.speedCasterUntil && p.speedCasterUntil > 0) mul *= 0.50;
  return baseMs * mul;
}
function dmgMulOf(p) {
  const mods = modsFor(p);
  let mul = mods.dmgMul;
  for (const bf of (p.buffs || [])) if (bf.dmgMul) mul *= bf.dmgMul;
  if (p.adrenalineUntil && p.adrenalineUntil > 0) mul *= 1.25;
  if (p.furyStacks) mul *= (1 + 0.08 * p.furyStacks);
  if (p.ragingStacks) mul *= (1 + 0.04 * Math.min(10, p.ragingStacks));
  if (p.aggrRushUntil && p.aggrRushUntil > 0) mul *= (p.build.weapon === 'dagger' ? 1.06 : 1.08);
  if (p.furiousUntil && p.furiousUntil > 0) mul *= 1.10;
  if (p.sunderStacks) mul = mul; // sunder é no alvo (res), não aqui
  return mul;
}
function healCastOf(p) {
  const mods = modsFor(p);
  let add = mods.healCast;
  for (const bf of (p.buffs || [])) if (bf.healCast) add += bf.healCast;
  if (p.charityUntil && p.charityUntil > 0) add += 0.20;
  if (p.desperateStacks) add += 0.05 * Math.min(3, p.desperateStacks);
  return 1 + add;
}

// ---- Geometria de área (Seção A/B) ----
// Regra documentada:
// - Cones/direções: só atingem à FRENTE do conjurador (projeção 0..alcance +
//   meio-ângulo). Largura/ângulo exatos não publicados: aproximação testável
//   CONE_HALF=30° (~60° totais) salvo largura própria documentada por skill.
//   shortcut: ajustar ângulo/largura com teste; indicador futuro = área aplicada.
// - Deslocamento (Dodge/Dash/BreakFree/FrostNova/teleportes/empurrões): NUNCA
//   termina em obstáculo nem fora da arena — para antes/desliza até borda
//   válida (slideTo/pushFrom). moveCommand com destino bloqueado segue inválido.
const CONE_HALF_DEG = 30;
function inCone(sx, sy, tx, ty, px, py, range, halfDeg = CONE_HALF_DEG, baseHalf = 0.6) {
  const dx = tx - sx, dy = ty - sy;
  const len = Math.hypot(dx, dy);
  const ax = len < 1e-6 ? 1 : dx / len, ay = len < 1e-6 ? 0 : dy / len;
  const rx = px - sx, ry = py - sy;
  const proj = rx * ax + ry * ay;
  if (proj < 0 || proj > range) return false;
  const perp = Math.abs(rx * ay - ry * ax);
  return perp <= proj * Math.tan(halfDeg * Math.PI / 180) + baseHalf;
}
// Ponto mais distante no segmento origem→destino fora de obstáculo (raio 0.4).
function slideTo(s, tx, ty) {
  const cx = world.clamp(tx, 0.5, world.W - 0.5), cy = world.clamp(ty, 0.5, world.H - 0.5);
  const dx = cx - s.x, dy = cy - s.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: s.x, y: s.y };
  const n = Math.max(1, Math.ceil(d / 0.25));
  let bx = s.x, by = s.y;
  for (let i = 1; i <= n; i++) {
    const nx = s.x + (dx * i) / n, ny = s.y + (dy * i) / n;
    if (world.isBlocked(nx, ny, 0.4)) break;
    bx = nx; by = ny;
  }
  return { x: bx, y: by };
}
// Empurrão com deslize: nunca termina em obstáculo/fora da arena.
function pushFrom(p, fx, fy, dist) {
  const dx = p.x - fx, dy = p.y - fy;
  const len = Math.hypot(dx, dy) || 1;
  const t = slideTo(p, p.x + (dx / len) * dist, p.y + (dy / len) * dist);
  p.x = t.x; p.y = t.y;
}
// Passo do monstro (PvE) com desprendimento de borda: tenta diagonal,
// eixo-x, eixo-y e — se as 3 bloquearem por épsilon de float na borda
// expandida do obstáculo — passos laterais/recuo p/ não travar para
// sempre. Só navegação do monstro; regra do player intacta.
function monsterSlide(mo, dx, dy, step) {
  let ux = dx, uy = dy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) { ux = 1; uy = 0; } else { ux = dx / len; uy = dy / len; }
  const nx = mo.x + ux * step, ny = mo.y + uy * step;
  if (!world.isBlocked(nx, ny, 0.4)) { mo.x = nx; mo.y = ny; return true; }
  if (!world.isBlocked(nx, mo.y, 0.4)) { mo.x = nx; return true; }
  if (!world.isBlocked(mo.x, ny, 0.4)) { mo.y = ny; return true; }
  const cands = [
    [mo.x - uy * step, mo.y + ux * step],
    [mo.x + uy * step, mo.y - ux * step],
    [mo.x - ux * step, mo.y - uy * step],
  ];
  for (const [cx, cy] of cands) {
    if (!world.isBlocked(cx, cy, 0.4)) { mo.x = cx; mo.y = cy; return true; }
  }
  return false;
}
// Itera vítimas de timers de área (players + monstro PvE), sem o conjurador.
function timerFoes(m, t, fn) {
  for (const p of m.players.values()) {
    if (p.left || !p.alive || p.knocked) continue;
    const src = m.players.get(t.from);
    if (src && m.mode === '2v2' && p.team === src.team) continue;
    if (p.id === t.from) continue;
    fn(p);
  }
  if (m.mode === 'pve' && m.monster && m.monster.alive && t.from !== '__monster__') fn(m.monster);
}
// Itera inimigos de s (players + monstro PvE). p.isMonster distingue.
function eachFoe(m, s, fn) {
  for (const p of m.players.values()) {
    if (p.id === s.id || p.left || !p.alive || p.knocked) continue;
    if (m.mode === '2v2' && p.team === s.team) continue;
    fn(p);
  }
  if (m.mode === 'pve' && m.monster && m.monster.alive) fn(m.monster);
}
function foeId(p) { return p.isMonster ? '__monster__' : p.id; }

// Regra custo/recarga por tipo (§14/4.5), aplicada em todo spendAndBreak/go:
// - alvo/estado inválido ANTES de gastar → rejeita sem gastar (sem energia, sem CD);
// - lançamento válido (alvo+alcance+estado ok) → gasta energia e inicia CD mesmo
//   se errar/falhar depois (cone vazio, esquiva, morte no voo);
// - área vazia permitida → gasta, retorna ok (ponto válido) ou 'Errou.' gasto
//   (cone/direção que exige acerto) — documentado por skill;
// - bloqueio (sem energia/CD/estado) → rejeita sem gastar, informa motivo.

// ---- Partida ----
function createMatch(code, opts = {}) {
  const mode = opts.mode === '2v2' ? '2v2' : opts.mode === 'pve' ? 'pve' : 'ffa';
  const m = {
    code, state: 'lobby', mode,
    players: new Map(), time: 0,
    endsAt: mode === 'pve' ? null : (opts.durationSec || 300) * 1000,
    durationMs: (opts.durationSec || 300) * 1000,
    winnerIds: [], result: null, autoReturnAt: null,
    round: 1, wins: { 0: 0, 1: 0 }, roundState: 'lobby', roundEndsAt: null, intervalUntil: null,
    waveRadius: WAVE_R0, timers: [],
    monster: null, dummy: null, editorOpenCount: 0,
    pve: mode === 'pve' ? { dmgTotal: 0, dmgWindow: [], healTotal: 0 } : null,
    maxPerTeam: 2,
    // Protocolo compatível: sequência + anel de eventos por comando (ack/event no servidor).
    seq: 0, events: [],
  };
  if (mode === 'pve') {
    m.monster = {
      isMonster: true, x: 60, y: 60, hp: 2500, maxHp: 2500, alive: true,
      respawnAt: null, cd: 0, target: null,
      // mesmos campos de efeito dos players p/ motor único (Seção 5)
      buffs: [], shields: [], dots: [], bleeds: [],
      cc: { stunUntil: 0, rootUntil: 0, silenceUntil: 0, slowUntil: 0, slowPct: 0 },
      vulnUntil: 0, sunderStacks: 0, sunderUntil: 0, rend: 0, rendUntil: 0,
      healDebuffUntil: 0, burnTagUntil: 0, frostbiteStacks: 0, frostbiteUntil: 0,
      smiteBonusUntil: 0, forbiddenUntil: 0, tauntVulnUntil: 0, howlWeakUntil: 0,
      fleeUntil: 0, fleeFx: 0, fleeFy: 0, lastFledWall: null,
    };
    m.dummy = { x: 40, y: 40, hp: 625, maxHp: 2500, waitUntil: null }; // 25% de 2500 (fora da torre central)
  }
  return m;
}

function activePlayers(m) { return [...m.players.values()].filter((p) => !p.left); }
function pickSpawn(m, idx) {
  const others = [...m.players.values()].filter((p) => p.alive && !p.left);
  let best = world.SPAWNS[idx % world.SPAWNS.length];
  let bestD = -1;
  for (const s of world.SPAWNS) {
    if (world.isBlocked(s[0], s[1], 0.5)) continue;
    let md = Infinity;
    for (const o of others) md = Math.min(md, world.dist(s[0], s[1], o.x, o.y));
    if (others.length === 0) md = 1;
    if (md > bestD) { bestD = md; best = s; }
  }
  return { x: best[0], y: best[1] };
}

function joinPlayer(m, id, nick, build, team) {
  if (m.state === 'playing' || m.state === 'ended' && m.mode !== 'pve') {
    if (m.state === 'playing') return { ok: false, error: 'Partida em andamento; aguarde o fim.' };
  }
  if (m.mode === 'pve' && activePlayers(m).length >= 1 && ![...m.players.keys()].includes(id)) {
    // treino individual: 1 jogador (+boneco/monstro). shortcut: 1 vaga.
    if (!m.players.has(id)) return { ok: false, error: 'Treino individual: sala ocupada.' };
  }
  if (m.mode !== 'pve' && activePlayers(m).length >= 12) return { ok: false, error: 'Sala cheia (máx. 12).' };
  const name = String(nick || '').trim().slice(0, 20);
  if (!name) return { ok: false, error: 'Apelido vazio.' };
  for (const p of m.players.values()) {
    if (p.nick.toLowerCase() === name.toLowerCase()) return { ok: false, error: 'Apelido já usado nesta sala.' };
  }
  let nb = normBuild(build || {});
  // Compat legado: valida base antiga; estendido cobre resto.
  const vf = validateFullBuild({ ...nb });
  if (!vf.ok) {
    const v = validateBuild({ weapon: nb.weapon, q: nb.q, w: nb.w, e: nb.e, offhand: nb.offhand, head: nb.head, chest: nb.chest, boots: nb.boots });
    if (!v.ok) return { ok: false, error: vf.error || v.error };
    nb = normBuild({ ...DEFAULT_BUILD, ...(build || {}) });
  } else nb = vf.build;
  let tm = null;
  if (m.mode === '2v2') {
    tm = team === 0 || team === 1 ? team : null;
    if (tm !== null) {
      const c = activePlayers(m).filter((p) => p.team === tm).length;
      if (c >= 2) return { ok: false, error: 'Equipe completa (máx. 2).' };
    }
  }
  if (m.mode === 'pve') tm = null;
  const st = statsFor(nb);
  m.players.set(id, {
    id, nick: name, build: nb, team: tm, ready: false,
    x: 0, y: 0, dest: null, chase: null,
    hp: st.maxHp, maxHp: st.maxHp, energy: st.maxEnergy, maxEnergy: st.maxEnergy,
    alive: true, respawnAt: null, protUntil: 0, lastCombat: -1e12,
    cd: { aa: 0, q: 0, w: 0, e: 0, head: 0, chest: 0, boots: 0 },
    buffs: [], shields: [], dots: [], hots: [],
    cc: { stunUntil: 0, rootUntil: 0, silenceUntil: 0, slowUntil: 0, slowPct: 0 },
    immuneDmgUntil: 0, immuneCCUntil: 0, castUntil: 0,
    rend: 0, rendUntil: 0, bleeds: [], healDebuffUntil: 0, vulnUntil: 0, sunderStacks: 0, sunderUntil: 0,
    assassinStacks: 0, assassinUntil: 0, eStage: null, searingStage: 0, searingUntil: 0,
    assassinSpiritOn: false, assassinSpiritUntil: 0, bloodthirstyOn: false, bloodthirstyUntil: 0,
    adrenalineUntil: 0, furyStacks: 0, furyUntil: 0, ragingStacks: 0, ragingUntil: 0,
    aggrRushUntil: 0, furiousUntil: 0, charityUntil: 0, desperateStacks: 0, desperateUntil: 0,
    speedCasterUntil: 0, frostShieldUntil: 0, stoneSkinUntil: 0, blockUntil: 0,
    glacialBuffUntil: 0, aegisUntil: 0, forceFieldCd: 0,
    aaCount: 0, spellCount: 0, aaHasteUntil: 0, burnStacks: 0,
    frostbiteStacks: 0, frostbiteUntil: 0, smiteBonusUntil: 0,
    holyBeamTicks: 0, channel: null, pendingCast: null,
    capeCdUntil: 0, capeBridgeUntil: 0, lymhurstUntil: 0, martlockUntil: 0, thetfordIcdUntil: 0,
    knocked: false, knockedUntil: 0, gettingUpUntil: 0, finish: null, reawakenLockUntil: 0,
    waveSec: 0, lastDmgFrom: null, lastDmgAt: -1e12,
    kills: 0, deaths: 0, dmgDealt: 0, dmgTaken: 0, healDone: 0, shieldAbsorbed: 0,
    disconnected: false, left: false, editorOpen: false, threat: 1,
  });
  return { ok: true };
}

function leavePlayer(m, id) {
  const p = m.players.get(id);
  if (!p) {
    if (activePlayers(m).length === 0) return 'empty';
    return 'ok';
  }
  p.left = true; p.alive = false; p.respawnAt = null; p.dest = null; p.eStage = null;
  p.knocked = false; p.channel = null; p.finish = null;
  if (activePlayers(m).length === 0) return 'empty';
  if (m.state === 'playing') checkRoundEnd(m);
  return 'ok';
}

function setTeam(m, id, team) {
  const p = m.players.get(id);
  if (!p || m.state !== 'lobby' || p.left) return { ok: false };
  if (m.mode !== '2v2') return { ok: false, error: 'Modo sem equipes.' };
  if (team !== 0 && team !== 1) return { ok: false, error: 'Equipe inválida.' };
  if (activePlayers(m).filter((x) => x.team === team && x.id !== id).length >= 2) {
    return { ok: false, error: 'Equipe completa (máx. 2).' };
  }
  p.team = team; p.ready = false; // troca equipe limpa pronto (§6)
  return { ok: true };
}

function setMode(m, idOrNull, mode, isCreator) {
  if (!['ffa', '2v2', 'pve'].includes(mode)) return { ok: false, error: 'Modo inválido.' };
  if (m.state !== 'lobby') return { ok: false, error: 'Modo só muda no lobby.' };
  if (mode === '2v2') {
    const n = activePlayers(m).length;
    if (n > 4) return { ok: false, error: 'Muitas pessoas para 2v2 (máx. 4).' };
  }
  if (mode === 'pve' && activePlayers(m).length > 1) return { ok: false, error: 'PvE é individual.' };
  m.mode = mode;
  if (mode === '2v2') { m.round = 1; m.wins = { 0: 0, 1: 0 }; }
  if (mode === 'pve' && !m.monster) {
    m.monster = {
      isMonster: true, x: 60, y: 60, hp: 2500, maxHp: 2500, alive: true,
      respawnAt: null, cd: 0, target: null,
      buffs: [], shields: [], dots: [], bleeds: [],
      cc: { stunUntil: 0, rootUntil: 0, silenceUntil: 0, slowUntil: 0, slowPct: 0 },
      vulnUntil: 0, sunderStacks: 0, sunderUntil: 0, rend: 0, rendUntil: 0,
      healDebuffUntil: 0, burnTagUntil: 0, frostbiteStacks: 0, frostbiteUntil: 0,
      smiteBonusUntil: 0, forbiddenUntil: 0, tauntVulnUntil: 0, howlWeakUntil: 0,
      fleeUntil: 0, fleeFx: 0, fleeFy: 0, lastFledWall: null,
    };
    m.dummy = { x: 40, y: 40, hp: 625, maxHp: 2500, waitUntil: null };
    m.pve = { dmgTotal: 0, dmgWindow: [], healTotal: 0 };
  }
  if (mode !== 'pve') { m.monster = null; m.dummy = null; m.pve = null; }
  m.endsAt = mode === 'pve' ? null : m.durationMs;
  for (const p of m.players.values()) { p.ready = false; if (mode !== '2v2') p.team = null; }
  return { ok: true };
}

function setReady(m, id, ready) {
  const p = m.players.get(id);
  if (!p || m.state !== 'lobby' || p.left) return { ok: false };
  if (m.mode === 'pve') {
    // treino: exige build válida; 1 pronto inicia.
    p.ready = !!ready;
    if (activePlayers(m).some((x) => x.ready)) startMatch(m);
    return { ok: true, started: m.state === 'playing' };
  }
  if (m.mode === '2v2') {
    if (p.team !== 0 && p.team !== 1) return { ok: false, error: 'Escolha uma equipe.' };
    p.ready = !!ready;
    const t0 = activePlayers(m).filter((x) => x.team === 0 && x.ready).length;
    const t1 = activePlayers(m).filter((x) => x.team === 1 && x.ready).length;
    if (t0 === 2 && t1 === 2) startMatch(m);
    return { ok: true, started: m.state === 'playing' };
  }
  p.ready = !!ready;
  const active = activePlayers(m);
  if (active.length >= 2 && active.every((x) => x.ready)) startMatch(m);
  return { ok: true, started: m.state === 'playing' };
}

function resetFighter(m, p, x, y) {
  const st = statsFor(p.build);
  p.x = x; p.y = y; p.dest = null; p.chase = null;
  p.maxHp = st.maxHp; p.hp = p.maxHp; p.maxEnergy = st.maxEnergy; p.energy = p.maxEnergy;
  p.alive = true; p.respawnAt = null; p.protUntil = 0; p.lastCombat = -1e12;
  p.cd = { aa: 0, q: 0, w: 0, e: 0, head: 0, chest: 0, boots: 0 };
  p.buffs = []; p.shields = []; p.dots = []; p.hots = [];
  p.cc = { stunUntil: 0, rootUntil: 0, silenceUntil: 0, slowUntil: 0, slowPct: 0 };
  p.immuneDmgUntil = 0; p.immuneCCUntil = 0; p.castUntil = 0;
  p.rend = 0; p.bleeds = []; p.healDebuffUntil = 0; p.vulnUntil = 0;
  p.sunderStacks = 0; p.eStage = null; p.searingStage = 0;
  p.assassinSpiritOn = false; p.bloodthirstyOn = false; p.bloodthirstyUntil = 0; p.adrenalineUntil = 0;
  p.bloodlustPool = 0; p.fleeUntil = 0;
  p.furyStacks = 0; p.ragingStacks = 0; p.channel = null; p.pendingCast = null;
  p.frostReady = false; p.magicReady = false; p.ironSkinUntil = 0;
  p.infernoUntil = 0; p.bloodlustUntil = 0; p.wanderlustUntil = 0;
  p.knocked = false; p.knockedUntil = 0; p.gettingUpUntil = 0; p.finish = null;
  p.waveSec = 0; p.aaCount = 0; p.spellCount = 0;
  p.capeCdUntil = 0; p.capeBridgeUntil = 0;
}

function startMatch(m) {
  m.state = 'playing'; m.time = 0;
  m.winnerIds = []; m.result = null; m.autoReturnAt = null;
  if (m.mode === 'ffa') { m.endsAt = m.durationMs; }
  if (m.mode === '2v2') { m.round = 1; m.wins = { 0: 0, 1: 0 }; startRound(m); return; }
  if (m.mode === 'pve') { m.endsAt = null; }
  let i = 0;
  for (const p of m.players.values()) {
    if (p.left) continue;
    const s = pickSpawn(m, i++);
    resetFighter(m, p, s.x, s.y);
    p.kills = 0; p.deaths = 0; p.dmgDealt = 0; p.dmgTaken = 0; p.healDone = 0; p.shieldAbsorbed = 0;
  }
  if (m.mode === 'pve') {
    if (m.monster.spiritBase != null) { m.monster.maxHp = m.monster.spiritBase; m.monster.spiritBase = null; m.monster.spiritUntil = 0; }
    m.monster.hp = m.monster.maxHp; m.monster.alive = true; m.monster.respawnAt = null;
    m.monster.dots = []; m.monster.bleeds = [];
    m.monster.cc = { stunUntil: 0, rootUntil: 0, silenceUntil: 0, slowUntil: 0, slowPct: 0 };
    m.monster.vulnUntil = 0; m.monster.sunderStacks = 0; m.monster.sunderUntil = 0;
    m.monster.rend = 0; m.monster.rendUntil = 0; m.monster.target = null;
    m.monster.fleeUntil = 0; m.monster.lastFledWall = null;
    m.dummy.hp = m.dummy.maxHp * 0.25; m.dummy.waitUntil = null;
    m.pve = { dmgTotal: 0, dmgWindow: [], healTotal: 0 };
  }
}

function startRound(m) {
  m.roundState = 'playing'; m.time = m.time || 0;
  let i = (m.round - 1) * 4;
  for (const p of m.players.values()) {
    if (p.left) continue;
    const s = pickSpawn(m, i++);
    resetFighter(m, p, s.x, s.y);
  }
  m.roundStartAt = m.time;
}

// ---- Alvos / permissão ----
function isAlly(m, a, b) {
  if (a.id === b.id) return true;
  if (m.mode === '2v2') return a.team !== null && a.team === b.team;
  if (m.mode === 'pve') return false; // só jogador; boneco tratado à parte
  return a.id === b.id; // FFA: si mesmo apenas
}
function isEnemy(m, a, b) {
  if (a.id === b.id) return false;
  if (b.left || !b.alive || b.knocked) return false;
  if (m.mode === '2v2') return a.team !== b.team;
  return true; // FFA todos inimigos; PvE monstro é inimigo separado
}

function canAct(m, p, now) {
  if (m.state !== 'playing' || !p.alive || p.left || p.knocked) return false;
  if (p.fleeUntil > now) return false; // fuga da parede: sem ataque/skills 0,5s (D.4)
  if (now < p.castUntil) return false;
  if (now < p.cc.stunUntil) return false;
  if (p.channel && p.channel.lock) return false;
  if (p.blockUntil > now) return false; // Block: sem ataque/skills (D.7)
  return true;
}
function canMove(m, p, now) {
  if (m.state !== 'playing' || !p.alive || p.left || p.knocked) return false;
  if (now < p.cc.stunUntil || now < p.cc.rootUntil) return false;
  if (p.channel && p.channel.lockMove) return false;
  return true;
}

function spend(p, now, cost, cdKey, cdMs) {
  cost = effCost(p, cost);
  cdMs = effCD(p, cdMs);
  if (p.energy < cost) return { ok: false, error: 'Sem energia.' };
  if (now < p.cd[cdKey]) return { ok: false, error: 'Em recarga.' };
  p.energy -= cost;
  p.cd[cdKey] = now + cdMs;
  return { ok: true };
}

function breakProt(p, now, offensive = true) {
  if (offensive) p.protUntil = Math.min(p.protUntil, now);
}

// Dano com escudo antes de resistência (F.2/F.3 + §14).
// opts: type, trueDamage, reflect, dot (DoT/tick: não dispara bloodlust),
//   pveRaw (valor com split PvP/PvE quando o alvo é o monstro; default = raw).
function dealDamage(m, srcId, dstId, raw, now, opts = {}) {
  const type = opts.type || 'phys';
  // Seção 5: monstro usa o MESMO motor (mitigação, vuln/sunder, debuffs, stats).
  if (dstId === '__monster__') return dealMonsterDamage(m, srcId, raw, now, opts);
  const s = srcId ? m.players.get(srcId) : null;
  const d = m.players.get(dstId);
  if (!d || !d.alive || d.knocked || d.left || m.state !== 'playing') return { ok: false };
  if (s && s.left) return { ok: false };
  if (srcId && srcId === dstId) return { ok: false, error: 'Não pode atacar a si mesmo.' };
  if (!s && srcId) return { ok: false };
  // Friendly-fire 2v2: sem dano hostil entre aliados.
  if (s && m.mode === '2v2' && s.team !== null && s.team === d.team) return { ok: false, error: 'Aliado protegido.' };
  if (now < d.protUntil && !opts.trueDamage) return { ok: false, error: 'Protegido.' };
  if (now < d.immuneDmgUntil && !opts.trueDamage) return { ok: false, error: 'Imune.' };
  if (!opts.trueDamage && s && world.segmentBlocked(s.x, s.y, d.x, d.y)) return { ok: false, error: 'Obstáculo bloqueia.' };
  let amt = raw;
  if (s) amt *= dmgMulOf(s);
  // vuln/sunder no alvo
  if (!opts.trueDamage) {
    if (now < d.vulnUntil) amt *= 1.16;
    if (now < d.sunderUntil) amt *= 1 + 0.04 * Math.min(3, d.sunderStacks || 0);
    if (d.howlDebuffUntil && now < d.howlDebuffUntil) amt *= 1; // howl reduz dano causado, aplicado na fonte
    if (s && s.howlWeakUntil && now < s.howlWeakUntil) amt *= 0.70;
    if (s && s.tauntVulnUntil && now < s.tauntVulnUntil) amt *= 1; // taunt aplica no alvo
    if (d.tauntVulnUntil && now < d.tauntVulnUntil) amt *= 1.20; // +20% dano recebido (B)
    // Resistência 100/(100+res) + Defense% (F.1/F.2).
    const mods = modsFor(d);
    let res = type === 'phys' ? mods.armor : mods.mr;
    if (d.frostShieldUntil > now) res += 83;
    if (d.aegisUntil > now) { res += (type === 'phys' ? 105 : 28); }
    if (d.stoneSkinUntil > now) amt *= (1 - 0.3333 * 0.5); // shortcut: Defense ~33% como 16.7% redução
    amt = amt * 100 / (100 + res);
    let def = mods.defensePct;
    if (d.martlockUntil > now) def += 0.50;
    if (d.ironSkinUntil > now) def += 0.29; // increased-defense: +29% resistência 2s (D.2)
    amt *= (1 - Math.min(0.75, def));
  }
  // Finalizador que sofre dano interrompe a finalização (§10).
  if (d.finish) { const v = m.players.get(d.finish.target); d.finish = null; if (v) v.finisher = null; }
  amt = Math.max(0, Math.round(amt));
  // Escudos absorvem antes (valor pré-resistência? aqui pós; F.3 diz antes — absorve do bruto mitigado).
  // shortcut: escudo absorve o valor final (sem ordem exata por escudo).
  let absorbed = 0;
  if (!opts.trueDamage && d.shields.length) {
    let rest = amt;
    for (const sh of d.shields) {
      if (now > sh.until || sh.amount <= 0) continue;
      const take = Math.min(sh.amount, rest);
      sh.amount -= take; rest -= take; absorbed += take;
    }
    d.shields = d.shields.filter((sh) => sh.amount > 0 && now <= sh.until);
    d.shieldAbsorbed = (d.shieldAbsorbed || 0) + absorbed;
    amt = rest;
  }
  // Lymhurst/Aegis/Fort gatilhos de dano são avaliados após aplicar (ver afterDamage).
  amt = Math.min(amt, d.hp);
  const beforeHp = d.hp;
  d.hp -= amt;
  d.lastCombat = now; d.waveSec = d.waveSec; // wave lida no tick
  if (s) {
    s.lastCombat = now; s.dmgDealt += amt;
    s.lastDmgFrom = null;
    // Contadores de passiva por dano direto
    onDirectDamage(m, s, d, amt, now, opts);
  }
  d.dmgTaken += amt;
  d.lastDmgFrom = srcId; d.lastDmgAt = now;
  if (m.mode === 'pve' && m.pve && s && !d.isMonster) { /* jogador->jogador não há */ }
  afterDamageTriggers(m, s, d, amt, beforeHp, now);
  if (d.hp <= 0) kill(m, srcId, dstId, now, opts);
  return { ok: true, dmg: amt, absorbed };
}

// Seção 5: dano ao monstro pelo mesmo motor (mitigação, lifesteal, stats).
// Split PvP/PvE explícito via opts.pveRaw (default = raw quando sem split).
function dealMonsterDamage(m, srcId, raw, now, opts = {}) {
  const type = opts.type || 'phys';
  const s = srcId ? m.players.get(srcId) : null;
  const mo = m.monster;
  if (!mo || !mo.alive || m.state !== 'playing' || m.mode !== 'pve') return { ok: false };
  if (s && s.left) return { ok: false };
  if (s && world.segmentBlocked(s.x, s.y, mo.x, mo.y)) return { ok: false, error: 'Obstáculo bloqueia.' };
  let amt = opts.pveRaw !== undefined ? opts.pveRaw : raw;
  if (s) amt *= dmgMulOf(s);
  if (!opts.trueDamage) {
    if (now < mo.vulnUntil) amt *= 1.16;
    if (now < mo.sunderUntil) amt *= 1 + 0.04 * Math.min(3, mo.sunderStacks || 0);
    if (s && s.howlWeakUntil && now < s.howlWeakUntil) amt *= 0.70;
    if (now < mo.tauntVulnUntil) amt *= 1.20;
    amt = amt * 100 / (100 + 0); // mob sem Armor/MR publicado (§13)
  }
  // Finalizador que sofre dano interrompe a finalização (§10).
  if (s && s.finish) { const v = m.players.get(s.finish.target); s.finish = null; if (v) v.finisher = null; }
  amt = Math.max(0, Math.round(amt));
  amt = Math.min(amt, mo.hp);
  mo.hp -= amt;
  if (s) {
    s.lastCombat = now; s.dmgDealt += amt;
    onDirectDamage(m, s, mo, amt, now, opts);
  }
  if (m.pve) { m.pve.dmgTotal += amt; m.pve.dmgWindow.push({ t: now, amt }); }
  if (mo.hp <= 0) { mo.hp = 0; mo.alive = false; mo.respawnAt = now + 30000; }
  return { ok: true, dmg: amt, absorbed: 0 };
}

function applyHeal(m, srcId, dstId, raw, now, opts = {}) {
  // Seção 5: boneco usa o mesmo motor de cura (healCast, stats, sem fixo extra).
  if (dstId === '__dummy__') {
    const s = srcId ? m.players.get(srcId) : null;
    const du = m.dummy;
    if (!du || m.state !== 'playing' || m.mode !== 'pve') return { ok: false };
    if (s && s.left) return { ok: false };
    if (du.forbiddenUntil && now < du.forbiddenUntil) return { ok: false, error: 'Cura negada.' };
    let amt = Math.round(raw * (s ? healCastOf(s) : 1));
    const eff = Math.min(amt, du.maxHp - du.hp);
    du.hp += eff;
    if (s) {
      s.healDone += eff;
      if (m.pve) m.pve.healTotal += eff;
    }
    return { ok: true, healed: eff };
  }
  const s = srcId ? m.players.get(srcId) : null;
  const d = m.players.get(dstId);
  if (!d || !d.alive || d.knocked || d.left) return { ok: false };
  if (s && s.left) return { ok: false };
  // Regras de alvo: FFA cura só si; 2v2/PvE só aliados (ou si).
  if (s) {
    if (m.mode === 'ffa' && srcId !== dstId) return { ok: false, error: 'No FFA, cura só a si mesmo.' };
    if (m.mode === '2v2' && srcId !== dstId && s.team !== d.team) return { ok: false, error: 'Só aliados recebem cura.' };
  }
  if (d.forbiddenUntil && now < d.forbiddenUntil) return { ok: false, error: 'Cura negada.' };
  let amt = raw;
  if (s) amt *= healCastOf(s);
  const recv = (d.healRecvBonusUntil && now < d.healRecvBonusUntil ? (d.healRecvBonus || 0) : 0)
    + (now < d.healDebuffUntil ? -0.12 : 0)
    + (d.blessingUntil && now < d.blessingUntil ? 0.30 : 0);
  amt *= (1 + recv);
  amt = Math.round(amt);
  const eff = Math.min(amt, d.maxHp - d.hp);
  d.hp += eff;
  if (s) {
    s.healDone += eff;
    if (m.mode === 'pve' && m.pve) m.pve.healTotal += eff;
  }
  return { ok: true, healed: eff };
}

function addShield(p, amount, ms, now) { p.shields.push({ amount, until: now + ms }); }
function addCC(m, src, dst, kind, ms, now) {
  if (now < dst.immuneCCUntil) return false;
  if (now < dst.protUntil) return false;
  // Fort Sterling: limpa e imuniza ao receber stun/silence/root (E).
  const b = normBuild(dst.build);
  if ((kind === 'stun' || kind === 'silence' || kind === 'root') && b.cape === 'fort-sterling' && now >= (dst.capeCdUntil || 0)) {
    dst.cc.stunUntil = 0; dst.cc.rootUntil = 0; dst.cc.silenceUntil = 0;
    dst.buffs = (dst.buffs || []).filter((x) => !x.debuff);
    dst.dots = dst.dots.filter((x) => false); // DoT permanece (não limpa) — mantém dots
    dst.immuneCCUntil = now + 1000;
    dst.capeCdUntil = now + 139000; // shortcut: último tooltip 2:19
    return false;
  }
  const mods = modsFor(dst);
  const ccrMul = 100 / (100 + (mods.ccr || 0) * 0 + (dst.tenacityMul || 0));
  // shortcut: CCR em pontos reduz duração linear simples 1/(1+ccr/500).
  const mul = 1 / (1 + (mods.ccr || 0) / 500);
  let dur = ms * mul;
  if (src) {
    const sm = modsFor(src);
    dur *= (1 + (sm.ccDur || 0) + (src.furyStacks ? 0.05 * src.furyStacks : 0));
  }
  if (kind === 'slow' && dst.wanderlustUntil > now) return false;
  if (kind === 'stun') dst.cc.stunUntil = Math.max(dst.cc.stunUntil, now + dur);
  if (kind === 'root') dst.cc.rootUntil = Math.max(dst.cc.rootUntil, now + dur);
  if (kind === 'silence') dst.cc.silenceUntil = Math.max(dst.cc.silenceUntil, now + dur);
  if (kind === 'slow') { dst.cc.slowUntil = Math.max(dst.cc.slowUntil, now + dur); dst.cc.slowPct = Math.max(dst.cc.slowPct || 0, 0.2); }
  // interrompe casts/canais (Forbidden Stab, Howl)
  if (kind === 'stun' || kind === 'silence') { dst.channel = null; dst.pendingCast = null; }
  return true;
}

function onDirectDamage(m, s, d, amt, now, opts = {}) {
  // Bloodlust (D.7/CATÁLOGO): cura 30% do dano DIRETO efetivo, cap 120 por
  // acerto e 600 por buff; DoT/reflect não disparam. Sem bônus flat por AA.
  if (s && !opts.reflect && !opts.dot && s.bloodlustUntil > now && amt > 0) {
    const pool = s.bloodlustPool || 0;
    if (pool < 600) {
      const want = Math.min(Math.round(amt * 0.30), 120, 600 - pool);
      const heal = Math.min(want, s.maxHp - s.hp);
      if (heal > 0) { s.hp += heal; s.healDone = (s.healDone || 0) + heal; }
      s.bloodlustPool = pool + want;
      if (s.bloodlustPool >= 600) s.bloodlustUntil = 0;
    }
  }
  // Fury: dano recebido gera stacks (Soldier Armor).
  const db = normBuild(d.build);
  if (db.cSkill === 'fury' && d.furyUntil > now && amt > 0) {
    d.furyStacks = Math.min(8, (d.furyStacks || 0) + 1);
    d.furyUntil = now + 10000;
  }
  // Aegis: ao receber dano restaura 42 energia.
  if (d.aegisUntil > now) d.energy = Math.min(d.maxEnergy, d.energy + 42);
  // Frost Shield: reflete 15% como magia + slow atacante 40%/2s.
  // Inferno Shield: reflete 20% como magia em 4m (sem loop em reflect).
  if (!opts.reflect && d.frostShieldUntil > now && s && amt > 0) {
    const refl = Math.max(1, Math.round(amt * 0.15));
    dealDamage(m, d.id, s.id, refl, now, { type: 'magic', reflect: true });
    addCC(m, d, s, 'slow', 2000, now); s.cc.slowPct = 0.40;
  }
  if (!opts.reflect && d.infernoUntil > now && s && amt > 0) {
    if (world.dist(d.x, d.y, s.x, s.y) <= 4) {
      const refl = Math.max(1, Math.round(amt * 0.20));
      dealDamage(m, d.id, s.id, refl, now, { type: 'magic', reflect: true });
    }
  }
  // Bloodlust/Inferno ticks, Life Leech por AA (tratado no AA), Martlock avaliado em afterDamage.
  // Thetford é por AA (no basicAttack), não aqui.
  // Adrenaline Boost: termina após 3s sem causar dano — renova janela.
  if (s.adrenalineUntil > now) s.adrenalineLastDmg = now;
}

// Gatilhos pós-dano: Martlock (<25%), Lymhurst (<40% energia após cast).
function afterDamageTriggers(m, s, d, amt, beforeHp, now) {
  if (!d || !d.alive) { /* morto: Martlock não reativa se já morto */ }
  const b = normBuild(d.build);
  if (b.cape === 'martlock' && d.hp > 0 && d.hp < d.maxHp * 0.25 && beforeHp >= d.maxHp * 0.25 && now >= (d.capeCdUntil || 0)) {
    d.martlockUntil = now + 5000;
    d.capeCdUntil = now + 225000; // shortcut: último tooltip 3:45
  }
}
function afterCastEnergy(m, p, now) {
  const b = normBuild(p.build);
  if (b.cape === 'lymhurst' && p.energy < p.maxEnergy * 0.40 && now >= (p.capeCdUntil || 0) && !(p.lymhurstUntil > now)) {
    p.lymhurstUntil = now + 10000; p.lymhurstNext = now; p.lymhurstTicks = 0;
    p.capeCdUntil = now + 182000; // shortcut: 3:02
  }
}

// ---- Morte / caído / finalização ----
function kill(m, srcId, dstId, now, opts = {}) {
  const d = m.players.get(dstId);
  if (!d) return;
  const waveKill = !!opts.wave;
  const isMonsterSrc = srcId === '__monster__';
  const isSelf = srcId === dstId;
  const isPlayerSrc = srcId && srcId !== dstId && m.players.has(srcId) && !isMonsterSrc;
  // Exceções que matam imediato: wave, PvE respawn direto, PvP player-vs-player.
  if (waveKill || m.mode === 'pve' || isPlayerSrc) {
    return dieImmediate(m, srcId, dstId, now, opts);
  }
  // Golpe de monstro/ambiente/autolesão: caído 15s + levantar 5s (§10).
  if (isMonsterSrc || isSelf || !srcId || opts.env) {
    if (m.mode === 'ffa' && false) { /* FFA sem aliado: ainda cai? regra diz cai; sem Reawaken */ }
    d.hp = 0; d.knocked = true; d.knockedUntil = now + DOWNED_MS; d.gettingUpUntil = 0;
    d.alive = true; // caído continua "vivo" mas incapaz; ataques não causam dano
    d.channel = null; d.pendingCast = null; d.finish = null;
    d.bloodthirstyOn = false; d.bloodthirstyUntil = 0; // buff cai ao cair
    return;
  }
  return dieImmediate(m, srcId, dstId, now, opts);
}

function dieImmediate(m, srcId, dstId, now, opts = {}) {
  const d = m.players.get(dstId);
  if (!d) return;
  d.hp = 0; d.alive = false; d.knocked = false; d.deaths += 1;
  d.bleeds = []; d.rend = 0; d.eStage = null; d.channel = null; d.pendingCast = null; d.finish = null;
  d.bloodthirstyOn = false; d.bloodthirstyUntil = 0; d.bloodlustUntil = 0; d.bloodlustPool = 0;
  // cancela finalizações onde vítima ou finalizador morreu
  for (const p of m.players.values()) {
    if (p.finish && (p.finish.target === dstId || p.id === dstId)) p.finish = null;
    if (p.id === dstId) p.finish = null;
  }
  let credit = null;
  if (opts.wave) {
    // crédito se inimigo causou dano ≤30s (§8).
    if (d.lastDmgFrom && m.players.has(d.lastDmgFrom) && now - d.lastDmgAt <= 30000) {
      const s = m.players.get(d.lastDmgFrom);
      const foe = m.mode === '2v2' ? (s.team !== d.team) : (s.id !== d.id);
      if (foe) credit = d.lastDmgFrom;
    }
  } else if (srcId && srcId !== dstId && m.players.has(srcId)) credit = srcId;
  if (credit) m.players.get(credit).kills += 1;
  if (m.mode === 'ffa') {
    d.respawnAt = now + RESPAWN_MS;
  } else if (m.mode === '2v2') {
    d.respawnAt = null; // sem respawn; assiste
  } else if (m.mode === 'pve') {
    d.respawnAt = now + PVE_RESPAWN_MS; // 3s sem caído
  }
  if (opts.defer) return;
  checkRoundEnd(m, now);
}

function checkRoundEnd(m, now = m.time) {
  if (m.state !== 'playing') return;
  if (m.mode === 'ffa') {
    const contenders = activePlayers(m).filter((p) => p.alive || (p.respawnAt !== null && p.respawnAt > now));
    if (contenders.length <= 1) endMatch(m);
  } else if (m.mode === '2v2') {
    const t0 = activePlayers(m).filter((p) => p.team === 0 && p.alive);
    const t1 = activePlayers(m).filter((p) => p.team === 1 && p.alive);
    const t0alive = t0.length > 0, t1alive = t1.length > 0;
    if (!t0alive && !t1alive) {
      // simultâneas = rodada empatada, repete sem ponto (§7/§8).
      m.intervalUntil = now + 10000; m.roundState = 'interval';
    } else if (!t0alive || !t1alive) {
      const winner = !t0alive ? 1 : 0;
      m.wins[winner] += 1;
      if (m.wins[winner] >= 2) endMatch2v2(m, winner);
      else { m.round += 1; m.intervalUntil = now + 10000; m.roundState = 'interval'; }
    }
    // equipe sem conectados/direito retorno: adversária vence (§8).
    const c0 = activePlayers(m).filter((p) => p.team === 0 && (!p.disconnected || p.left === false));
    // simplificação: se time zerado (todos left), outro vence partida.
    const n0 = activePlayers(m).filter((p) => p.team === 0).length;
    const n1 = activePlayers(m).filter((p) => p.team === 1).length;
    if (n0 === 0 && n1 > 0) endMatch2v2(m, 1);
    else if (n1 === 0 && n0 > 0) endMatch2v2(m, 0);
    else if (n0 === 0 && n1 === 0) { m.state = 'ended'; m.result = { winners: [], board: boardOf(m), draw: true }; m.winnerIds = []; m.autoReturnAt = now + 30000; }
  } else if (m.mode === 'pve') {
    // sem fim por morte; jogador respawna.
  }
}

function boardOf(m) {
  return [...m.players.values()].map((p) => ({
    nick: p.nick, team: p.team, kills: p.kills, deaths: p.deaths,
    dmgDealt: Math.round(p.dmgDealt), dmgTaken: Math.round(p.dmgTaken),
    healDone: Math.round(p.healDone),
  })).sort((a, b) => b.kills - a.kills);
}

function endMatch(m) {
  if (m.state !== 'playing') return;
  m.state = 'ended';
  const eligible = activePlayers(m);
  let best = -1;
  for (const p of eligible) best = Math.max(best, p.kills);
  m.winnerIds = eligible.filter((p) => p.kills === best).map((p) => p.id);
  m.result = {
    winners: m.winnerIds.map((id) => m.players.get(id)?.nick).filter(Boolean),
    board: boardOf(m),
  };
  m.autoReturnAt = m.time + 30000;
}

function endMatch2v2(m, winnerTeam) {
  m.state = 'ended';
  const eligible = activePlayers(m).filter((p) => p.team === winnerTeam);
  m.winnerIds = eligible.map((p) => p.id);
  m.result = { winners: eligible.map((p) => p.nick), board: boardOf(m), winnerTeam, wins: { ...m.wins } };
  m.autoReturnAt = m.time + 30000;
}

// ---- Ataque básico (números do item no catálogo; fallback local) ----
const AA_STATS = {
  battleaxe: { dmg: 98, cd: 1000 / 1.1, range: 3, type: 'phys' },
  dagger: { dmg: 55, cd: 500, range: 2, type: 'phys' },
  fire: { dmg: 53, cd: 1000 / 1.35, range: 9, type: 'magic' },
  frost: { dmg: 53, cd: 1000 / 1.35, range: 9, type: 'magic' },
  holy: { dmg: 53, cd: 1000 / 1.35, range: 9, type: 'magic' },
};
for (const _w of Object.keys(AA_STATS)) { const _c = aaStatsFor(_w); if (_c) AA_STATS[_w] = _c; }

function basicAttack(m, srcId, dstId, now = m.time) {
  const s = m.players.get(srcId);
  const monTgt = dstId === '__monster__' && m.mode === 'pve';
  const d = monTgt ? m.monster : m.players.get(dstId);
  if (!s || !d) return { ok: false, error: 'Alvo inválido.' };
  if (srcId === dstId) return { ok: false, error: 'Não pode atacar a si mesmo.' };
  if (!monTgt && d.left) return { ok: false, error: 'Alvo inválido.' };
  if (monTgt && (!d.alive || m.state !== 'playing')) return { ok: false, error: 'Alvo inválido.' };
  if (m.mode === '2v2' && s.team !== null && s.team === d.team) return { ok: false, error: 'Aliado protegido.' };
  if (!canAct(m, s, now)) return { ok: false, error: 'Incapaz de agir.' };
  if (now < s.cd.aa) return { ok: false, error: 'Em recarga.' };
  if (now < s.cc.silenceUntil) { /* AA permitido sob silence */ }
  const aa = aaStatsFor(s.build.weapon) || AA_STATS.battleaxe;
  const range = aa.range;
  // §14: proteção termina ao atacar/usar ofensiva, inclusive se errar.
  breakProt(s, now);
  if (world.dist(s.x, s.y, d.x, d.y) > range) return { ok: false, error: 'Fora de alcance.' };
  const aaCd = effCD(s, aa.cd) / (modsFor(s).aaSpeed * (s.adrenalineUntil > now ? 1.4 : 1) * (s.aaHasteUntil > now ? 1.3 : 1));
  s.cd.aa = now + aaCd;
  s.dest = null;
  // Ataque interrompe finalização do próprio atacante (§10).
  if (s.finish) { const v = m.players.get(s.finish.target); s.finish = null; if (v) v.finisher = null; }
  const r = dealDamage(m, srcId, monTgt ? '__monster__' : dstId, aa.dmg, now, { type: aa.type });
  if (r.ok) {
    // Life Leech: cada AA cura 15% da vida efetivamente perdida (D.2/D.3).
    if (normBuild(s.build).wPass === 'life-leech') {
      const heal = Math.min(r.dmg * 0.15, s.maxHp - s.hp);
      if (heal > 0) { s.hp += heal; s.healDone = (s.healDone || 0) + heal; }
    }
    // Burn (fire): cada AA aplica 72 mágico total em 3s (D.4).
    if (normBuild(s.build).wPass === 'burn') {
      d.dots.push({ id: 'burn', until: now + 3000, tickEvery: 1000, next: now + 1000, perTick: 72 / 3, from: s.id, type: 'magic' });
    }
    // Bloodthirsty Blade (D.3): AA soma 172 mágico vs player / 103 vs mob e
    // rouba 100% da vida efetivamente removida pelo bônus; +30% mov no buff.
    if (s.bloodthirstyOn && s.bloodthirstyUntil > now) {
      bloodthirstyHit(m, s, monTgt ? m.monster : d, now);
    }
    // Frost (frost): próximo AA após 4 spells enraíza ~1,2s (D.5).
    if (s.frostReady) { s.frostReady = false; addCC(m, s, monTgt ? m.monster : d, 'root', 1200, now); }
    // Magic Force (holy): próximo AA após 5 spells empurra ~2,99m (D.6).
    if (s.magicReady) {
      s.magicReady = false;
      const D = monTgt ? m.monster : d;
      pushFrom(D, s.x, s.y, 2.99);
    }
    // Spirit Crush (Soldier Armor, PvE): cada AA no mob −12% HP máx+atual 3s.
    if (monTgt) {
      const b = normBuild(s.build);
      if (b.cPass1 === 'spirit-crush' || b.cPass2 === 'spirit-crush') {
        const mo = m.monster;
        if (mo.spiritBase == null) mo.spiritBase = mo.maxHp;
        mo.spiritUntil = now + 3000;
        mo.maxHp = Math.round(mo.spiritBase * 0.88);
        mo.hp = Math.min(mo.hp, mo.maxHp);
      }
    }
    onAutoAttack(m, s, monTgt ? m.monster : d, now);
  }
  return r;
}

// Bloodthirsty Blade: bônus mágico por AA + lifesteal 100% do bônus.
function bloodthirstyHit(m, s, D, now) {
  const isMon = !!D.isMonster;
  const r2 = dealDamage(m, s.id, isMon ? '__monster__' : D.id, isMon ? 103 : 172, now, { type: 'magic' });
  if (r2.ok && r2.dmg > 0) {
    const heal = Math.min(r2.dmg, s.maxHp - s.hp);
    if (heal > 0) { s.hp += heal; s.healDone = (s.healDone || 0) + heal; }
  }
  return r2;
}

function onAutoAttack(m, s, d, now) {
  s.aaCount = (s.aaCount || 0) + 1;
  const b = normBuild(s.build);
  // Thetford: AA pode disparar raio 242 em até4 alvos 9m, ICD15s.
  if (b.cape === 'thetford' && now >= (s.thetfordIcdUntil || 0)) {
    const foes = [...m.players.values()].filter((p) => p.id !== s.id && !p.left && p.alive && !p.knocked && (m.mode !== '2v2' || p.team !== s.team) && world.dist(s.x, s.y, p.x, p.y) <= 9);
    if (foes.length) {
      s.thetfordIcdUntil = now + 15000;
      let cur = foes[0]; let hits = 0;
      const seen = new Set();
      while (cur && hits < 4 && !seen.has(cur.id)) {
        seen.add(cur.id);
        dealDamage(m, s.id, cur.id, 242, now, { type: 'magic' });
        hits += 1;
        cur = [...m.players.values()].filter((p) => !seen.has(p.id) && p.id !== s.id && !p.left && p.alive && world.dist(cur.x, cur.y, p.x, p.y) <= 9 && (m.mode !== '2v2' || p.team !== s.team))[0];
      }
    }
  }
  // Deep Cuts: a cada4 AA aplica bleed real 55 (axe)/57 (dagger) total.
  if (b.wPass === 'deep-cuts' && s.aaCount % 4 === 0 && d && !d.left && d.alive) {
    const tot = shortWeapon(s.build.weapon) === 'dagger' ? 57 : 55;
    d.bleeds.push({ until: now + 6000, perSec: tot / 6, from: s.id });
  }
  // Increased Defense: a cada5 AA +29% res 2s (shortcut: +29 Armor/MR).
  if (b.wPass === 'increased-defense' && s.aaCount % 5 === 0) { s.ironSkinUntil = now + 2000; }
  // Aggressive Rush: a cada4 AA +8%/+6% dano 3s.
  if (b.wPass === 'aggressive-rush' && s.aaCount % 4 === 0) s.aggrRushUntil = now + 3000;
  // Auto-Attack Speed (dagger): a cada5 AA +30% 3s.
  if (b.wPass === 'auto-attack-speed' && s.aaCount % 5 === 0) s.aaHasteUntil = now + 3000;
  // Life Leech: a cada AA rouba 15% da vida perdida (aplicado no dealDamage do AA? shortcut: cura 15% do dano).
  // Burn (fire): cada AA aplica 72/3s.
  if (b.wPass === 'burn') { /* aplicado ao alvo no basicAttack via dots — precisa alvo; ver wrapper */ }
  // Energetic: AA restaura 3,6 energia.
  if (b.wPass === 'energetic') s.energy = Math.min(s.maxEnergy, s.energy + 3.6);
  // Frost (frost): após4 spells o próximo AA enraíza (flag consumida no AA).
  // Magic Force (holy): após5 spells o próximo AA empurra (flag consumida no AA).
  // Spirit Crush (soldier armor PvE): cada AA -12% HP máx+atual do mob 3s.
}

// ---- Skills ----
function rangeFor(m, p, slot) {
  const mslot = String(slot || '').toUpperCase();
  if (mslot === 'AA') return (aaStatsFor(p.build.weapon) || {}).range || 3;
  // Alcance da skill equipada no slot, direto do catálogo.
  try {
    const b = normBuild(p.build);
    const id = mslot === 'Q' ? b.q : mslot === 'E' ? b.e : mslot === 'W' ? b.w : null;
    const pr = id && skillParams(id);
    if (pr && Number.isFinite(pr.range)) return pr.range;
  } catch { /* fallback abaixo */ }
  if (mslot === 'E') return 17;
  return 12;
}

function useSkill(m, srcId, slot, target, a, b) {
  // assinatura flexível: (m,src,slot,targetId,now) | (m,src,slot,targetId,{x,y},now) | (m,src,slot,{x,y},now)
  let targetId = null, opts = {}, now = m.time;
  if (typeof target === 'object' && target !== null && !(typeof target === 'string')) { opts = target; }
  else targetId = target;
  if (typeof a === 'number') now = a;
  else if (typeof a === 'object' && a !== null) { opts = { ...opts, ...a }; if (typeof a.now === 'number') now = a.now; }
  if (typeof b === 'number') now = b;
  if (opts.target && !targetId) targetId = opts.target;
  const s = m.players.get(srcId);
  if (!s) return { ok: false, error: 'Jogador inválido.' };
  // FINISH: finalização de caído (slot especial).
  if (String(slot).toUpperCase() === 'FINISH') return startFinish(m, srcId, targetId, now);
  const key = String(slot || '').toUpperCase();
  if (!['Q', 'W', 'E', 'HEAD', 'CHEST', 'BOOTS', 'R', 'C', 'B', 'H'].includes(key)) return { ok: false, error: 'Habilidade inválida.' };
  const sk = key === 'H' ? 'HEAD' : key === 'R' ? 'HEAD' : key === 'C' ? 'CHEST' : key === 'B' ? 'BOOTS' : key;
  if (!canAct(m, s, now)) {
    if (s.knocked) return { ok: false, error: 'Caído.' };
    return { ok: false, error: 'Incapaz de agir.' };
  }
  // Habilidade do finalizador interrompe a finalização (§10).
  if (s.finish && String(slot).toUpperCase() !== 'FINISH') {
    const v = m.players.get(s.finish.target);
    s.finish = null; if (v) v.finisher = null;
  }
  if (now < s.cc.silenceUntil && sk !== 'AA') {
    // Break Free pode sob stun/silence.
    const bld = normBuild(s.build);
    const isBreakFree = (sk === 'BOOTS' && bld.bSkill === 'break-free');
    if (!isBreakFree) return { ok: false, error: 'Silenciado.' };
  }
  // §14: proteção termina ao usar ação ofensiva, inclusive se errar (sem gastar).
  if (sk === 'Q' || sk === 'W' || sk === 'E') {
    const bn = normBuild(s.build);
    const nm = sk === 'Q' ? bn.q : sk === 'W' ? bn.w : bn.e;
    const nonOff = ['generous-heal', 'holy-flash', 'holy-beam', 'holy-blessing', 'holy-orb', 'desperate-prayer', 'sacred-pulse'];
    if (!nonOff.includes(nm)) breakProt(s, now);
  }
  if (sk === 'Q' || sk === 'W' || sk === 'E') return useWeaponSkill(m, s, sk, targetId, opts, now);
  return useArmorSkill(m, s, sk, targetId, opts, now);
}

function needEnemy(m, s, d, now) {
  if (!d || d.left) return 'Alvo inválido.';
  if (d.isMonster) return null; // monstro PvE: inimigo válido (Seção 5)
  if (d.isDummy) return 'Boneco não recebe dano.';
  if (s.id === d.id) return 'Não pode atacar a si mesmo.';
  if (m.mode === '2v2' && s.team === d.team) return 'Aliado protegido.';
  return null;
}
function needAlly(m, s, d) {
  if (!d || d.left) return 'Alvo inválido.';
  if (d.isMonster) return 'Alvo inválido.';
  if (d.isDummy) return null; // boneco PvE: alvo de cura válido (Seção 5)
  if (m.mode === 'ffa' && s.id !== d.id) return 'No FFA, cura só a si mesmo.';
  if (m.mode === '2v2' && s.id !== d.id && s.team !== d.team) return 'Só aliados recebem cura.';
  return null;
}
// Alvo de canal (player, monstro ou boneco).
function chanTarget(m, id) {
  if (id === '__monster__') return m.monster && m.monster.alive ? m.monster : null;
  if (id === '__dummy__') return m.dummy || null;
  const p = m.players.get(id);
  return p && !p.left ? p : null;
}
// Validação do alvo ao CONCLUIR um cast (Seção C): morto/saído/caído ou fora
// do alcance no término → efeito falha explícito (gasto da lançamento mantido).
function castTarget(m, s, tgtId, range, now) {
  const isMon = tgtId === '__monster__';
  const D = isMon ? m.monster : m.players.get(tgtId);
  if (!D) return null;
  if (isMon) { if (!D.alive || m.mode !== 'pve') return null; }
  else if (!D.alive || D.knocked || D.left) return null;
  if (world.dist(s.x, s.y, D.x, D.y) > range + 0.5) return null;
  return D;
}
// Seção C: conjuração com efeito ao concluir (ex.: Deadly Chop 0,4s).
// spendAndBreak já gastou (regra 4.5). Cancela sem reembolso: mover, nova
// skill/AA, stun/silence, morte, disconnect. Dano NÃO cancela cast.
function beginCast(s, castMs, now, run) {
  const at = now + effCast(s, castMs);
  s.castUntil = Math.max(s.castUntil || 0, at);
  s.pendingCast = { id: 'cast', at, run, total: Math.max(0, at - now) };
  return { ok: true, casting: true };
}
// Liberação da Pyroblast (D.4): canal completo → 976 + knockback 3,5m;
// soltar andando (voluntário) → estágio parcial (402 <0,6s, 689 ≥0,6s) sem
// knockback; interrupção forçada (stun/morte) → fizzle (gasto mantido).
function pyroRelease(m, p, ch, now, voluntary) {
  const stage = now - (ch.until - 1200) >= 600 ? 1 : 0;
  const dmg = [402, 689][stage];
  for (const q of m.players.values()) {
    if (q.id === p.id || q.left || !q.alive || q.knocked) continue;
    if (m.mode === '2v2' && q.team === p.team) continue;
    if (world.dist(ch.x, ch.y, q.x, q.y) <= 4) dealDamage(m, p.id, q.id, dmg, now, { type: 'magic', dot: !voluntary });
  }
  if (m.mode === 'pve' && m.monster && m.monster.alive && world.dist(ch.x, ch.y, m.monster.x, m.monster.y) <= 4) {
    dealDamage(m, p.id, '__monster__', dmg, now, { type: 'magic', dot: !voluntary });
  }
}

function useWeaponSkill(m, s, sk, targetId, opts, now) {
  const b = normBuild(s.build);
  const w = b.weapon;
  const qName = b.q, wName = b.w, eName = b.e;
  // Seção 5: ids PvE canônicos resolvem p/ monstro/boneco no mesmo motor.
  const monActive = targetId === '__monster__' && m.mode === 'pve' && m.monster && m.monster.alive;
  const dumActive = targetId === '__dummy__' && m.mode === 'pve' && m.dummy;
  const d = monActive ? m.monster : (dumActive ? { ...m.dummy, isDummy: true } : (targetId ? m.players.get(targetId) : null));
  const px = opts.x, py = opts.y;
  const hasPoint = Number.isFinite(px) && Number.isFinite(py);
  const spendAndBreak = (cost, cdKey, cdMs) => {
    const sp = spend(s, now, cost, cdKey, cdMs);
    if (!sp.ok) return sp;
    breakProt(s, now);
    s.dest = null;
    s.spellCount = (s.spellCount || 0) + 1;
    // Aggressive Caster: após4 spells −40% cast 3s; Furious: após5 spells +10% dano 4s.
    if (b.wPass === 'aggressive-caster' && s.spellCount % 4 === 0) { s.aggroCastUntil = now + 3000; s.buffs.push({ id: 'aggro-cast', until: now + 3000, castMul: 0.6 }); }
    if (b.wPass === 'furious' && s.spellCount % 5 === 0) s.furiousUntil = now + 4000;
    // Adrenaline Driven Charity (holy): após4 spells +20% cura 3s.
    if (b.wPass === 'adrenaline-driven-charity' && s.spellCount % 4 === 0) s.charityUntil = now + 3000;
    // Frost: após4 spells arma o próximo AA com root.
    if (b.wPass === 'frost' && s.spellCount % 4 === 0) s.frostReady = true;
    // Magic Force: após5 spells arma o próximo AA com empurrão.
    if (b.wPass === 'magic-force' && s.spellCount % 5 === 0) s.magicReady = true;
    // Caerleon: ao usar Q reseta CD do Q, 1x por ativação, capa CD 60s (hipótese §14).
    if (sk === 'Q' && b.cape === 'caerleon' && now >= (s.capeCdUntil || 0)) {
      s.cd.q = 0; // reseta (antes do spend? após: zera de novo)
      s.capeCdUntil = now + 60000;
    }
    // Bridgewatch: ao usar E, aura 5m 6s (slow40% CCR−30%).
    if (sk === 'E' && b.cape === 'bridgewatch' && now >= (s.capeCdUntil || 0)) {
      s.capeBridgeUntil = now + 6000;
      s.capeCdUntil = now + 75000; // shortcut: 1:15
    }
    afterCastEnergy(m, s, now);
    return { ok: true };
  };

  // ===== BATTLEAXE =====
  if (w === 'battleaxe') {
    if (sk === 'Q') {
      if (qName === 'rending-strike') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (world.dist(s.x, s.y, d.x, d.y) > 3) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(2, 'q', 2000); if (!sp.ok) return sp;
        const r = dealDamage(m, s.id, foeId(d), 195, now, { type: 'phys' });
        if (r.ok) {
          if (now > d.rendUntil) d.rend = 0;
          d.rend = Math.min(3, d.rend + 1); d.rendUntil = now + 6000;
          d.bleeds.push({ until: now + 6000, perSec: 83 / 6, from: s.id });
          if (d.rend >= 3) d.healDebuffUntil = now + 5000;
        }
        return r;
      }
      if (qName === 'rending-spin') {
        const sp = spendAndBreak(3, 'q', 3000); if (!sp.ok) return sp;
        let hit = false;
        eachFoe(m, s, (p) => {
          const dd = world.dist(s.x, s.y, p.x, p.y);
          if (dd <= 5) {
            const dmg = dd <= 2.5 ? 231 : 264;
            const r = dealDamage(m, s.id, foeId(p), dmg, now, { type: 'phys', pveRaw: dmg });
            if (r.ok) {
              hit = true;
              if (now > p.rendUntil) p.rend = 0;
              p.rend = Math.min(3, p.rend + 1); p.rendUntil = now + 6000;
              p.bleeds.push({ until: now + 6000, perSec: 83 / 6, from: s.id });
              if (p.rend >= 3) p.healDebuffUntil = now + 5000;
            }
          }
        });
        return hit ? { ok: true } : { ok: false, error: 'Nenhum alvo no alcance.' };
      }
      if (qName === 'rending-rage') {
        // D.2/B.3: combo em cone — 2 cortes + salto. Direção pelo ponto (ou inimigo).
        // shortcut: cone ~60° comprimento 3m nas etapas 1-2; 3ª etapa salta ao ponto até 9m + root em área 5m.
        const tx = hasPoint ? px : (d && !needEnemy(m, s, d) ? d.x : null);
        if (tx === null || tx === undefined) return { ok: false, error: 'Escolha a direção.' };
        const ty = hasPoint ? py : d.y;
        const isThird = s.searingStage >= 2 && now <= s.searingUntil;
        const rng = isThird ? 9 : 3;
        if (world.dist(s.x, s.y, tx, ty) > rng) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(4, 'q', 1200); if (!sp.ok) return sp; // shortcut: custo/CD por etapa; janela combo 2,5s
        const applyRend = (p) => {
          if (now > p.rendUntil) p.rend = 0;
          p.rend = Math.min(3, p.rend + 1); p.rendUntil = now + 6000;
          p.bleeds.push({ until: now + 6000, perSec: 83 / 6, from: s.id });
          if (p.rend >= 3) { p.healDebuffUntil = Math.max(p.healDebuffUntil || 0, now + 5000); }
        };
        if (isThird) {
          const t = slideTo(s, tx, ty); // nunca em obstáculo/fora da arena
          s.x = t.x; s.y = t.y; s.searingStage = 0;
          let hit = false;
          eachFoe(m, s, (p) => {
            if (world.dist(s.x, s.y, p.x, p.y) > 5) return;
            const r = dealDamage(m, s.id, foeId(p), 165, now, { type: 'phys' });
            if (r.ok) { hit = true; applyRend(p); addCC(m, s, p, 'root', 1610, now); }
          });
          return hit ? { ok: true } : { ok: false, error: 'Errou.' };
        }
        let hit = false;
        eachFoe(m, s, (p) => {
          if (!inCone(s.x, s.y, tx, ty, p.x, p.y, 3)) return;
          const r = dealDamage(m, s.id, foeId(p), 165, now, { type: 'phys' });
          if (r.ok) { hit = true; applyRend(p); }
        });
        if (!hit) return { ok: false, error: 'Errou.' }; // gasta mesmo errando (regra §4.5)
        s.searingStage = (s.searingStage || 0) + 1; s.searingUntil = now + 2500;
        return { ok: true };
      }
    }
    if (sk === 'W') {
      if (wName === 'deadly-chop') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (!d || world.dist(s.x, s.y, d.x, d.y) > 3) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(8, 'w', 15000); if (!sp.ok) return sp;
        // Seção C: 502 + vuln SÓ ao concluir o cast 0,4s (D.2).
        const tgtId = foeId(d);
        return beginCast(s, 400, now, (mm, ss, nn) => {
          const D = castTarget(mm, ss, tgtId, 3, nn);
          if (!D) return { ok: false, error: 'Alvo inválido ao concluir.' };
          const r = dealDamage(mm, ss.id, foeId(D), 502, nn, { type: 'phys' });
          if (r.ok) D.vulnUntil = nn + 8000;
          return r;
        });
      }
      if (wName === 'adrenaline-boost') {
        const sp = spendAndBreak(30, 'w', 20000); if (!sp.ok) return sp;
        s.adrenalineUntil = now + 9000; s.adrenalineLastDmg = now;
        return { ok: true };
      }
      if (wName === 'battle-rush') {
        if (!hasPoint) return { ok: false, error: 'Escolha o destino.' };
        if (world.dist(s.x, s.y, px, py) > 12) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(36, 'w', 18000); if (!sp.ok) return sp;
        const t = slideTo(s, px, py); // Seção B: nunca em obstáculo
        s.x = t.x; s.y = t.y;
        eachFoe(m, s, (p) => {
          if (world.dist(s.x, s.y, p.x, p.y) > 5) return;
          if (p.id === s.id) return;
          if (m.mode === '2v2' && p.team === s.team) { p.healRecvBonus = 0.20; p.healRecvBonusUntil = now + 4000; }
          else { p.healDebuffUntil = Math.max(p.healDebuffUntil || 0, now + 3000); }
        });
        for (const p of m.players.values()) {
          if (p.left || !p.alive || p.knocked) continue;
          if (m.mode === '2v2' && p.team === s.team && world.dist(s.x, s.y, p.x, p.y) <= 5) { p.healRecvBonus = 0.20; p.healRecvBonusUntil = now + 4000; }
        }
        return { ok: true };
      }
      if (wName === 'internal-bleeding') {
        const sp = spendAndBreak(26, 'w', 15000); if (!sp.ok) return sp;
        let hit = false;
        eachFoe(m, s, (p) => {
          if (world.dist(s.x, s.y, p.x, p.y) > 6) return;
          const r = dealDamage(m, s.id, foeId(p), 193, now, { type: 'phys', pveRaw: 193 });
          if (r.ok) { hit = true; p.dots.push({ id: 'int-bleed', until: now + 8000, tickEvery: 500, next: now + 500, perTick: 66, from: s.id, moveOnly: true, type: 'phys' }); }
        });
        return hit ? { ok: true } : { ok: false, error: 'Nenhum alvo no alcance.' };
      }
      if (wName === 'raging-blades') {
        const sp = spendAndBreak(30, 'w', 12000); if (!sp.ok) return sp;
        s.ragingUntil = now + 3000; s.ragingNext = now; s.ragingStacks = 0;
        return { ok: true };
      }
    }
    if (sk === 'E') {
      // Blood Bandit: 2 etapas DIRECIONAIS 17m, combo 9s (PRODUTO D.2 + catálogo
      // blood-bandit target direction range17 cost40 cd10 duration9).
      // Mira=servidor: direção por ponto (x/y) ou, sem ponto, pela posição do
      // inimigo indicado; cone inCone 30°/17m + LOS via segmentBlocked no
      // dealDamage. Permite errar (cone vazio/bloqueado → 'Errou.' gasto na
      // etapa1, janela consumida na etapa2). shortcut: cone/projétil exato
      // Albion não publicado; cura etapa2 usa cargas do mais próximo na
      // trajetória (candidatos ordenados por projeção na direção).
      const dirOf = () => {
        if (hasPoint) return { x: px, y: py };
        if (d && !d.isDummy && !needEnemy(m, s, d)) return { x: d.x, y: d.y };
        return null;
      };
      // Projeção na direção (para ordenar frente→fundo); mesmo eixo do inCone.
      const projOf = (dx, dy, qx, qy) => {
        const ax = dx - s.x, ay = dy - s.y;
        const len = Math.hypot(ax, ay) || 1;
        return ((qx - s.x) * ax + (qy - s.y) * ay) / len;
      };
      if (s.eStage && now <= s.eStage.until) {
        const st = s.eStage.stacks;
        const dir = dirOf();
        if (!dir) return { ok: false, error: 'Escolha a direção.' };
        if (world.dist(s.x, s.y, dir.x, dir.y) > 17) return { ok: false, error: 'Fora de alcance.' };
        s.eStage = null; breakProt(s, now);
        let hit = false;
        eachFoe(m, s, (p) => {
          if (!inCone(s.x, s.y, dir.x, dir.y, p.x, p.y, 17)) return;
          const r = dealDamage(m, s.id, foeId(p), 363, now, { type: 'phys' });
          if (r.ok && (r.dmg > 0 || (r.absorbed || 0) > 0)) hit = true;
        });
        if (hit) {
          applyHeal(m, s.id, s.id, SK.E.healByStacks[st] || 110, now);
          return { ok: true };
        }
        return { ok: false, error: 'Errou.' };
      }
      const dir = dirOf();
      if (!dir) return { ok: false, error: 'Escolha a direção.' };
      if (world.dist(s.x, s.y, dir.x, dir.y) > 17) return { ok: false, error: 'Fora de alcance.' };
      const sp = spendAndBreak(40, 'e', 10000); if (!sp.ok) return sp;
      // Ordena candidatos frente→fundo pela projeção para firstStacks ser o
      // da frente na trajetória (não o 1º no Map).
      const cands = [];
      eachFoe(m, s, (p) => {
        if (!inCone(s.x, s.y, dir.x, dir.y, p.x, p.y, 17)) return;
        cands.push(p);
      });
      cands.sort((a, b2) => projOf(dir.x, dir.y, a.x, a.y) - projOf(dir.x, dir.y, b2.x, b2.y));
      let hit = false, firstStacks = 0;
      for (const p of cands) {
        const stacks = now <= (p.rendUntil || 0) ? (p.rend || 0) : 0;
        const before = hit;
        const r = dealDamage(m, s.id, foeId(p), SK.E.dmgByStacks[stacks] || 528, now, { type: 'phys' });
        if (r.ok && (r.dmg > 0 || (r.absorbed || 0) > 0)) {
          hit = true;
          if (!before) firstStacks = stacks;
          p.rend = 0;
        }
      }
      if (hit) { s.eStage = { until: now + 9000, stacks: firstStacks }; return { ok: true }; }
      return { ok: false, error: 'Errou.' };
    }
  }

  // ===== DAGGER =====
  if (w === 'dagger') {
    if (sk === 'Q') {
      if (qName === 'sunder-armor') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (world.dist(s.x, s.y, d.x, d.y) > 2) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(3, 'q', 2000); if (!sp.ok) return sp;
        const r = dealDamage(m, s.id, foeId(d), 230, now, { type: 'phys' });
        if (r.ok) {
          if (now > d.sunderUntil) d.sunderStacks = 0;
          d.sunderStacks = Math.min(3, (d.sunderStacks || 0) + 1); d.sunderUntil = now + 8000;
        }
        return r;
      }
      if (qName === 'deadly-swipe') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o destino.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 4.5) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(9, 'q', 4000); if (!sp.ok) return sp;
        const t = slideTo(s, tx, ty); // Seção B: nunca em obstáculo
        s.x = t.x; s.y = t.y;
        let hits = 0;
        eachFoe(m, s, (p) => {
          if (world.dist(s.x, s.y, p.x, p.y) <= 3) {
            const r = dealDamage(m, s.id, foeId(p), 258, now, { type: 'phys', pveRaw: 258 });
            if (r.ok) hits += 1;
          }
        });
        if (hits > 0) {
          s.assassinStacks = Math.min(3, (s.assassinStacks || 0) + hits); s.assassinUntil = now + 8000;
          s.energy = Math.min(s.maxEnergy, s.energy + 21);
          return { ok: true };
        }
        return { ok: false, error: 'Errou.' };
      }
      if (qName === 'assassin-spirit') {
        if (s.assassinSpiritOn) { s.assassinSpiritOn = false; return { ok: true, toggled: 'off' }; }
        const sp = spendAndBreak(6, 'q', 1000); if (!sp.ok) return sp;
        s.assassinSpiritOn = true; s.assassinSpiritUntil = now + 15000; s.assassinTick = now;
        return { ok: true, toggled: 'on' };
      }
    }
    if (sk === 'W') {
      if (wName === 'throwing-blades') {
        const sp = spendAndBreak(11, 'w', 15000); if (!sp.ok) return sp;
        // shortcut: cone 12m na direção do alvo/ponto; perfura.
        const tx = hasPoint ? px : (d ? d.x : s.x + 1), ty = hasPoint ? py : (d ? d.y : s.y);
        const dx = tx - s.x, dy = ty - s.y; const len = Math.hypot(dx, dy) || 1;
        let hits = [];
        eachFoe(m, s, (p) => {
          const rx = p.x - s.x, ry = p.y - s.y;
          const proj = (rx * dx + ry * dy) / len;
          if (proj < 0 || proj > 12) return;
          const perp = Math.abs(rx * dy - ry * dx) / len;
          if (perp <= 2) { const r = dealDamage(m, s.id, foeId(p), 207, now, { type: 'phys', pveRaw: 207 }); if (r.ok) hits.push(p); }
        });
        if (hits.length === 1) { s.buffs.push({ id: 'tblades', until: now + 5000, dmgMul: 1.10 }); s.moveBonusUntil = now + 5000; s.moveBonus = 0.15; }
        return hits.length ? { ok: true } : { ok: false, error: 'Errou.' };
      }
      if (wName === 'dash') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o destino.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 8) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(1, 'w', 23500); if (!sp.ok) return sp;
        const t = slideTo(s, tx, ty); // Seção B: nunca em obstáculo
        s.x = t.x; s.y = t.y;
        s.buffs.push({ id: 'dash-dmg', until: now + 4000, dmgMul: 1.15 });
        return { ok: true };
      }
      if (wName === 'forbidden-stab') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (world.dist(s.x, s.y, d.x, d.y) > 2) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(24, 'w', 15000); if (!sp.ok) return sp;
        d.channel = null; d.pendingCast = null; d.cc.silenceUntil = Math.max(d.cc.silenceUntil, now + 100); // interrompe
        const r = dealDamage(m, s.id, foeId(d), 290, now, { type: 'phys' });
        if (r.ok) d.forbiddenUntil = now + 1500;
        return r;
      }
      if (wName === 'shadow-edge') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (world.dist(s.x, s.y, d.x, d.y) > 22) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(41, 'w', 20000); if (!sp.ok) return sp;
        s.immuneCCUntil = Math.max(s.immuneCCUntil, now + 800);
        // teleporta para trás do alvo; sem dano (catálogo não lista dano p/ shadow-edge)
        const dx = d.x - s.x, dy = d.y - s.y; const len = Math.hypot(dx, dy) || 1;
        const t = slideTo(s, d.x + (dx / len) * 1.2, d.y + (dy / len) * 1.2); // Seção B
        s.x = t.x; s.y = t.y;
        const stunned = addCC(m, s, d, 'stun', 1680, now);
        if (stunned) s.cd.w = now + effCD(s, 20000) * 0.75;
        return { ok: true };
      }
      if (wName === 'chain-slash') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (world.dist(s.x, s.y, d.x, d.y) > 6) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(9, 'w', 15000); if (!sp.ok) return sp;
        s.immuneDmgUntil = Math.max(s.immuneDmgUntil, now + 1200);
        const dmgByHit = [379, 482, 689];
        let cur = d; let hits = 0;
        const seen = new Set();
        const nextHop = () => {
          const cands = [...m.players.values()].filter((p) => !seen.has(foeId(p)) && !p.left && p.alive && !p.knocked && (m.mode !== '2v2' || p.team !== s.team) && world.dist(s.x, s.y, p.x, p.y) <= 7);
          if (m.mode === 'pve' && m.monster && m.monster.alive && !seen.has('__monster__') && world.dist(s.x, s.y, m.monster.x, m.monster.y) <= 7) cands.push(m.monster);
          return cands[0];
        };
        while (cur && hits < 3) {
          if (seen.has(foeId(cur))) break;
          seen.add(foeId(cur));
          const r = dealDamage(m, s.id, foeId(cur), dmgByHit[hits] || 379, now, { type: 'phys', pveRaw: dmgByHit[hits] || 379 });
          if (!r.ok) break;
          hits += 1;
          s.x = cur.x; s.y = cur.y;
          cur = nextHop();
        }
        return hits ? { ok: true } : { ok: false, error: 'Errou.' };
      }
    }
    if (sk === 'E') {
      // Bloodthirsty Blade: toggle 6s.
      if (s.bloodthirstyOn) {
        s.bloodthirstyOn = false; s.bloodthirstyUntil = 0;
        if (s.moveBonus === 0.30) { s.moveBonusUntil = 0; s.moveBonus = 0; }
        return { ok: true, toggled: 'off' };
      }
      const sp = spendAndBreak(48, 'e', 20000); if (!sp.ok) return sp;
      s.bloodthirstyOn = true; s.bloodthirstyUntil = now + 6000; s.bloodthirstyTick = now;
      s.moveBonusUntil = now + 6000; s.moveBonus = 0.30; // +30% movimento no buff
      return { ok: true, toggled: 'on' };
    }
  }

  // ===== FIRE =====
  if (w === 'fire') {
    if (sk === 'Q') {
      if (qName === 'fire-bolt') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (!d || world.dist(s.x, s.y, d.x, d.y) > 13) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(9, 'q', 0); if (!sp.ok) return sp; // D.4: sem CD próprio
        const tgtId = foeId(d);
        return beginCast(s, 800, now, (mm, ss, nn) => {
          const D = castTarget(mm, ss, tgtId, 13, nn);
          if (!D) return { ok: false, error: 'Alvo inválido ao concluir.' };
          const r = dealDamage(mm, ss.id, foeId(D), 178, nn, { type: 'magic' });
          if (r.ok) { D.dots.push({ id: 'burn', until: nn + 4000, tickEvery: 1000, next: nn + 1000, perTick: 57 / 4, from: ss.id, type: 'magic' }); D.burnTagUntil = nn + 8000; }
          return r;
        });
      }
      if (qName === 'burning-field') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o ponto.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 15) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(6, 'q', 4000); if (!sp.ok) return sp;
        return beginCast(s, 500, now, (mm, ss, nn) => {
          mm.timers.push({ at: nn, kind: 'burning-field', x: tx, y: ty, until: nn + 4000, from: ss.id });
          // impacto imediato ao concluir
          eachFoe(mm, ss, (p) => {
            if (world.dist(tx, ty, p.x, p.y) <= 3) {
              const r = dealDamage(mm, ss.id, foeId(p), 201, nn, { type: 'magic', pveRaw: 201 });
              if (r.ok) p.burnTagUntil = nn + 8000;
            }
          });
          return { ok: true };
        });
      }
      if (qName === 'searing-flame') {
        const tx = hasPoint ? px : (d ? d.x : null);
        if (tx === null) return { ok: false, error: 'Escolha a direção.' };
        const ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 20) return { ok: false, error: 'Fora de alcance.' };
        const cont = s.searingStage > 0 && now <= s.searingUntil;
        const sp = spendAndBreak(14, 'q', 1500); if (!sp.ok) return sp;
        // shortcut: cone aproximado como área no ponto de mira (indicador futuro = área aplicada).
        return beginCast(s, cont ? 400 : 300, now, (mm, ss, nn) => {
          let hits = 0;
          const isFinisher = (ss.searingStage || 0) >= 3;
          eachFoe(mm, ss, (p) => {
            if (world.dist(tx, ty, p.x, p.y) <= 3.5) {
              const r = dealDamage(mm, ss.id, foeId(p), isFinisher ? 574 : 284, nn, { type: 'magic', pveRaw: isFinisher ? 574 : 284 });
              if (r.ok) { hits += 1; p.dots.push({ id: 'burn', until: nn + 4000, tickEvery: 1000, next: nn + 1000, perTick: 126 / 4, from: ss.id, type: 'magic' }); p.burnTagUntil = nn + 8000; }
            }
          });
          if (hits > 0) { ss.searingStage = isFinisher ? 0 : (ss.searingStage || 0) + 1; ss.searingUntil = nn + 5000; return { ok: true }; }
          ss.searingStage = 0;
          return { ok: false, error: 'Errou.' };
        });
      }
    }
    if (sk === 'W') {
      if (wName === 'flame-blast') {
        // alvo pode ser inimigo, aliado ou self.
        if (dumActive) return { ok: false, error: 'Boneco não recebe dano.' };
        const tgt = d || s;
        if (world.dist(s.x, s.y, tgt.x, tgt.y) > 11) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(23, 'w', 12000); if (!sp.ok) return sp;
        const tx = tgt.x, ty = tgt.y;
        const isAllyTgt = m.mode === '2v2' ? (tgt.team === s.team) : (tgt.id === s.id);
        if (isAllyTgt) { tgt.moveBonusUntil = now + 1600; tgt.moveBonus = 0.60; }
        else { const r0 = dealDamage(m, s.id, foeId(tgt), 115, now, { type: 'magic', pveRaw: 115 }); }
        m.timers.push({ at: now + 1600, kind: 'flame-blast', x: tx, y: ty, from: s.id });
        return { ok: true };
      }
      if (wName === 'wall-of-flames') {
        const sp = spendAndBreak(43, 'w', 15000); if (!sp.ok) return sp;
        // D.4: parede FRONTAL (largura 14m). Aproximação: BARREIRA posicional
        // centrada 4m à frente da mira (ou +x), raio 7m — largura 14m exige
        // raio ~7, por isso alcança até ~3m atrás do conjurador.
        // shortcut: parede é barreira posicional, NÃO cone direcional (4.1:
        // cones exigem proj>=0 e nunca atingem atrás); espessura/colisão pendentes.
        const ax = hasPoint ? px : s.x + 1, ay = hasPoint ? py : s.y;
        const dx = ax - s.x, dy = ay - s.y, len = Math.hypot(dx, dy) || 1;
        const t = slideTo(s, s.x + (dx / len) * 4, s.y + (dy / len) * 4);
        m.timers.push({ at: now, kind: 'wall', x: t.x, y: t.y, until: now + 5000, from: s.id, wid: s.id + '@' + now });
        return { ok: true };
      }
      if (wName === 'raging-flare') {
        const tx = hasPoint ? px : (d ? d.x : null);
        if (tx === null) return { ok: false, error: 'Escolha a direção.' };
        const ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 22) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(46, 'w', 20000); if (!sp.ok) return sp;
        return beginCast(s, 400, now, (mm, ss, nn) => {
          eachFoe(mm, ss, (p) => {
            if (world.dist(tx, ty, p.x, p.y) <= 5) {
              const r = dealDamage(mm, ss.id, foeId(p), 588, nn, { type: 'magic', pveRaw: 588 });
              if (r.ok) p.dots.push({ id: 'burn', until: nn + 3000, tickEvery: 1000, next: nn + 1000, perTick: 184 / 3, from: ss.id, type: 'magic' });
            }
          });
          return { ok: true };
        });
      }
      if (wName === 'fire-wave') {
        const sp = spendAndBreak(34, 'w', 12000); if (!sp.ok) return sp;
        const tx = hasPoint ? px : (d ? d.x : s.x + 1), ty = hasPoint ? py : (d ? d.y : s.y);
        let hit = false;
        // D.4: cone frontal 12m (aproximação ~60°); empurrão com deslize.
        eachFoe(m, s, (p) => {
          if (!inCone(s.x, s.y, tx, ty, p.x, p.y, 12)) return;
          const bonus = (p.burnTagUntil > now) ? 201 : 0;
          const r = dealDamage(m, s.id, foeId(p), 497 + bonus, now, { type: 'magic', pveRaw: 497 + bonus });
          if (r.ok) { hit = true; pushFrom(p, s.x, s.y, 5.59); }
        });
        return hit ? { ok: true } : { ok: false, error: 'Errou.' };
      }
      if (wName === 'fire-artillery') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (!d || world.dist(s.x, s.y, d.x, d.y) > 18) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(46, 'w', 15000); if (!sp.ok) return sp;
        // cast inicial 1,5s (D.4) e então canal 3s de orbes.
        const tgtId = foeId(d);
        return beginCast(s, 1500, now, (mm, ss, nn) => {
          const D = castTarget(mm, ss, tgtId, 18, nn);
          if (!D) return { ok: false, error: 'Alvo inválido ao concluir.' };
          ss.channel = { id: 'artillery', until: nn + 3000, span: 3000, tickEvery: 1500, next: nn + 1500, target: foeId(D), lock: true };
          return { ok: true };
        });
      }
    }
    if (sk === 'E') {
      // Pyroblast: carrega até1,2s; estágios 402/689/976; completo knockback.
      const err = needEnemy(m, s, d); if (err && !hasPoint) return { ok: false, error: err || 'Escolha o ponto.' };
      const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
      if (world.dist(s.x, s.y, tx, ty) > 15) return { ok: false, error: 'Fora de alcance.' };
      const sp = spendAndBreak(43, 'e', 15000); if (!sp.ok) return sp;
      s.channel = { id: 'pyroblast', until: now + 1200, span: 1200, tickEvery: 600, next: now + 600, stage: 0, x: tx, y: ty, lock: true };
      return { ok: true, charging: true };
    }
  }

  // ===== FROST =====
  if (w === 'frost') {
    if (sk === 'Q') {
      if (qName === 'frostbite') {
        const tx = hasPoint ? px : (d ? d.x : null);
        if (tx === null) return { ok: false, error: 'Escolha a direção.' };
        const ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 18) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(14, 'q', 1200); if (!sp.ok) return sp;
        // D.5: projétil direcional 18m (cone) com cast 0,3s; efeito ao concluir.
        return beginCast(s, 300, now, (mm, ss, nn) => {
          let hit = false;
          eachFoe(mm, ss, (p) => {
            if (!inCone(ss.x, ss.y, tx, ty, p.x, p.y, 18)) return;
            const r = dealDamage(mm, ss.id, foeId(p), 293, nn, { type: 'magic', pveRaw: 293 });
            if (r.ok) {
              hit = true;
              if (nn > p.frostbiteUntil) p.frostbiteStacks = 0;
              p.frostbiteStacks = Math.min(3, (p.frostbiteStacks || 0) + 1); p.frostbiteUntil = nn + 3000;
              if (p.frostbiteStacks >= 3) { addCC(mm, ss, p, 'stun', 1120, nn); p.frostbiteStacks = 0; }
            }
          });
          return hit ? { ok: true } : { ok: false, error: 'Errou.' };
        });
      }
      if (qName === 'ice-shard') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o ponto.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 14) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(8, 'q', 0); if (!sp.ok) return sp; // D.5: CD0 na captura
        return beginCast(s, 1200, now, (mm, ss, nn) => {
          mm.timers.push({ at: nn + 200, kind: 'ice-shard', x: tx, y: ty, from: ss.id });
          return { ok: true };
        });
      }
      if (qName === 'frozen-surge') {
        const sp = spendAndBreak(14, 'q', 3000); if (!sp.ok) return sp;
        const tx = hasPoint ? px : (d ? d.x : s.x + 8), ty = hasPoint ? py : (d ? d.y : s.y);
        // D.5: faixa frontal 16m x 3,8m ≈ cone estreito (meio-ângulo 7° + base 1,9m).
        eachFoe(m, s, (p) => {
          if (!inCone(s.x, s.y, tx, ty, p.x, p.y, 16, 7, 1.9)) return;
          const r = dealDamage(m, s.id, foeId(p), 258, now, { type: 'magic', pveRaw: 258 });
          if (r.ok) { addCC(m, s, p, 'slow', 3000, now); p.cc.slowPct = 0.20; }
        });
        return { ok: true };
      }
    }
    if (sk === 'W') {
      if (wName === 'frost-bomb') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o ponto.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 11) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(29, 'w', 10000); if (!sp.ok) return sp;
        eachFoe(m, s, (p) => {
          if (world.dist(tx, ty, p.x, p.y) <= 5) { addCC(m, s, p, 'slow', 1500, now); p.cc.slowPct = 0.30; }
        });
        m.timers.push({ at: now + 1600, kind: 'frost-bomb', x: tx, y: ty, from: s.id });
        return { ok: true };
      }
      if (wName === 'frost-beam') {
        const err = needEnemy(m, s, d); if (err) return { ok: false, error: err };
        if (world.dist(s.x, s.y, d.x, d.y) > 12) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(37, 'w', 15000); if (!sp.ok) return sp;
        s.channel = { id: 'frost-beam', until: now + 2700, span: 2700, tickEvery: 300, next: now + 300, target: d.id, lock: true };
        return { ok: true };
      }
      if (wName === 'frost-nova') {
        if (!hasPoint) return { ok: false, error: 'Escolha o destino.' };
        if (world.dist(s.x, s.y, px, py) > 11) return { ok: false, error: 'Fora de alcance.' };
        if (world.segmentBlocked(s.x, s.y, px, py)) return { ok: false, error: 'Obstáculo bloqueia.' };
        const sp = spendAndBreak(34, 'w', 20000); if (!sp.ok) return sp;
        const ox = s.x, oy = s.y;
        // Seção B: teleporte nunca termina em obstáculo (para antes/desliza).
        const t = slideTo(s, px, py);
        s.x = t.x; s.y = t.y;
        s.immuneDmgUntil = Math.max(s.immuneDmgUntil, now + 200);
        for (const p of m.players.values()) {
          if (p.id === s.id || p.left || !p.alive || p.knocked) continue;
          if (m.mode === '2v2' && p.team === s.team) continue;
          if (world.dist(ox, oy, p.x, p.y) <= 3) {
            const r = dealDamage(m, s.id, p.id, 201, now, { type: 'magic', pveRaw: 201 });
            if (r.ok) addCC(m, s, p, 'stun', 1400, now);
          }
        }
        if (m.mode === 'pve' && m.monster && m.monster.alive && world.dist(ox, oy, m.monster.x, m.monster.y) <= 3) {
          const r = dealDamage(m, s.id, '__monster__', 201, now, { type: 'magic', pveRaw: 201 });
          if (r.ok) addCC(m, s, m.monster, 'stun', 1400, now);
        }
        return { ok: true };
      }
      if (wName === 'frost-lance') {
        const tx = hasPoint ? px : (d ? d.x : null);
        if (tx === null) return { ok: false, error: 'Escolha o ponto.' };
        const ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 9) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(8, 'w', 8000); if (!sp.ok) return sp;
        eachFoe(m, s, (p) => {
          if (world.dist(tx, ty, p.x, p.y) <= 3) {
            const r = dealDamage(m, s.id, foeId(p), 425, now, { type: 'magic', pveRaw: 425 });
            if (r.ok) p.vulnUntil = Math.max(p.vulnUntil, now + 3000);
          }
        });
        return { ok: true };
      }
      if (wName === 'glacial-obelisk') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o ponto.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 12) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(23, 'w', 16000); if (!sp.ok) return sp;
        return beginCast(s, 400, now, (mm, ss, nn) => {
          mm.timers.push({ at: nn, kind: 'obelisk', x: tx, y: ty, until: nn + 6000, from: ss.id });
          return { ok: true };
        });
      }
    }
    if (sk === 'E') {
      // Freezing Wind: cone frontal 12m, 574 + root 2,8s (D.5/B).
      if (!hasPoint && !d) return { ok: false, error: 'Escolha a direção.' };
      const sp = spendAndBreak(46, 'e', 18000); if (!sp.ok) return sp;
      const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
      let hit = false;
      eachFoe(m, s, (p) => {
        if (!inCone(s.x, s.y, tx, ty, p.x, p.y, 12)) return;
        const r = dealDamage(m, s.id, foeId(p), 574, now, { type: 'magic', pveRaw: 574 });
        if (r.ok) { addCC(m, s, p, 'root', 2800, now); hit = true; }
      });
      return hit ? { ok: true } : { ok: false, error: 'Errou.' };
    }
  }

  // ===== HOLY =====
  if (w === 'holy') {
    if (sk === 'Q') {
      if (qName === 'generous-heal') {
        const tgt = dumActive ? null : (d || s);
        const err = needAlly(m, s, dumActive ? { isDummy: true } : tgt); if (err) return { ok: false, error: err };
        const gx = dumActive ? m.dummy.x : tgt.x, gy = dumActive ? m.dummy.y : tgt.y;
        if (world.dist(s.x, s.y, gx, gy) > 15) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(18, 'q', 1500); if (!sp.ok) return sp;
        return beginCast(s, 500, now, (mm, ss, nn) => {
          const r = applyHeal(mm, ss.id, dumActive ? '__dummy__' : tgt.id, 201, nn);
          if (r.ok && !dumActive) { tgt.healRecvBonus = 0.05 * Math.min(3, (tgt.generousStacks || 0) + 1); tgt.generousStacks = Math.min(3, (tgt.generousStacks || 0) + 1); tgt.healRecvBonusUntil = nn + 4000; }
          return r;
        });
      }
      if (qName === 'smite') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o ponto.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 13) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(11, 'q', 3000); if (!sp.ok) return sp;
        return beginCast(s, 500, now, (mm, ss, nn) => {
          mm.timers.push({ at: nn + 250, kind: 'smite', x: tx, y: ty, from: ss.id });
          return { ok: true };
        });
      }
      if (qName === 'holy-flash') {
        if (!hasPoint && !d) return { ok: false, error: 'Escolha o ponto.' };
        const tx = hasPoint ? px : d.x, ty = hasPoint ? py : d.y;
        if (world.dist(s.x, s.y, tx, ty) > 13) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(23, 'q', 3500); if (!sp.ok) return sp;
        return beginCast(s, 400, now, (mm, ss, nn) => {
          mm.timers.push({ at: nn + 400, kind: 'holy-flash', x: tx, y: ty, from: ss.id });
          return { ok: true };
        });
      }
    }
    if (sk === 'W') {
      if (wName === 'sacred-pulse') {
        const tgt = dumActive ? null : (d || s);
        const err = needAlly(m, s, dumActive ? { isDummy: true } : tgt); if (err) return { ok: false, error: err };
        const gx = dumActive ? m.dummy.x : tgt.x, gy = dumActive ? m.dummy.y : tgt.y;
        if (world.dist(s.x, s.y, gx, gy) > 13) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(32, 'w', 12000); if (!sp.ok) return sp;
        // cura até5 aliados raio5m + dano inimigos + knockback (Seção 5: mob/boneco incluídos)
        let healed = 0;
        for (const p of m.players.values()) {
          if (p.left || !p.alive || p.knocked) continue;
          if (world.dist(gx, gy, p.x, p.y) > 5) continue;
          const ally = m.mode === 'ffa' ? (p.id === s.id) : (m.mode === '2v2' ? p.team === s.team : p.id === s.id);
          if (ally && healed < 5) { const r = applyHeal(m, s.id, p.id, 81, now); if (r.ok) healed += 1; }
          else if (!ally) {
            const r = dealDamage(m, s.id, p.id, 321, now, { type: 'magic' });
            if (r.ok) pushFrom(p, gx, gy, 12.58);
          }
        }
        if (m.mode === 'pve') {
          if (m.monster && m.monster.alive && world.dist(gx, gy, m.monster.x, m.monster.y) <= 5) {
            const r = dealDamage(m, s.id, '__monster__', 321, now, { type: 'magic', pveRaw: 482 });
            if (r.ok) pushFrom(m.monster, gx, gy, 12.58);
          }
          if (m.dummy && healed < 5 && world.dist(gx, gy, m.dummy.x, m.dummy.y) <= 5) {
            if (applyHeal(m, s.id, '__dummy__', 81, now).ok) healed += 1;
          }
        }
        return { ok: true };
      }
      if (wName === 'holy-beam') {
        // Só aliado, não self; FFA sem alvo válido informa sem gastar.
        if (!d) return { ok: false, error: 'Sem alvo aliado válido.' };
        if (d.id === s.id) return { ok: false, error: 'Holy Beam não mira em si mesmo.' };
        const err = needAlly(m, s, d); if (err) return { ok: false, error: err };
        if (m.mode === 'ffa') return { ok: false, error: 'No FFA não há aliado para Holy Beam.' };
        // PvE: boneco (dummy) é alvo válido de cura.
        if (world.dist(s.x, s.y, d.x, d.y) > 12) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(37, 'w', 12000); if (!sp.ok) return sp;
        s.cc.slowUntil = Math.max(s.cc.slowUntil, now + 3000); s.cc.slowPct = 0.30;
        s.channel = { id: 'holy-beam', until: now + 3000, span: 3000, tickEvery: 500, next: now + 500, target: dumActive ? '__dummy__' : d.id, ticks: 0, lock: true };
        return { ok: true };
      }
      if (wName === 'holy-blessing') {
        if (dumActive) return { ok: false, error: 'Sem alvo aliado válido.' }; // buff sem efeito no boneco
        const tgt = d || s;
        const err = needAlly(m, s, tgt); if (err) return { ok: false, error: err };
        if (world.dist(s.x, s.y, tgt.x, tgt.y) > 13) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(23, 'w', 15000); if (!sp.ok) return sp;
        tgt.blessingUntil = now + 4000; tgt.blessArmor = 86;
        return { ok: true };
      }
      if (wName === 'holy-orb') {
        const sp = spendAndBreak(29, 'w', 15000); if (!sp.ok) return sp;
        const tx = hasPoint ? px : (d ? d.x : s.x + 5), ty = hasPoint ? py : (d ? d.y : s.y);
        if (world.dist(s.x, s.y, tx, ty) > 25) return { ok: false, error: 'Fora de alcance.' };
        m.timers.push({ at: now + 400, kind: 'holy-orb', x: tx, y: ty, from: s.id });
        return { ok: true };
      }
      if (wName === 'reawaken') {
        const tgt = d;
        if (!tgt || !tgt.knocked) return { ok: false, error: 'Sem aliado caído válido.' };
        if (m.mode === 'ffa') return { ok: false, error: 'Sem aliado caído válido.' };
        if (m.mode === 'pve') return { ok: false, error: 'Sem aliado caído válido.' };
        if (tgt.team !== s.team) return { ok: false, error: 'Reawaken só afeta aliados.' };
        if (now < tgt.reawakenLockUntil) return { ok: false, error: 'Alvo em lockout.' };
        if (world.dist(s.x, s.y, tgt.x, tgt.y) > 12) return { ok: false, error: 'Fora de alcance.' };
        const sp = spendAndBreak(66, 'w', 30000); if (!sp.ok) return sp;
        s.castUntil = now + effCast(s, 1000);
        s.pendingCast = { id: 'reawaken', at: now + 1000, total: 1000, target: tgt.id };
        return { ok: true, casting: true };
      }
    }
    if (sk === 'E') {
      if (dumActive) {
        const sp = spendAndBreak(43, 'e', 10000); if (!sp.ok) return sp;
        const low = m.dummy.hp <= m.dummy.maxHp * 0.40;
        const r = applyHeal(m, s.id, '__dummy__', low ? 443 : 201, now);
        if (r.ok && !low) { s.desperateStacks = Math.min(3, (s.desperateStacks || 0) + 1); s.desperateUntil = now + 15000; }
        return r;
      }
      const tgt = d || s;
      const err = needAlly(m, s, tgt); if (err) return { ok: false, error: err };
      if (world.dist(s.x, s.y, tgt.x, tgt.y) > 13) return { ok: false, error: 'Fora de alcance.' };
      const sp = spendAndBreak(43, 'e', 10000); if (!sp.ok) return sp;
      const low = tgt.hp <= tgt.maxHp * 0.40;
      const r = applyHeal(m, s.id, tgt.id, low ? 443 : 201, now);
      if (r.ok && !low) { s.desperateStacks = Math.min(3, (s.desperateStacks || 0) + 1); s.desperateUntil = now + 15000; }
      return r;
    }
  }
  return { ok: false, error: 'Habilidade inválida.' };
}

// ---- Armaduras ----
function useArmorSkill(m, s, sk, targetId, opts, now) {
  const b = normBuild(s.build);
  const d = targetId ? m.players.get(targetId) : null;
  const monActive = targetId === '__monster__' && m.mode === 'pve' && m.monster && m.monster.alive;
  const D = monActive ? m.monster : d;
  const px = opts.x, py = opts.y;
  const hasPoint = Number.isFinite(px) && Number.isFinite(py);
  const name = sk === 'HEAD' ? b.hSkill : sk === 'CHEST' ? b.cSkill : b.bSkill;
  const cdKey = sk === 'HEAD' ? 'head' : sk === 'CHEST' ? 'chest' : 'boots';
  const go = (cost, cd) => {
    const sp = spend(s, now, cost, cdKey, cd);
    if (!sp.ok) return sp;
    // Bridgewatch não dispara em armor; Caerleon só Q.
    afterCastEnergy(m, s, now);
    s.spellCount = (s.spellCount || 0) + 1;
    return { ok: true };
  };
  switch (name) {
    case 'energizing-shield': {
      const r = go(0, 25000); if (!r.ok) return r;
      addShield(s, 505, 3000, now);
      s.energy = Math.min(s.maxEnergy, s.energy + (s.maxEnergy - s.energy) * 0.25);
      return { ok: true };
    }
    case 'cleanse': {
      const r = go(0, 30000); if (!r.ok) return r; // shortcut: CD conservador
      s.buffs = (s.buffs || []).filter((x) => !x.debuff);
      s.dots = []; s.cc.stunUntil = 0; s.cc.rootUntil = 0; s.cc.silenceUntil = 0; s.cc.slowUntil = 0;
      s.immuneCCUntil = Math.max(s.immuneCCUntil, now + 1000);
      return { ok: true };
    }
    case 'howl': {
      if (!hasPoint && !D) return { ok: false, error: 'Escolha a direção.' };
      const r = go(0, 30000); if (!r.ok) return r; // catálogo: custo 0, CD 30
      // D.7: cone frontal 8m na direção da mira/alvo. Cone é direcional (4.1:
      // nunca atinge atrás); sem direção rejeita antes de gastar, como dodge.
      // Cone vazio = Errou gasto.
      const hx = hasPoint ? px : D.x;
      let hit = false;
      eachFoe(m, s, (p) => {
        if (!inCone(s.x, s.y, hx, hasPoint ? py : D.y, p.x, p.y, 8)) return;
        const rr = dealDamage(m, s.id, foeId(p), 163, now, { type: 'magic', pveRaw: 163 });
        if (rr.ok) { addCC(m, s, p, 'slow', 4000, now); p.cc.slowPct = 0.35; p.howlWeakUntil = now + 4000; p.channel = null; hit = true; }
      });
      return hit ? { ok: true } : { ok: false, error: 'Errou.' };
    }
    case 'mend-wounds': {
      if (now - s.lastCombat < COMBAT_MS) return { ok: false, error: 'Só fora de combate.' };
      const r = go(0, 30000); if (!r.ok) return r;
      s.channel = { id: 'mend', until: now + 7000, span: 7000, tickEvery: 1000, next: now + 1000, lock: true, lockMove: false };
      s.moveSlow = 0.5;
      return { ok: true };
    }
    case 'inferno-shield': {
      const r = go(0, 30000); if (!r.ok) return r; // catálogo: custo 0, CD 30, reflect 20%/5s
      s.infernoUntil = now + 5000;
      return { ok: true };
    }
    case 'bloodlust': {
      const r = go(0, 30000); if (!r.ok) return r; // catálogo: custo 0, CD 30, 6s
      s.bloodlustUntil = now + 6000;
      return { ok: true };
    }
    case 'dodge': {
      if (!hasPoint) return { ok: false, error: 'Escolha o destino.' };
      if (world.dist(s.x, s.y, px, py) > 5) return { ok: false, error: 'Fora de alcance.' };
      const r = go(0, 20000); if (!r.ok) return r;
      const t = slideTo(s, px, py); // Seção B: nunca em obstáculo/fora da arena
      s.x = t.x; s.y = t.y;
      s.immuneDmgUntil = Math.max(s.immuneDmgUntil, now + 800);
      s.immuneCCUntil = Math.max(s.immuneCCUntil, now + 800);
      s.moveBonusUntil = now + 5000; s.moveBonus = 0.40;
      return { ok: true };
    }
    case 'refreshing-sprint': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.moveBonusUntil = now + 5000; s.moveBonus = 0.40;
      s.buffs.push({ id: 'cdr-sprint', until: now + 5000, cdr: 0.20 }); // +40% mov/+20% recarga 5s
      return { ok: true };
    }
    case 'break-free': {
      if (!hasPoint) return { ok: false, error: 'Escolha o destino.' };
      if (world.dist(s.x, s.y, px, py) > 12) return { ok: false, error: 'Fora de alcance.' };
      const cost = effCost(s, 0);
      if (now < s.cd.boots) return { ok: false, error: 'Em recarga.' };
      s.energy -= cost; s.cd.boots = now + effCD(s, 30000);
      s.cc.stunUntil = 0; s.cc.rootUntil = 0; s.cc.silenceUntil = 0; s.cc.slowUntil = 0;
      const t = slideTo(s, px, py); // Seção B: nunca em obstáculo/fora da arena
      s.x = t.x; s.y = t.y;
      return { ok: true };
    }
    case 'stone-skin': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.stoneSkinUntil = now + 4000;
      return { ok: true };
    }
    case 'block': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.blockUntil = now + 2500; s.immuneDmgUntil = Math.max(s.immuneDmgUntil, now + 2500); s.immuneCCUntil = Math.max(s.immuneCCUntil, now + 2500);
      return { ok: true };
    }
    case 'taunt': {
      if (!D) return { ok: false, error: 'Alvo inválido.' };
      const terr = needEnemy(m, s, D); if (terr) return { ok: false, error: terr };
      if (world.dist(s.x, s.y, D.x, D.y) > 8) return { ok: false, error: 'Fora de alcance.' }; // shortcut
      const r = go(15, 20000); if (!r.ok) return r; // catálogo: 15/20s (hipótese, D.7 pendente)
      D.tauntVulnUntil = now + 3000; // +20% dano recebido de players (B)
      if (m.mode === 'pve' && m.monster) m.monster.target = s.id; // ameaça máxima
      s.threatBurstUntil = now + 5000;
      return { ok: true };
    }
    case 'fury': {
      const r = go(29, 35000); if (!r.ok) return r;
      s.furyUntil = now + 10000; s.furyStacks = 0;
      return { ok: true };
    }
    case 'rejuvenating-sprint': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.moveBonusUntil = now + 5000; s.moveBonus = 0.80;
      s.hots.push({ id: 'reju', until: now + 5000, tickEvery: 1000, next: now + 1000, perTick: 40 }); // 40/s x5s
      return { ok: true };
    }
    case 'wanderlust': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.moveBonusUntil = now + 8000; s.moveBonus = 0.80;
      s.wanderlustUntil = now + 8000; // +80% 8s fora de combate; entrar em combate cancela
      return { ok: true };
    }
    case 'force-field': {
      const r = go(0, 30000); if (!r.ok) return r;
      // stand 0,5s (D.6): efeito ao concluir; empurrão com deslize.
      s.castUntil = Math.max(s.castUntil || 0, now + effCast(s, 500));
      s.pendingCast = {
        id: 'cast', at: s.castUntil, total: Math.max(0, s.castUntil - now),
        run: (mm, ss, nn) => {
          eachFoe(mm, ss, (p) => {
            if (world.dist(ss.x, ss.y, p.x, p.y) <= 6) {
              const rr = dealDamage(mm, ss.id, foeId(p), 177, nn, { type: 'magic', pveRaw: 177 });
              if (rr.ok) pushFrom(p, ss.x, ss.y, 9);
            }
          });
          return { ok: true };
        },
      };
      return { ok: true, casting: true };
    }
    case 'aegis-of-energy': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.aegisUntil = now + 4000;
      return { ok: true };
    }
    case 'frost-shield': {
      const r = go(26, 40000); if (!r.ok) return r;
      s.frostShieldUntil = now + 8000;
      return { ok: true };
    }
    case 'speed-caster': {
      const r = go(26, 30000); if (!r.ok) return r;
      s.speedCasterUntil = now + 8000;
      return { ok: true };
    }
    case 'energetic-sprint': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.moveBonusUntil = now + 5000; s.moveBonus = 0.80;
      s.channel = s.channel; // instantâneo com HoT de energia
      s.hots.push({ id: 'en-sprint', until: now + 5000, tickEvery: 1000, next: now + 1000, energy: 11 });
      return { ok: true };
    }
    case 'focused-run': {
      const r = go(0, 30000); if (!r.ok) return r;
      s.channel = { id: 'focused-run', until: now + 4500, span: 4500, tickEvery: 500, next: now + 500, lock: true };
      s.moveBonusUntil = now + 4500; s.moveBonus = 0.70;
      s.focusImmuneUntil = now + 4500;
      return { ok: true };
    }
    default: return { ok: false, error: 'Habilidade inválida.' };
  }
}

function startFinish(m, srcId, targetId, now) {
  const s = m.players.get(srcId);
  const d = targetId ? m.players.get(targetId) : null;
  if (!s || !d) return { ok: false, error: 'Alvo inválido.' };
  if (!d.knocked) return { ok: false, error: 'Alvo não está caído.' };
  if (d.gettingUpUntil && now >= d.knockedUntil - GETUP_MS) { /* não pode iniciar nos 5s de levantar */ }
  if (d.gettingUpUntil > now) return { ok: false, error: 'Levantando.' };
  if (m.mode === '2v2' && s.team === d.team) return { ok: false, error: 'Só inimigos.' };
  if (world.dist(s.x, s.y, d.x, d.y) > 3) return { ok: false, error: 'Fora de alcance.' };
  if (!canAct(m, s, now)) return { ok: false, error: 'Incapaz de agir.' };
  s.finish = { target: d.id, until: now + FINISH_MS };
  d.finisher = s.id;
  return { ok: true, finishing: true };
}

function moveCommand(m, id, x, y, now = m.time) {
  const p = m.players.get(id);
  if (!p || !canMove(m, p, now)) return { ok: false };
  // Seção C: movimento cancela conjuração (sem reembolso, gasto mantido).
  if (p.pendingCast) p.pendingCast = null;
  // movimento interrompe finalização do próprio e canais com lockMove.
  if (p.finish) { p.finish = null; }
  if (p.channel && p.channel.lockMove) { /* focused-run permite mover */ }
  else if (p.channel && p.channel.lock && p.channel.id !== 'focused-run') {
    // Pyroblast: soltar andando libera o estágio parcial (voluntário).
    if (p.channel.id === 'pyroblast') pyroRelease(m, p, p.channel, now, true);
    p.channel = null;
  }
  const tx = world.clamp(Number(x), 0.5, world.W - 0.5);
  const ty = world.clamp(Number(y), 0.5, world.H - 0.5);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return { ok: false };
  if (world.isBlocked(tx, ty, 0.4)) return { ok: false, error: 'Destino bloqueado.' };
  p.dest = { x: tx, y: ty };
  return { ok: true };
}

// ---- tick ----
function waveRadiusAt(t) {
  if (t < WAVE_START_MS) return WAVE_R0;
  if (t >= WAVE_END_MS) return 0;
  return WAVE_R0 * (1 - (t - WAVE_START_MS) / (WAVE_END_MS - WAVE_START_MS));
}

function tick(m, dtMs, opts = {}) {
  const dt = Math.max(0, dtMs) / 1000;
  m.time += dtMs;
  const now = m.time;
  // intervalo 2v2: recomeça rodada.
  if (m.mode === '2v2' && m.roundState === 'interval' && m.intervalUntil !== null && now >= m.intervalUntil) {
    m.roundState = 'playing';
    startRound(m);
  }
  // wave radius
  if (m.mode === '2v2' && m.state === 'playing') m.waveRadius = waveRadiusAt(now - (m.roundStartAt || 0) + 0); // shortcut: wave por rodada
  if (m.mode === '2v2' && m.state === 'playing') {
    // usa tempo de rodada
    const rt = now - (m.roundStartAt || 0);
    m.waveRadius = waveRadiusAt(rt);
  }
  for (const p of m.players.values()) {
    if (p.left) continue;
    // movimento (fuga da parede tem precedência sobre dest)
    if (p.alive && !p.knocked && m.state === 'playing' && canMove(m, p, now)) {
      if (p.fleeUntil > now) {
        // D.4: fuga forçada para longe da parede 0,5s (dest já interrompido).
        // shortcut: vetor nulo (em cima do centro) foge p/ +x.
        const dx = p.x - (p.fleeFx ?? p.x), dy = p.y - (p.fleeFy ?? p.y);
        const len = Math.hypot(dx, dy);
        const ux = len < 1e-6 ? 1 : dx / len, uy = len < 1e-6 ? 0 : dy / len;
        const nx = p.x + ux * MOVE_SPEED * dt, ny = p.y + uy * MOVE_SPEED * dt;
        if (!world.isBlocked(nx, ny, 0.4)) { p.x = nx; p.y = ny; }
      } else if (p.dest) {
      const dx = p.dest.x - p.x, dy = p.dest.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.15) p.dest = null;
      else {
        let sp = MOVE_SPEED;
        if (now < p.cc.slowUntil) sp *= (1 - (p.cc.slowPct || 0.2));
        if (p.moveBonusUntil > now) sp *= (1 + (p.moveBonus || 0));
        if (p.adrenalineUntil > now) sp *= 1.40;
        if (p.channel && p.channel.id === 'mend') sp *= 0.5;
        const step = Math.min(d, sp * dt);
        const nx = p.x + (dx / d) * step, ny = p.y + (dy / d) * step;
        if (world.isBlocked(nx, ny, 0.4)) p.dest = null;
        else { p.x = nx; p.y = ny; }
      }
      }
    }
    if (m.state !== 'playing') {
      // respawn fora do loop principal
      if (!p.alive && !p.left && p.respawnAt !== null && now >= p.respawnAt && m.state === 'playing') { /* tratado abaixo */ }
      // caído: 15s → 5s levantar → vivo 100%.
      if (p.knocked && now >= p.knockedUntil && !p.gettingUpUntil) p.gettingUpUntil = now + GETUP_MS;
      continue;
    }
    if (!p.alive && !p.knocked) {
      if (!p.left && p.respawnAt !== null && now >= p.respawnAt) {
        if (m.mode === '2v2') { /* sem respawn */ }
        else {
          const s = pickSpawn(m, [...m.players.keys()].indexOf(p.id));
          p.x = s.x; p.y = s.y; p.dest = null;
          p.hp = p.maxHp; p.energy = p.maxEnergy; p.alive = true; p.respawnAt = null;
          p.protUntil = m.mode === 'pve' ? 0 : now + PROT_MS;
          p.cd = { aa: 0, q: 0, w: 0, e: 0, head: 0, chest: 0, boots: 0 };
          p.rend = 0; p.bleeds = []; p.dots = []; p.hots = []; p.healDebuffUntil = 0; p.vulnUntil = 0;
          p.eStage = null; p.castUntil = 0; p.channel = null; p.finish = null;
        }
      }
      continue;
    }
    // caído: progressão + finalização
    if (p.knocked) {
      if (!p.gettingUpUntil && now >= p.knockedUntil) p.gettingUpUntil = now + GETUP_MS;
      if (p.gettingUpUntil && now >= p.gettingUpUntil) {
        // levantou com 100% (§10).
        p.knocked = false; p.knockedUntil = 0; p.gettingUpUntil = 0; p.hp = p.maxHp;
        if (p.finisher) { const f = m.players.get(p.finisher); if (f) f.finish = null; p.finisher = null; }
      }
      // finalização em curso (p é vítima): verifica atacante
      continue;
    }
    // finalizador: checa conclusão/interrupção (só cancela ao concluir/expirar/morte/desconexão/distância; segue no levantar)
    if (p.finish) {
      const v = m.players.get(p.finish.target);
      if (!v || !v.knocked || !p.alive || p.left || p.disconnected) { p.finish = null; if (v) v.finisher = null; }
      else if (world.dist(p.x, p.y, v.x, v.y) > 4) { p.finish = null; v.finisher = null; }
      else if (now >= p.finish.until) {
        p.finish = null; v.finisher = null;
        v.knocked = false;
        dieImmediate(m, p.id, v.id, now);
      }
    }
    // Bleeds (Q) — DoT persiste; dano por segundo.
    if (p.bleeds.length) {
      p.bleeds = p.bleeds.filter((bl) => now < bl.until);
      for (const bl of p.bleeds) {
        const from = m.players.has(bl.from) && !m.players.get(bl.from)?.left ? bl.from : null;
        const amt = Math.min(p.hp, bl.perSec * dt);
        if (p.hp <= 0) break;
        if (now < p.protUntil) continue;
        if (now < p.immuneDmgUntil) continue;
        p.hp -= amt; p.lastCombat = now;
        if (from) { const s = m.players.get(from); s.lastCombat = now; s.dmgDealt += amt; }
        p.dmgTaken += amt;
        if (p.hp <= 0) { p.hp = 0; kill(m, from, p.id, now, { defer: true }); break; }
      }
      if (now > p.rendUntil) p.rend = 0;
    }
    // Dots genéricos (burn, int-bleed com moveOnly, etc.)
    if (p.dots.length) {
      const keep = [];
      for (const dot of p.dots) {
        if (now >= dot.until) continue;
        if (now < dot.next) { keep.push(dot); continue; }
        dot.next = now + (dot.tickEvery || 1000);
        if (dot.moveOnly && !p.dest && !(p.chase)) { keep.push(dot); continue; } // só enquanto se move
        if (now < p.protUntil || now < p.immuneDmgUntil) { keep.push(dot); continue; }
        const from = dot.from && m.players.has(dot.from) && !m.players.get(dot.from)?.left ? dot.from : null;
        let amt = dot.perTick || 0;
        if (from) { const s = m.players.get(from); amt = Math.round(amt * dmgMulOf(s)); }
        amt = Math.min(amt, p.hp);
        // resistência simples p/ dot mágico
        p.hp -= amt; p.lastCombat = now;
        if (from) { m.players.get(from).dmgDealt += amt; m.players.get(from).lastCombat = now; }
        p.dmgTaken += amt; p.lastDmgFrom = from; p.lastDmgAt = now;
        if (p.hp <= 0) { p.hp = 0; kill(m, from, p.id, now, { defer: true }); break; }
        keep.push(dot);
      }
      p.dots = keep;
    }
    // HoTs
    if (p.hots.length) {
      const keep = [];
      for (const h of p.hots) {
        if (now >= h.until) continue;
        if (now < h.next) { keep.push(h); continue; }
        h.next = now + (h.tickEvery || 1000);
        if (h.energy) { p.energy = Math.min(p.maxEnergy, p.energy + h.energy); keep.push(h); continue; }
        const eff = Math.min(h.perTick || 0, p.maxHp - p.hp);
        p.hp += eff; keep.push(h);
      }
      p.hots = keep;
    }
    // Casts com conclusão (Seção C; reawaken 1s): alvo morto/saído/fora de alcance
    // no término → falha explícita sem ressuscitar/aplicar (gasto mantido).
    if (p.pendingCast && now >= p.pendingCast.at) {
      const pc = p.pendingCast; p.pendingCast = null;
      if (pc.id === 'reawaken') {
        const t = m.players.get(pc.target);
        if (t && t.knocked && !t.left && t.alive) {
          t.knocked = false; t.knockedUntil = 0; t.gettingUpUntil = 0;
          t.hp = Math.round(t.maxHp * 0.30);
          t.reawakenLockUntil = now + 180000; // lockout 3min no alvo
          if (t.finisher) { const f = m.players.get(t.finisher); if (f) f.finish = null; t.finisher = null; }
        }
      } else if (typeof pc.run === 'function') {
        try { pc.run(m, p, now); } catch { /* efeito falhou explícito */ }
      }
    }
    // Desconectado: casts/finish do próprio cancelam (Seção 6/§11); parado e vulnerável.
    if (p.disconnected) {
      p.pendingCast = null;
      if (p.channel && p.channel.id !== 'focused-run') p.channel = null;
      if (p.finish) { const v = m.players.get(p.finish.target); p.finish = null; if (v) v.finisher = null; }
    }
    // Canais com ticks
    if (p.channel) {
      const ch = p.channel;
      if (now >= ch.until) {
        if (ch.id === 'pyroblast') {
          // canal completo: 976 + knockback 3,5m (D.4).
          eachFoe(m, p, (q) => {
            if (world.dist(ch.x, ch.y, q.x, q.y) <= 4) {
              const r = dealDamage(m, p.id, foeId(q), 976, now, { type: 'magic', pveRaw: 976 });
              if (r.ok) pushFrom(q, p.x, p.y, 3.5);
            }
          });
        }
        if (ch.id === 'mend') { /* fim do canal */ p.moveSlow = 0; }
        p.channel = null;
      } else if (now >= ch.next) {
        ch.next = now + ch.tickEvery;
        if (ch.id === 'frost-beam') {
          const t = chanTarget(m, ch.target);
          if (!t || (t.isMonster ? !t.alive : (!t.alive || t.knocked || t.left))) p.channel = null;
          else {
            eachFoe(m, p, (q) => {
              if (foeId(q) !== foeId(t) && world.dist(t.x, t.y, q.x, q.y) > 4) return;
              const r = dealDamage(m, p.id, foeId(q), 90, now, { type: 'magic' });
              if (r.ok) { q.frostSlowStacks = Math.min(5, (q.frostSlowStacks || 0) + 1); q.frostSlowUntil = now + 2000; addCC(m, p, q, 'slow', 2000, now); q.cc.slowPct = 0.15; }
            });
          }
        }
        if (ch.id === 'artillery') {
          const t = chanTarget(m, ch.target);
          const tOk = t && (t.isMonster ? t.alive : (t.alive && !t.knocked && !t.left));
          if (tOk) {
            dealDamage(m, p.id, foeId(t), 158, now, { type: 'magic', pveRaw: 158 });
            m.timers.push({ at: now, kind: 'fire-ground', x: t.x, y: t.y, until: now + 6000, from: p.id });
          }
        }
        if (ch.id === 'holy-beam') {
          const tIsDum = ch.target === '__dummy__';
          const t = chanTarget(m, ch.target);
          const tOk = t && (tIsDum || (t.alive && !t.knocked && !t.left));
          if (!tOk) p.channel = null;
          else { ch.ticks = (ch.ticks || 0) + 1; applyHeal(m, p.id, tIsDum ? '__dummy__' : t.id, 101 + 12 * Math.min(6, ch.ticks - 1), now); }
        }
        if (ch.id === 'mend') {
          // Mend só fora de combate: dano recebido cancela o canal.
          if (now - p.lastCombat < COMBAT_MS) { p.channel = null; p.moveSlow = 0; }
          else {
            const amt = p.maxHp * 0.09, en = p.maxEnergy * 0.075;
            p.hp = Math.min(p.maxHp, p.hp + amt);
            p.energy = Math.min(p.maxEnergy, p.energy + en);
          }
        }
        if (ch.id === 'focused-run') p.energy = Math.min(p.maxEnergy, p.energy + 11 / 2);
        if (ch.id === 'raging') { /* auras abaixo */ }
      }
    }
    // Raging Blades aura 3s: 73/0,5s raio5m + stacks.
    if (p.ragingUntil > now) {
      if (!p.ragingNext || now >= p.ragingNext) {
        p.ragingNext = now + 500;
        eachFoe(m, p, (q) => {
          if (world.dist(p.x, p.y, q.x, q.y) <= 5) {
            const r = dealDamage(m, p.id, foeId(q), 73, now, { type: 'magic', pveRaw: 73 });
            if (r.ok && !p.ragingHit?.has(foeId(q))) { (p.ragingHit = p.ragingHit || new Set()).add(foeId(q)); p.ragingStacks = Math.min(10, (p.ragingStacks || 0) + 1); p.ragingUntil = now + 3000; }
          }
        });
      }
    } else p.ragingHit = null;
    // Assassin Spirit ticks: 1 carga/2s.
    if (p.assassinSpiritOn) {
      if (now >= p.assassinSpiritUntil) p.assassinSpiritOn = false;
      else if (now >= (p.assassinTick || 0)) { p.assassinTick = now + 2000; p.assassinStacks = Math.min(3, (p.assassinStacks || 0) + 1); p.assassinUntil = now + 8000; }
    }
    // Bloodthirsty ticks: auto-dano verdadeiro 2,5% max/s.
    if (p.bloodthirstyOn) {
      if (now >= p.bloodthirstyUntil) p.bloodthirstyOn = false;
      else if (now >= (p.bloodthirstyTick || 0)) {
        p.bloodthirstyTick = now + 1000;
        p.hp -= p.maxHp * 0.025; p.lastCombat = now;
        if (p.hp <= 0) { p.hp = 0; kill(m, p.id, p.id, now, { defer: true }); }
      }
    }
    // Lymhurst ticks: 7% x10.
    if (p.lymhurstUntil > now && now >= (p.lymhurstNext || 0)) {
      p.lymhurstNext = now + 1000; p.lymhurstTicks = (p.lymhurstTicks || 0) + 1;
      p.energy = Math.min(p.maxEnergy, p.energy + p.maxEnergy * 0.07);
      if (p.lymhurstTicks >= 10) p.lymhurstUntil = 0;
    }
    // Adrenaline expira após 3s sem dano.
    if (p.adrenalineUntil > now && now - (p.adrenalineLastDmg || 0) > 3000 && (p.adrenalineLastDmg || 0) > 0) { /* mantém até 9s? encerra */ if (now - p.adrenalineLastDmg > 3000) p.adrenalineUntil = Math.min(p.adrenalineUntil, now); }
    // Wave 2v2: dano verdadeiro fora da área, só após 2:00 da rodada (§8).
    if (m.mode === '2v2' && m.state === 'playing' && (now - (m.roundStartAt || 0)) >= WAVE_START_MS) {
      const dd = Math.hypot(p.x - WAVE_CENTER[0], p.y - WAVE_CENTER[1]);
      if (dd > (m.waveRadius || 0)) {
        p.waveSec = (p.waveSec || 0) + dt;
        const perSec = p.maxHp * (0.05 + 0.02 * Math.floor(p.waveSec));
        p.hp -= Math.min(p.hp, perSec * dt);
        p.lastCombat = now;
        if (p.hp <= 0) { p.hp = 0; kill(m, null, p.id, now, { wave: true, defer: true }); }
      } else p.waveSec = 0;
    }
    // Regen (PRODUTO §14 + BARRAGEM §4: HP natural ZERO em combate; EN/curas/efeitos separados).
    // Confirmado: 1%/1% paz, HP 0% + EN 0,5% combate, janela 10s (COMBAT_MS).
    // Aproximação: flats base C.3 (capuz 2,7/1,22 + peito 5,4/0,61 + botas 2,7/0,37
    // + capa 0,24 + tomo 0,37); hpRegenPct/enRegenPct do catálogo (jaquetas +150%
    // HP, +4/6/12% EN) PENDENTES — ordem/acúmulo sem fonte confiável, sem inventar
    // valor (ver CATALOGO §3-33 e lib/catalog calcStats). shortcut: aplicar pct
    // quando houver medição em cliente.
    const inCombat = now - p.lastCombat < COMBAT_MS;
    const bld = normBuild(p.build);
    let hpFlat = 0, enFlat = 0;
    if (bld.head === 'mercenary-hood' || bld.head === 'soldier-helmet' || bld.head === 'scholar-cowl') { hpFlat += 2.7; enFlat += 1.22; }
    if (bld.chest === 'mercenary-jacket' || bld.chest === 'soldier-armor' || bld.chest === 'scholar-robe') { hpFlat += 5.4; enFlat += 0.61; }
    if (bld.boots) { hpFlat += 2.7; enFlat += 0.37; }
    if (bld.cape) enFlat += 0.24;
    if (bld.offhand === 'tome') enFlat += 0.37;
    const hpR = (inCombat ? 0 : p.maxHp * 0.01 + hpFlat) * dt;
    const enR = (p.maxEnergy * (inCombat ? 0.005 : 0.01) + (inCombat ? 0 : enFlat)) * dt;
    p.hp = Math.min(p.maxHp, p.hp + hpR);
    p.energy = Math.min(p.maxEnergy, p.energy + enR);
    // expirações
    if (p.bloodlustUntil && p.bloodlustUntil <= now) p.bloodlustUntil = 0;
    // Wanderlust: entrar em combate cancela (+80% só fora de combate).
    // shortcut: moveBonus 0,80 é compartilhado (rejuvenating/energetic); só limpa
    // se a janela coincide com a do wanderlust (faixa, não === exato).
    if (p.wanderlustUntil > now && now - p.lastCombat < COMBAT_MS) {
      const wUntil = p.wanderlustUntil;
      p.wanderlustUntil = 0;
      if (Math.abs((p.moveBonus || 0) - 0.80) < 1e-6 && Math.abs((p.moveBonusUntil || 0) - wUntil) < 1) { p.moveBonusUntil = 0; p.moveBonus = 0; }
    }
  }
  // Timers (projéteis/atrasos/áreas).
  if (m.timers.length && m.state === 'playing') {
    const due = m.timers.filter((t) => now >= t.at);
    m.timers = m.timers.filter((t) => now < t.at || (t.until && now < t.until && (t.kind === 'burning-field' || t.kind === 'wall' || t.kind === 'fire-ground' || t.kind === 'obelisk')));
    // áreas persistentes: tick
    for (const t of m.timers) {
      if (t.until && now < t.until && (t.kind === 'burning-field' || t.kind === 'wall' || t.kind === 'fire-ground' || t.kind === 'obelisk')) {
        if (!t.next || now >= t.next) {
          t.next = now + 500;
          timerFoes(m, t, (p) => {
            if (t.kind === 'burning-field' && world.dist(t.x, t.y, p.x, p.y) <= 3) {
              dealDamage(m, t.from, foeId(p), 79, now, { type: 'magic', dot: true, pveRaw: 57 }); // 158/0,5s → 79/tick; 57 vs mob
            }
            if (t.kind === 'wall' && world.dist(t.x, t.y, p.x, p.y) <= 7) {
              if (!p.wallHit || now > p.wallHit) {
                p.wallHit = now + 4000;
                dealDamage(m, t.from, foeId(p), 417, now, { type: 'magic', dot: true, pveRaw: 417 });
                // D.4: inimigos fogem 0,5s; monstros uma vez por parede.
                // shortcut: fuga = corre para longe 0,5s sem atacar/usar skills;
                // timing exato de interrupt não confirmado (ficha: "foge/recua").
                const isMon = !!p.isMonster;
                const fearResisted = !isMon && (now < (p.protUntil || 0) || now < (p.immuneCCUntil || 0));
                if (!fearResisted && !(isMon && p.lastFledWall === t.wid)) {
                  if (isMon) p.lastFledWall = t.wid;
                  // referência da fuga: centro da parede; se a vítima está em
                  // cima do centro, foge para longe do conjurador (fallback +x).
                  let fx = t.x, fy = t.y;
                  if (Math.hypot(p.x - t.x, p.y - t.y) < 0.5) {
                    const src = m.players.get(t.from);
                    fx = src ? src.x : t.x - 1; fy = src ? src.y : t.y;
                  }
                  p.fleeUntil = now + 500; p.fleeFx = fx; p.fleeFy = fy;
                  p.dest = null; p.chase = null; // interrompe movimento/perseguição
                }
              }
            }
            if (t.kind === 'fire-ground' && world.dist(t.x, t.y, p.x, p.y) <= 3) {
              p.artStacks = (p.artStacks || 0) + 0; // shortcut: stacks até4
              dealDamage(m, t.from, foeId(p), 21.5, now, { type: 'magic', dot: true, pveRaw: 16 }); // 43/0,5s → /0,5s; 16 vs mob
            }
            if (t.kind === 'obelisk') {
              const src = m.players.get(t.from);
              if (src && world.dist(t.x, t.y, p.x, p.y) <= 6 && (m.mode !== '2v2' || p.team === src.team)) p.glacialBuffUntil = now + 1000;
            }
          });
        }
      }
    }
    for (const t of due) {
      if (t.kind === 'flame-blast') {
        timerFoes(m, t, (p) => {
          if (world.dist(t.x, t.y, p.x, p.y) <= 5) dealDamage(m, t.from, foeId(p), 402, now, { type: 'magic', pveRaw: 402 });
        });
      }
      if (t.kind === 'frost-bomb') {
        const src = m.players.get(t.from);
        timerFoes(m, t, (p) => {
          if (world.dist(t.x, t.y, p.x, p.y) <= 5) { const r = dealDamage(m, t.from, foeId(p), 477, now, { type: 'magic', pveRaw: 477 }); if (r.ok) { addCC(m, src, p, 'slow', 5000, now); p.cc.slowPct = 0.20; } }
        });
      }
      if (t.kind === 'ice-shard') {
        timerFoes(m, t, (p) => {
          if (world.dist(t.x, t.y, p.x, p.y) <= 3) dealDamage(m, t.from, foeId(p), 373, now, { type: 'magic', pveRaw: 258 });
        });
      }
      if (t.kind === 'smite') {
        const src = m.players.get(t.from);
        timerFoes(m, t, (p) => {
          if (world.dist(t.x, t.y, p.x, p.y) <= 2.5) {
            const r = dealDamage(m, t.from, foeId(p), 330, now, { type: 'magic', pveRaw: 390 });
            if (r.ok) { p.smiteBonusUntil = now + 3000; if (src && src.id === t.from) src.cd.q = Math.max(0, src.cd.q - 1500); }
          }
        });
      }
      if (t.kind === 'holy-flash') {
        let n = 0;
        for (const p of m.players.values()) {
          if (p.left || !p.alive || p.knocked) continue;
          const src = m.players.get(t.from);
          const ally = !src || (m.mode === 'ffa' ? p.id === src.id : (m.mode === '2v2' ? p.team === src.team : true));
          if (!ally) continue;
          if (world.dist(t.x, t.y, p.x, p.y) <= 5 && n < 10) { applyHeal(m, t.from, p.id, 213, now); n += 1; }
        }
        if (m.mode === 'pve' && m.dummy && n < 10 && world.dist(t.x, t.y, m.dummy.x, m.dummy.y) <= 5) applyHeal(m, t.from, '__dummy__', 213, now);
      }
      if (t.kind === 'holy-orb') {
        let n = 0;
        for (const p of m.players.values()) {
          if (p.left || !p.alive || p.knocked) continue;
          const src = m.players.get(t.from);
          const ally = !src || (m.mode === 'ffa' ? p.id === src.id : (m.mode === '2v2' ? p.team === src.team : true));
          if (!ally) continue;
          if (world.dist(t.x, t.y, p.x, p.y) <= 7 && n < 10) { applyHeal(m, t.from, p.id, 272, now); n += 1; }
        }
        if (m.mode === 'pve' && m.dummy && n < 10 && world.dist(t.x, t.y, m.dummy.x, m.dummy.y) <= 7) applyHeal(m, t.from, '__dummy__', 272, now);
      }
    }
  }
  // Monstro PvE (persegue/ataca corpo-a-corpo; não ataca boneco; para com editor).
  if (m.mode === 'pve' && m.monster && m.state === 'playing') {
    const mo = m.monster;
    const anyEditor = [...m.players.values()].some((p) => p.editorOpen && !p.left);
    if (!mo.alive && mo.respawnAt !== null && now >= mo.respawnAt) {
      mo.alive = true; mo.hp = mo.maxHp;
      mo.spiritUntil = 0; mo.spiritBase = null; // limpa Spirit Crush
      if (m.pve) { m.pve.dmgTotal = 0; m.pve.dmgWindow = []; } // dano/DPS zeram; cura não
    }
    // Spirit Crush expira: restaura vida máxima base.
    if (mo.spiritUntil && now >= mo.spiritUntil && mo.spiritBase != null) {
      mo.maxHp = mo.spiritBase; mo.spiritBase = null; mo.spiritUntil = 0;
    }
    if (mo.alive) {
      if (now > mo.rendUntil) mo.rend = 0;
      // Bleeds/DoTs no monstro (mesmo motor; crédito + stats PvE; sem prot de player).
      if (mo.bleeds.length) {
        mo.bleeds = mo.bleeds.filter((bl) => now < bl.until);
        for (const bl of mo.bleeds) {
          const amt = Math.min(mo.hp, bl.perSec * dt);
          mo.hp -= amt;
          const from = bl.from && m.players.has(bl.from) ? m.players.get(bl.from) : null;
          if (from) { from.lastCombat = now; from.dmgDealt += amt; }
          if (m.pve) { m.pve.dmgTotal += amt; m.pve.dmgWindow.push({ t: now, amt }); }
          if (mo.hp <= 0) { mo.hp = 0; mo.alive = false; mo.respawnAt = now + 30000; break; }
        }
      }
      if (mo.alive && mo.dots.length) {
        const keep = [];
        for (const dot of mo.dots) {
          if (now >= dot.until) continue;
          if (now < dot.next) { keep.push(dot); continue; }
          dot.next = now + (dot.tickEvery || 1000);
          if (dot.moveOnly && now - (mo.movedAt || 0) > 1500) { keep.push(dot); continue; }
          const from = dot.from && m.players.has(dot.from) ? m.players.get(dot.from) : null;
          let amt = Math.min(mo.hp, dot.perTick || 0);
          if (from) amt = Math.min(mo.hp, Math.round(amt * dmgMulOf(from)));
          mo.hp -= amt;
          if (from) { from.lastCombat = now; from.dmgDealt += amt; }
          if (m.pve) { m.pve.dmgTotal += amt; m.pve.dmgWindow.push({ t: now, amt }); }
          if (mo.hp <= 0) { mo.hp = 0; mo.alive = false; mo.respawnAt = now + 30000; break; }
          keep.push(dot);
        }
        mo.dots = keep;
      }
      const moStunned = now < (mo.cc.stunUntil || 0);
      const moRooted = now < (mo.cc.rootUntil || 0) || moStunned;
      const prey = [...m.players.values()].filter((p) => !p.left && p.alive && !p.knocked)[0];
      if (prey && !anyEditor && !moStunned) {
        const dd = Math.hypot(prey.x - mo.x, prey.y - mo.y);
        if (mo.fleeUntil > now && !moRooted) {
          // D.4: fuga da parede 0,5s (uma vez por parede); sem atacar fugindo.
          const dx = mo.x - (mo.fleeFx ?? mo.x), dy = mo.y - (mo.fleeFy ?? mo.y);
          let msp = 5;
          if (now < (mo.cc.slowUntil || 0)) msp *= (1 - (mo.cc.slowPct || 0.2));
          const step = msp * dt;
          if (monsterSlide(mo, dx, dy, step)) mo.movedAt = now;
        }
        else if (dd > 2 && !moRooted) {
          const dx = prey.x - mo.x, dy = prey.y - mo.y;
          let msp = 5;
          if (now < (mo.cc.slowUntil || 0)) msp *= (1 - (mo.cc.slowPct || 0.2));
          const step = Math.min(dd, msp * dt);
          // monstro obedece obstáculos como jogadores (nunca entra na parede);
          // desliza no eixo livre p/ contornar cantos convexos (sem rota automática).
          if (monsterSlide(mo, dx, dy, step)) mo.movedAt = now;
        }
        else if (dd <= 2 && now >= (mo.cd || 0) && !(mo.fleeUntil > now)) {
          mo.cd = now + 1500;
          // ataque corpo-a-corpo ~90 físico (shortcut: hipótese, ajustar com teste).
          const amt = Math.min(prey.hp, Math.round(90 * 100 / (100 + (modsFor(prey).armor || 0))));
          prey.hp -= amt; prey.lastCombat = now; prey.dmgTaken += amt;
          // dano no finalizador interrompe a finalização (§10).
          if (prey.finish) { const v = m.players.get(prey.finish.target); prey.finish = null; if (v) v.finisher = null; }
          if (prey.hp <= 0) { prey.hp = 0; prey.alive = false; prey.deaths += 1; prey.respawnAt = now + PVE_RESPAWN_MS; }
        }
      }
      if (mo.hp <= 0 && mo.alive) { mo.alive = false; mo.respawnAt = now + 30000; }
    }
    // Boneco: 25%→100% espera 5s→25%.
    const du = m.dummy;
    if (du) {
      if (du.hp >= du.maxHp && !du.waitUntil) du.waitUntil = now + 5000;
      if (du.waitUntil && now >= du.waitUntil) { du.hp = du.maxHp * 0.25; du.waitUntil = null; }
    }
  }
  // Avalia fim simultâneo ao fim do passo.
  if (m.state === 'playing' && !opts.keepEnded) {
    if (m.mode === 'ffa') {
      const contenders = activePlayers(m).filter((p) => p.alive || (p.respawnAt !== null && p.respawnAt > now));
      if (contenders.length <= 1) endMatch(m);
    } else if (m.mode === '2v2' && m.roundState === 'playing') {
      checkRoundEnd(m, now);
    }
  }
  if (m.mode !== 'pve' && m.state === 'playing' && m.endsAt !== null && now >= m.endsAt) {
    // 2v2 não tem decisão por HP total: rodada só termina por eliminação/empate/wave (§8).
    if (m.mode !== '2v2') endMatch(m);
  } else if (m.state === 'ended' && !opts.keepEnded && m.autoReturnAt !== null && now >= m.autoReturnAt) {
    m.state = 'lobby'; m.result = null; m.winnerIds = []; m.endsAt = m.mode === 'pve' ? null : m.durationMs; m.autoReturnAt = null;
    for (const p of m.players.values()) p.ready = false;
  }
  return m;
}

// Dano no monstro/boneco (PvE) — separado de players.
function hitMonster(m, srcId, amount, now = m.time) {
  const s = m.players.get(srcId);
  const mo = m.monster;
  if (!s || !mo || !mo.alive || m.state !== 'playing') return { ok: false };
  let amt = Math.round(amount * dmgMulOf(s));
  // Spirit Crush (Soldier Armor, PvE): cada AA reduz vida máx e atual do MOB
  // em 12% por 3s; sem efeito em jogadores (catálogo: spirit-crush).
  try {
    const b = normBuild(s.build);
    if (b.cPass1 === 'spirit-crush' || b.cPass2 === 'spirit-crush') {
      if (mo.spiritBase == null) mo.spiritBase = mo.maxHp;
      mo.spiritUntil = now + 3000;
      mo.maxHp = Math.round(mo.spiritBase * 0.88);
      mo.hp = Math.min(mo.hp, mo.maxHp);
    }
  } catch { /* sem passiva: dano normal */ }
  amt = Math.min(amt, mo.hp);
  mo.hp -= amt; s.dmgDealt += amt; s.lastCombat = now;
  if (m.pve) { m.pve.dmgTotal += amt; m.pve.dmgWindow.push({ t: now, amt }); }
  if (mo.hp <= 0) { mo.alive = false; mo.respawnAt = now + 30000; }
  return { ok: true, dmg: amt };
}
function hitDummy(m, srcId, amount, now = m.time) {
  const du = m.dummy;
  if (!du || m.state !== 'playing') return { ok: false };
  const amt = Math.min(amount, du.maxHp - du.hp);
  du.hp += 0; // dummy não recebe dano; só cura (spec: monstro não ataca boneco; jogador testa cura)
  return { ok: false, error: 'Boneco não recebe dano.' };
}
function healDummy(m, srcId, amount, now = m.time) {
  const s = m.players.get(srcId);
  const du = m.dummy;
  if (!s || !du || m.state !== 'playing') return { ok: false };
  let amt = Math.round(amount * healCastOf(s));
  const eff = Math.min(amt, du.maxHp - du.hp);
  du.hp += eff; s.healDone += eff;
  if (m.pve) m.pve.healTotal += eff;
  return { ok: true, healed: eff };
}
function dps5s(m, now = m.time) {
  if (!m.pve) return 0;
  m.pve.dmgWindow = m.pve.dmgWindow.filter((e) => now - e.t <= 5000);
  return m.pve.dmgWindow.reduce((a, e) => a + e.amt, 0) / 5;
}

// §3.4/§9: resets INDEPENDENTES do treino — heal:true zera SÓ healTotal;
// sem heal zera SÓ dmgTotal + janela do DPS (a cura é preservada).
function pveResetStats(m, heal) {
  if (!m.pve) return { ok: false };
  if (heal) m.pve.healTotal = 0;
  else { m.pve.dmgTotal = 0; m.pve.dmgWindow = []; }
  return { ok: true };
}

function playerEffects(m, p) {
  // Efeitos ativos que o cliente lê (nome/tipo/restante em ms).
  const out = [];
  const now = m.time;
  for (const bl of (p.bleeds || [])) {
    if (now < bl.until) out.push({ nome: 'sangramento', id: 'bleed', tipo: 'debuff', restante: bl.until - now });
  }
  for (const d of (p.dots || [])) {
    if (now < d.until) out.push({ nome: d.id || 'dot', id: d.id || 'dot', tipo: 'debuff', restante: d.until - now });
  }
  for (const b of (p.buffs || [])) {
    if (now < (b.until || 0)) out.push({ nome: b.id || 'buff', id: b.id || 'buff', tipo: 'buff', restante: (b.until || 0) - now });
  }
  if (now < p.adrenalineUntil) out.push({ nome: 'adrenalina', id: 'adrenaline', tipo: 'buff', restante: p.adrenalineUntil - now });
  if (now < (p.stoneSkinUntil || 0)) out.push({ nome: 'pele de pedra', id: 'stone-skin', tipo: 'buff', restante: p.stoneSkinUntil - now });
  if (now < (p.frostShieldUntil || 0)) out.push({ nome: 'escudo gélido', id: 'frost-shield', tipo: 'buff', restante: p.frostShieldUntil - now });
  if (now < (p.aegisUntil || 0)) out.push({ nome: 'égide', id: 'aegis', tipo: 'buff', restante: p.aegisUntil - now });
  if (now < (p.martlockUntil || 0)) out.push({ nome: 'proteção (capa)', id: 'martlock', tipo: 'buff', restante: p.martlockUntil - now });
  if (now < p.protUntil) out.push({ nome: 'proteção', id: 'prot', tipo: 'buff', restante: p.protUntil - now });
  if (now < p.cc.stunUntil) out.push({ nome: 'stun', id: 'stun', tipo: 'debuff', restante: p.cc.stunUntil - now });
  if (now < p.cc.rootUntil) out.push({ nome: 'root', id: 'root', tipo: 'debuff', restante: p.cc.rootUntil - now });
  if (now < p.cc.silenceUntil) out.push({ nome: 'silence', id: 'silence', tipo: 'debuff', restante: p.cc.silenceUntil - now });
  return out;
}

function playerShield(p, now) {
  let total = 0;
  for (const sh of (p.shields || [])) {
    if (now <= sh.until && sh.amount > 0) total += sh.amount;
  }
  return Math.round(total);
}

// Anel de eventos por comando (protocolo compatível): servidor registra cada
// comando aceito/recusado; snapshot expõe últimos 20 sem quebrar clientes.
function pushEvent(m, evt) {
  m.seq = (m.seq || 0) + 1;
  m.events = m.events || [];
  const e = { seq: m.seq, t: m.time, ...evt };
  m.events.push(e);
  if (m.events.length > 20) m.events.shift();
  return e;
}

function snapshot(m) {
  const phase = m.state === 'playing' ? (m.mode === '2v2' ? `round-${m.round}` : 'combat') : m.state;
  const waveActive = m.mode === '2v2' && m.state === 'playing' && (m.time - (m.roundStartAt || 0)) >= WAVE_START_MS;
  return {
    code: m.code, state: m.state, phase, mode: m.mode, time: m.time,
    timeLeft: m.endsAt !== null && m.endsAt !== undefined ? Math.max(0, m.endsAt - m.time) : null,
    round: m.round, wins: m.wins, waveRadius: m.waveRadius,
    wave: { x: WAVE_CENTER[0], y: WAVE_CENTER[1], r: m.waveRadius, active: !!waveActive },
    endsIn: m.endsAt !== null ? Math.max(0, m.endsAt - m.time) : null,
    players: [...m.players.values()].map((p) => {
      const st = statsFor(p.build);
      const knocked = !!p.knocked;
      return {
        id: p.id, nick: p.nick, name: p.nick, team: p.team, ready: p.ready, left: !!p.left,
        disconnected: !!p.disconnected,
        x: +p.x.toFixed(2), y: +p.y.toFixed(2),
        hp: Math.ceil(p.hp), maxHp: p.maxHp,
        energy: Math.floor(p.energy), en: Math.floor(p.energy),
        maxEnergy: p.maxEnergy, maxEn: p.maxEnergy,
        alive: p.alive && !p.left && !p.knocked, knocked,
        downed: knocked ? { state: p.gettingUpUntil ? 'getting-up' : 'downed', t: Math.max(0, (p.knockedUntil || 0) - m.time) } : { state: 'up', t: 0 },
        caido: knocked,
        prot: m.time < p.protUntil, protecao: m.time < p.protUntil,
        shield: playerShield(p, m.time),
        effects: playerEffects(m, p), efeitos: playerEffects(m, p),
        kills: p.kills, deaths: p.deaths,
        dmgDealt: Math.round(p.dmgDealt), dmgTaken: Math.round(p.dmgTaken), healDone: Math.round(p.healDone),
        stunned: m.time < p.cc.stunUntil,
        cd: {
          aa: Math.max(0, Math.ceil(p.cd.aa - m.time)),
          q: Math.max(0, Math.ceil(p.cd.q - m.time)),
          w: Math.max(0, Math.ceil(p.cd.w - m.time)),
          e: Math.max(0, Math.ceil(p.cd.e - m.time)),
          head: Math.max(0, Math.ceil(p.cd.head - m.time)),
          chest: Math.max(0, Math.ceil(p.cd.chest - m.time)),
          boots: Math.max(0, Math.ceil(p.cd.boots - m.time)),
        },
        build: p.build,
        stats: { maxHp: st.maxHp, maxEnergy: st.maxEnergy },
        // Layer 1 (rodada combate): conjuração/canal em curso p/ arco de progresso na UI.
        cast: p.pendingCast ? { until: p.pendingCast.at, total: p.pendingCast.total || 0 } : null,
        chan: p.channel ? { id: p.channel.id, until: p.channel.until, total: p.channel.span || 0 } : null,
        // Layer 2: E de 2 usos (blood-bandit) — sinaliza 2º uso armado + expiração.
        eCombo: p.eStage && m.time <= p.eStage.until
          ? { armed: true, msLeft: Math.max(0, p.eStage.until - m.time), stacks: p.eStage.stacks } : null,
      };
    }),
    scores: boardOf(m),
    monster: m.monster ? { x: +m.monster.x.toFixed(1), y: +m.monster.y.toFixed(1), hp: Math.ceil(m.monster.hp), maxHp: m.monster.maxHp, alive: m.monster.alive } : null,
    dummy: m.dummy ? { x: m.dummy.x, y: m.dummy.y, hp: Math.ceil(m.dummy.hp), maxHp: m.dummy.maxHp } : null,
    pve: m.pve ? { dmgTotal: Math.round(m.pve.dmgTotal), dps5: +dps5s(m).toFixed(1), healTotal: Math.round(m.pve.healTotal) } : null,
    result: m.result,
    winners: m.winnerIds,
    seq: m.seq || 0,
    events: (m.events || []).slice(-20),
  };
}

module.exports = {
  SK, TICK_RATE, MOVE_SPEED, RESPAWN_MS, PVE_RESPAWN_MS, PROT_MS, MATCH_MS, COMBAT_MS,
  WEAPONS, OFFHANDS, HEADS, CHESTS, BOOTS, CAPES, ARMOR_SKILLS, WEAPON_Q, WEAPON_W, WEAPON_E,
  createMatch, joinPlayer, leavePlayer, setReady, setTeam, setMode, startMatch, startRound,
  basicAttack, useSkill, moveCommand, dealDamage, applyHeal, pushEvent,
  hitMonster, hitDummy, healDummy, dps5s, pveResetStats, waveRadiusAt,
  tick, snapshot, endMatch, validateFullBuild, normBuild, statsFor,
  skillParams, aaStatsFor, canonWeapon, shortWeapon, canonCape, shortCape, simToCanonBuild,
};
