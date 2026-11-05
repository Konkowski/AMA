// ============================================================
// AMA — Studio 5000 L5X import
//
// Reads a controller .L5X and builds an AMA project from it:
//   Controller / program tags   -> variables, I/O signals (alias tags), alarms
//   AddOn Instructions          -> Library function blocks (+ their logic)
//   User-defined data types     -> Library entries holding the members
//   Programs + routines         -> UN / EM / CM entities (RLL and ST code)
//   I/O configuration (Modules) -> SBOM + network topology
//
// The code format matches what the L5X exporter reads back:
//   "ROUTINE <name> (RLL|ST)" sections, rung comments as "// ..." lines,
//   one neutral-text rung per line.
//
// Logix has no UN/EM/CM hierarchy. It is INFERRED from program names
// (UN_*, EM_*, CM*_*) and word overlap, and every inference is listed in
// the returned warnings so the user can review it.
// ============================================================
import type {
    FunctionBlock, Unit, EquipmentModule, ControlModule, BlockBase, Variable, Alarm,
    IOSignal, AlarmLevel, AssemblyProject, AssemblyNode, HardwareItem, DataType, SignalType,
} from '../types/machine';
import { createEmptyBlock, generateId } from './helpers';

export interface L5xImportResult {
    project: {
        library: FunctionBlock[];
        units: Unit[];
        equipmentModules: EquipmentModule[];
        controlModules: ControlModule[];
        assembly: AssemblyProject;
    };
    stats: {
        programs: number; aois: number; udts: number; tags: number;
        io: number; alarms: number; modules: number; rungs: number; stRoutines: number;
    };
    warnings: string[];
}

// ─── tiny XML helpers (work with browser DOMParser and @xmldom) ───
type El = Element;
const kids = (el: El | null | undefined, tag?: string): El[] => {
    const out: El[] = [];
    if (!el) return out;
    for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1 && (!tag || (n as El).nodeName === tag)) out.push(n as El);
    }
    return out;
};
const kid = (el: El | null | undefined, tag: string): El | null => kids(el, tag)[0] || null;
const attr = (el: El | null | undefined, name: string, fallback = ''): string => el?.getAttribute(name) ?? fallback;
const oneLine = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/** <Description> (or the first localized one) of an element. */
function descOf(el: El | null | undefined): string {
    const d = kid(el, 'Description');
    if (d) return oneLine(d.textContent);
    const loc = kid(el, 'LocalizedDescriptions');
    const first = loc ? kids(loc)[0] : null;
    return first ? oneLine(first.textContent) : '';
}

const slug = (s: string): string =>
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

// ─── type mapping Logix -> AMA ────────────────────────────────
// UDTs of Family=StringFamily (STR0016...) are plain strings in AMA
let STRING_TYPES = new Set<string>();

function mapType(dt: string, dims: string): { dataType: DataType; customDataType?: string } {
    const up = dt.toUpperCase();
    const count = dims ? dims.split(',').reduce((a, d) => a * (parseInt(d, 10) || 1), 1) : 0;
    if (count > 0) return { dataType: 'ARRAY OF', customDataType: `ARRAY[0..${count - 1}] OF ${dt}` };
    if (STRING_TYPES.has(dt)) return { dataType: 'STRING' };
    switch (up) {
        case 'BOOL': return { dataType: 'BOOL' };
        case 'SINT': case 'INT': return { dataType: 'INT' };
        case 'DINT': case 'LINT': return { dataType: 'DINT' };
        case 'REAL': return { dataType: 'REAL' };
        case 'LREAL': return { dataType: 'LREAL' };
        case 'STRING': return { dataType: 'STRING' };
        default: return { dataType: 'Other', customDataType: dt };
    }
}

// ─── routines -> AMA code text ────────────────────────────────
interface RoutineText { name: string; type: string; text: string; rungs: number }

function readRoutine(r: El, warnings: string[], owner: string): RoutineText {
    const name = attr(r, 'Name');
    const type = attr(r, 'Type', 'RLL').toUpperCase();
    const lines: string[] = [];
    let rungs = 0;
    if (type === 'RLL') {
        const rll = kid(r, 'RLLContent');
        for (const rung of kids(rll, 'Rung')) {
            const c = kid(rung, 'Comment') || kid(kid(rung, 'LocalizedComments'), 'LocalizedComment');
            if (c) for (const l of String(c.textContent || '').split(/\r?\n/)) if (l.trim()) lines.push('// ' + l.trim());
            const t = oneLine(kid(rung, 'Text')?.textContent);
            if (t) { lines.push(t.endsWith(';') ? t : t + ';'); rungs++; }
        }
        return { name, type, text: `ROUTINE ${name} (RLL)\n${lines.join('\n')}`, rungs };
    }
    if (type === 'ST') {
        const st = kid(r, 'STContent');
        const ls = kids(st, 'Line').sort((a, b) => parseInt(attr(a, 'Number', '0'), 10) - parseInt(attr(b, 'Number', '0'), 10));
        for (const l of ls) lines.push(String(l.textContent ?? '').replace(/\s+$/, ''));
        return { name, type, text: `ROUTINE ${name} (ST)\n${lines.join('\n')}`, rungs: 0 };
    }
    warnings.push(`${owner}: routine "${name}" of type ${type} cannot be imported (RLL and ST only): left as a comment.`);
    return { name, type, text: `// ROUTINE ${name} (${type}) - type not imported from Studio 5000`, rungs: 0 };
}

// ─── tags -> variables / io / alarms ──────────────────────────
const ALARM_RE = /^(alm|alarm|al|wrn|warn|warning|flt|fault|err|error)[_\d]/i;
const levelOf = (n: string): AlarmLevel =>
    /safety|estop|e_stop|emerg/i.test(n) ? 'Safety'
        : /^(wrn|warn)/i.test(n) ? 'Warning'
            : /^(flt|fault|err)/i.test(n) ? 'Fault' : 'Alarm';

interface Parts { variables: Variable[]; io: IOSignal[]; alarms: Alarm[] }
const newParts = (): Parts => ({ variables: [], io: [], alarms: [] });

function ioSignalOf(name: string, aliasFor: string, description: string): IOSignal | null {
    const m = aliasFor.match(/:(I|O)(\.|$)/);
    if (!m) return null;
    const input = m[1] === 'I';
    const isBit = /\.\d+$/.test(aliasFor) || /\.Pt\d+/i.test(aliasFor);
    const signalType: SignalType = isBit ? (input ? 'DI' : 'DO') : (input ? 'AI' : 'AO');
    return {
        id: generateId(), signalId: name, signalType, address: aliasFor, variable: name,
        description, dataType: isBit ? 'BOOL' : 'DINT',
    };
}

function addTags(tags: El[], into: Parts): void {
    for (const t of tags) {
        const name = attr(t, 'Name');
        if (!name) continue;
        const tagType = attr(t, 'TagType', 'Base');
        const dt = attr(t, 'DataType');
        const dims = attr(t, 'Dimensions');
        const description = descOf(t);
        if (tagType === 'Alias') {
            const io = ioSignalOf(name, attr(t, 'AliasFor'), description);
            if (io) { into.io.push(io); continue; }
        }
        const mapped = mapType(dt || (tagType === "Alias" ? "BOOL" : "DINT"), dims);
        const v: Variable = {
            id: generateId(), name, description: description || (tagType === "Alias" ? `Alias of ${attr(t, "AliasFor")}` : ""),
            dataType: mapped.dataType, scope: "Local",
        };
        if (mapped.customDataType) v.customDataType = mapped.customDataType;
        into.variables.push(v);
        if (dt.toUpperCase() === 'BOOL' && !dims && ALARM_RE.test(name)) {
            into.alarms.push({
                id: generateId(), alarmId: name, message: description || name, level: levelOf(name),
                triggerVariable: name, action: 'Log', linkedModules: [],
            });
        }
    }
}

// ─── hierarchy heuristics ─────────────────────────────────────
const prefixLevel = (n: string): 'UN' | 'EM' | 'CM' | null =>
    /^UN[_\d]/i.test(n) ? 'UN' : /^EM[_\d]/i.test(n) ? 'EM' : /^CM[_\d]/i.test(n) ? 'CM' : null;

const tokensOf = (n: string): Set<string> => new Set(
    n.replace(/^(UN|EM|CM)\d*_?/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
        .split(/[^a-z0-9]+/).filter(t => t.length >= 3));

function bestMatch<T>(name: string, cands: T[], nameOf: (c: T) => string): T | null {
    const mine = tokensOf(name);
    let best: T | null = null, bestScore = 0;
    for (const c of cands) {
        let s = 0;
        for (const t of tokensOf(nameOf(c))) if (mine.has(t)) s++;
        if (s > bestScore) { best = c; bestScore = s; }
    }
    return best;
}

// ─── hardware ─────────────────────────────────────────────────
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Human product name from a catalog number (the module's own description is
 *  usually the motor/device name, not the hardware). */
function productOf(catalog: string, moduleName: string): { vendor: string; name: string } {
    const AB = 'Allen-Bradley ';
    const rules: [RegExp, string, string][] = [
        [/^25B-/i, 'PowerFlex 525 AC drive', AB],
        [/^2198-C/i, 'Kinetix 5100 servo drive', AB],
        [/^2198-/i, 'Kinetix 5500 servo drive', AB],
        [/^1734-AENTR/i, 'Point I/O EtherNet/IP adapter', AB],
        [/^1734-I[ER]/i, 'Point I/O analog input', AB],
        [/^1734-IE/i, 'Point I/O analog input', AB],
        [/^1734-O[VE]/i, 'Point I/O analog output', AB],
        [/^1734-I/i, 'Point I/O digital input', AB],
        [/^1734-O/i, 'Point I/O digital output', AB],
        [/^1769-I[RT]/i, 'Compact I/O analog input', AB],
        [/^1769-I/i, 'Compact I/O digital input', AB],
        [/^1769-O[VF]/i, 'Compact I/O analog output', AB],
        [/^1769-O/i, 'Compact I/O digital output', AB],
        [/^1783-/i, 'Stratix managed switch', AB],
        [/^2711P-/i, 'PanelView Plus HMI', AB],
        [/PowerFlex 525/i, 'PowerFlex 525 AC drive', AB],
        [/^EX260/i, 'EX260 EtherNet/IP valve manifold', 'SMC '],
        [/^ETHERNET-MODULE$/i, `Generic EtherNet/IP device ${moduleName}`, ''],
    ];
    for (const [re, name, vendor] of rules) if (re.test(catalog)) return { vendor, name };
    return { vendor: '', name: `Module ${moduleName}` };
}

function importHardware(ctrl: El, ctrlName: string, warnings: string[]): {
    sbom: HardwareItem[]; nodes: any[]; edges: any[]; count: number;
} {
    const mods = kids(kid(ctrl, 'Modules'), 'Module');
    const procType = attr(ctrl, 'ProcessorType');
    const fw = `v${attr(ctrl, 'MajorRev')}.${String(attr(ctrl, 'MinorRev', '0')).padStart(3, '0')}`;
    const isCpu = (m: El) => /^(5069-L|1769-L|1756-L|5370|5380)/i.test(attr(m, 'CatalogNumber')) || /^Local$/i.test(attr(m, 'Name')) && attr(m, 'CatalogNumber') === procType;
    const ipOf = (m: El): string => {
        for (const p of kids(kid(m, 'Ports'), 'Port')) {
            const a = attr(p, 'Address');
            if (attr(p, 'Type') === 'Ethernet' && IP_RE.test(a)) return a;
        }
        return '';
    };

    const sbom: HardwareItem[] = [];
    const nodes: any[] = [];
    const edges: any[] = [];

    const local = mods.find(m => attr(m, 'Name') === 'Local');
    const cpuIp = local ? ipOf(local) : '';
    const plcSbom: HardwareItem = {
        id: generateId(), type: 'Hardware',
        hardware: `Allen-Bradley Logix controller (${procType || attr(local, 'CatalogNumber')})`,
        firmware: fw, quantity: 1, notes: `Controller ${ctrlName}`, ipAddress: cpuIp,
    };
    sbom.push(plcSbom);
    nodes.push({ id: 'node-plc', sbomId: plcSbom.id, x: 350, y: 60, label: `${ctrlName} (${procType})`, ip: cpuIp, type: 'Hardware', note: 'Controller' });

    // group the rest by catalog number; modules with their own IP also become nodes
    const groups = new Map<string, { item: HardwareItem; names: string[] }>();
    const devices: { m: El; sbomId: string; ip: string }[] = [];
    let count = 0;
    for (const m of mods) {
        if (m === local && isCpu(m)) continue;
        if (isCpu(m)) continue;
        count++;
        const catalog = attr(m, 'CatalogNumber') || 'ETHERNET-MODULE';
        const prod = productOf(catalog, attr(m, 'Name'));
        const key = `${catalog}|${attr(m, 'Major')}${attr(m, 'CatalogNumber') ? '' : '|' + attr(m, 'Name')}`;
        let g = groups.get(key);
        if (!g) {
            g = {
                names: [],
                item: {
                    id: generateId(), type: /stratix|1783-/i.test(catalog + prod.name) ? 'Network' : 'Hardware',
                    hardware: `${prod.vendor}${prod.name} (${catalog})`, firmware: attr(m, 'Major') ? `v${attr(m, 'Major')}.${attr(m, 'Minor', '0')}` : '',
                    quantity: 0, notes: '',
                },
            };
            groups.set(key, g);
            sbom.push(g.item);
        }
        g.item.quantity++;
        g.names.push(descOf(m) ? `${attr(m, 'Name')} (${descOf(m)})` : attr(m, 'Name'));
        const ip = ipOf(m);
        if (ip) devices.push({ m, sbomId: g.item.id, ip });
    }
    for (const g of groups.values()) {
        g.item.notes = `I/O modules: ${g.names.join(', ')}`;
        if (g.item.quantity === 1) {
            const d = devices.find(x => x.sbomId === g.item.id);
            if (d) g.item.ipAddress = d.ip;
        }
    }

    const switchDev = devices.find(d => sbom.find(h => h.id === d.sbomId)?.type === 'Network');
    devices.forEach((d, i) => {
        const nm = attr(d.m, 'Name');
        const item = sbom.find(h => h.id === d.sbomId)!;
        const isNet = item.type === 'Network';
        const id = `node-${slug(nm)}`;
        nodes.push({
            id, sbomId: d.sbomId,
            x: isNet ? 600 : 100 + (i % 5) * 200, y: isNet ? 60 : 220 + Math.floor(i / 5) * 140,
            label: `${nm} ${descOf(d.m) || attr(d.m, 'CatalogNumber')}`, ip: d.ip, type: item.type, note: descOf(d.m),
        });
    });
    const hub = switchDev ? `node-${slug(attr(switchDev.m, 'Name'))}` : 'node-plc';
    for (const n of nodes) {
        if (n.id === 'node-plc' || n.id === hub) continue;
        edges.push({
            id: `edge-${n.id}-${hub}`, source: n.id, target: hub, protocol: 'EtherNet/IP',
            sourcePort: '44818', targetPort: '44818', subnetMask: '255.255.255.0', gateway: '',
            isEncrypted: false, isFirewalled: false,
        });
    }
    if (switchDev) {
        edges.push({
            id: `edge-node-plc-${hub}`, source: 'node-plc', target: hub, protocol: 'EtherNet/IP',
            sourcePort: '44818', targetPort: '44818', subnetMask: '255.255.255.0', gateway: '',
            isEncrypted: false, isFirewalled: false,
        });
    }
    if (mods.length === 0) warnings.push('No I/O module in the file: hardware reduced to the controller only.');
    else warnings.push('Topology: links inferred (every EtherNet/IP device to the switch or the controller): please verify.');
    return { sbom, nodes, edges, count };
}

// ─── main ─────────────────────────────────────────────────────
export function importL5X(xml: string, fileName = 'import.L5X', author = 'Studio 5000'): L5xImportResult {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML file.');
    const root = doc.documentElement;
    const ctrl = kid(root, 'Controller');
    if (!ctrl) throw new Error('No <Controller> element in the file: this is not a controller L5X.');

    const warnings: string[] = [];
    STRING_TYPES = new Set(kids(kid(ctrl, 'DataTypes'), 'DataType').filter(d => attr(d, 'Family') === 'StringFamily').map(d => attr(d, 'Name')));
    const ctrlName = attr(ctrl, 'Name', 'Controller');
    const today = new Date().toISOString().split('T')[0];
    const stats = { programs: 0, aois: 0, udts: 0, tags: 0, io: 0, alarms: 0, modules: 0, rungs: 0, stRoutines: 0 };

    const usedIds = new Set<string>();
    const idFor = (prefix: string, name: string): string => {
        let id = `${prefix}-${slug(name)}`, i = 2;
        while (usedIds.has(id)) id = `${prefix}-${slug(name)}-${i++}`;
        usedIds.add(id);
        return id;
    };
    const finish = <T extends BlockBase>(e: any, prefix: string, name: string, description: string): T => {
        e.id = idFor(prefix, name);
        e.description = description;
        e.revisions = [{ version: '1.0', date: today, author, notes: `Imported from ${fileName}` }];
        e.lastModifiedBy = author;
        return e as T;
    };

    // ---- AOIs -> library ----
    const library: FunctionBlock[] = [];
    const aoiByName = new Map<string, FunctionBlock>();
    for (const a of kids(kid(ctrl, 'AddOnInstructionDefinitions'), 'AddOnInstructionDefinition')) {
        const name = attr(a, 'Name');
        const fb = finish<FunctionBlock>(createEmptyBlock('FB', name, author), 'fb', name, descOf(a));
        fb.category = 'Other';
        fb.currentVersion = attr(a, 'Revision', '1.0');
        for (const p of kids(kid(a, 'Parameters'), 'Parameter')) {
            const t = mapType(attr(p, 'DataType', 'DINT'), attr(p, 'Dimensions'));
            const usage = attr(p, 'Usage', 'Input');
            fb.variables.push({
                id: generateId(), name: attr(p, 'Name'), description: descOf(p), dataType: t.dataType,
                ...(t.customDataType ? { customDataType: t.customDataType } : {}),
                scope: usage === 'Output' ? 'Output' : usage === 'InOut' ? 'InOut' : 'Input',
            });
        }
        for (const l of kids(kid(a, 'LocalTags'), 'LocalTag')) {
            const t = mapType(attr(l, 'DataType', 'DINT'), attr(l, 'Dimensions'));
            fb.variables.push({
                id: generateId(), name: attr(l, 'Name'), description: descOf(l), dataType: t.dataType,
                ...(t.customDataType ? { customDataType: t.customDataType } : {}), scope: 'Local',
            });
        }
        const routines = kids(kid(a, 'Routines'), 'Routine').map(r => readRoutine(r, warnings, `AOI ${name}`));
        const logic = routines.find(r => r.name === 'Logic') || routines[0];
        const ordered = logic ? [logic, ...routines.filter(r => r !== logic)] : [];
        // a lone ST Logic routine is stored as plain ST (the exporter's AOI form)
        fb.code = ordered.length === 1 && ordered[0].type === 'ST'
            ? ordered[0].text.replace(/^ROUTINE [^\n]*\n/, '')
            : ordered.map(r => r.text).join('\n\n');
        for (const r of ordered) { stats.rungs += r.rungs; if (r.type === 'ST') stats.stRoutines++; }
        library.push(fb);
        aoiByName.set(name, fb);
        stats.aois++;
    }

    // ---- UDTs -> library (members as variables) ----
    for (const d of kids(kid(ctrl, 'DataTypes'), 'DataType')) {
        const name = attr(d, 'Name');
        if (aoiByName.has(name) || STRING_TYPES.has(name)) continue;
        const fb = finish<FunctionBlock>(createEmptyBlock('FB', name, author), 'fb', name, `[UDT] ${descOf(d)}`.trim());
        for (const m of kids(kid(d, 'Members'), 'Member')) {
            if (attr(m, 'Hidden') === 'true') continue;
            const t = mapType(attr(m, 'DataType', 'DINT'), attr(m, 'Dimension') === '0' ? '' : attr(m, 'Dimension'));
            fb.variables.push({
                id: generateId(), name: attr(m, 'Name'), description: descOf(m), dataType: t.dataType,
                ...(t.customDataType ? { customDataType: t.customDataType } : {}), scope: 'Local',
            });
        }
        library.push(fb);
        stats.udts++;
    }

    // ---- scheduled order ----
    const scheduled: string[] = [];
    const taskNotes: string[] = [];
    for (const t of kids(kid(ctrl, 'Tasks'), 'Task')) {
        taskNotes.push(`${attr(t, 'Name')} (${attr(t, 'Type')}${attr(t, 'Rate') ? ' ' + attr(t, 'Rate') + ' ms' : ''})`);
        for (const sp of kids(kid(t, 'ScheduledPrograms'), 'ScheduledProgram')) scheduled.push(attr(sp, 'Name'));
    }
    const programs = kids(kid(ctrl, 'Programs'), 'Program');
    programs.sort((a, b) => {
        const ia = scheduled.indexOf(attr(a, 'Name')), ib = scheduled.indexOf(attr(b, 'Name'));
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });

    const aoiRe = aoiByName.size
        ? new RegExp(`\\b(${[...aoiByName.keys()].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`, 'g')
        : null;

    // ---- programs -> entities ----
    type Ent = { e: BlockBase; level: 'UN' | 'EM' | 'CM' };
    const ents: Ent[] = [];
    const explicitParent = new Map<string, Ent>();      // CM id -> the EM it was split from
    const nameTaken = new Set<string>();
    const uniqueName = (n: string, prefix: string): string => {
        let out = n;
        if (nameTaken.has(out)) out = `${prefix}_${n}`;
        let i = 2;
        while (nameTaken.has(out)) out = `${prefix}_${n}_${i++}`;
        nameTaken.add(out);
        return out;
    };
    const setAois = (e: BlockBase): void => {
        const used = new Set<string>();
        for (const v of e.variables) if (v.customDataType && aoiByName.has(v.customDataType)) used.add(v.customDataType);
        if (aoiRe) for (const m of e.code.matchAll(aoiRe)) used.add(m[1]);
        (e as any).assignedFBs = [...used].map(n => aoiByName.get(n)!.id);
    };
    const identsOf = (text: string): Set<string> => new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);

    for (const p of programs) {
        const name = attr(p, 'Name');
        const forced = prefixLevel(name);
        const main = attr(p, 'MainRoutineName');
        const rs = kids(kid(p, 'Routines'), 'Routine').map(r => readRoutine(r, warnings, `Program ${name}`));
        for (const r of rs) { stats.rungs += r.rungs; if (r.type === 'ST') stats.stRoutines++; }
        const mainR = rs.find(r => r.name === main) || null;
        const others = rs.filter(r => r !== mainR);
        const parts = newParts();
        addTags(kids(kid(p, 'Tags'), 'Tag'), parts);
        stats.programs++;

        // A plain program with several routines is a machine split into
        // sections: program -> EM, each routine -> CM, and every program tag
        // goes to the one routine that uses it (shared/unused ones stay on the EM).
        if (!forced && others.length >= 2) {
            nameTaken.add(name);
            const em = finish<BlockBase>(createEmptyBlock('EM', name, author), 'em', name, descOf(p));
            em.category = 'Logic';
            em.code = mainR ? mainR.text : '';
            const emEnt: Ent = { e: em, level: 'EM' };
            const cmEnts = others.map(r => {
                const cn = uniqueName(r.name, name);
                const cm = finish<BlockBase>(createEmptyBlock('CM', cn, author), 'cm', cn, `Routine ${r.name} of program ${name}`);
                cm.category = 'Logic';
                cm.code = r.text;
                const x: Ent = { e: cm, level: 'CM' };
                explicitParent.set(cm.id, emEnt);
                return { x, idents: identsOf(r.text) };
            });
            const emIdents = identsOf(em.code);
            const pick = (tagName: string): BlockBase => {
                const users = cmEnts.filter(c => c.idents.has(tagName));
                if (users.length === 1 && !emIdents.has(tagName)) return users[0].x.e;
                return em;
            };
            for (const v of parts.variables) pick(v.name).variables.push(v);
            for (const i of parts.io) pick(i.variable).io.push(i);
            for (const a of parts.alarms) pick(a.triggerVariable).alarms.push(a);
            ents.push(emEnt, ...cmEnts.map(c => c.x));
            for (const c of cmEnts) setAois(c.x.e);
            setAois(em);
            warnings.push(`Program "${name}": diviso in 1 EM + ${others.length} CMs (one routine = one CM); each tag is assigned to the CM that uses it, shared tags stay on the EM.`);
            continue;
        }

        const level = forced || 'CM';
        const uname = nameTaken.has(name) ? uniqueName(name, 'P') : (nameTaken.add(name), name);
        const e = finish<BlockBase>(createEmptyBlock(level, uname, author), level.toLowerCase(), uname, descOf(p));
        e.category = 'Logic';
        e.variables = parts.variables; e.io = parts.io; e.alarms = parts.alarms;
        const ordered = mainR ? [mainR, ...others] : others;
        e.code = ordered.map(r => r.text).join('\n\n');
        setAois(e);
        ents.push({ e, level });
    }

    // ---- controller-scope tags go to the top unit ----
    const ctrlParts = newParts();
    addTags(kids(kid(ctrl, 'Tags'), 'Tag'), ctrlParts);

    let uns = ents.filter(x => x.level === 'UN');
    let ems = ents.filter(x => x.level === 'EM');
    const cms = ents.filter(x => x.level === 'CM');
    const synth = (level: 'UN' | 'EM', name: string, desc: string): Ent => {
        const e = finish<BlockBase>(createEmptyBlock(level, name, author), level.toLowerCase(), name, desc);
        e.category = 'Logic';
        const x: Ent = { e, level };
        ents.push(x);
        return x;
    };
    if (uns.length === 0) {
        uns = [synth('UN', `UN_${ctrlName.replace(/[^A-Za-z0-9_]/g, '_')}`, `Unit generated by the import of controller ${ctrlName} (holds the controller tags).`)];
        warnings.push(`No UN_* program: created the unit "${uns[0].e.name}" to hold the EMs and the controller tags.`);
    }
    const topUn = uns[0];
    topUn.e.variables.push(...ctrlParts.variables);
    topUn.e.io.push(...ctrlParts.io);
    topUn.e.alarms.push(...ctrlParts.alarms);
    setAois(topUn.e);

    let fallbackEm: Ent | null = null;
    const emFor = (cmName: string): Ent => {
        const m = bestMatch(cmName, ems, x => x.e.name) || (ems.length === 1 ? ems[0] : null);
        if (m) return m;
        if (!fallbackEm) {
            fallbackEm = synth('EM', 'EM_Imported', 'Control modules that could not be assigned automatically to an EM: reorganize.');
            ems = [...ems, fallbackEm];
        }
        return fallbackEm;
    };

    const emChildren = new Map<string, Ent[]>();
    for (const c of cms) {
        const em = explicitParent.get(c.e.id) || emFor(c.e.name);
        if (!emChildren.has(em.e.id)) emChildren.set(em.e.id, []);
        emChildren.get(em.e.id)!.push(c);
    }
    const unChildren = new Map<string, Ent[]>();
    for (const em of ems) {
        const un = bestMatch(em.e.name, uns, x => x.e.name) || topUn;
        if (!unChildren.has(un.e.id)) unChildren.set(un.e.id, []);
        unChildren.get(un.e.id)!.push(em);
    }
    if (fallbackEm) warnings.push('Some CMs do not match any EM by name: grouped in "EM_Imported".');
    warnings.push('UN/EM/CM hierarchy inferred from program and routine names (Logix does not have one): please review it.');

    const node = (x: Ent, children: AssemblyNode[]): AssemblyNode =>
        ({ id: generateId(), refId: x.e.id, level: x.level, children });
    const tree: AssemblyNode[] = uns.map(un => node(un, (unChildren.get(un.e.id) || []).map(em =>
        node(em, (emChildren.get(em.e.id) || []).map(cm => node(cm, []))))));
    for (const un of uns) (un.e as any).assignedEMs = (unChildren.get(un.e.id) || []).map(x => x.e.id);
    for (const em of ems) (em.e as any).assignedCMs = (emChildren.get(em.e.id) || []).map(x => x.e.id);

    // ---- hardware ----
    const hw = importHardware(ctrl, ctrlName, warnings);
    stats.modules = hw.count;

    // ---- totals ----
    for (const x of ents) { stats.tags += x.e.variables.length; stats.io += x.e.io.length; stats.alarms += x.e.alarms.length; }
    if (stats.alarms === 0) warnings.push('No alarm recognized (BOOL tags prefixed Alm_/Alarm_/Wrn_/Flt_...): add them in AMA.');
    warnings.push('Not present in the file and left empty: DFMEA, checklist, development hours, per-entity BOM.');
    if (stats.udts) warnings.push(`${stats.udts} user-defined data types (UDT) saved in the Library with description "[UDT]" and the members as variables.`);

    const assembly: AssemblyProject = {
        id: generateId(),
        name: ctrlName,
        secondaryDescription: attr(ctrl, 'ProcessorType'),
        description: `Imported from ${fileName} (${attr(ctrl, 'ProcessorType')} v${attr(ctrl, 'MajorRev')}).` + (taskNotes.length ? ` Task: ${taskNotes.join(', ')}.` : ''),
        version: '1.0.0',
        tree,
        sbom: hw.sbom,
        networkNodes: hw.nodes,
        networkEdges: hw.edges,
    };

    return {
        project: {
            library,
            units: ents.filter(x => x.level === 'UN').map(x => x.e as Unit),
            equipmentModules: ents.filter(x => x.level === 'EM').map(x => x.e as EquipmentModule),
            controlModules: ents.filter(x => x.level === 'CM').map(x => x.e as ControlModule),
            assembly,
        },
        stats,
        warnings,
    };
}
