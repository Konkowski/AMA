// ============================================================
// AMA — Library Page
// ============================================================
import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useStore } from '../lib/store';
import { EntityEditor } from '../components/EntityEditor';
import { generateId } from '../lib/helpers';
import { Search, Plus, BookOpen, Trash2, GripVertical } from 'lucide-react';
import { Modal } from '../components/Modal';
import type { FunctionBlock, FBCategory } from '../types/machine';

const CATEGORIES: FBCategory[] = ['Motion', 'Valve', 'Sensor', 'Communication', 'Safety', 'Logic', 'HMI', 'Other'];

const categoryColors: Record<string, string> = {
    Motion: 'var(--un-color)',
    Valve: 'var(--em-color)',
    Sensor: 'var(--cm-color)',
    Communication: 'var(--yellow)',
    Safety: '#db2777',
    Logic: 'var(--purple)',
    HMI: 'var(--sky)',
    Other: 'var(--text-secondary)',
};

// ─── Draggable FB Card ──────────────────────────────
interface DraggableFBCardProps {
    fb: FunctionBlock;
    isSelected: boolean;
    onSelect: () => void;
    categoryColor: string;
}

const DraggableFBCard: React.FC<DraggableFBCardProps> = ({ fb, isSelected, onSelect, categoryColor }) => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `drag-fb-${fb.id}`,
        data: { type: 'fb', fbId: fb.id, fbName: fb.name },
    });

    return (
        <div
            ref={setNodeRef}
            className={`list-item draggable-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            onClick={onSelect}
        >
            <div
                className="list-item-grip"
                {...attributes}
                {...listeners}
                style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', cursor: 'grab', padding: '0 4px' }}
            >
                <GripVertical size={14} />
            </div>
            <div className="list-item-icon" style={{ background: categoryColor }}>
                FB
            </div>
            <div className="list-item-info">
                <div className="list-item-name">{fb.name}</div>
                <div className="list-item-desc">{fb.category} · v{fb.currentVersion}</div>
            </div>
        </div>
    );
};

export const LibraryPage: React.FC = () => {
    const library = useStore(s => s.library);
    const selectedNodeId = useStore(s => s.selectedNodeId);
    const selectNode = useStore(s => s.selectNode);
    const addFB = useStore(s => s.addFB);
    const deleteFB = useStore(s => s.deleteFB);
    const searchQuery = useStore(s => s.searchQuery);
    const setSearchQuery = useStore(s => s.setSearchQuery);
    const categoryFilter = useStore(s => s.categoryFilter);
    const setCategoryFilter = useStore(s => s.setCategoryFilter);
    const [showCreate, setShowCreate] = React.useState(false);
    const [newName, setNewName] = React.useState('');
    const [newCat, setNewCat] = React.useState<FBCategory>('Other');

    const filtered = library.filter(fb => {
        if (searchQuery && !fb.name.toLowerCase().includes(searchQuery.toLowerCase()) && !fb.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (categoryFilter && fb.category !== categoryFilter) return false;
        return true;
    });

    const selected = library.find(fb => fb.id === selectedNodeId) || null;

    const handleCreate = () => {
        if (!newName) return;
        const newFB: FunctionBlock = {
            id: generateId(),
            name: newName.startsWith('FB_') ? newName : `FB_${newName}`,
            description: '',
            category: newCat,
            level: 'FB',
            variables: [],
            alarms: [],
            io: [],
            dfmea: [],
            revisions: [{ version: '1.0', date: new Date().toISOString().split('T')[0], author: 'System', notes: 'Initial creation' }],
            code: '',
            currentVersion: '1.0',
            lastModifiedBy: '',
        };
        addFB(newFB);
        selectNode(newFB.id);
        setNewName('');
        setNewCat('Other');
        setShowCreate(false);
    };

    return (
        <div className="split-layout" style={{ margin: -24, height: 'calc(100% + 48px)' }}>
            {/* Left Panel */}
            <div className="split-left">
                <div className="split-left-header">
                    <div className="flex items-center justify-between">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <BookOpen size={18} style={{ color: 'var(--sky)' }} />
                            FB Library
                            <span className="badge badge-em">{library.length}</span>
                        </h3>
                        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                            <Plus size={14} /> New
                        </button>
                    </div>

                    <div className="search-box">
                        <Search size={16} className="search-icon" />
                        <input
                            placeholder="Search function blocks..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="filter-pills">
                        <button
                            className={`filter-pill ${!categoryFilter ? 'active' : ''}`}
                            onClick={() => setCategoryFilter(null)}
                        >
                            All
                        </button>
                        {CATEGORIES.map(cat => {
                            const count = library.filter(fb => fb.category === cat).length;
                            if (count === 0) return null;
                            return (
                                <button
                                    key={cat}
                                    className={`filter-pill ${categoryFilter === cat ? 'active' : ''}`}
                                    onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                                >
                                    {cat} ({count})
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="split-left-list">
                    {filtered.map(fb => (
                        <DraggableFBCard
                            key={fb.id}
                            fb={fb}
                            isSelected={selectedNodeId === fb.id}
                            onSelect={() => selectNode(fb.id)}
                            categoryColor={categoryColors[fb.category] || 'var(--text-secondary)'}
                        />
                    ))}
                    {filtered.length === 0 && (
                        <div className="empty-state" style={{ padding: 30 }}>
                            <BookOpen size={32} />
                            <span>No function blocks found</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Panel */}
            <div className="split-right">
                {selected ? (
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {selected.name}
                                    <span className="badge badge-fb">FB</span>
                                    <span className="badge badge-em">v{selected.currentVersion}</span>
                                </h2>
                                <p className="text-sm" style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                                    {selected.category} · {selected.variables.length} var · {selected.alarms.length} alarms
                                </p>
                            </div>
                            <button className="btn btn-danger btn-sm" onClick={() => { deleteFB(selected.id); }}>
                                <Trash2 size={14} /> Delete
                            </button>
                        </div>
                        <EntityEditor block={selected} isLibrary />
                    </div>
                ) : (
                    <div className="empty-state" style={{ height: '100%' }}>
                        <BookOpen size={48} />
                        <h3>Select a Function Block</h3>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            Pick an FB from the library to view and edit its details.
                        </p>
                    </div>
                )}
            </div>

            {/* Create Modal */}
            <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Function Block" footer={
                <><button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleCreate}>Create</button></>
            }>
                <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="FB_MioBlocco" />
                </div>
                <div className="form-group">
                    <label className="form-label">Categoria</label>
                    <select className="form-select" value={newCat} onChange={e => setNewCat(e.target.value as FBCategory)}>
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                </div>
            </Modal>
        </div>
    );
};
