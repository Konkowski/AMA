// ============================================================
// AMA — Risk page (step 3 of the Code base workspace)
// The DFMEA turned into a to-do list for the Product Owner:
// which blocks and which components deserve attention, and why.
// ============================================================
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useStore } from '../lib/store';
import { blockRisk, componentRisks, suggestFor, rpnBand, needsAttention, isMitigated, RPN_ATTENTION, type BlockRisk } from '../lib/dfmeaGuide';
import type { BlockBase } from '../types/machine';

export const RiskPage: React.FC = () => {
    const navigate = useNavigate();
    const units = useStore(s => s.units);
    const ems = useStore(s => s.equipmentModules);
    const cms = useStore(s => s.controlModules);
    const library = useStore(s => s.library);
    const [open, setOpen] = useState<string | null>(null);

    const blocks = useMemo<BlockBase[]>(() => [...units, ...ems, ...cms, ...library], [units, ems, cms, library]);
    const risks = useMemo(() => blocks.map(blockRisk), [blocks]);
    const ranked = useMemo(() => risks.filter(r => r.total > 0).sort((a, b) => (b.critical - a.critical) || (b.open - a.open) || (b.maxRpn - a.maxRpn)), [risks]);
    const withoutDfmea = useMemo(() => blocks.filter(b => (b.dfmea || []).length === 0 && (b.level === 'CM' || b.level === 'FB')), [blocks]);
    const comps = useMemo(() => componentRisks(blocks), [blocks]);

    const totals = useMemo(() => ({
        critical: risks.reduce((n, r) => n + r.critical, 0),
        open: risks.reduce((n, r) => n + r.open, 0),
        done: blocks.reduce((n, b) => n + (b.dfmea || []).filter(isMitigated).length, 0),
        all: risks.reduce((n, r) => n + r.total, 0),
    }), [risks, blocks]);

    const goTo = (b: BlockBase) => {
        useStore.setState({ archTab: b.level, selectedNodeId: b.id, selectedTab: 'dfmea' });
        navigate('/');
    };

    return (
        <div className="project-page">
            <section>
                <h1>Risk</h1>
                <p className="project-lead">
                    Where the code base needs attention. Failures with RPN ≥ {RPN_ATTENTION} that are not implemented yet are listed first,
                    with what the block or the component should do about them. Open a block to fix it.
                </p>
            </section>

            <section className="risk-tiles">
                <div className={`risk-tile ${totals.critical ? 'band-critical' : ''}`}><b>{totals.critical}</b><span>critical open (RPN ≥ 200)</span></div>
                <div className={`risk-tile ${totals.open ? 'band-high' : ''}`}><b>{totals.open}</b><span>need attention (RPN ≥ {RPN_ATTENTION})</span></div>
                <div className="risk-tile"><b>{totals.done}/{totals.all}</b><span>failures implemented or verified</span></div>
                <div className={`risk-tile ${withoutDfmea.length ? 'band-medium' : ''}`}><b>{withoutDfmea.length}</b><span>CM / FB with no DFMEA</span></div>
            </section>

            <section className="project-card">
                <h2>Blocks by risk</h2>
                {ranked.length === 0 && <p className="project-counts">No DFMEA entries yet. Add them in Architecture, tab DFMEA, for each block.</p>}
                {ranked.length > 0 && (
                    <table className="release-table">
                        <thead><tr><th>Level</th><th>Block</th><th style={{ width: 200 }}>Highest RPN</th><th>Failures</th><th>Open</th><th>No alarm</th><th></th></tr></thead>
                        <tbody>
                            {ranked.map((r: BlockRisk) => (
                                <React.Fragment key={r.block.id}>
                                    <tr className="risk-row" onClick={() => setOpen(open === r.block.id ? null : r.block.id)}>
                                        <td><span className={`badge badge-${r.block.level.toLowerCase()}`}>{r.block.level}</span></td>
                                        <td>{r.block.name}</td>
                                        <td>
                                            <div className="risk-bar"><div className={`risk-bar-fill band-${rpnBand(r.maxRpn)}`} style={{ width: `${Math.min(100, r.maxRpn / 10)}%` }} /><span>{r.maxRpn}</span></div>
                                        </td>
                                        <td>{r.total}</td>
                                        <td>{r.open ? <span style={{ color: r.critical ? 'var(--red)' : 'var(--orange)' }}>{r.open}</span> : <span style={{ color: 'var(--text-muted)' }}>0</span>}</td>
                                        <td>{r.unlinked || <span style={{ color: 'var(--text-muted)' }}>0</span>}</td>
                                        <td><button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); goTo(r.block); }}>Open <ArrowRight size={12} /></button></td>
                                    </tr>
                                    {open === r.block.id && (
                                        <tr className="release-issues-row">
                                            <td colSpan={7}>
                                                {[...(r.block.dfmea || [])].sort((a, b) => b.rpn - a.rpn).map(d => {
                                                    const tips = suggestFor(d, r.block);
                                                    const part = (r.block.bom || []).find(p => p.id === d.componentId);
                                                    return (
                                                        <div key={d.id} className={`risk-failure band-${rpnBand(d.rpn)} ${needsAttention(d) ? 'is-open' : ''}`}>
                                                            <div className="risk-failure-head">
                                                                <strong>RPN {d.rpn}</strong> {d.failureMode}
                                                                <span className="project-counts"> · {d.status}{part ? ` · component: ${part.description || part.code}` : ''}</span>
                                                            </div>
                                                            {tips.length > 0 && needsAttention(d) && <ul>{tips.map(t => <li key={t.id}>{t.text}</li>)}</ul>}
                                                        </div>
                                                    );
                                                })}
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            <section className="project-card">
                <h2>Components at risk</h2>
                {comps.length === 0
                    ? <p className="project-counts">No failure is linked to a component yet. In a DFMEA entry, pick the "Component involved" (the components come from the block's BOM tab).</p>
                    : (
                        <table className="release-table">
                            <thead><tr><th>Component</th><th>Block</th><th>Highest RPN</th><th>Failures</th><th>Alternatives</th><th>Advice</th></tr></thead>
                            <tbody>
                                {comps.map(c => (
                                    <tr key={c.block.id + c.part.id}>
                                        <td>{c.part.description || c.part.code || 'Component'}{c.part.code ? <span className="project-counts"> {c.part.code}</span> : null}</td>
                                        <td><a href="#" onClick={e => { e.preventDefault(); goTo(c.block); }}>{c.block.name}</a></td>
                                        <td><span className={`rpn-${rpnBand(c.maxRpn)}`}>{c.maxRpn}</span></td>
                                        <td>{c.failures.length}</td>
                                        <td>{(c.part.alternatives || []).length}</td>
                                        <td>{c.hint || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
            </section>

            {withoutDfmea.length > 0 && (
                <section className="project-card">
                    <h2>Blocks with no DFMEA</h2>
                    <p className="project-counts" style={{ marginBottom: 8 }}>Control Modules and Function Blocks usually drive a physical output or a check: ask what can fail.</p>
                    <div className="risk-chips">
                        {withoutDfmea.map(b => <button key={b.id} className="btn btn-secondary btn-sm" onClick={() => goTo(b)}>{b.level} · {b.name}</button>)}
                    </div>
                </section>
            )}
        </div>
    );
};
