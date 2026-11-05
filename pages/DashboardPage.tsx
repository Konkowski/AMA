// ============================================================
// AMA — Project Dashboard
// Built for the engineer who assembled the machine: how big is
// it, how long to develop, how standardized, what's the risk,
// and is it ready to ship. SVG charts, no chart library.
// ============================================================
import React, { useMemo } from 'react';
import { useStore } from '../lib/store';
import { getAssemblyDFMEA } from '../lib/helpers';
import type { AssemblyNode, EntityLevel, BlockBase, FunctionBlock } from '../types/machine';
import {
    Shield, Cpu, Box, AlertTriangle, Activity, Clock,
    CheckCircle, AlertCircle, Info, Layers, Network, Recycle, Gauge
} from 'lucide-react';

// ─── Chart primitives ───────────────────────────────────────
interface Seg { label: string; value: number; color: string }

const Donut: React.FC<{ segments: Seg[]; size?: number; thickness?: number; centerValue?: React.ReactNode; centerLabel?: string }> =
    ({ segments, size = 132, thickness = 16, centerValue, centerLabel }) => {
        const total = segments.reduce((s, x) => s + x.value, 0);
        const r = (size - thickness) / 2;
        const c = size / 2;
        const circ = 2 * Math.PI * r;
        let offset = 0;
        return (
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
                <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
                {total > 0 && segments.filter(s => s.value > 0).map((s, i) => {
                    const dash = (s.value / total) * circ;
                    const el = (
                        <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
                            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
                            transform={`rotate(-90 ${c} ${c})`} />
                    );
                    offset += dash;
                    return el;
                })}
                {centerValue !== undefined && (
                    <text x={c} y={c} textAnchor="middle" dominantBaseline="central"
                        fontSize={size * 0.26} fontWeight={300} fill="var(--text)" fontFamily="Inter">{centerValue}</text>
                )}
                {centerLabel && (
                    <text x={c} y={c + size * 0.18} textAnchor="middle" dominantBaseline="central"
                        fontSize={size * 0.075} fill="var(--text-muted)" fontFamily="Inter"
                        letterSpacing="1.5">{centerLabel.toUpperCase()}</text>
                )}
            </svg>
        );
    };

const Legend: React.FC<{ segments: Seg[] }> = ({ segments }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {segments.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-secondary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
            </div>
        ))}
    </div>
);

const ChartCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> =
    ({ title, icon, children, right }) => (
        <div className="card dash-chart-card">
            <div className="dash-chart-head">
                <span className="dash-chart-title">{icon} {title}</span>
                {right}
            </div>
            <div className="dash-chart-body">{children}</div>
        </div>
    );

const DashboardPage: React.FC = () => {
    const store = useStore();
    const { library, units, equipmentModules, controlModules, assembly } = store;

    const findEntity = (id: string): BlockBase | null =>
        library.find(e => e.id === id) || units.find(e => e.id === id) ||
        equipmentModules.find(e => e.id === id) || controlModules.find(e => e.id === id) || null;

    const activeNodes = useMemo(() => {
        const nodes: { id: string; refId: string; level: EntityLevel; children: any[] }[] = [];
        const traverse = (tn: AssemblyNode[]) => { for (const n of tn) { nodes.push(n); traverse(n.children); } };
        traverse(assembly.tree);
        return nodes;
    }, [assembly.tree]);

    // Unique architecture entities used (development is per-entity, not per-instance)
    const uniqueEntities = useMemo(() => {
        const seen = new Set<string>(); const list: BlockBase[] = [];
        for (const n of activeNodes) { if (!seen.has(n.refId)) { seen.add(n.refId); const e = findEntity(n.refId); if (e) list.push(e); } }
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeNodes, units, equipmentModules, controlModules, library]);

    const counts = useMemo(() => {
        let un = 0, em = 0, cm = 0;
        activeNodes.forEach(n => { if (n.level === 'UN') un++; else if (n.level === 'EM') em++; else if (n.level === 'CM') cm++; });
        return { un, em, cm };
    }, [activeNodes]);

    const ioCounts = useMemo(() => {
        let di = 0, do_ = 0, ai = 0, ao = 0;
        activeNodes.forEach(n => {
            const e = findEntity(n.refId);
            e?.io?.forEach(io => {
                const t = io.signalType.toUpperCase();
                if (t === 'DI') di++; else if (t === 'DO') do_++; else if (t === 'AI') ai++; else if (t === 'AO') ao++;
            });
        });
        return { di, do_, ai, ao, total: di + do_ + ai + ao };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeNodes, units, equipmentModules, controlModules, library]);

    const alarmCounts = useMemo(() => {
        let fault = 0, alarm = 0, warning = 0, safety = 0;
        activeNodes.forEach(n => {
            const e = findEntity(n.refId);
            e?.alarms?.forEach(a => {
                if (a.level === 'Fault') fault++; else if (a.level === 'Alarm') alarm++;
                else if (a.level === 'Warning') warning++; else if (a.level === 'Safety') safety++;
            });
        });
        return { fault, alarm, warning, safety, total: fault + alarm + warning + safety };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeNodes, units, equipmentModules, controlModules, library]);

    // Reuse / standardization — how many times each FB & module is instanced
    const reuse = useMemo(() => {
        const inst = new Map<string, number>();
        activeNodes.forEach(n => inst.set(n.refId, (inst.get(n.refId) || 0) + 1));
        const fbUsage = new Map<string, { name: string; count: number }>();
        activeNodes.forEach(n => {
            const e = findEntity(n.refId);
            ((e as any)?.assignedFBs || []).forEach((fbId: string) => {
                const fb = library.find(f => f.id === fbId);
                if (fb) { const cur = fbUsage.get(fb.id) || { name: fb.name, count: 0 }; cur.count++; fbUsage.set(fb.id, cur); }
            });
        });
        const topFb = [...fbUsage.values()].sort((a, b) => b.count - a.count).slice(0, 6);
        const reused = [...inst.values()].filter(c => c > 1).length;
        const reuseRate = inst.size > 0 ? Math.round((reused / inst.size) * 100) : 0;
        return { topFb, reuseRate, uniqueCount: inst.size, instanceCount: activeNodes.length };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeNodes, library, units, equipmentModules, controlModules]);

    // Complexity — engineering weight per module (top)
    const complexity = useMemo(() => {
        return uniqueEntities.map(e => {
            const vars = (e.variables || []).length, alarms = (e.alarms || []).length, io = (e.io || []).length;
            return { name: e.name, level: e.level, vars, alarms, io, score: vars + alarms * 2 + io };
        }).sort((a, b) => b.score - a.score).slice(0, 7);
    }, [uniqueEntities]);

    // Software readiness analyzer (QA checkout)
    const gaps = useMemo(() => {
        const issues: { level: 'error' | 'warning' | 'info'; message: string; module: string }[] = [];
        activeNodes.forEach(node => {
            const e = findEntity(node.refId);
            if (!e) return;
            const m = `${e.level}: ${e.name}`;
            if (!e.code || e.code.trim().length === 0) issues.push({ level: 'warning', message: 'Structured Text (ST) code not defined.', module: m });
            if (e.level === 'CM' && (((e as any).assignedFBs || []).length === 0)) issues.push({ level: 'info', message: 'No library Function Block assigned.', module: m });
            e.alarms?.forEach(a => { if (!a.triggerVariable?.trim()) issues.push({ level: 'error', message: `Alarm '${a.alarmId}' has no trigger variable.`, module: m }); });
            e.io?.forEach(io => { if (!io.variable?.trim()) issues.push({ level: 'error', message: `I/O signal '${io.signalId}' has no software variable.`, module: m }); });
        });
        const ipMap: Record<string, string[]> = {};
        (assembly.sbom || []).forEach(item => {
            const ip = (item.ipAddress || '').trim();
            if (ip && ip !== '—') { ipMap[ip] = ipMap[ip] || []; ipMap[ip].push(item.hardware || 'Device'); }
        });
        Object.entries(ipMap).forEach(([ip, d]) => { if (d.length > 1) issues.push({ level: 'error', message: `Conflitto IP '${ip}' (${d.join(', ')}).`, module: 'Network / SBOM' }); });
        const prio = { error: 0, warning: 1, info: 2 };
        return issues.sort((a, b) => prio[a.level] - prio[b.level]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeNodes, assembly.sbom, units, equipmentModules, controlModules, library]);

    const dfmeaEntries = useMemo(() => getAssemblyDFMEA(store), [store]);
    const dfmeaProfile = useMemo(() => {
        let crit = 0, high = 0, med = 0, low = 0;
        dfmeaEntries.forEach(d => {
            if (d.rpn >= 200) crit++; else if (d.rpn >= 100) high++; else if (d.rpn >= 50) med++; else low++;
        });
        return { crit, high, med, low, total: dfmeaEntries.length };
    }, [dfmeaEntries]);

    const errorGaps = gaps.filter(g => g.level === 'error').length;
    const readiness = activeNodes.length === 0 ? 0
        : Math.max(0, Math.round(100 - (errorGaps * 8) - (gaps.filter(g => g.level === 'warning').length * 3)));

    const hasAssembly = assembly.tree.length > 0;

    // Segment definitions
    const ioSegs: Seg[] = [
        { label: 'Digital Inputs (DI)', value: ioCounts.di, color: 'var(--un-color)' },
        { label: 'Digital Outputs (DO)', value: ioCounts.do_, color: 'var(--em-color)' },
        { label: 'Analog Inputs (AI)', value: ioCounts.ai, color: 'var(--cm-color)' },
        { label: 'Analog Outputs (AO)', value: ioCounts.ao, color: 'var(--fb-color)' },
    ];
    const alarmSegs: Seg[] = [
        { label: 'Fault', value: alarmCounts.fault, color: 'var(--red)' },
        { label: 'Alarm', value: alarmCounts.alarm, color: 'var(--orange)' },
        { label: 'Warning', value: alarmCounts.warning, color: 'var(--yellow)' },
        { label: 'Safety', value: alarmCounts.safety, color: 'var(--sky)' },
    ];
    const riskSegs: Seg[] = [
        { label: 'Critical (RPN ≥ 200)', value: dfmeaProfile.crit, color: 'var(--red)' },
        { label: 'High (100–199)', value: dfmeaProfile.high, color: 'var(--orange)' },
        { label: 'Medium (50–99)', value: dfmeaProfile.med, color: 'var(--yellow)' },
        { label: 'Low (< 50)', value: dfmeaProfile.low, color: 'var(--em-color)' },
    ];

    const cplxMax = Math.max(...complexity.map(c => c.score), 1);
    const fbMax = Math.max(...reuse.topFb.map(f => f.count), 1);
    const levelColor = (lv: string) => `var(--${lv.toLowerCase()}-color)`;

    return (
        <div className="dash-page">
            <div className="page-header">
                <div>
                    <h1>Project Dashboard</h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: 2, fontSize: '0.85rem' }}>
                        {assembly.name} · engineering overview of the assembly
                    </p>
                </div>
            </div>

            {!hasAssembly ? (
                <div className="card" style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--border)' }}>
                    <Network size={44} style={{ opacity: 0.25, marginBottom: 14 }} />
                    <h3 style={{ marginBottom: 6 }}>No assembled modules</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 460, margin: '0 auto' }}>
                        Drag your units into the Assembly tree to see engineering KPIs, development estimates, risk profile and charts.
                    </p>
                </div>
            ) : (
                <>
                    {/* ── KPI strip ── */}
                    <div className="dash-kpi-row">
                        <div className="dash-kpi">
                            <div className="dash-kpi-icon" style={{ color: 'var(--un-color)' }}><Layers size={18} /></div>
                            <div className="dash-kpi-num">{activeNodes.length}</div>
                            <div className="dash-kpi-label">Assembled modules</div>
                            <div className="dash-kpi-sub">{counts.un} UN · {counts.em} EM · {counts.cm} CM</div>
                        </div>
                        <div className="dash-kpi">
                            <div className="dash-kpi-icon" style={{ color: 'var(--em-color)' }}><Activity size={18} /></div>
                            <div className="dash-kpi-num">{ioCounts.total}</div>
                            <div className="dash-kpi-label">Physical I/O points</div>
                            <div className="dash-kpi-sub">{ioCounts.di} DI · {ioCounts.do_} DO · {ioCounts.ai} AI · {ioCounts.ao} AO</div>
                        </div>
                        <div className="dash-kpi">
                            <div className="dash-kpi-icon" style={{ color: 'var(--cm-color)' }}><AlertTriangle size={18} /></div>
                            <div className="dash-kpi-num">{alarmCounts.total}</div>
                            <div className="dash-kpi-label">Configured alarms</div>
                            <div className="dash-kpi-sub">{alarmCounts.fault} Fault · {alarmCounts.alarm} Alarm · {alarmCounts.warning} Warn</div>
                        </div>
                        <div className="dash-kpi">
                            <div className="dash-kpi-icon" style={{ color: 'var(--sky)' }}><Recycle size={18} /></div>
                            <div className="dash-kpi-num">{reuse.reuseRate}<span className="dash-kpi-unit">%</span></div>
                            <div className="dash-kpi-label">Architecture reuse</div>
                            <div className="dash-kpi-sub">{reuse.uniqueCount} unique → {reuse.instanceCount} instances</div>
                        </div>
                        <div className="dash-kpi">
                            <div className="dash-kpi-icon" style={{ color: readiness >= 80 ? 'var(--em-color)' : readiness >= 50 ? 'var(--yellow)' : 'var(--red)' }}><Gauge size={18} /></div>
                            <div className="dash-kpi-num">{readiness}<span className="dash-kpi-unit">%</span></div>
                            <div className="dash-kpi-label">Software readiness</div>
                            <div className="dash-kpi-sub">{errorGaps} errors · {gaps.length} findings</div>
                        </div>
                    </div>

                    {/* ── Donut row ── */}
                    <div className="dash-grid-3">
                        <ChartCard title="I/O distribution" icon={<Activity size={15} />}>
                            <div className="dash-donut-row">
                                <Donut segments={ioSegs} centerValue={ioCounts.total} centerLabel="points" />
                                <Legend segments={ioSegs} />
                            </div>
                        </ChartCard>
                        <ChartCard title="Alarms by severity" icon={<AlertTriangle size={15} />}>
                            <div className="dash-donut-row">
                                <Donut segments={alarmSegs} centerValue={alarmCounts.total} centerLabel="alarms" />
                                <Legend segments={alarmSegs} />
                            </div>
                        </ChartCard>
                        <ChartCard title="DFMEA risk profile" icon={<Shield size={15} />}>
                            <div className="dash-donut-row">
                                <Donut segments={riskSegs} centerValue={dfmeaProfile.total} centerLabel="risks" />
                                <Legend segments={riskSegs} />
                            </div>
                        </ChartCard>
                    </div>

                    {/* ── Reuse + Complexity ── */}
                    <div className="dash-grid-2">
                        <ChartCard title="Function block reuse" icon={<Recycle size={15} />}
                            right={<span className="dash-chart-total">{reuse.topFb.length} FB</span>}>
                            {reuse.topFb.length === 0 ? (
                                <p className="dash-hint">No function block assigned to the assembled entities.</p>
                            ) : (
                                <div className="dash-bars">
                                    {reuse.topFb.map((f, i) => (
                                        <div className="dash-bar-row" key={i}>
                                            <span className="dash-bar-label" title={f.name}>{f.name}</span>
                                            <div className="dash-bar-track">
                                                <div className="dash-bar-seg" style={{ width: `${(f.count / fbMax) * 100}%`, background: 'var(--fb-color)' }} />
                                            </div>
                                            <span className="dash-bar-val">×{f.count}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ChartCard>

                        <ChartCard title="Complexity per module" icon={<Cpu size={15} />}
                            right={<span className="dash-chart-total">var · alarms · I/O</span>}>
                            {complexity.length === 0 ? <p className="dash-hint">No data.</p> : (
                                <div className="dash-bars">
                                    {complexity.map((c, i) => (
                                        <div className="dash-bar-row" key={i}>
                                            <span className="dash-bar-label" title={c.name}>
                                                <span className={`badge badge-${c.level.toLowerCase()}`} style={{ fontSize: '0.6rem', padding: '1px 5px', marginRight: 6 }}>{c.level}</span>
                                                {c.name}
                                            </span>
                                            <div className="dash-bar-track">
                                                <div className="dash-bar-seg" style={{ width: `${(c.score / cplxMax) * 100}%`, background: levelColor(c.level) }} />
                                            </div>
                                            <span className="dash-bar-val" style={{ minWidth: 96, textAlign: 'right' }}>{c.vars}·{c.alarms}·{c.io}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ChartCard>
                    </div>

                    {/* ── QA analyzer (full width) ── */}
                    <div className="dash-grid-1">
                        <ChartCard title="Software analyzer (QA checkout)" icon={<Shield size={15} />}
                            right={<span className={`badge ${errorGaps > 0 ? 'badge-error' : gaps.length > 0 ? 'badge-warning' : 'badge-un'}`}>{gaps.length} findings</span>}>
                            {gaps.length === 0 ? (
                                <div className="dash-qa-ok">
                                    <CheckCircle size={36} />
                                    <h4>All modules pass the checks</h4>
                                    <p>No software anomalies or unmapped I/O in the assembly.</p>
                                </div>
                            ) : (
                                <div className="dash-qa-list">
                                    {gaps.slice(0, 40).map((g, i) => {
                                        const color = g.level === 'error' ? 'var(--red)' : g.level === 'warning' ? 'var(--orange)' : 'var(--sky)';
                                        const Icon = g.level === 'error' ? AlertCircle : g.level === 'warning' ? AlertTriangle : Info;
                                        return (
                                            <div className="dash-qa-item" key={i} style={{ borderLeftColor: color }}>
                                                <Icon size={14} style={{ color, flexShrink: 0, marginTop: 1 }} />
                                                <div style={{ minWidth: 0 }}>
                                                    <div className="dash-qa-msg">{g.message}</div>
                                                    <div className="dash-qa-mod">{g.module}</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </ChartCard>
                    </div>
                </>
            )}
        </div>
    );
};

export default DashboardPage;
