// ============================================================
// AMA — Command Palette (Ctrl+K)
// Actions + global search in one surface: type to filter
// commands (salva, esporta, verifica…) and project data
// (entità, variabili, allarmi, I/O, DFMEA) together.
// ============================================================
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore } from '../lib/store';
import {
    Search, X, Hash, AlertTriangle, Radio, Settings, Box,
    Terminal, Save, FolderOpen, FilePlus, CheckSquare, RefreshCw,
    Cpu, FolderGit2, Package, Users, PanelLeftClose, Network, GitBranch, LayoutDashboard, Download
} from 'lucide-react';
import type { FunctionBlock, BlockBase, Unit, EquipmentModule, ControlModule } from '../types/machine';
import { useNavigate } from 'react-router-dom';

// ─── Commands ───────────────────────────────────────
interface Command { id: string; label: string; kbd?: string; icon: React.ReactNode; action: string }

const COMMANDS: Command[] = [
    { id: 'nav-arch', label: 'Go to: Architecture', kbd: 'Ctrl+1', icon: <Network size={14} />, action: 'nav:/' },
    { id: 'nav-asm', label: 'Go to: Assembly', kbd: 'Ctrl+2', icon: <GitBranch size={14} />, action: 'nav:/assembly' },
    { id: 'nav-dash', label: 'Go to: Dashboard', kbd: 'Ctrl+3', icon: <LayoutDashboard size={14} />, action: 'nav:/dashboard' },
    { id: 'nav-exp', label: 'Go to: Export & Import', kbd: 'Ctrl+4', icon: <Download size={14} />, action: 'nav:/export' },
    { id: 'nav-git', label: 'Go to: Version Control (Git)', kbd: 'Ctrl+5', icon: <FolderGit2 size={14} />, action: 'nav:/git' },
    { id: 'save', label: 'Save project', kbd: 'Ctrl+S', icon: <Save size={14} />, action: 'file:save' },
    { id: 'saveas', label: 'Save project as…', kbd: 'Ctrl+Shift+S', icon: <Save size={14} />, action: 'file:saveAs' },
    { id: 'open', label: 'Open / import project…', icon: <FolderOpen size={14} />, action: 'file:open' },
    { id: 'new', label: 'New project', icon: <FilePlus size={14} />, action: 'file:new' },
    { id: 'verify', label: 'Verify project', icon: <CheckSquare size={14} />, action: 'tools:verify' },
    { id: 'compare', label: 'Compare with library / another project…', icon: <RefreshCw size={14} />, action: 'tools:compare' },
    { id: 'exp-l5x', label: 'Export: Studio 5000 L5X', icon: <Cpu size={14} />, action: 'export:l5x' },
    { id: 'exp-git', label: 'Export: ZIP for Git', icon: <FolderGit2 size={14} />, action: 'export:gitzip' },
    { id: 'exp-bom', label: 'Export: Purchasing BOM (CSV)', icon: <Package size={14} />, action: 'export:bom' },
    { id: 'users', label: 'User management…', icon: <Users size={14} />, action: 'settings:users' },
    { id: 'sidebar', label: 'Collapse / expand sidebar', kbd: 'Ctrl+B', icon: <PanelLeftClose size={14} />, action: 'view:sidebar' },
];

// ─── Search result item ─────────────────────────────
interface SearchResult {
    id: string;
    name: string;
    category: 'Entity' | 'Variable' | 'Alarm' | 'I/O' | 'DFMEA';
    entityLevel: string;  // UN, EM, CM, FB
    path: string;
    nodeId: string;
    tabToOpen?: string;
}

function collectSearchResults(
    units: Unit[],
    ems: EquipmentModule[],
    cms: ControlModule[],
    library: FunctionBlock[],
): SearchResult[] {
    const results: SearchResult[] = [];

    const addBlockResults = (block: BlockBase, path: string) => {
        results.push({ id: `entity-${block.id}`, name: block.name, category: 'Entity', entityLevel: block.level, path, nodeId: block.id, tabToOpen: 'info' });
        block.variables.forEach(v => results.push({ id: `var-${block.id}-${v.id}`, name: v.name, category: 'Variable', entityLevel: block.level, path: `${path} → ${v.name}`, nodeId: block.id, tabToOpen: 'variables' }));
        block.alarms.forEach(a => results.push({ id: `alarm-${block.id}-${a.id}`, name: `${a.alarmId}: ${a.message}`, category: 'Alarm', entityLevel: block.level, path: `${path} → ${a.alarmId}`, nodeId: block.id, tabToOpen: 'alarms' }));
        block.io.forEach(io => results.push({ id: `io-${block.id}-${io.id}`, name: `${io.signalId}: ${io.variable}`, category: 'I/O', entityLevel: block.level, path: `${path} → ${io.signalId}`, nodeId: block.id, tabToOpen: 'io' }));
        block.dfmea.forEach(d => results.push({ id: `dfmea-${block.id}-${d.id}`, name: d.failureMode, category: 'DFMEA', entityLevel: block.level, path: `${path} → DFMEA`, nodeId: block.id, tabToOpen: 'dfmea' }));
    };

    library.forEach(fb => addBlockResults(fb, `Library → ${fb.name}`));
    units.forEach(un => addBlockResults(un, `Architecture → ${un.name}`));
    ems.forEach(em => addBlockResults(em, `Architecture → ${em.name}`));
    cms.forEach(cm => addBlockResults(cm, `Architecture → ${cm.name}`));

    return results;
}

// ─── The Overlay ────────────────────────────────────
interface SearchOverlayProps { open: boolean; onClose: () => void; }

export const SearchOverlay: React.FC<SearchOverlayProps> = ({ open, onClose }) => {
    const [query, setQuery] = useState('');
    const [highlightIdx, setHighlightIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const units = useStore(s => s.units);
    const ems = useStore(s => s.equipmentModules);
    const cms = useStore(s => s.controlModules);
    const library = useStore(s => s.library);
    const selectNode = useStore(s => s.selectNode);
    const setTab = useStore(s => s.setTab);
    const navigate = useNavigate();
    const setArchTab = useStore(s => s.setArchTab);

    const allResults = useMemo(() => collectSearchResults(units, ems, cms, library), [units, ems, cms, library]);

    type Item = { kind: 'cmd'; cmd: Command } | { kind: 'res'; res: SearchResult };

    const items: Item[] = useMemo(() => {
        const q = query.trim().toLowerCase();
        const cmds = (q
            ? COMMANDS.filter(c => c.label.toLowerCase().includes(q))
            : COMMANDS.slice(0, 6)
        ).map(cmd => ({ kind: 'cmd' as const, cmd }));
        const res = (q
            ? allResults.filter(r => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)).slice(0, 24)
            : allResults.slice(0, 14)
        ).map(r => ({ kind: 'res' as const, res: r }));
        return [...cmds, ...res];
    }, [query, allResults]);

    useEffect(() => { setHighlightIdx(0); }, [query]);
    useEffect(() => { if (open) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);

    const handleSelect = useCallback((item: Item) => {
        if (item.kind === 'cmd') {
            const action = item.cmd.action;
            onClose();
            if (action.startsWith('nav:')) navigate(action.slice(4));
            else window.dispatchEvent(new CustomEvent('ama-command', { detail: action }));
            return;
        }
        const result = item.res;
        navigate('/'); // Everything is in the Architecture page (root Route)
        setArchTab(result.entityLevel as any); // Switch to the correct UN/EM/CM/FB filter
        selectNode(result.nodeId);
        if (result.tabToOpen) setTab(result.tabToOpen as any);
        onClose();
    }, [navigate, setArchTab, selectNode, setTab, onClose]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, items.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (items[highlightIdx]) handleSelect(items[highlightIdx]); }
        else if (e.key === 'Escape') { onClose(); }
    };

    const categoryIcon = (cat: string) => {
        switch (cat) {
            case 'Entity': return <Box size={14} />;
            case 'Variable': return <Hash size={14} />;
            case 'Alarm': return <AlertTriangle size={14} />;
            case 'I/O': return <Radio size={14} />;
            case 'DFMEA': return <Settings size={14} />;
            default: return <Box size={14} />;
        }
    };

    const levelColor = (level: string) => {
        switch (level) {
            case 'UN': return 'var(--un-color)';
            case 'EM': return 'var(--em-color)';
            case 'CM': return 'var(--cm-color)';
            case 'FB': return 'var(--fb-color)';
            default: return 'var(--text-muted)';
        }
    };

    if (!open) return null;

    return (
        <div className="search-overlay-backdrop" onClick={onClose}>
            <div className="search-overlay" onClick={e => e.stopPropagation()}>
                <div className="search-overlay-input-wrap">
                    <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input ref={inputRef} placeholder="Type a command or search entities, variables, alarms, I/O…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown} />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ flexShrink: 0 }}><X size={16} /></button>
                </div>
                <div className="search-overlay-results">
                    {items.length > 0 ? (
                        items.map((item, i) => {
                            const sectionStart = i === 0 || items[i - 1].kind !== item.kind;
                            return (
                                <React.Fragment key={item.kind === 'cmd' ? item.cmd.id : item.res.id}>
                                    {sectionStart && (
                                        <div className="palette-section">{item.kind === 'cmd' ? 'Commands' : 'Entities & Data'}</div>
                                    )}
                                    {item.kind === 'cmd' ? (
                                        <div className={`search-result-item ${i === highlightIdx ? 'highlighted' : ''}`} onClick={() => handleSelect(item)} onMouseEnter={() => setHighlightIdx(i)}>
                                            <div className="result-icon" style={{ background: 'rgba(56,189,248,0.12)', color: 'var(--sky-light)' }}><Terminal size={14} /></div>
                                            <div className="result-text">
                                                <div className="result-name" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{item.cmd.icon}{item.cmd.label}</div>
                                            </div>
                                            {item.cmd.kbd && <span className="search-kbd">{item.cmd.kbd}</span>}
                                        </div>
                                    ) : (
                                        <div className={`search-result-item ${i === highlightIdx ? 'highlighted' : ''}`} onClick={() => handleSelect(item)} onMouseEnter={() => setHighlightIdx(i)}>
                                            <div className="result-icon" style={{ background: `${levelColor(item.res.entityLevel)}20`, color: levelColor(item.res.entityLevel) }}>{categoryIcon(item.res.category)}</div>
                                            <div className="result-text"><div className="result-name">{item.res.name}</div><div className="result-path">{item.res.path}</div></div>
                                            <span className="badge" style={{ fontSize: '0.6rem', opacity: 0.7 }}>{item.res.category}</span>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })
                    ) : (
                        <div className="empty-state" style={{ padding: 20 }}><p className="text-sm" style={{ color: 'var(--text-muted)' }}>No command or result found</p></div>
                    )}
                </div>
                <div className="search-overlay-footer">
                    <span>{items.length} element{items.length !== 1 ? 'i' : 'o'}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className="search-kbd">↑↓</span> Naviga
                        <span className="search-kbd">↵</span> Esegui
                        <span className="search-kbd">Esc</span> Close
                    </div>
                </div>
            </div>
        </div>
    );
};
