// Asfalto Vivo — persistência local (configurações + recordes por pista).
// Fachada canônica (ARCHITECTURE §6): loadSettings, saveSettings, loadRecords, saveRecord.

import { STORAGE, COLORS } from '/shared/constants.js';

const DEFAULTS = {
  volume: 0.8,
  muted: false,
  quality: 'medium',        // 'low' | 'medium' | 'high'
  fxIntensity: 1,           // 0..1
  steerSensitivity: 1,      // multiplicador
  nickname: '',
  color: COLORS[0].hex,     // '#hex' da paleta
};

function safeParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function loadSettings() {
  let saved = null;
  try { saved = safeParse(localStorage.getItem(STORAGE.settings)); } catch { saved = null; }
  const s = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };

  // Sanidade mínima: tipos errados voltam ao default.
  if (typeof s.volume !== 'number' || Number.isNaN(s.volume)) s.volume = DEFAULTS.volume;
  s.volume = Math.min(1, Math.max(0, s.volume));
  s.muted = !!s.muted;
  if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = DEFAULTS.quality;
  if (typeof s.fxIntensity !== 'number' || Number.isNaN(s.fxIntensity)) s.fxIntensity = DEFAULTS.fxIntensity;
  s.fxIntensity = Math.min(1, Math.max(0, s.fxIntensity));
  if (typeof s.steerSensitivity !== 'number' || Number.isNaN(s.steerSensitivity)) s.steerSensitivity = DEFAULTS.steerSensitivity;
  s.nickname = typeof s.nickname === 'string' ? s.nickname.slice(0, 16) : '';
  if (typeof s.color !== 'string' || !COLORS.some((c) => c.hex === s.color)) s.color = DEFAULTS.color;
  return s;
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...(patch && typeof patch === 'object' ? patch : {}) };
  try { localStorage.setItem(STORAGE.settings, JSON.stringify(next)); } catch { /* storage cheio/bloqueado: segue em memória */ }
  return next;
}

export function loadRecords() {
  let saved = null;
  try { saved = safeParse(localStorage.getItem(STORAGE.records)); } catch { saved = null; }
  const base = { costeiro: null, industrial: null };
  if (saved && typeof saved === 'object') {
    for (const id of Object.keys(base)) {
      const r = saved[id];
      if (r && typeof r === 'object' && typeof r.bestLapMs === 'number') {
        base[id] = { bestLapMs: r.bestLapMs, at: typeof r.at === 'number' ? r.at : null };
      }
    }
  }
  return base;
}

export function saveRecord(trackId, lapMs) {
  if (typeof lapMs !== 'number' || !Number.isFinite(lapMs) || lapMs <= 0) return false;
  const records = loadRecords();
  const cur = records[trackId];
  if (cur && cur.bestLapMs <= lapMs) return false;
  records[trackId] = { bestLapMs: lapMs, at: Date.now() };
  try { localStorage.setItem(STORAGE.records, JSON.stringify(records)); } catch { /* ignora */ }
  return true;
}
