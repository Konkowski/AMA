// ============================================================
// AMA — Pre-flight Project Validation
// Checks the assembled machine (or the whole DB when the
// assembly tree is empty) for issues that degrade the quality
// of exports and generated PLC code.
// ============================================================
import type {
    AssemblyProject, AssemblyNode, BlockBase, EntityLevel, CodebaseInfo,
} from '../types/machine';
import type { EntityDB } from './helpers';
import { findEntityById } from './helpers';
import { isAdjusted, isMachineOnly } from './deviation';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
    severity: IssueSeverity;
    category: string;
    entityName?: string;
    entityLevel?: EntityLevel | string;
    message: string;
}

export interface ValidationReport {
    issues: ValidationIssue[];
    errors: number;
    warnings: number;
    infos: number;
    scope: 'assembly' | 'full-database';
    checkedEntities: number;
}

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidIp(ip: string): boolean {
    const m = ip.match(IP_RE);
    if (!m) return false;
    return m.slice(1).every(part => Number(part) <= 255);
}

function collectRefIds(tree: AssemblyNode[]): Set<string> {
    const ids = new Set<string>();
    const walk = (nodes: AssemblyNode[]) => {
        for (const n of nodes) { ids.add(n.refId); walk(n.children); }
    };
    walk(tree);
    return ids;
}

export function validateProject(assembly: AssemblyProject, db: EntityDB, opts: { requireReleased?: boolean; codebase?: CodebaseInfo | null } = {}): ValidationReport {
    const issues: ValidationIssue[] = [];
    const add = (severity: IssueSeverity, category: string, message: string, entity?: BlockBase) => {
        issues.push({
            severity, category, message,
            entityName: entity?.name, entityLevel: entity?.level,
        });
    };

    const usedIds = collectRefIds(assembly.tree);
    const scoped = usedIds.size > 0;
    const allEntities: BlockBase[] = [
        ...db.units, ...db.equipmentModules, ...db.controlModules, ...db.library,
    ];
    const entities = scoped ? allEntities.filter(e => usedIds.has(e.id)) : allEntities;

    // ── Dangling references ──────────────────────────────
    const walkTree = (nodes: AssemblyNode[]) => {
        for (const n of nodes) {
            if (!findEntityById(db, n.refId)) {
                add('error', 'Assembly',
                    `Assembly node [${n.level}] references a non-existent entity (id ${n.refId}). Remove it from the tree.`);
            }
            walkTree(n.children);
        }
    };
    walkTree(assembly.tree);

    // Traceability: which code base (and which commit) is this machine made from?
    if (opts.codebase === null) {
        add('warning', 'Code base', 'No code base is linked: this machine cannot be rebuilt from a known, released version of the blocks.');
    } else if (opts.codebase) {
        const cb = opts.codebase;
        if (!cb.commit) add('info', 'Code base', `Code base "${cb.name}" v${cb.version} was linked without a Git commit: commit it in the Release step so the machine points to an exact version.`);
        for (const e of entities) {
            if (isMachineOnly(e)) add('info', 'Code base', `${e.name} exists only on this machine (not in the code base).`, e);
            else if (isAdjusted(e)) add('info', 'Code base', `${e.name} was adjusted for this machine: it differs from the code base.`, e);
        }
        if (cb.dirty) add('warning', 'Code base', `Code base "${cb.name}" had uncommitted changes when it was linked: the machine may not match any commit.`);
    }

    // A machine that follows a code base may only use Released blocks
    if (opts.requireReleased) {
        for (const e of entities) {
            if (e.status !== 'Released') {
                add('warning', 'Code base', `${e.name} is ${e.status || 'Draft'}, not Released: release it in the code base before exporting.`, e);
            }
        }
    }

    for (const e of allEntities) {
        const refs: { label: string; ids: string[] }[] = [];
        if ('assignedFBs' in e) refs.push({ label: 'FB', ids: (e as any).assignedFBs || [] });
        if ('assignedEMs' in e) refs.push({ label: 'EM', ids: (e as any).assignedEMs || [] });
        if ('assignedCMs' in e) refs.push({ label: 'CM', ids: (e as any).assignedCMs || [] });
        for (const r of refs) {
            for (const refId of r.ids) {
                if (!findEntityById(db, refId)) {
                    add('warning', 'Architecture',
                        `Reference to a ${r.label} deleted (id ${refId}). Remove the assignment.`, e);
                }
            }
        }
    }

    // ── Per-entity checks ────────────────────────────────
    const machineIoAddresses = new Map<string, string>(); // address -> owner name
    const machineAlarmIds = new Map<string, string>();    // alarmId -> owner name

    for (const e of entities) {
        // Duplicate variable names within the entity
        const seenVars = new Set<string>();
        for (const v of e.variables || []) {
            const key = (v.name || '').trim().toLowerCase();
            if (!key) {
                add('warning', 'Variables', `Variable without a name.`, e);
                continue;
            }
            if (seenVars.has(key)) add('error', 'Variables', `Duplicate variable name: "${v.name}".`, e);
            seenVars.add(key);
        }

        // Alarms: trigger variable must exist among the entity's variables
        for (const a of e.alarms || []) {
            const trig = (a.triggerVariable || '').trim();
            if (!trig) {
                add('warning', 'Alarms', `Alarm ${a.alarmId || a.message} has no trigger variable.`, e);
            } else if (!seenVars.has(trig.toLowerCase())) {
                add('warning', 'Alarms',
                    `Alarm ${a.alarmId || ''} uses the trigger variable "${trig}" which does not exist among the entity variables.`, e);
            }
            const aid = (a.alarmId || '').trim();
            if (aid) {
                const prevOwner = machineAlarmIds.get(aid);
                if (prevOwner && prevOwner !== e.name) {
                    add('warning', 'Alarms', `Alarm ID "${aid}" duplicated (already used in ${prevOwner}).`, e);
                } else {
                    machineAlarmIds.set(aid, e.name);
                }
            }
        }

        // I/O: addresses present and unique across the machine
        for (const io of e.io || []) {
            const addr = (io.address || '').trim();
            if (!addr) {
                add('warning', 'I/O', `Signal ${io.signalId || io.variable || '?'} has no address.`, e);
                continue;
            }
            const prevOwner = machineIoAddresses.get(addr.toUpperCase());
            if (prevOwner) {
                add('error', 'I/O', `I/O address "${addr}" duplicated (already used in ${prevOwner}).`, e);
            } else {
                machineIoAddresses.set(addr.toUpperCase(), e.name);
            }
        }

        // DFMEA: high risk left unaddressed
        for (const d of e.dfmea || []) {
            const rpn = d.rpn || (d.severity * d.occurrence * d.detection);
            if (rpn >= 100 && d.status === 'To Do') {
                add('warning', 'DFMEA', `Failure mode "${d.failureMode}" with RPN ${rpn} still "To Do".`, e);
            }
        }

        // Empty shells
        if ((e.variables || []).length === 0 && !(e.code || '').trim()) {
            add('info', 'Completeness', `No variables and no code defined.`, e);
        }
    }

    // ── SBOM checks ──────────────────────────────────────
    const sbomIps = new Map<string, string>();
    const sbomMacs = new Map<string, string>();
    for (const hw of assembly.sbom || []) {
        const ip = (hw.ipAddress || '').trim();
        if (ip) {
            if (!isValidIp(ip)) {
                add('warning', 'SBOM', `"${hw.hardware}": invalid IP address (${ip}).`);
            } else if (sbomIps.has(ip)) {
                add('error', 'SBOM', `IP address ${ip} duplicated between "${sbomIps.get(ip)}" e "${hw.hardware}".`);
            } else {
                sbomIps.set(ip, hw.hardware);
            }
        }
        const mac = (hw.macAddress || '').trim().toUpperCase();
        if (mac) {
            if (sbomMacs.has(mac)) {
                add('warning', 'SBOM', `MAC address ${mac} duplicated between "${sbomMacs.get(mac)}" e "${hw.hardware}".`);
            } else {
                sbomMacs.set(mac, hw.hardware);
            }
        }
    }

    // ── Network topology checks ──────────────────────────
    const nodes = assembly.networkNodes || [];
    const nodeIds = new Set(nodes.map((n: any) => n.id));
    const sbomIds = new Set((assembly.sbom || []).map(h => h.id));
    for (const n of nodes) {
        if (n.sbomId && !sbomIds.has(n.sbomId)) {
            add('warning', 'Network', `Network device "${n.label || n.id}" references a deleted SBOM component.`);
        }
    }
    for (const edge of assembly.networkEdges || []) {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
            add('warning', 'Network', `A network connection references a deleted device.`);
        }
    }

    return {
        issues,
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        infos: issues.filter(i => i.severity === 'info').length,
        scope: scoped ? 'assembly' : 'full-database',
        checkedEntities: entities.length,
    };
}
