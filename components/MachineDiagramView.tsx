// ============================================================
// AMA — ISA-88 Hierarchy Diagram
// Pan / zoom / fit canvas (same interaction model as the
// network topology): wheel = zoom at cursor, drag = pan,
// toolbar = zoom in/out, fit-to-view, 100%.
// ============================================================
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { AssemblyNode, EntityLevel, BlockBase } from '../types/machine';
import type { EntityDB } from '../lib/helpers';
import { Box, Cpu, Settings, BookOpen, ZoomIn, ZoomOut, Maximize2, GitBranch } from 'lucide-react';

interface MachineDiagramViewProps {
    tree: AssemblyNode[];
    db: EntityDB;
    onSelectNode?: (asmNodeId: string) => void;
}

const NODE_W = 210;
const NODE_H = 54;
const COL_GAP = 110;
const ROW_GAP = 16;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

const levelColor = (level: EntityLevel) =>
    level === 'UN' ? 'var(--un-color)'
        : level === 'EM' ? 'var(--em-color)'
            : level === 'CM' ? 'var(--cm-color)' : 'var(--fb-color)';

const LevelIcon = ({ level, size = 14 }: { level: EntityLevel; size?: number }) => {
    if (level === 'UN') return <Box size={size} />;
    if (level === 'EM') return <Cpu size={size} />;
    if (level === 'CM') return <Settings size={size} />;
    return <BookOpen size={size} />;
};

interface DiagNode {
    id: string; refId: string; level: EntityLevel;
    name: string; version: string; missing: boolean;
    x: number; y: number;
}
interface DiagEdge { x1: number; y1: number; x2: number; y2: number; color: string }

export const MachineDiagramView: React.FC<MachineDiagramViewProps> = ({ tree, db, onSelectNode }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pan, setPan] = useState({ x: 40, y: 40 });
    const [zoom, setZoom] = useState(1);
    const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

    const findEntity = useCallback((id: string): BlockBase | null => {
        return db.library.find(e => e.id === id) ||
            db.units.find(e => e.id === id) ||
            db.equipmentModules.find(e => e.id === id) ||
            db.controlModules.find(e => e.id === id) || null;
    }, [db]);

    // ─── Tidy left-to-right tree layout ─────────────────────
    const { nodes, edges, bbox } = useMemo(() => {
        const nodes: DiagNode[] = [];
        const edges: DiagEdge[] = [];
        let row = 0;

        const layout = (n: AssemblyNode, depth: number): DiagNode => {
            const children = n.children.map(c => layout(c, depth + 1));
            const entity = findEntity(n.refId);
            const y = children.length > 0
                ? (children[0].y + children[children.length - 1].y) / 2
                : (row++) * (NODE_H + ROW_GAP);
            const node: DiagNode = {
                id: n.id, refId: n.refId, level: n.level,
                name: entity?.name || '(missing reference)',
                version: entity?.currentVersion || '',
                missing: !entity,
                x: depth * (NODE_W + COL_GAP),
                y,
            };
            nodes.push(node);
            for (const c of children) {
                edges.push({
                    x1: node.x + NODE_W, y1: node.y + NODE_H / 2,
                    x2: c.x, y2: c.y + NODE_H / 2,
                    color: levelColor(c.level),
                });
            }
            return node;
        };

        for (const root of tree) {
            layout(root, 0);
            row++; // breathing room between machine roots
        }

        const bbox = nodes.length === 0
            ? { w: 0, h: 0 }
            : {
                w: Math.max(...nodes.map(n => n.x)) + NODE_W,
                h: Math.max(...nodes.map(n => n.y)) + NODE_H,
            };
        return { nodes, edges, bbox };
    }, [tree, findEntity]);

    // ─── View controls ──────────────────────────────────────
    const fitView = useCallback(() => {
        const el = containerRef.current;
        if (!el || bbox.w === 0) return;
        const { width, height } = el.getBoundingClientRect();
        const pad = 50;
        const scale = Math.min((width - pad * 2) / bbox.w, (height - pad * 2) / bbox.h, 1.4);
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
        setZoom(z);
        setPan({
            x: (width - bbox.w * z) / 2,
            y: (height - bbox.h * z) / 2,
        });
    }, [bbox.w, bbox.h]);

    useEffect(() => { fitView(); }, [fitView]);

    const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
        setZoom(prev => {
            const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor));
            const k = next / prev;
            setPan(p => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
            return next;
        });
    }, []);

    const onWheel = (e: React.WheelEvent) => {
        const rect = containerRef.current!.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };

    const zoomCenter = (factor: number) => {
        const el = containerRef.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        zoomAt(width / 2, height / 2, factor);
    };

    const onMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.diag-node, .diagram-toolbar')) return;
        dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    };
    const onMouseMove = (e: React.MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
    };
    const endDrag = () => { dragRef.current = null; };

    if (tree.length === 0) {
        return (
            <div className="diagram-canvas" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="empty-state-sm" style={{ maxWidth: 360 }}>
                    <GitBranch size={28} />
                    <p>No assembled entity. Drag Units from the library to build the machine's ISA-88 hierarchy diagram.</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="diagram-canvas"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        >
            {/* Toolbar — identical interaction to the network topology */}
            <div className="diagram-toolbar">
                <button className="btn-icon" title="Zoom in" onClick={() => zoomCenter(1.25)}><ZoomIn size={15} /></button>
                <button className="btn-icon" title="Zoom indietro" onClick={() => zoomCenter(1 / 1.25)}><ZoomOut size={15} /></button>
                <button className="btn-icon" title="Adatta e centra" onClick={fitView}><Maximize2 size={15} /></button>
                <span className="diagram-zoom-label">{Math.round(zoom * 100)}%</span>
            </div>

            {/* Legend */}
            <div className="diagram-legend">
                {(['UN', 'EM', 'CM', 'FB'] as EntityLevel[]).map(l => (
                    <span key={l} className="diagram-legend-item">
                        <span className="diagram-legend-dot" style={{ background: levelColor(l) }} />
                        {l === 'UN' ? 'Units' : l === 'EM' ? 'Equip. Module' : l === 'CM' ? 'Control Module' : 'Function Block'}
                    </span>
                ))}
            </div>

            <svg width="100%" height="100%" style={{ display: 'block' }}>
                <defs>
                    <pattern id="diag-grid" width={24 * zoom} height={24 * zoom} patternUnits="userSpaceOnUse"
                        patternTransform={`translate(${pan.x % (24 * zoom)}, ${pan.y % (24 * zoom)})`}>
                        <circle cx="1" cy="1" r="1" fill="rgba(148, 163, 184, 0.13)" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#diag-grid)" />
                <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    {edges.map((e, i) => {
                        const mx = (e.x1 + e.x2) / 2;
                        return (
                            <path
                                key={i}
                                d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
                                fill="none"
                                stroke={e.color}
                                strokeWidth={1.5}
                                strokeOpacity={0.55}
                            />
                        );
                    })}
                    {nodes.map(n => (
                        <foreignObject key={n.id} x={n.x} y={n.y} width={NODE_W} height={NODE_H}>
                            <div
                                className={`diag-node ${n.missing ? 'diag-node-missing' : ''}`}
                                style={{ borderLeftColor: levelColor(n.level) }}
                                onClick={() => onSelectNode?.(n.id)}
                                title={`${n.name}${n.version ? ` · v${n.version}` : ''}`}
                            >
                                <span className="diag-node-icon" style={{ color: levelColor(n.level) }}>
                                    <LevelIcon level={n.level} />
                                </span>
                                <span className="diag-node-body">
                                    <span className="diag-node-name">{n.name}</span>
                                    <span className="diag-node-meta">{n.level}{n.version ? ` · v${n.version}` : ''}</span>
                                </span>
                            </div>
                        </foreignObject>
                    ))}
                </g>
            </svg>
        </div>
    );
};
