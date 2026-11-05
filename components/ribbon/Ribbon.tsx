// ============================================================
// AMA — Ribbon (workflow tabs + command groups) and File backstage
// ============================================================
import React from 'react';
import { ChevronDown, ChevronUp, ArrowRight, CircleHelp } from 'lucide-react';
import { backstageItems, type RibbonCmd, type RibbonGroup, type RibbonTab } from './ribbonConfig';
import type { WorkspaceKind } from '../../types/machine';

interface RibbonProps {
    tabs: RibbonTab[];
    activeTab: string;
    onTab: (id: string) => void;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onRun: (cmd: { id: string; route?: string }) => void;
    backstageOpen: boolean;
    onBackstage: (open: boolean) => void;
}

const CmdButton: React.FC<{ cmd: RibbonCmd; onRun: RibbonProps['onRun'] }> = ({ cmd, onRun }) => {
    const Icon = cmd.icon;
    return (
        <button
            className={`rb-btn ${cmd.small ? 'small' : 'large'}`}
            title={cmd.tip || cmd.label}
            onClick={() => onRun(cmd)}
        >
            <Icon size={cmd.small ? 15 : 24} strokeWidth={1.6} />
            <span>{cmd.label}</span>
        </button>
    );
};

/** Consecutive small buttons stack up to three high, like in Office. */
const GroupBody: React.FC<{ group: RibbonGroup; onRun: RibbonProps['onRun'] }> = ({ group, onRun }) => {
    const cols: React.ReactNode[] = [];
    let stack: RibbonCmd[] = [];
    const flush = () => {
        if (!stack.length) return;
        const items = stack;
        cols.push(
            <div className="rb-stack" key={`s-${cols.length}`}>
                {items.map(c => <CmdButton key={c.id} cmd={c} onRun={onRun} />)}
            </div>
        );
        stack = [];
    };
    for (const c of group.cmds) {
        if (c.small) { stack.push(c); if (stack.length === 3) flush(); }
        else { flush(); cols.push(<CmdButton key={c.id} cmd={c} onRun={onRun} />); }
    }
    flush();
    return <div className="rb-group-body">{cols}</div>;
};

export const Ribbon: React.FC<RibbonProps & { onHelp: () => void }> = ({
    tabs, activeTab, onTab, collapsed, onToggleCollapsed, onRun, backstageOpen, onBackstage, onHelp,
}) => {
    const tab = tabs.find(t => t.id === activeTab) || tabs[0];
    const next = tabs.find(t => t.id === tab.next);
    return (
        <div className="ribbon">
            <div className="rb-tabs" role="tablist">
                <button
                    className={`rb-tab rb-file ${backstageOpen ? 'active' : ''}`}
                    onClick={() => onBackstage(!backstageOpen)}
                >File</button>
                {tabs.map(t => (
                    <button
                        key={t.id}
                        role="tab"
                        aria-selected={!backstageOpen && t.id === activeTab}
                        className={`rb-tab ${!backstageOpen && t.id === activeTab ? 'active' : ''}`}
                        onClick={() => { onBackstage(false); onTab(t.id); }}
                        onDoubleClick={onToggleCollapsed}
                    >
                        {t.step && <span className="rb-step">{t.step}</span>}{t.label}
                    </button>
                ))}
                <span style={{ flex: 1 }} />
                <button className="rb-collapse" onClick={onHelp} title="Help and shortcuts"><CircleHelp size={15} /></button>
                <button
                    className="rb-collapse"
                    onClick={onToggleCollapsed}
                    title={collapsed ? 'Expand the ribbon (Ctrl+F1)' : 'Collapse the ribbon (Ctrl+F1)'}
                >{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
            </div>
            {!collapsed && (
                <div className="rb-body">
                    <div className="rb-group rb-hint-group">
                        <div className="rb-hint">
                            <div className="rb-hint-title">{tab.step ? `Step ${tab.step}` : 'Optional'} · {tab.label}</div>
                            <div className="rb-hint-text">{tab.hint}</div>
                        </div>
                    </div>
                    {tab.groups.map(g => (
                        <div className="rb-group" key={g.label}>
                            <GroupBody group={g} onRun={onRun} />
                            <div className="rb-group-label">{g.label}</div>
                        </div>
                    ))}
                    <span style={{ flex: 1 }} />
                    {next && (
                        <div className="rb-group rb-next-group">
                            <button className="rb-next" onClick={() => onTab(next.id)} title={`Go to the next step: ${next.label}`}>
                                <span className="rb-next-small">{next.step ? `Step ${next.step}` : 'Then'}</span>
                                <span className="rb-next-label">{next.label} <ArrowRight size={16} /></span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const Backstage: React.FC<{
    kind: WorkspaceKind;
    open: boolean;
    onClose: () => void;
    onRun: RibbonProps['onRun'];
}> = ({ kind, open, onClose, onRun }) => {
    const [hover, setHover] = React.useState<string | null>(null);
    if (!open) return null;
    const items = backstageItems(kind);
    const shown = items.find(i => i.id === hover);
    return (
        <div className="backstage" onClick={onClose}>
            <div className="backstage-menu" onClick={e => e.stopPropagation()}>
                {items.map(item => (
                    <React.Fragment key={item.id}>
                        {item.sep && <div className="backstage-sep" />}
                        <button
                            className="backstage-item"
                            onMouseEnter={() => setHover(item.id)}
                            onFocus={() => setHover(item.id)}
                            onClick={() => { onClose(); onRun({ id: item.id, route: item.route }); }}
                        >
                            <item.icon size={18} strokeWidth={1.6} /> {item.label}
                        </button>
                    </React.Fragment>
                ))}
            </div>
            <div className="backstage-pane" onClick={e => e.stopPropagation()}>
                <h2>{shown?.label || 'File'}</h2>
                <p>{shown?.desc || 'Pick a command from the menu on the left.'}</p>
            </div>
        </div>
    );
};
