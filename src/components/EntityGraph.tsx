import React, { useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, X } from "lucide-react";
import { Entity, Relationship } from "../types";

interface EntityGraphProps {
  entities: Entity[];
  relationships: Relationship[];
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
  entity: Entity;
  x: number;
  y: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  relationship: Relationship;
}

const TYPE_COLORS: Record<string, { fill: string; stroke: string; badge: string }> = {
  domain: { fill: "#1d4ed8", stroke: "#3b82f6", badge: "bg-blue-950 border-blue-800 text-blue-300" },
  person: { fill: "#7e22ce", stroke: "#a855f7", badge: "bg-purple-950 border-purple-800 text-purple-300" },
  organization: { fill: "#b45309", stroke: "#f59e0b", badge: "bg-amber-950 border-amber-800 text-amber-300" },
  ipaddress: { fill: "#0f766e", stroke: "#14b8a6", badge: "bg-teal-950 border-teal-800 text-teal-300" },
  repository: { fill: "#be123c", stroke: "#f43f5e", badge: "bg-rose-950 border-rose-800 text-rose-300" },
  default: { fill: "#3f3f46", stroke: "#71717a", badge: "bg-neutral-900 border-neutral-700 text-neutral-300" },
};

function getTypeColor(type: string) {
  const key = (type || "").toLowerCase().replace(/\s+/g, "");
  return TYPE_COLORS[key] || TYPE_COLORS.default;
}

const WIDTH = 900;
const HEIGHT = 560;

function computeLayout(entities: Entity[], relationships: Relationship[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (entities.length === 0) {
    return { nodes: [], edges: [] };
  }

  const byName = new Map<string, Entity>();
  const byId = new Map<string, Entity>();
  entities.forEach(e => {
    byName.set(e.name, e);
    byId.set(e.id, e);
  });

  const resolveEntity = (ref: string): Entity | undefined => byName.get(ref) || byId.get(ref);

  const validEdges: { sourceId: string; targetId: string; relationship: Relationship }[] = [];
  relationships.forEach(rel => {
    const sourceEntity = resolveEntity(rel.source);
    const targetEntity = resolveEntity(rel.target);
    if (sourceEntity && targetEntity && sourceEntity.id !== targetEntity.id) {
      validEdges.push({ sourceId: sourceEntity.id, targetId: targetEntity.id, relationship: rel });
    }
  });

  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const radius = Math.min(WIDTH, HEIGHT) / 2.6;
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  entities.forEach((e, i) => {
    const angle = (2 * Math.PI * i) / entities.length;
    positions.set(e.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
    });
  });

  const idealEdgeLength = 150;
  const repulsionStrength = 4200;
  const springStrength = 0.02;
  const centeringStrength = 0.006;
  const damping = 0.85;
  const iterations = entities.length > 40 ? 120 : 220;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < entities.length; i++) {
      const a = positions.get(entities[i].id)!;
      for (let j = i + 1; j < entities.length; j++) {
        const b = positions.get(entities[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(distSq);
        const force = repulsionStrength / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    validEdges.forEach(edge => {
      const a = positions.get(edge.sourceId)!;
      const b = positions.get(edge.targetId)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const displacement = dist - idealEdgeLength;
      const force = displacement * springStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    positions.forEach(p => {
      p.vx += (centerX - p.x) * centeringStrength;
      p.vy += (centerY - p.y) * centeringStrength;
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx;
      p.y += p.vy;
    });
  }

  const padding = 60;
  positions.forEach(p => {
    p.x = Math.min(WIDTH - padding, Math.max(padding, p.x));
    p.y = Math.min(HEIGHT - padding, Math.max(padding, p.y));
  });

  const nodes: GraphNode[] = entities.map(e => {
    const pos = positions.get(e.id)!;
    return { id: e.id, name: e.name, type: e.type, entity: e, x: pos.x, y: pos.y };
  });

  const edges: GraphEdge[] = validEdges.map(e => ({
    source: e.sourceId,
    target: e.targetId,
    type: e.relationship.type,
    relationship: e.relationship,
  }));

  return { nodes, edges };
}

export default function EntityGraph({ entities, relationships }: EntityGraphProps) {
  const { nodes, edges } = useMemo(
    () => computeLayout(entities || [], relationships || []),
    [entities, relationships]
  );
  const nodesById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) || null : null;

  const clampScale = (s: number) => Math.min(3, Math.max(0.3, s));
  const handleZoomIn = () => setScale(s => clampScale(s + 0.2));
  const handleZoomOut = () => setScale(s => clampScale(s - 0.2));
  const handleReset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setScale(s => clampScale(s - e.deltaY * 0.001));
  };
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setTranslate(t => ({ x: t.x + dx, y: t.y + dy }));
  };
  const handlePointerUp = () => {
    isDragging.current = false;
  };

  if (nodes.length === 0) {
    return (
      <div className="bg-neutral-900/70 border border-neutral-800 rounded-lg p-10 text-center">
        <p className="text-xs text-neutral-500 font-mono italic">No entities available to graph yet.</p>
      </div>
    );
  }

  return (
    <div className="relative bg-neutral-950 border border-neutral-800 rounded-lg overflow-hidden">
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        <button type="button" onClick={handleZoomIn} aria-label="Zoom in"
          className="w-8 h-8 flex items-center justify-center bg-neutral-900 border border-neutral-700 rounded text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none transition-colors">
          <ZoomIn size={14} />
        </button>
        <button type="button" onClick={handleZoomOut} aria-label="Zoom out"
          className="w-8 h-8 flex items-center justify-center bg-neutral-900 border border-neutral-700 rounded text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none transition-colors">
          <ZoomOut size={14} />
        </button>
        <button type="button" onClick={handleReset} aria-label="Reset zoom and pan"
          className="w-8 h-8 flex items-center justify-center bg-neutral-900 border border-neutral-700 rounded text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none transition-colors">
          <Maximize2 size={14} />
        </button>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-[420px] sm:h-[520px] cursor-grab active:cursor-grabbing touch-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        role="img"
        aria-label={`Entity relationship graph with ${nodes.length} entities and ${edges.length} connections`}
      >
        <g transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}>
          {edges.map((edge, i) => {
            const source = nodesById.get(edge.source);
            const target = nodesById.get(edge.target);
            if (!source || !target) return null;
            return (
              <g key={i}>
                <line x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                  stroke="#52525b" strokeWidth={1.5} opacity={0.6} />
                <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 4}
                  fill="#a1a1aa" fontSize={8} fontFamily="monospace" textAnchor="middle" opacity={0.85}>
                  {edge.type}
                </text>
              </g>
            );
          })}

          {nodes.map(node => {
            const color = getTypeColor(node.type);
            const isSelected = node.id === selectedNodeId;
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}
                onClick={() => setSelectedNodeId(node.id)}
                style={{ cursor: "pointer" }}
                role="button" tabIndex={0}
                aria-label={`View details for ${node.name}, type ${node.type}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedNodeId(node.id);
                  }
                }}
              >
                <circle r={isSelected ? 14 : 11} fill={color.fill}
                  stroke={isSelected ? "#ffffff" : color.stroke} strokeWidth={isSelected ? 2 : 1.5} />
                <text y={24} textAnchor="middle" fill="#e4e4e7" fontSize={9} fontFamily="monospace">
                  {node.name.length > 16 ? `${node.name.slice(0, 14)}…` : node.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {selectedNode && (
        <div className="absolute top-0 right-0 h-full w-full sm:w-72 bg-neutral-900 border-l border-neutral-800 p-4 overflow-y-auto">
          <div className="flex items-start justify-between mb-3">
            <span className={`text-[8px] font-mono uppercase font-bold px-1.5 py-0.5 border rounded ${getTypeColor(selectedNode.type).badge}`}>
              {selectedNode.type}
            </span>
            <button type="button" onClick={() => setSelectedNodeId(null)} aria-label="Close entity details"
              className="text-neutral-500 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none rounded">
              <X size={16} />
            </button>
          </div>
          <h4 className="text-sm font-mono font-bold text-white break-words mb-2">{selectedNode.name}</h4>
          {selectedNode.entity.metadata && Object.keys(selectedNode.entity.metadata).length > 0 && (
            <div className="mt-3 pt-3 border-t border-neutral-800 space-y-1.5">
              {Object.entries(selectedNode.entity.metadata).slice(0, 12).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2 text-[10px] font-mono">
                  <span className="text-neutral-500 uppercase">{key}</span>
                  <span className="text-neutral-300 text-right break-all">{String(value)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-neutral-800 text-[10px] font-mono text-neutral-500">
            {selectedNode.entity.evidenceIds?.length || 0} linked evidence item(s)
          </div>
        </div>
      )}
    </div>
  );
}
