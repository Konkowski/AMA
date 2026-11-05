// ============================================================
// AMA — Release checks
// A block can only become Released when it is complete and safe to
// reuse. Errors block the release; warnings are shown but allowed.
// Pure functions: the same rules run in the Release page, the block
// editor and the tests.
// ============================================================
import type { BlockBase, EntityStatus } from '../types/machine';
import { isMitigated, RPN_ATTENTION, RPN_CRITICAL } from './dfmeaGuide';

export interface EntityLists {
    library: BlockBase[];
    units: BlockBase[];
    equipmentModules: BlockBase[];
    controlModules: BlockBase[];
}

export interface Issue { severity: 'error' | 'warning'; text: string }

const PHYSICAL: BlockBase['category'][] = ['Motion', 'Valve', 'Sensor'];

const childIds = (e: BlockBase): string[] => {
    const a = e as any;
    return [...(a.assignedFBs || []), ...(a.assignedEMs || []), ...(a.assignedCMs || [])];
};

/** Everything that stops (error) or should worry (warning) a release of this block. */
export function releaseIssues(e: BlockBase, lists: EntityLists): Issue[] {
    const out: Issue[] = [];
    const err = (text: string) => out.push({ severity: 'error', text });
    const warn = (text: string) => out.push({ severity: 'warning', text });
    const all = [...lists.library, ...lists.units, ...lists.equipmentModules, ...lists.controlModules];
    const byId = new Map(all.map(x => [x.id, x]));

    if (!(e.description || '').trim()) err('No description: say what the block does.');
    if (!(e.currentVersion || '').trim()) err('No version.');

    const kids = childIds(e).map(id => byId.get(id)).filter(Boolean) as BlockBase[];
    const hasCode = !!(e.code || '').trim();
    if ((e.level === 'CM' || e.level === 'FB') && !hasCode) err('No code.');
    if ((e.level === 'UN' || e.level === 'EM') && !hasCode && kids.length === 0) err('Empty: no code and no blocks assigned to it.');

    for (const k of kids) {
        const st: EntityStatus = k.status || 'Draft';
        if (st !== 'Released') err(`Uses ${k.level} "${k.name}" which is ${st}: release it first.`);
    }

    // DFMEA: where the Product Owner must have answered
    const dfmea = e.dfmea || [];
    for (const d of dfmea) {
        if (isMitigated(d)) continue;
        if (d.rpn >= RPN_CRITICAL) err(`DFMEA "${d.failureMode}": RPN ${d.rpn} is critical and not implemented.`);
        else if (d.rpn >= RPN_ATTENTION) warn(`DFMEA "${d.failureMode}": RPN ${d.rpn}, not implemented yet.`);
    }
    for (const d of dfmea) {
        if (d.rpn >= RPN_ATTENTION && !(e.alarms || []).some(a => a.id === d.alarmId)) {
            warn(`DFMEA "${d.failureMode}": no alarm linked to a high-RPN failure.`);
        }
        if (d.componentId && !(e.bom || []).some(p => p.id === d.componentId)) warn(`DFMEA "${d.failureMode}": linked component no longer exists.`);
    }

    // Physical blocks should describe their hardware side
    if (PHYSICAL.includes(e.category) && (e.level === 'CM' || e.level === 'FB')) {
        if (!(e.io || []).length) warn('A physical block with no I/O signals.');
        if (!(e.alarms || []).length) warn('A physical block with no alarms.');
        if (e.level === 'CM' && !(e.bom || []).length) warn('No components (BOM) registered.');
    }
    return out;
}

export const errorsOf = (issues: Issue[]): Issue[] => issues.filter(i => i.severity === 'error');

/** x.y.z -> x.y.(z+1); x.y -> x.(y+1). */
export function bumpVersion(v: string): string {
    const parts = (v || '1.0').split('.').map(n => parseInt(n, 10) || 0);
    parts[parts.length - 1]++;
    return parts.join('.');
}

/** Fields that are bookkeeping: changing only these never "modifies" a Released block. */
export const META_KEYS = new Set(['revisions', 'lastModifiedBy', 'status']);
