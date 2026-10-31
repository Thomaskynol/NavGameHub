// Sessão por sala (sessionStorage, por aba) + preferências (localStorage).

export interface HubParams {
  room: string;
  name: string;
  create: boolean;
  expect: number;
  slot: number;
  hubUrl: string;
  /** Dono da instância (htok do Hub); '' quando ausente/legado. */
  htok: string;
}

/**
 * Modo Hub (hub/PROTOCOLO.md): `?hub=1&room=&name=&create=1|0&expect=&slot=&hubUrl=&htok=`.
 * Pura (recebe o search) para ser testável sem DOM. Null fora do modo Hub
 * ou quando faltam sala/apelido.
 */
export function parseHubParams(search: string): HubParams | null {
  const q = new URLSearchParams(search);
  if (q.get('hub') !== '1') return null;
  const room = (q.get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const name = (q.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!room || !name) return null;
  const rawHtok = (q.get('htok') ?? '').trim();
  const htok = /^[A-Za-z0-9\-_]{1,128}$/.test(rawHtok) ? rawHtok : '';
  return {
    room,
    name,
    create: q.get('create') === '1',
    expect: Math.max(0, Number(q.get('expect')) || 0),
    slot: Math.max(0, Number(q.get('slot')) || 0),
    hubUrl: q.get('hubUrl') ?? '',
    htok,
  };
}

export interface StoredSession {
  roomCode: string;
  roomName: string;
  playerId: string;
  recoveryCode: string;
}

const ROOM_PREFIX = 'catan:room:';
const ACTIVE_KEY = 'catan:active-room';
const PREFS_KEY = 'catan:prefs';

export interface Prefs {
  volume: number;
  muted: boolean;
  reduceMotion: boolean;
  tutorialSeen: boolean;
  nickname: string;
}

export const DEFAULT_PREFS: Prefs = {
  volume: 0.7,
  muted: false,
  reduceMotion: false,
  tutorialSeen: false,
  nickname: '',
};

function roomKey(code: string): string {
  return ROOM_PREFIX + code.toUpperCase();
}

export function saveSession(s: StoredSession): void {
  sessionStorage.setItem(roomKey(s.roomCode), JSON.stringify(s));
  sessionStorage.setItem(ACTIVE_KEY, s.roomCode.toUpperCase());
}

export function loadSession(code: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(roomKey(code));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function loadActiveSession(): StoredSession | null {
  const code = sessionStorage.getItem(ACTIVE_KEY);
  if (!code) return null;
  return loadSession(code);
}

export function clearActiveSession(): void {
  const code = sessionStorage.getItem(ACTIVE_KEY);
  if (code) sessionStorage.removeItem(roomKey(code));
  sessionStorage.removeItem(ACTIVE_KEY);
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // armazenamento indisponível — segue com preferências em memória
  }
}
