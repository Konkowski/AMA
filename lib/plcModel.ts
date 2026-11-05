// ============================================================
// AMA — Shared PLC model (blocks, UDTs, call hierarchy, devices)
//
// Deterministic, READ-ONLY view of the AMA model used by the
// Siemens TIA Portal exporter. Never mutates the project.
// ============================================================
import type { AssemblyProject, AssemblyNode, BlockBase, Variable } from '../types/machine';
import type { EntityDB } from './helpers';
import { generateFDS } from './helpers';
export interface FileMap { [path: string]: string; }

// ─── Low-level helpers ──────────────────────────────────────
const xmlEsc = (s: any): string => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Keep a name readable but safe for XML attributes / identifiers. */
const safeName = (s: string): string => String(s ?? '').trim() || 'Unnamed';

/** RFC 4180 CSV field: quote everything, double inner quotes. */
const csv = (v: any): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** First line of a (possibly multi-line) string, collapsed and trimmed. */
const firstLine = (s: string, max = 160): string => {
    const t = String(s ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// ─── Type system (AMA -> Siemens SCL casing) ────────────────
const BUILTINS = new Set([
    'BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD', 'SINT', 'USINT', 'INT', 'UINT',
    'DINT', 'UDINT', 'LINT', 'ULINT', 'REAL', 'LREAL', 'TIME', 'LTIME',
    'DATE', 'TOD', 'DT', 'STRING', 'WSTRING', 'CHAR', 'WCHAR',
    'TIMER', 'COUNTER', 'MODULE', 'FBD_TIMER', 'MOTION_INSTRUCTION',
    // Siemens system types — never emitted as user UDTs
    'TO_POSITIONINGAXIS', 'TO_EXTERNALENCODER', 'TO_SYNCHRONOUSAXIS', 'TO_SPEEDAXIS',
    'HW_DEVICE', 'HW_IO', 'HW_ANY', 'TON_TIME', 'TOF_TIME',
]);

const SIEMENS_CASE: Record<string, string> = {
    BOOL: 'Bool', BYTE: 'Byte', WORD: 'Word', DWORD: 'DWord', LWORD: 'LWord',
    SINT: 'SInt', USINT: 'USInt', INT: 'Int', UINT: 'UInt', DINT: 'DInt',
    UDINT: 'UDInt', LINT: 'LInt', ULINT: 'ULInt', REAL: 'Real', LREAL: 'LReal',
    TIME: 'Time', STRING: 'String', CHAR: 'Char',
};

const siemensCase = (t: string): string => SIEMENS_CASE[t.toUpperCase()] || t;

/** True for module-defined I/O connection types like "AB:Drive:I:0". */
const isModuleDefined = (raw: string): boolean => /:/.test(String(raw || ''));

/** Map an AMA variable to the Siemens type string used in the skeleton. */
function typeOf(v: Variable): string {
    switch (v.dataType) {
        case 'ARRAY OF':
            return v.customDataType || 'Array[0..9] of Bool';
        case 'Union OF':
        case 'System':
        case 'Other': {
            const raw = (v.customDataType || 'DInt').trim();
            if (isModuleDefined(raw)) return raw;            // keep verbatim as a structural note
            return BUILTINS.has(raw.toUpperCase()) ? siemensCase(raw) : safeName(raw);
        }
        default:
            return siemensCase(v.dataType);
    }
}

// ─── Deterministic model assembly ───────────────────────────
export interface Member { id: string; name: string; type: string; scope: string; description: string }
export interface Block {
    id: string; name: string; type: 'OB' | 'FB'; lang: string;
    level: string;                      // OB | UN | EM | CM | FB
    folder: string;                     // deterministic program-folder name
    entity: BlockBase | null;
    in: Member[]; out: Member[]; inout: Member[]; static: Member[];
    behavior: string;
}
export interface Folder { id: string; name: string; blocks: Block[] }
export interface Udt { id: string; name: string; members: { id: string; name: string; type: string }[] }
export interface Call { id: string; fromId: string; toId: string; fromName: string; toName: string }
export interface Model {
    project: { id: string; name: string; version: string; description: string };
    udts: Udt[];
    blocks: Block[];
    folders: Folder[];
    calls: Call[];
    db: EntityDB;
    assembly: AssemblyProject;
    scoped: boolean;
}

// Deterministic program-folder per ISA-88 level: the generated TIA project
// groups blocks (and their instance DBs / local variables) by these folders.
const FOLDER_OF: Record<string, string> = {
    OB: '01_Main', UN: '02_Units', EM: '03_EquipmentModules',
    CM: '04_ControlModules', FB: '05_Library',
};
const FOLDER_ORDER = ['01_Main', '02_Units', '03_EquipmentModules', '04_ControlModules', '05_Library'];

/** Assembled entity ids in first-seen depth-first order (deterministic). */
function orderedRefIds(tree: AssemblyNode[]): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    const walk = (nodes: AssemblyNode[]) => {
        for (const n of nodes) {
            if (!seen.has(n.refId)) { seen.add(n.refId); order.push(n.refId); }
            walk(n.children);
        }
    };
    walk(tree);
    return order;
}

export function buildModel(assembly: AssemblyProject, db: EntityDB): Model {
    const findEntity = (id: string): BlockBase | null =>
        db.units.find(e => e.id === id) || db.equipmentModules.find(e => e.id === id)
        || db.controlModules.find(e => e.id === id) || db.library.find(e => e.id === id) || null;

    // Scope to the assembled machine, exactly like the L5X exporter; when the
    // tree is empty, fall back to the whole database (still deterministic).
    const treeOrder = orderedRefIds(assembly.tree);
    const scoped = treeOrder.length > 0;

    const orderedEntities: BlockBase[] = [];
    const pushed = new Set<string>();
    const pushEntity = (e: BlockBase | null) => {
        if (e && !pushed.has(e.id)) { pushed.add(e.id); orderedEntities.push(e); }
    };

    if (scoped) {
        // UN/EM/CM in tree order first…
        for (const id of treeOrder) pushEntity(findEntity(id));
        // …then the FBs they reference (assignedFBs), in that same order.
        for (const e of [...orderedEntities]) {
            for (const fbId of (e as any).assignedFBs || []) pushEntity(findEntity(fbId));
        }
    } else {
        for (const e of [...db.units, ...db.equipmentModules, ...db.controlModules, ...db.library]) pushEntity(e);
    }

    // Pull in library FBs referenced only as a member TYPE (FB instances, e.g.
    // a Static member typed "EthernetConnectionCtrl"), so those types resolve
    // to real blocks instead of bogus UDT stubs.
    const libByName = new Map(db.library.map(fb => [safeName(fb.name).toUpperCase(), fb] as const));
    for (const e of [...orderedEntities]) {
        for (const v of e.variables || []) {
            const fb = libByName.get(typeOf(v).toUpperCase());
            if (fb) pushEntity(fb);
        }
    }

    const entityIdToBlockId = new Map<string, string>();
    const blockName = (e: BlockBase) => safeName(e.name);
    const entityNames = new Set(orderedEntities.map(e => blockName(e).toUpperCase()));

    // ── Blocks ──────────────────────────────────────────────
    // A synthesized OB "Main" is the cyclic entry point; every AMA entity
    // (UN/EM/CM/FB) becomes an FB written in SCL.
    const blocks: Block[] = [];
    let blockIdx = 0;
    const nextBlockId = () => `B${pad2(++blockIdx)}`;

    const ob: Block = {
        id: nextBlockId(), name: 'Main', type: 'OB', lang: 'SCL', entity: null,
        level: 'OB', folder: FOLDER_OF.OB,
        in: [], out: [], inout: [], static: [],
        behavior: 'Cyclic entry point (OB1). Calls the machine\'s top-level Units.',
    };
    blocks.push(ob);

    const memberOf = (v: Variable, id: string, scope: string): Member => ({
        id, name: safeName(v.name), type: typeOf(v), scope, description: v.description || '',
    });

    for (const e of orderedEntities) {
        const bId = nextBlockId();
        entityIdToBlockId.set(e.id, bId);
        const blk: Block = {
            id: bId, name: blockName(e), type: 'FB', lang: 'SCL', entity: e,
            level: e.level, folder: FOLDER_OF[e.level] || FOLDER_OF.FB,
            in: [], out: [], inout: [], static: [], behavior: firstLine(e.description || '', 200),
        };
        // Interface member ids: In/Out/InOut share an I-sequence; Static uses S.
        let iSeq = 0, sSeq = 0;
        for (const v of e.variables || []) {
            if (v.scope === 'Input') blk.in.push(memberOf(v, `${bId}I${pad2(++iSeq)}`, 'In'));
            else if (v.scope === 'Output') blk.out.push(memberOf(v, `${bId}I${pad2(++iSeq)}`, 'Out'));
            else if (v.scope === 'InOut') blk.inout.push(memberOf(v, `${bId}I${pad2(++iSeq)}`, 'InOut'));
            else blk.static.push(memberOf(v, `${bId}S${pad2(++sSeq)}`, 'Static'));   // Local -> Static
        }
        blocks.push(blk);
    }

    // ── Call hierarchy (deterministic, de-duplicated) ───────
    const calls: Call[] = [];
    let callIdx = 0;
    const seenCall = new Set<string>();
    const addCall = (fromId: string, fromName: string, toId: string, toName: string) => {
        const key = `${fromId}->${toId}`;
        if (seenCall.has(key)) return;
        seenCall.add(key);
        calls.push({ id: `C${pad2(++callIdx)}`, fromId, fromName, toId, toName });
    };

    // OB -> top-level Units (roots of the assembly tree)
    const rootRefIds = scoped
        ? [...new Set(assembly.tree.map(n => n.refId))]
        : db.units.map(u => u.id);
    for (const id of rootRefIds) {
        const bid = entityIdToBlockId.get(id);
        const ent = findEntity(id);
        if (bid && ent) addCall(ob.id, ob.name, bid, blockName(ent));
    }
    // Entity -> its assigned sub-modules (EM/CM/FB)
    for (const e of orderedEntities) {
        const fromId = entityIdToBlockId.get(e.id)!;
        const fromName = blockName(e);
        const subs = [
            ...((e as any).assignedEMs || []),
            ...((e as any).assignedCMs || []),
            ...((e as any).assignedFBs || []),
        ];
        for (const subId of subs) {
            const toId = entityIdToBlockId.get(subId);
            const sub = findEntity(subId);
            if (toId && sub) addCall(fromId, fromName, toId, blockName(sub));
        }
    }

    // ── UDTs (genuine user types only), members from code refs ─
    const allCode = orderedEntities.map(e => String(e.code || '')).join('\n');
    const udtNames: string[] = [];
    const udtSeen = new Set<string>();
    const considerUdt = (raw: string) => {
        const t = (raw || '').trim();
        if (!t || isModuleDefined(t) || /\[|\bARRAY\b|\bOF\b/i.test(t)) return;
        if (BUILTINS.has(t.toUpperCase())) return;
        if (entityNames.has(t.toUpperCase())) return;         // it's an FB instance, not a UDT
        if (!/^[A-Za-z_]\w*$/.test(t)) return;
        if (udtSeen.has(t)) return;
        udtSeen.add(t); udtNames.push(t);
    };
    for (const e of orderedEntities) {
        for (const v of e.variables || []) {
            if (v.dataType === 'System' || v.dataType === 'Union OF' || v.dataType === 'Other') {
                considerUdt(v.customDataType || '');
            }
        }
    }

    const memberTypeOf = (m: string): string =>
        /^STRING/i.test(m) ? 'String' : /^REAL|^LREAL/i.test(m) ? 'Real' : /^BOOL/i.test(m) ? 'Bool'
            : /^SINT/i.test(m) ? 'SInt' : /^INT/i.test(m) ? 'Int' : 'DInt';

    const udts: Udt[] = udtNames.map((name, ui) => {
        const uid = `U${pad2(ui + 1)}`;
        // Reconstruct members from "var.member" accesses in the code, where
        // var is a variable declared with this UDT type (read-only, like L5X).
        const members = new Set<string>();
        for (const e of orderedEntities) {
            for (const v of e.variables || []) {
                if (typeOf(v) !== name) continue;
                const re = new RegExp(`\\b${safeName(v.name).replace(/[^A-Za-z0-9_]/g, '_')}(?:\\[[^\\]]*\\])?\\.([A-Za-z_]\\w*)`, 'g');
                for (const m of allCode.matchAll(re)) members.add(m[1]);
            }
        }
        const sorted = [...members].sort();
        const memberList = sorted.length > 0 ? sorted : ['TODO_Define'];
        return {
            id: uid, name,
            members: memberList.map((m, mi) => ({
                id: `${uid}M${pad2(mi + 1)}`, name: m,
                type: sorted.length > 0 ? memberTypeOf(m) : 'DInt',
            })),
        };
    });

    // Folder index (F01..) in fixed order, only non-empty folders
    const folders: Folder[] = [];
    let fIdx = 0;
    for (const fname of FOLDER_ORDER) {
        const inFolder = blocks.filter(b => b.folder === fname);
        if (inFolder.length > 0) folders.push({ id: `F${pad2(++fIdx)}`, name: fname, blocks: inFolder });
    }

    return {
        project: { id: 'P01', name: safeName(assembly.name), version: assembly.version || '1.0.0', description: assembly.description || '' },
        udts, blocks, folders, calls, db, assembly, scoped,
    };
}

// ─── D. parts_list.csv ──────────────────────────────────────
/** Exact article number of a component: explicit supplierCode wins, else the
 *  code embedded in the display name "(...)"; never leave the agent guessing. */
export function orderNumberOf(h: any): string {
    if (h.supplierCode && String(h.supplierCode).trim()) return String(h.supplierCode).trim();
    const mm = String(h.hardware || '').match(/\(([^()]+)\)\s*$/);
    return mm ? mm[1] : '';
}

/** Component display name without the trailing "(order number)". */
export function componentNameOf(h: any): string {
    return String(h.hardware || '').replace(/\s*\(([^()]+)\)\s*$/, '').trim();
}

// ─── shared prompt-data helpers ─────────────────────────────
export interface Dev { name: string; model: string; mlfb: string; fw: string; ip: string }

export function sortedSbom(m: Model) {
    return [...(m.assembly.sbom || [])].sort((a, b) =>
        `${a.type || 'Hardware'}${a.hardware || ''}`.localeCompare(`${b.type || 'Hardware'}${b.hardware || ''}`));
}

// One row per PHYSICAL device with its final name: from the topology nodes
// when available (zero derivation), otherwise expanded from SBOM quantities.
export function computeDevices(m: Model, sbom: any[]): Dev[] {
    const nodes = (m.assembly.networkNodes || []) as any[];
    const sbomById = new Map(sbom.map(h => [h.id, h] as const));
    const devices: Dev[] = [];
    if (nodes.length > 0) {
        for (const n of nodes) {
            const h = n.sbomId ? sbomById.get(n.sbomId) : undefined;
            devices.push({
                name: n.label, model: h ? componentNameOf(h) : (n.label || ''),
                mlfb: h ? orderNumberOf(h) : '', fw: h ? (h.firmware || '') : '', ip: n.ip || (h ? h.ipAddress || '' : ''),
            });
        }
    } else {
        for (const h of sbom.filter((x: any) => orderNumberOf(x))) {
            const q = Math.max(1, h.quantity || 1);
            for (let i = 1; i <= q; i++) {
                devices.push({ name: `${componentNameOf(h).replace(/[^A-Za-z0-9]+/g, '_')}${q > 1 ? '_' + i : ''}`,
                               model: componentNameOf(h), mlfb: orderNumberOf(h), fw: h.firmware || '', ip: i === 1 ? h.ipAddress || '' : '' });
            }
        }
    }
    return devices;
}
