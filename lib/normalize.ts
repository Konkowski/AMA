// ============================================================
// AMA — Project data normalization
// Every byte that enters the store from outside (opened JSON,
// Git ZIP import, autosave recovery) passes through here: shapes
// are guaranteed, missing fields get safe defaults, broken rows
// are dropped instead of crashing pages later. This is also the
// single place where old file formats get migrated forward.
// ============================================================
import type {
    AssemblyProject, AssemblyNode, BlockBase, EntityLevel,
    FunctionBlock, Unit, EquipmentModule, ControlModule,
} from '../types/machine';
import { generateId } from './helpers';

/** Bump when the saved-file shape changes and add a migration below. */
export const PROJECT_SCHEMA_VERSION = 1;

export interface NormalizedProject {
    library: FunctionBlock[];
    units: Unit[];
    equipmentModules: EquipmentModule[];
    controlModules: ControlModule[];
    assembly: AssemblyProject;
}

const DEFAULT_DEV_TIMES = { plcHours: 0, hmiHours: 0, commissioningHours: 0 };

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown, fallback = ''): string =>
    typeof v === 'string' ? v : (v === null || v === undefined ? fallback : String(v));

/** Rows of sub-lists (variables, alarms…) must at least carry an id. */
function withIds(list: any[]): any[] {
    return list
        .filter(x => x && typeof x === 'object')
        .map(x => (x.id ? x : { ...x, id: generateId() }));
}

// Saved projects from before the English UI carry Italian enum values
const LEGACY_DATATYPE: Record<string, string> = { Sistema: 'System', Altro: 'Other' };
const LEGACY_STATUS: Record<string, string> = { 'Da Fare': 'To Do', 'In Corso': 'In Progress', Implementato: 'Implemented', Verificato: 'Verified' };
const migrateRows = (rows: any[], key: string, map: Record<string, string>): any[] =>
    rows.map(r => (r && map[r[key]] ? { ...r, [key]: map[r[key]] } : r));

function normalizeEntity(raw: any, level: EntityLevel): BlockBase | null {
    if (!raw || typeof raw !== 'object') return null;
    const e: any = {
        ...raw,
        id: asString(raw.id) || generateId(),
        name: asString(raw.name, 'Unnamed'),
        description: asString(raw.description),
        category: raw.category || 'Other',
        level,
        variables: migrateRows(withIds(asArray(raw.variables)), 'dataType', LEGACY_DATATYPE),
        alarms: withIds(asArray(raw.alarms)),
        io: migrateRows(withIds(asArray(raw.io)), 'dataType', LEGACY_DATATYPE),
        dfmea: migrateRows(withIds(asArray(raw.dfmea)), 'status', LEGACY_STATUS),
        revisions: asArray(raw.revisions).filter(r => r && typeof r === 'object'),
        code: asString(raw.code),
        currentVersion: asString(raw.currentVersion, '1.0'),
        lastModifiedBy: asString(raw.lastModifiedBy),
        status: raw.status || 'Draft',
    };
    if (raw.bom !== undefined) e.bom = withIds(asArray(raw.bom));
    // structural levels carry assignments / checklist / dev times
    if (level !== 'FB') {
        e.assignedFBs = asArray(raw.assignedFBs).filter(x => typeof x === 'string');
        e.checklist = withIds(asArray(raw.checklist));
        e.devTimes = { ...DEFAULT_DEV_TIMES, ...(raw.devTimes || {}) };
    }
    if (level === 'UN') e.assignedEMs = asArray(raw.assignedEMs).filter(x => typeof x === 'string');
    if (level === 'EM') e.assignedCMs = asArray(raw.assignedCMs).filter(x => typeof x === 'string');
    return e as BlockBase;
}

function normalizeEntityList<T extends BlockBase>(raw: unknown, level: EntityLevel): T[] {
    return asArray(raw)
        .map(e => normalizeEntity(e, level))
        .filter((e): e is T => e !== null);
}

function normalizeTree(raw: unknown): AssemblyNode[] {
    return asArray(raw)
        .filter(n => n && typeof n === 'object' && n.refId)
        .map((n: any) => ({
            id: asString(n.id) || generateId(),
            refId: asString(n.refId),
            level: (n.level || 'UN') as EntityLevel,
            children: normalizeTree(n.children),
            ...(typeof n.label === 'string' && n.label ? { label: n.label } : {}),
            ...(Array.isArray(n.params) && n.params.length ? { params: withIds(n.params) } : {}),
            ...(n.componentChoice && typeof n.componentChoice === 'object' && Object.keys(n.componentChoice).length ? { componentChoice: n.componentChoice } : {}),
        }));
}

/** A fresh, valid, empty assembly. The only factory for it in the app. */
export function emptyAssembly(name = 'No Project', description = 'Empty workspace. Create or import a project to begin.'): AssemblyProject {
    return {
        id: generateId(),
        name,
        description,
        secondaryDescription: '',
        version: '1.0.0',
        tree: [],
        sbom: [],
        networkNodes: [],
        networkEdges: [],
    };
}

export function normalizeAssembly(raw: any): AssemblyProject {
    if (!raw || typeof raw !== 'object') return emptyAssembly();
    return {
        id: asString(raw.id) || generateId(),
        name: asString(raw.name, 'Project'),
        description: asString(raw.description),
        secondaryDescription: asString(raw.secondaryDescription),
        version: asString(raw.version, '1.0.0'),
        tree: normalizeTree(raw.tree),
        sbom: withIds(asArray(raw.sbom)),
        sbomRemoved: asArray(raw.sbomRemoved).filter((r: any) => r && typeof r.partId === 'string').map((r: any) => ({ partId: r.partId, label: asString(r.label, r.partId) })),
        networkNodes: asArray(raw.networkNodes).filter(n => n && typeof n === 'object'),
        networkEdges: asArray(raw.networkEdges).filter(e => e && typeof e === 'object'),
    };
}

/** Normalize only the four entity lists (architecture import keeps the assembly). */
export function normalizeEntityListsOnly(data: any): Omit<NormalizedProject, 'assembly'> {
    const d = (data && typeof data === 'object') ? data : {};
    return {
        library: normalizeEntityList<FunctionBlock>(d.library, 'FB'),
        units: normalizeEntityList<Unit>(d.units, 'UN'),
        equipmentModules: normalizeEntityList<EquipmentModule>(d.equipmentModules, 'EM'),
        controlModules: normalizeEntityList<ControlModule>(d.controlModules, 'CM'),
    };
}

/**
 * Normalize (and migrate) any project-shaped payload. Never throws on
 * malformed content — the worst case is an empty, valid workspace.
 * `data.schemaVersion` is reserved for future format migrations.
 */
export function normalizeProjectData(data: any): NormalizedProject {
    const d = (data && typeof data === 'object') ? data : {};
    // schemaVersion migrations go here, oldest first:
    // if ((d.schemaVersion ?? 0) < 1) { ...mutate d to the v1 shape... }
    return {
        library: normalizeEntityList<FunctionBlock>(d.library, 'FB'),
        units: normalizeEntityList<Unit>(d.units, 'UN'),
        equipmentModules: normalizeEntityList<EquipmentModule>(d.equipmentModules, 'EM'),
        controlModules: normalizeEntityList<ControlModule>(d.controlModules, 'CM'),
        assembly: normalizeAssembly(d.assembly),
    };
}
