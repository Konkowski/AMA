// ============================================================
// AMA — Machine vs code base
//
// A machine takes a copy of the code base, then it is adjusted: almost
// every real machine needs changes the code base does not have. Nothing
// is ever thrown away. Each block of a machine is one of:
//
//   from the code base, unchanged   (origin 'codebase', content = baseline)
//   from the code base, adjusted    (origin 'codebase', content != baseline)  -> "deviation"
//   only on this machine            (origin 'machine')
//
// `baseline` is a fingerprint of the block as it came from the code base.
// Pure functions: no store, no UI.
// ============================================================
import type { BlockBase } from '../types/machine';
import type { EntityLists } from './codebase';

/** Bookkeeping that never counts as an adjustment. */
const IGNORED = new Set(['status', 'revisions', 'lastModifiedBy', 'origin', 'baseline']);

function canonical(v: any): any {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
        const o: Record<string, any> = {};
        for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canonical(v[k]);
        return o;
    }
    return v;
}

/** Fingerprint of a block's content (djb2 over its canonical JSON). */
export function contentHash(e: BlockBase): string {
    const body: Record<string, any> = {};
    for (const k of Object.keys(e)) if (!IGNORED.has(k)) body[k] = (e as any)[k];
    const s = JSON.stringify(canonical(body));
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16) + ':' + s.length;
}

export const isMachineOnly = (e: BlockBase): boolean => e.origin === 'machine';

/** Came from the code base but was changed on this machine. */
export const isAdjusted = (e: BlockBase): boolean => e.origin === 'codebase' && !!e.baseline && contentHash(e) !== e.baseline;

/**
 * Can it be put in the machine tree? A block taken from the code base must be Released
 * (unless this machine already adjusted it); the machine's own blocks are always allowed.
 */
export const isAssemblable = (e: BlockBase): boolean =>
    e.origin !== 'codebase' || e.status === 'Released' || isAdjusted(e);

export interface MergeSummary {
    added: number;          // new from the code base
    updated: number;        // untouched here, newer in the code base: replaced
    keptAdjusted: number;   // adjusted here: kept as is
    adjustedNewer: number;  // ... and the code base changed it too (review by hand)
    machineOnly: number;    // not in the code base: kept
}

/**
 * Brings the code base into a machine WITHOUT deleting anything the machine has.
 * Adjusted and machine-only blocks are kept; untouched copies are updated.
 */
export function mergeFromCodebase(current: EntityLists, incoming: EntityLists): { lists: EntityLists; summary: MergeSummary } {
    const summary: MergeSummary = { added: 0, updated: 0, keptAdjusted: 0, adjustedNewer: 0, machineOnly: 0 };

    const mergeList = <T extends BlockBase>(cur: T[], inc: T[]): T[] => {
        const incById = new Map(inc.map(e => [e.id, e]));
        const out: T[] = [];
        for (const e of cur) {
            const fresh = incById.get(e.id);
            if (!fresh) {
                // not in the code base (never was, or removed there): the machine keeps it as its own
                out.push({ ...e, origin: 'machine', baseline: undefined });
                summary.machineOnly++;
                continue;
            }
            incById.delete(e.id);
            const freshHash = contentHash(fresh);
            const untouched = e.origin === 'codebase' && e.baseline === contentHash(e);
            if (untouched || contentHash(e) === freshHash) {
                if (e.baseline !== freshHash) summary.updated++;
                out.push({ ...fresh, origin: 'codebase', baseline: freshHash });
            } else {
                // adjusted here (or an unlabelled copy that differs): keep it, compare to the new baseline
                out.push({ ...e, origin: 'codebase', baseline: freshHash });
                summary.keptAdjusted++;
                if (e.baseline && e.baseline !== freshHash) summary.adjustedNewer++;
            }
        }
        for (const fresh of incById.values()) {
            out.push({ ...fresh, origin: 'codebase', baseline: contentHash(fresh) });
            summary.added++;
        }
        return out;
    };

    return {
        lists: {
            library: mergeList(current.library, incoming.library),
            units: mergeList(current.units, incoming.units),
            equipmentModules: mergeList(current.equipmentModules, incoming.equipmentModules),
            controlModules: mergeList(current.controlModules, incoming.controlModules),
        },
        summary,
    };
}
