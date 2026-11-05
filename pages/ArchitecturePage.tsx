// ============================================================
// AMA — Architecture Page (Entity Database Editor)
// Flat DB with 4 tabs: UNs, EMs, CMs, FBs
// ============================================================
import React, { useState, useMemo } from 'react';
import { useStore } from '../lib/store';
import { useCommands } from '../lib/commands';
import { EntityEditor } from '../components/EntityEditor';
import { Modal } from '../components/Modal';
import type { EntityLevel, BlockBase, EntityStatus } from '../types/machine';

const STATUS_FILTERS: { id: 'all' | EntityStatus; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'Draft', label: 'Draft' },
    { id: 'In Review', label: 'In Review' },
    { id: 'Released', label: 'Released' },
    { id: 'Deprecated', label: 'Deprecato' },
];
const statusBadgeClass = (s?: EntityStatus) => `status-pill status-${(s || 'Draft').toLowerCase().replace(/\s+/g, '-')}`;
import {
    Network, Plus, Trash2, Box, Cpu, Settings, BookOpen,
    Search, ChevronRight
} from 'lucide-react';
import { createEmptyBlock, findEntityUsages } from '../lib/helpers';
import { isAdjusted, isMachineOnly } from '../lib/deviation';

const LEVEL_TABS: { level: EntityLevel; label: string; icon: React.ReactNode; color: string }[] = [
    { level: 'UN', label: 'Units', icon: <Box size={16} />, color: 'var(--color-un)' },
    { level: 'EM', label: 'Equipment Modules', icon: <Cpu size={16} />, color: 'var(--color-em)' },
    { level: 'CM', label: 'Control Modules', icon: <Settings size={16} />, color: 'var(--color-cm)' },
    { level: 'FB', label: 'Function Blocks', icon: <BookOpen size={16} />, color: 'var(--color-fb)' },
];

export const ArchitecturePage: React.FC = () => {
    const archTab = useStore(s => s.archTab);
    const workspaceKind = useStore(s => s.workspaceKind);
    const codebase = useStore(s => s.codebase);
    const setArchTab = useStore(s => s.setArchTab);
    const selectedNodeId = useStore(s => s.selectedNodeId);
    const selectNode = useStore(s => s.selectNode);

    // All entity lists
    const library = useStore(s => s.library);
    const units = useStore(s => s.units);
    const ems = useStore(s => s.equipmentModules);
    const cms = useStore(s => s.controlModules);

    // Actions
    const addUnit = useStore(s => s.addUnit);
    const addEM = useStore(s => s.addEM);
    const addCM = useStore(s => s.addCM);
    const addFB = useStore(s => s.addFB);
    const deleteEntity = useStore(s => s.deleteEntity);
    const findEntity = useStore(s => s.findEntityById);

    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [filterText, setFilterText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | EntityStatus>('all');

    // Current list based on tab
    const currentList: BlockBase[] = useMemo(() => {
        switch (archTab) {
            case 'UN': return units;
            case 'EM': return ems;
            case 'CM': return cms;
            case 'FB': return library;
            default: return [];
        }
    }, [archTab, units, ems, cms, library]);

    const filteredList = useMemo(() => {
        const q = filterText.toLowerCase();
        return currentList.filter(e => {
            if (statusFilter !== 'all' && (e.status || 'Draft') !== statusFilter) return false;
            if (!q) return true;
            return e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q);
        });
    }, [currentList, filterText, statusFilter]);

    const selectedEntity = selectedNodeId ? findEntity(selectedNodeId) : null;

    const handleCreate = () => {
        if (!newName.trim()) return;
        const name = newName.trim();
        if (archTab === 'UN') addUnit(name);
        else if (archTab === 'EM') addEM(name);
        else if (archTab === 'CM') addCM(name);
        else if (archTab === 'FB') {
            addFB(createEmptyBlock('FB', name, useStore.getState().activeUser));
        }
        setNewName('');
        setCreateOpen(false);
    };

    const handleDelete = (id: string) => {
        const s = useStore.getState();
        const usage = findEntityUsages(id, {
            library: s.library, units: s.units,
            equipmentModules: s.equipmentModules, controlModules: s.controlModules,
        }, s.assembly);

        let msg: string;
        const parts: string[] = [];
        if (usage.referencedBy.length > 0) {
            const list = usage.referencedBy.map(r => `[${r.level}] ${r.name}`).join(', ');
            parts.push(`is assigned to: ${list}`);
        }
        if (usage.assemblyCount > 0) {
            parts.push(`is present in ${usage.assemblyCount} ${usage.assemblyCount === 1 ? 'place' : 'places'} of the assembly tree`);
        }
        if (parts.length > 0) {
            msg = `WARNING: this entity ${parts.join(' e ')}.

Deleting it will also remove all of these references. This cannot be undone. Continue?`;
        } else {
            msg = 'Delete this entity from the architecture database? This cannot be undone.';
        }

        if (confirm(msg)) {
            deleteEntity(id, archTab);
            if (selectedNodeId === id) selectNode(null);
        }
    };

    const tabConfig = LEVEL_TABS.find(t => t.level === archTab)!;

    // Ribbon commands for this page
    const switchTab = (level: EntityLevel) => { setArchTab(level); selectNode(null); setFilterText(''); };
    const openCreate = (level?: EntityLevel) => { if (level) setArchTab(level); setCreateOpen(true); };
    useCommands({
        'arch:new': () => openCreate(),
        'arch:new:UN': () => openCreate('UN'),
        'arch:new:EM': () => openCreate('EM'),
        'arch:new:CM': () => openCreate('CM'),
        'arch:new:FB': () => openCreate('FB'),
        'arch:tab:UN': () => switchTab('UN'),
        'arch:tab:EM': () => switchTab('EM'),
        'arch:tab:CM': () => switchTab('CM'),
        'arch:tab:FB': () => switchTab('FB'),
        'arch:delete': () => { if (selectedNodeId) handleDelete(selectedNodeId); },
    });

    return (
        <div className="arch-page">
            {workspaceKind === 'machine' && (
                <div className="asm-free-banner">
                    <strong>Adjusting this machine's blocks.</strong>
                    {codebase
                        ? ` Changes stay on this machine and are marked "adjusted"; the code base "${codebase.name}" is not touched. Blocks that exist only here are marked "machine only".`
                        : ' No code base is linked, so these blocks belong to this machine only.'}
                </div>
            )}
            <div className="arch-content">
                {/* Left Panel: Library browser with level filter */}
                <div className="arch-list-panel">
                    <div className="arch-list-header">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {tabConfig.icon} Library
                        </h3>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                                <Plus size={14} /> New
                            </button>
                        </div>
                    </div>

                    {/* Level filter — segmented */}
                    <div className="level-segmented">
                        {LEVEL_TABS.map(tab => {
                            const count = tab.level === 'UN' ? units.length : tab.level === 'EM' ? ems.length : tab.level === 'CM' ? cms.length : library.length;
                            const active = archTab === tab.level;
                            return (
                                <button
                                    key={tab.level}
                                    className={`segment ${active ? 'active' : ''}`}
                                    style={active ? { color: tab.color, borderColor: tab.color } : undefined}
                                    title={tab.label}
                                    onClick={() => { setArchTab(tab.level); selectNode(null); setFilterText(''); }}
                                >
                                    {tab.icon}
                                    <span>{tab.level}</span>
                                    <span className="segment-count">{count}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Search */}
                    <div className="arch-list-search">
                        <Search size={14} />
                        <input
                            className="input input-sm"
                            placeholder={`Filtra ${tabConfig.label.toLowerCase()}...`}
                            value={filterText}
                            onChange={e => setFilterText(e.target.value)}
                        />
                    </div>

                    {/* Status filter */}
                    <div className="arch-status-filter">
                        {STATUS_FILTERS.map(s => (
                            <button
                                key={s.id}
                                className={`status-chip ${statusFilter === s.id ? 'active' : ''}`}
                                onClick={() => setStatusFilter(s.id)}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {/* List */}
                    <div className="arch-entity-list">
                        {filteredList.length === 0 ? (
                            (
                                <div className="empty-state-sm">
                                    <p>No {tabConfig.label.toLowerCase()} found.</p>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setCreateOpen(true)}>
                                        <Plus size={14} /> Create one
                                    </button>
                                </div>
                            )
                        ) : (
                            filteredList.map(entity => (
                                <div
                                    key={entity.id}
                                    className={`arch-entity-item ${selectedNodeId === entity.id ? 'selected' : ''}`}
                                    onClick={() => selectNode(entity.id)}
                                >
                                    <div className="arch-entity-info">
                                        <div className="arch-entity-name" title={entity.name}>
                                            <span className={`badge badge-${entity.level.toLowerCase()}`} style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                                                {entity.level}
                                            </span>
                                            {entity.name}
                                            <span className={statusBadgeClass(entity.status)} title={`Status: ${entity.status || 'Draft'}`} />
                                            {workspaceKind === 'machine' && codebase && isMachineOnly(entity) && <span className="badge badge-warning" style={{ fontSize: '0.6rem', padding: '1px 5px', marginLeft: 4 }}>machine only</span>}
                                            {workspaceKind === 'machine' && codebase && isAdjusted(entity) && <span className="badge badge-warning" style={{ fontSize: '0.6rem', padding: '1px 5px', marginLeft: 4 }}>adjusted</span>}
                                        </div>
                                        <div className="arch-entity-desc" title={entity.description}>{entity.description || 'No description'}</div>
                                        <div className="arch-entity-meta">
                                            v{entity.currentVersion}
                                            {entity.variables?.length > 0 && <span>· {entity.variables.length} vars</span>}
                                            {entity.alarms?.length > 0 && <span>· {entity.alarms.length} alarms</span>}
                                            {'assignedFBs' in entity && (entity as any).assignedFBs?.length > 0 && (
                                                <span>· {(entity as any).assignedFBs.length} FBs</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={e => { e.stopPropagation(); handleDelete(entity.id); }}
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right Panel: Editor */}
                <div className="arch-editor-panel">
                    {selectedEntity ? (
                        <EntityEditor block={selectedEntity} isLibrary={archTab === 'FB'} />
                    ) : (
                        <div className="empty-state" style={{ height: '60vh' }}>
                            <Network size={48} />
                            <h3>Select an entity to edit</h3>
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                Pick a {tabConfig.label.toLowerCase().slice(0, -1)} from the list on the left, or create a new one.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            <Modal open={createOpen} onClose={() => { setCreateOpen(false); setNewName(''); }}>
                <h3 style={{ marginBottom: 16 }}>Create New {archTab === 'FB' ? 'Function Block' : archTab === 'UN' ? 'Units' : archTab === 'EM' ? 'Equipment Module' : 'Control Module'}</h3>
                <input
                    className="input"
                    placeholder={`Name (e.g. ${archTab}_NewEntity)`}
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                    <button className="btn btn-secondary" onClick={() => { setCreateOpen(false); setNewName(''); }}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim()}>Create</button>
                </div>
            </Modal>
        </div>
    );
};
