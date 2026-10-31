// Ícones vetoriais próprios (recursos + ações). Tamanho via prop size.
import type { DevCardKind, ResourceKind } from '../../shared/constants';

export const RESOURCE_LABEL: Record<ResourceKind, string> = {
  brick: 'Tijolo',
  lumber: 'Madeira',
  wool: 'Lã',
  grain: 'Grão',
  ore: 'Minério',
};

export const RESOURCE_SHORT: Record<ResourceKind, string> = {
  brick: 'Tij',
  lumber: 'Mad',
  wool: 'Lã',
  grain: 'Grã',
  ore: 'Min',
};

export const DEV_LABEL: Record<DevCardKind, string> = {
  knight: 'Cavaleiro',
  victoryPoint: 'Ponto de Vitória',
  roadBuilding: 'Construção de Estradas',
  monopoly: 'Monopólio',
  yearOfPlenty: 'Fartura',
};

export const DEV_DESC: Record<DevCardKind, string> = {
  knight: 'Mova o ladrão e roube uma carta de um jogador à escolha.',
  victoryPoint: 'Vale 1 ponto. Revela quando você chegar a 10+.',
  roadBuilding: 'Coloque até 2 estradas gratuitas.',
  monopoly: 'Anuncie um recurso: todos os rivais entregam as cartas que têm dele.',
  yearOfPlenty: 'Tome 2 cartas do banco (mesmo tipo ou dois diferentes).',
};

const RES_COLOR: Record<ResourceKind, string> = {
  brick: '#bd6a3f',
  lumber: '#2e6b3c',
  wool: '#93c25f',
  grain: '#e0b63e',
  ore: '#8d9098',
};

export function ResourceIcon({ kind, size = 18 }: { kind: ResourceKind; size?: number }) {
  const c = RES_COLOR[kind];
  const common = { width: size, height: size, viewBox: '0 0 24 24' };
  switch (kind) {
    case 'brick':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="2" y="8" width="20" height="8" rx="1.5" fill={c} stroke="#5a3018" strokeWidth="1.2" />
          <rect x="2" y="16" width="9" height="6" rx="1.2" fill={c} stroke="#5a3018" strokeWidth="1.2" />
          <rect x="13" y="16" width="9" height="6" rx="1.2" fill={c} stroke="#5a3018" strokeWidth="1.2" />
          <line x1="12" y1="8" x2="12" y2="16" stroke="#5a3018" strokeWidth="1" />
        </svg>
      );
    case 'lumber':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 2 L5 12 H9 L4 19 H20 L15 12 H19 Z" fill={c} stroke="#173d22" strokeWidth="1.2" strokeLinejoin="round" />
          <rect x="10.5" y="19" width="3" height="3.5" fill="#6b4a2a" />
        </svg>
      );
    case 'wool':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="8" cy="12" r="5" fill={c} stroke="#4d7230" strokeWidth="1.1" />
          <circle cx="14" cy="10" r="5.5" fill={c} stroke="#4d7230" strokeWidth="1.1" />
          <circle cx="15" cy="15" r="4.5" fill={c} stroke="#4d7230" strokeWidth="1.1" />
          <circle cx="10" cy="8" r="3.6" fill="#eaf5da" stroke="#4d7230" strokeWidth="1" />
        </svg>
      );
    case 'grain':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 22 V7" stroke="#8a6d1e" strokeWidth="1.6" />
          <ellipse cx="12" cy="6" rx="2.6" ry="4" fill={c} stroke="#8a6d1e" strokeWidth="1" />
          <ellipse cx="8.6" cy="10" rx="2.4" ry="3.6" fill={c} stroke="#8a6d1e" strokeWidth="1" transform="rotate(-35 8.6 10)" />
          <ellipse cx="15.4" cy="10" rx="2.4" ry="3.6" fill={c} stroke="#8a6d1e" strokeWidth="1" transform="rotate(35 15.4 10)" />
          <ellipse cx="9" cy="15" rx="2.2" ry="3.2" fill={c} stroke="#8a6d1e" strokeWidth="1" transform="rotate(-35 9 15)" />
          <ellipse cx="15" cy="15" rx="2.2" ry="3.2" fill={c} stroke="#8a6d1e" strokeWidth="1" transform="rotate(35 15 15)" />
        </svg>
      );
    case 'ore':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 18 L8 7 L12 13 L15 8 L21 18 Z" fill={c} stroke="#3c3f45" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M8 7 L10 18" stroke="#3c3f45" strokeWidth="0.8" opacity="0.6" />
          <path d="M15 8 L14 18" stroke="#3c3f45" strokeWidth="0.8" opacity="0.6" />
        </svg>
      );
  }
}

export function DiceIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#f3e6c8" stroke="#8a6d3b" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.7" fill="#2a1c10" />
      <circle cx="16" cy="8" r="1.7" fill="#2a1c10" />
      <circle cx="12" cy="12" r="1.7" fill="#2a1c10" />
      <circle cx="8" cy="16" r="1.7" fill="#2a1c10" />
      <circle cx="16" cy="16" r="1.7" fill="#2a1c10" />
    </svg>
  );
}

export function RoadIcon({ color = '#d97b28', size = 18 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="9" width="20" height="7" rx="3" fill={color} stroke="#2a1c10" strokeWidth="1.2" transform="rotate(-18 12 12)" />
    </svg>
  );
}

export function SettlementIcon({ color = '#d97b28', size = 18 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20 V11 L12 4 L20 11 V20 Z" fill={color} stroke="#2a1c10" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="10" y="13" width="4" height="7" fill="rgba(42,28,16,0.4)" />
    </svg>
  );
}

export function CityIcon({ color = '#d97b28', size = 18 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 20 V12 L8 10 V4 L13 7 L18 4 V10 L21 12 V20 Z" fill={color} stroke="#2a1c10" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="5" y="14" width="3" height="6" fill="rgba(42,28,16,0.4)" />
      <rect x="14" y="9" width="2.6" height="2.6" fill="rgba(42,28,16,0.45)" />
    </svg>
  );
}

export function DevCardIcon({ kind, size = 18 }: { kind: DevCardKind; size?: number }) {
  const base = { width: size, height: size, viewBox: '0 0 24 24' } as const;
  switch (kind) {
    case 'knight':
      return (
        <svg {...base} aria-hidden="true">
          <path d="M12 2 L19 5 V11 C19 16 16 20 12 22 C8 20 5 16 5 11 V5 Z" fill="#5c78c9" stroke="#26355c" strokeWidth="1.3" />
          <path d="M12 7 L14 11 L12 15 L10 11 Z" fill="#f0e8d5" />
        </svg>
      );
    case 'victoryPoint':
      return (
        <svg {...base} aria-hidden="true">
          <path d="M12 2 L15 9 L22 9.5 L17 14 L18.5 21 L12 17.5 L5.5 21 L7 14 L2 9.5 L9 9 Z" fill="#e6b74a" stroke="#8a6d3b" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'roadBuilding':
      return (
        <svg {...base} aria-hidden="true">
          <rect x="2" y="7" width="9" height="4" rx="2" fill="#d97b28" stroke="#2a1c10" strokeWidth="1" />
          <rect x="13" y="13" width="9" height="4" rx="2" fill="#d97b28" stroke="#2a1c10" strokeWidth="1" />
          <path d="M11 9 L15 13" stroke="#2a1c10" strokeWidth="1.2" />
        </svg>
      );
    case 'monopoly':
      return (
        <svg {...base} aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="#c9962c" stroke="#8a6d3b" strokeWidth="1.3" />
          <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#33230a" fontFamily="Georgia, serif">
            M
          </text>
        </svg>
      );
    case 'yearOfPlenty':
      return (
        <svg {...base} aria-hidden="true">
          <path d="M4 12 Q 12 3 20 12 Q 12 21 4 12 Z" fill="#3e8e5a" stroke="#1e5233" strokeWidth="1.2" />
          <circle cx="9.5" cy="12" r="2" fill="#f3e6c8" />
          <circle cx="14.5" cy="12" r="2" fill="#f3e6c8" />
        </svg>
      );
  }
}

export function RobberIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 20 Q 3 8 12 5 Q 21 8 19 20 Z" fill="#241a12" stroke="#0d0906" strokeWidth="1.2" />
      <circle cx="9.5" cy="11" r="1.6" fill="#c0392b" />
      <circle cx="14.5" cy="11" r="1.6" fill="#c0392b" />
    </svg>
  );
}

export function CopyIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 5 H6 A2.5 2.5 0 0 0 3.5 7.5 V17" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
