// ============================================================
// AMA — Architecture / Library Comparison
// Compares the current workspace against another project or
// master-library file (JSON or Git ZIP): finds entities that
// exist only on one side and entities that diverged (version,
// variables, alarms, I/O, DFMEA, BOM, code).
// Inspired by FactoryTalk Design Studio's shared-library
// standardization workflow.
// ============================================================
import type { BlockBase } from '../types/machine';
import type { EntityDB } from './helpers';

export interface EntityDiff {
    name: string;
    level: string;
    status: 'solo-corrente' | 'solo-file' | 'modificata';
    notes: string[];
}

export interface CompareReport {
    diffs: EntityDiff[];
    identical: number;
    totalCurrent: number;
    totalOther: number;
}

const flat = (db: Partial<EntityDB>): BlockBase[] => [
    ...(db.units || []), ...(db.equipmentModules || []),
    ...(db.controlModules || []), ...(db.library || []),
];

const keyOf = (e: BlockBase) => `${e.level}|${e.name.trim().toLowerCase()}`;

function diffEntity(cur: BlockBase, oth: BlockBase): string[] {
    const notes: string[] = [];
    if ((cur.currentVersion || '') !== (oth.currentVersion || '')) {
        notes.push(`version: v${cur.currentVersion} (current) ↔ v${oth.currentVersion} (file)`);
    }
    const count = (label: string, a?: any[], b?: any[]) => {
        const na = (a || []).length, nb = (b || []).length;
        if (na !== nb) notes.push(`${label}: ${na} ↔ ${nb}`);
    };
    count('variables', cur.variables, oth.variables);
    count('alarms', cur.alarms, oth.alarms);
    count('I/O signals', cur.io, oth.io);
    count('DFMEA', cur.dfmea, oth.dfmea);
    count('bill of materials (BOM)', (cur as any).bom, (oth as any).bom);
    const codeA = (cur.code || '').trim(), codeB = (oth.code || '').trim();
    if (codeA !== codeB) {
        notes.push(`changed code (${codeA.split('\n').length} ↔ ${codeB.split('\n').length} lines)`);
    }
    if ((cur.description || '').trim() !== (oth.description || '').trim()) {
        notes.push('different description');
    }
    return notes;
}

export function compareArchitectures(current: Partial<EntityDB>, other: Partial<EntityDB>): CompareReport {
    const curList = flat(current);
    const othList = flat(other);
    const othByKey = new Map(othList.map(e => [keyOf(e), e]));
    const curKeys = new Set(curList.map(keyOf));

    const diffs: EntityDiff[] = [];
    let identical = 0;

    for (const cur of curList) {
        const oth = othByKey.get(keyOf(cur));
        if (!oth) {
            diffs.push({ name: cur.name, level: cur.level, status: 'solo-corrente', notes: [] });
            continue;
        }
        const notes = diffEntity(cur, oth);
        if (notes.length === 0) identical++;
        else diffs.push({ name: cur.name, level: cur.level, status: 'modificata', notes });
    }
    for (const oth of othList) {
        if (!curKeys.has(keyOf(oth))) {
            diffs.push({ name: oth.name, level: oth.level, status: 'solo-file', notes: [] });
        }
    }

    const order = { 'modificata': 0, 'solo-corrente': 1, 'solo-file': 2 } as const;
    diffs.sort((a, b) => order[a.status] - order[b.status] || a.level.localeCompare(b.level) || a.name.localeCompare(b.name));

    return { diffs, identical, totalCurrent: curList.length, totalOther: othList.length };
}
