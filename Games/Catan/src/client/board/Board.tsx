// Tabuleiro SVG: ilha de 19 hexes, mar, portos, peças, ladrão, destaques legais.
// Pan (arrastar) + zoom (roda / botões). Arte vetorial original.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EdgeId, HexId, PlayerColor, PlayerId, VertexId } from '../../shared/constants';
import type { GameView, PublicPlayerView } from '../../shared/protocol';
import { hexPathPoints, parseEdgeId, type GeoHex, type IslandGeometry } from './geometry';
import type { LegalTargets } from './legalClient';

export type BoardMode =
  | { kind: 'none'; label?: string }
  | { kind: 'vertex'; vertices: VertexId[]; label: string }
  | { kind: 'edge'; edges: EdgeId[]; label: string }
  | { kind: 'robber'; hexes: HexId[]; label: string };

export interface BoardPick {
  type: 'vertex' | 'edge' | 'hex';
  id: string;
}

interface BoardProps {
  view: GameView;
  geo: IslandGeometry;
  legal: LegalTargets;
  mode: BoardMode;
  selected: BoardPick | null;
  onPick(pick: BoardPick): void;
  onHoverPreview?(pick: BoardPick | null): void;
  youId: PlayerId;
}

const VIEW_W = 1200;
const VIEW_H = 860;

const TERRAIN_STYLE: Record<string, { fill: string; ink: string; label: string }> = {
  forest: { fill: '#2e6b3c', ink: '#1d4a28', label: 'floresta' },
  pasture: { fill: '#93c25f', ink: '#6f9b43', label: 'pastagem' },
  fields: { fill: '#e0b63e', ink: '#c1952a', label: 'campos' },
  hills: { fill: '#bd6a3f', ink: '#99512c', label: 'colinas' },
  mountains: { fill: '#8d9098', ink: '#6c6f77', label: 'montanhas' },
  desert: { fill: '#ddc288', ink: '#c0a46a', label: 'deserto' },
};

const PLAYER_FILL: Record<PlayerColor, string> = {
  red: '#b33a2e',
  orange: '#d97b28',
  white: '#f0e8d5',
  blue: '#2f6ea8',
};

const RESOURCE_TINT: Record<string, string> = {
  brick: '#bd6a3f',
  lumber: '#2e6b3c',
  wool: '#93c25f',
  grain: '#e0b63e',
  ore: '#8d9098',
};

function pipsFor(n: number): number {
  return Math.max(1, 6 - Math.abs(n - 7));
}

function Token({ x, y, number }: { x: number; y: number; number: number }) {
  const hot = number === 6 || number === 8;
  const n = pipsFor(number);
  const dots: { cx: number; cy: number }[] = [];
  const gap = 4.4;
  const start = -((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) dots.push({ cx: x + start + i * gap, cy: y + 15 });
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={14.5} fill="#f3e6c8" stroke="#8a6d3b" strokeWidth={1.4} />
      <circle cx={x} cy={y} r={12} fill="none" stroke="#d8bf8a" strokeWidth={0.8} />
      <text
        x={x}
        y={y + 4.5}
        textAnchor="middle"
        fontSize={14}
        fontWeight={800}
        fontFamily="Georgia, serif"
        fill={hot ? '#b33a2e' : '#2a1c10'}
      >
        {number}
      </text>
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={1.35} fill={hot ? '#b33a2e' : '#5a4630'} />
      ))}
    </g>
  );
}

function SettlementShape({ color }: { color: PlayerColor }) {
  const fill = PLAYER_FILL[color];
  return (
    <g>
      <path d="M-9,9 L-9,-1 L0,-10 L9,-1 L9,9 Z" fill={fill} stroke="#2a1c10" strokeWidth={1.6} strokeLinejoin="round" />
      <rect x={-3} y={2} width={6} height={7} fill="rgba(42,28,16,0.35)" />
    </g>
  );
}

function CityShape({ color }: { color: PlayerColor }) {
  const fill = PLAYER_FILL[color];
  return (
    <g>
      <path d="M-10,10 L-10,0 L-2,-2 L-2,-10 L4,-13 L10,-10 L10,0 L5,2 L5,10 Z" fill={fill} stroke="#2a1c10" strokeWidth={1.6} strokeLinejoin="round" />
      <rect x={-7} y={3} width={4} height={7} fill="rgba(42,28,16,0.35)" />
      <rect x={4} y={-7} width={3} height={3} fill="rgba(42,28,16,0.4)" />
    </g>
  );
}

export default function Board({
  view,
  geo,
  legal,
  mode,
  selected,
  onPick,
  onHoverPreview,
}: BoardProps) {
  const playersById = useMemo(() => {
    const m = new Map<PlayerId, PublicPlayerView>();
    for (const p of view.players) m.set(p.id, p);
    return m;
  }, [view.players]);

  const [k, setK] = useState(1);
  const [pan, setPan] = useState({ x: VIEW_W / 2, y: VIEW_H / 2 });
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<BoardPick | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Ajusta enquadramento inicial quando o tabuleiro aparece.
  useEffect(() => {
    setPan({ x: VIEW_W / 2, y: VIEW_H / 2 });
    setK(1.45);
  }, [view.board.seed]);

  const transform = `translate(${pan.x - geo.center.x * k} ${pan.y - geo.center.y * k}) scale(${k})`;

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      setK((prev) => {
        const nk = Math.min(2.6, Math.max(0.45, prev * factor));
        const mx = (sx - (pan.x - geo.center.x * prev)) / prev;
        const my = (sy - (pan.y - geo.center.y * prev)) / prev;
        setPan({ x: sx - mx * nk + geo.center.x * nk, y: sy - my * nk + geo.center.y * nk });
        return nk;
      });
    },
    [pan.x, pan.y, geo.center.x, geo.center.y],
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    zoomAt(e.deltaY < 0 ? 1.12 : 0.89, sx, sy);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = VIEW_W / rect.width;
    setPan({ x: d.panX + (e.clientX - d.x) * scale, y: d.panY + (e.clientY - d.y) * scale });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const legalVertexSet = useMemo(() => new Set(mode.kind === 'vertex' ? mode.vertices : []), [mode]);
  const legalEdgeSet = useMemo(() => new Set(mode.kind === 'edge' ? mode.edges : []), [mode]);
  const legalHexSet = useMemo(() => new Set(mode.kind === 'robber' ? mode.hexes : []), [mode]);

  const isLegalVertex = (v: VertexId) =>
    legalVertexSet.has(v) || legal.setupVertices.includes(v) || legal.settlementVertices.includes(v) || legal.cityVertices.includes(v);
  const isLegalEdge = (e: EdgeId) =>
    legalEdgeSet.has(e) || legal.setupEdges.includes(e) || legal.roadEdges.includes(e) || legal.freeRoadEdges.includes(e);
  const isLegalHex = (h: HexId) => legalHexSet.has(h);

  // Quando o modo não é explícito (ex.: hand parada), usa lists do legal direto.
  const activeVertexTargets = mode.kind === 'vertex' ? mode.vertices : legal.setupVertices.length ? legal.setupVertices : [];
  const activeEdgeTargets = mode.kind === 'edge' ? mode.edges : legal.setupEdges.length ? legal.setupEdges : [];

  const vertexTargets = useMemo(() => {
    const s = new Set<VertexId>([
      ...legalVertexSet,
      ...legal.setupVertices,
      ...legal.settlementVertices,
      ...legal.cityVertices,
      ...activeVertexTargets,
    ]);
    return [...s];
  }, [mode, legal]);

  const edgeTargets = useMemo(() => {
    const s = new Set<EdgeId>([
      ...legalEdgeSet,
      ...legal.setupEdges,
      ...legal.roadEdges,
      ...legal.freeRoadEdges,
      ...activeEdgeTargets,
    ]);
    return [...s];
  }, [mode, legal]);

  const handleVertex = (v: VertexId) => {
    if (!isLegalVertex(v)) return;
    onPick({ type: 'vertex', id: v });
  };
  const handleEdge = (e: EdgeId) => {
    if (!isLegalEdge(e)) return;
    onPick({ type: 'edge', id: e });
  };
  const handleHex = (h: HexId) => {
    if (!isLegalHex(h)) return;
    onPick({ type: 'hex', id: h });
  };

  const setHoverPick = (p: BoardPick | null) => {
    setHover(p);
    onHoverPreview?.(p);
  };

  const myPorts = useMemo(() => new Set(view.you.ports.map((p) => p.id)), [view.you.ports]);
  const youColor = view.you.color;

  // Comprimento das arestas para estradas.
  const firstEdge = geo.edges.values().next().value;
  const roadLen = firstEdge ? Math.hypot(firstEdge.x2 - firstEdge.x1, firstEdge.y2 - firstEdge.y1) - 8 : 70;

  const hoverGhost = (() => {
    if (!hover || hover.id === selected?.id) return null;
    const color = youColor;
    if (hover.type === 'vertex') {
      const p = geo.vertices.get(hover.id);
      if (!p) return null;
      const hasCity = legal.cityVertices.includes(hover.id);
      return (
        <g transform={`translate(${p.x} ${p.y})`} opacity={0.55} pointerEvents="none">
          {hasCity ? <CityShape color={color} /> : <SettlementShape color={color} />}
        </g>
      );
    }
    if (hover.type === 'edge') {
      const e = geo.edges.get(hover.id);
      if (!e) return null;
      return (
        <g transform={`translate(${e.mx} ${e.my}) rotate(${e.angleDeg})`} opacity={0.55} pointerEvents="none">
          <rect x={-roadLen / 2} y={-5.5} width={roadLen} height={11} rx={4} fill={PLAYER_FILL[color]} stroke="#2a1c10" strokeWidth={1.2} />
        </g>
      );
    }
    return null;
  })();

  return (
    <div
      ref={stageRef}
      className={`board-stage${dragging ? ' dragging' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div className="board-toolbar">
        <button type="button" aria-label="Aproximar" onClick={() => zoomAt(1.2, VIEW_W / 2, VIEW_H / 2)}>+</button>
        <button type="button" aria-label="Afastar" onClick={() => zoomAt(0.82, VIEW_W / 2, VIEW_H / 2)}>−</button>
        <button
          type="button"
          aria-label="Centralizar tabuleiro"
          onClick={() => {
            setPan({ x: VIEW_W / 2, y: VIEW_H / 2 });
            setK(1.45);
          }}
        >
          ⌖
        </button>
      </div>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="Tabuleiro de Catan">
        <defs>
          <linearGradient id="sea-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3d7ea6" />
            <stop offset="1" stopColor="#234d68" />
          </linearGradient>
          <pattern id="waves" width="60" height="28" patternUnits="userSpaceOnUse">
            <path d="M0 14 Q 15 4 30 14 T 60 14" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2.5" />
            <path d="M-30 22 Q -15 12 0 22 T 30 22 T 60 22" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
          </pattern>

          <pattern id="tex-forest" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M4 12 L8 3 L12 12 Z" fill="rgba(15,52,26,0.55)" />
            <path d="M12 16 L14 11 L16 16 Z" fill="rgba(15,52,26,0.4)" />
          </pattern>
          <pattern id="tex-pasture" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="2.2" fill="rgba(255,255,255,0.35)" />
            <circle cx="10" cy="10" r="2.6" fill="rgba(111,155,67,0.4)" />
          </pattern>
          <pattern id="tex-fields" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M3 11 L3 3 M3 3 Q5 4 6 2 M3 6 Q5 7 6 5" stroke="rgba(133,95,20,0.55)" strokeWidth="1.3" fill="none" />
            <path d="M9 12 L9 5 M9 5 Q11 6 12 4" stroke="rgba(133,95,20,0.4)" strokeWidth="1.1" fill="none" />
          </pattern>
          <pattern id="tex-hills" width="18" height="12" patternUnits="userSpaceOnUse">
            <path d="M1 10 Q 5 3 9 10" fill="none" stroke="rgba(90,40,16,0.45)" strokeWidth="2" />
            <path d="M10 10 Q 13 5 16 10" fill="none" stroke="rgba(90,40,16,0.3)" strokeWidth="1.6" />
          </pattern>
          <pattern id="tex-mountains" width="20" height="14" patternUnits="userSpaceOnUse">
            <path d="M1 12 L6 3 L11 12 Z" fill="rgba(52,54,60,0.5)" />
            <path d="M10 13 L15 6 L19 13 Z" fill="rgba(52,54,60,0.35)" />
          </pattern>
          <pattern id="tex-desert" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="5" r="1" fill="rgba(150,118,60,0.4)" />
            <circle cx="11" cy="11" r="1.2" fill="rgba(150,118,60,0.35)" />
            <path d="M0 14 Q 8 10 16 14" fill="none" stroke="rgba(150,118,60,0.25)" strokeWidth="1.4" />
          </pattern>

          <filter id="piece-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" floodColor="#1a0f06" floodOpacity="0.55" />
          </filter>
          <filter id="robber-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity="0.6" />
          </filter>
        </defs>

        {/* mar */}
        <rect width={VIEW_W} height={VIEW_H} fill="url(#sea-grad)" />
        <rect width={VIEW_W} height={VIEW_H} fill="url(#waves)" />

        <g transform={transform}>
          {/* hexes */}
          {geo.hexes.map((h) => {
            const st = TERRAIN_STYLE[h.tile.terrain] ?? TERRAIN_STYLE.desert;
            const legalHex = isLegalHex(h.id);
            const isRobber = view.board.robberHexId === h.id;
            return (
              <g key={h.id} className={`board-hex${legalHex ? ' robber-target' : ''}`}>
                <polygon
                  points={hexPathPoints(h.x, h.y)}
                  fill={st.fill}
                  stroke={st.ink}
                  strokeWidth={3}
                  strokeLinejoin="round"
                />
                <polygon points={hexPathPoints(h.x, h.y)} fill={`url(#tex-${h.tile.terrain})`} stroke="none" pointerEvents="none" />
                {legalHex && (
                  <polygon
                    points={hexPathPoints(h.x, h.y)}
                    fill="rgba(230,183,74,0.16)"
                    stroke="#e6b74a"
                    strokeWidth={3.5}
                    className="legal-glow"
                    pointerEvents="none"
                  />
                )}
                <polygon
                  points={hexPathPoints(h.x, h.y)}
                  fill="transparent"
                  className="board-hex"
                  style={{ cursor: legalHex ? 'pointer' : 'default' }}
                  onPointerEnter={() => (legalHex ? setHoverPick({ type: 'hex', id: h.id }) : null)}
                  onPointerLeave={() => setHoverPick(null)}
                  onClick={() => handleHex(h.id)}
                />
                {h.tile.number != null && <Token x={h.x} y={h.y - 6} number={h.tile.number} />}
                {isRobber && (
                  <g key={`robber-${view.board.robberHexId}`} className="robber-piece" transform={`translate(${h.x} ${h.y + 22})`} pointerEvents="none" filter="url(#robber-shadow)">
                    <ellipse cx={0} cy={10} rx={12} ry={4.5} fill="rgba(0,0,0,0.35)" />
                    <path d="M-10 8 Q -12 -8 0 -12 Q 12 -8 10 8 Z" fill="#241a12" stroke="#0d0906" strokeWidth={1.5} />
                    <circle cx={-3.5} cy={-2} r={1.8} fill="#c0392b" opacity={0.85} />
                    <circle cx={3.5} cy={-2} r={1.8} fill="#c0392b" opacity={0.85} />
                  </g>
                )}
              </g>
            );
          })}

          {/* portos */}
          {view.board.ports.map((port) => {
            const mid = (() => {
              const e = geo.edges.get(port.edgeId);
              if (e) return { x: e.mx, y: e.my };
              const [a, b] = parseEdgeId(port.edgeId);
              const va = geo.vertices.get(a);
              const vb = geo.vertices.get(b);
              if (!va || !vb) return null;
              return { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 };
            })();
            if (!mid) return null;
            const dx = mid.x - geo.center.x;
            const dy = mid.y - geo.center.y;
            const len = Math.hypot(dx, dy) || 1;
            const px = mid.x + (dx / len) * 42;
            const py = mid.y + (dy / len) * 42;
            const mine = myPorts.has(port.id);
            const label = port.kind === 'generic' ? '3:1' : '2:1';
            const tint = port.kind === 'generic' ? '#8a6d3b' : RESOURCE_TINT[port.kind] ?? '#8a6d3b';
            const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <g key={port.id} pointerEvents="none">
                <line x1={mid.x} y1={mid.y} x2={px} y2={py} stroke="#5d432c" strokeWidth={3} strokeDasharray="5 4" />
                <g transform={`translate(${px} ${py}) rotate(${ang + 90})`}>
                  {mine && <circle cx={0} cy={0} r={24} fill="none" stroke="#e6b74a" strokeWidth={3} className="port-mine" />}
                  <rect x={-21} y={-14} width={42} height={26} rx={7} fill="#f3e6c8" stroke="#8a6d3b" strokeWidth={1.6} transform={`rotate(${-(ang + 90)})`} />
                  <g transform={`rotate(${-(ang + 90)})`}>
                    <circle cx={-12} cy={-1} r={5.5} fill={tint} stroke="#5a4630" strokeWidth={1} />
                    <text x={6} y={4} textAnchor="middle" fontSize={12} fontWeight={800} fontFamily="Georgia, serif" fill="#2a1c10">
                      {label}
                    </text>
                  </g>
                </g>
                {mine &&
                  port.vertexIds.map((vid) => {
                    const v = geo.vertices.get(vid);
                    if (!v) return null;
                    return <circle key={vid} cx={v.x} cy={v.y} r={15} fill="none" stroke="#e6b74a" strokeWidth={2.5} className="port-mine" />;
                  })}
              </g>
            );
          })}

          {/* estradas (legal highlight abaixo das peças) */}
          {edgeTargets.map((eid) => {
            const e = geo.edges.get(eid);
            if (!e) return null;
            return (
              <g key={`hl-${eid}`} pointerEvents="none">
                <line
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke="#8a6d3b"
                  strokeWidth={16}
                  strokeLinecap="round"
                  opacity={0.5}
                  className="legal-glow"
                />
                <line
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke="#ffe9a8"
                  strokeWidth={11}
                  strokeLinecap="round"
                  strokeDasharray="7 6"
                  className="legal-glow"
                />
              </g>
            );
          })}

          {/* estradas construídas */}
          {view.board.roads.map((r) => {
            const e = geo.edges.get(r.edgeId);
            const p = playersById.get(r.playerId);
            if (!e || !p) return null;
            return (
              <g key={r.edgeId} transform={`translate(${e.mx} ${e.my}) rotate(${e.angleDeg})`} className="piece-appear" filter="url(#piece-shadow)" pointerEvents="none">
                <rect x={-roadLen / 2} y={-5.5} width={roadLen} height={11} rx={4} fill={PLAYER_FILL[p.color]} stroke="#2a1c10" strokeWidth={1.4} />
                <rect x={-roadLen / 2 + 2} y={-3.5} width={roadLen - 4} height={3} rx={1.5} fill="rgba(255,255,255,0.22)" />
              </g>
            );
          })}

          {/* vértices legais */}
          {vertexTargets.map((vid) => {
            const v = geo.vertices.get(vid);
            if (!v) return null;
            return (
              <g key={`hl-${vid}`} pointerEvents="none">
                <circle cx={v.x} cy={v.y} r={13} fill="rgba(230,183,74,0.35)" stroke="#8a6d3b" strokeWidth={2} className="legal-glow" />
                <circle cx={v.x} cy={v.y} r={9.5} fill="none" stroke="#ffe9a8" strokeWidth={3} strokeDasharray="4 4" className="legal-glow" />
              </g>
            );
          })}

          {/* construções */}
          {view.board.buildings.map((b) => {
            const v = geo.vertices.get(b.vertexId);
            const p = playersById.get(b.playerId);
            if (!v || !p) return null;
            return (
              <g key={`${b.vertexId}`} transform={`translate(${v.x} ${v.y})`} className="piece-appear" filter="url(#piece-shadow)" pointerEvents="none">
                {b.kind === 'city' ? <CityShape color={p.color} /> : <SettlementShape color={p.color} />}
              </g>
            );
          })}

          {/* preview fantasma */}
          {hoverGhost}
          {selected && selected.type === 'vertex' &&
            (() => {
              const v = geo.vertices.get(selected.id);
              if (!v) return null;
              const isCity = legal.cityVertices.includes(selected.id);
              return (
                <g transform={`translate(${v.x} ${v.y})`} pointerEvents="none">
                  {isCity ? <CityShape color={youColor} /> : <SettlementShape color={youColor} />}
                  <circle cx={0} cy={0} r={18} fill="none" stroke="#e6b74a" strokeWidth={3} />
                </g>
              );
            })()}
          {selected && selected.type === 'edge' &&
            (() => {
              const e = geo.edges.get(selected.id);
              if (!e) return null;
              return (
                <g transform={`translate(${e.mx} ${e.my}) rotate(${e.angleDeg})`} pointerEvents="none">
                  <rect x={-roadLen / 2} y={-5.5} width={roadLen} height={11} rx={4} fill={PLAYER_FILL[youColor]} stroke="#2a1c10" strokeWidth={1.2} />
                  <rect x={-roadLen / 2 - 4} y={-9.5} width={roadLen + 8} height={19} rx={8} fill="none" stroke="#e6b74a" strokeWidth={2.5} />
                </g>
              );
            })()}

          {/* hit areas: vértices (≥24px) */}
          {mode.kind !== 'robber' &&
            vertexTargets.map((vid) => {
              const v = geo.vertices.get(vid);
              if (!v) return null;
              return (
                <circle
                  key={`hv-${vid}`}
                  cx={v.x}
                  cy={v.y}
                  r={12}
                  fill="transparent"
                  className="hit-vertex"
                  style={{ cursor: 'pointer' }}
                  onPointerEnter={() => setHoverPick({ type: 'vertex', id: vid })}
                  onPointerLeave={() => setHoverPick(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    handleVertex(vid);
                  }}
                />
              );
            })}

          {/* hit areas: arestas (≥24px) */}
          {mode.kind !== 'robber' &&
            edgeTargets.map((eid) => {
              const e = geo.edges.get(eid);
              if (!e) return null;
              return (
                <line
                  key={`he-${eid}`}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke="transparent"
                  strokeWidth={26}
                  strokeLinecap="round"
                  className="hit-edge"
                  style={{ cursor: 'pointer' }}
                  onPointerEnter={() => setHoverPick({ type: 'edge', id: eid })}
                  onPointerLeave={() => setHoverPick(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    handleEdge(eid);
                  }}
                />
              );
            })}
        </g>
      </svg>
    </div>
  );
}

export { TERRAIN_STYLE, PLAYER_FILL };
export type { GeoHex };
