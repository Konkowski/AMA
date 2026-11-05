// ============================================================
// AMA — Helper Utilities
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import type {
    Unit, EquipmentModule, ControlModule, FunctionBlock,
    Variable, Alarm, IOSignal, DFMEAEntry, BlockBase,
    AssemblyProject, AssemblyNode
} from '../types/machine';

/** Generate a unique ID */
export function generateId(): string {
    return uuidv4();
}

/** Project names go into filenames: strip characters Windows/macOS reject. */
export function safeFileName(name: string): string {
    return (name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'project';
}

/** Calculate Risk Priority Number */
export function calculateRPN(s: number, o: number, d: number): number {
    return s * o * d;
}

// ─── Entity Lookup (flat DB) ────────────────────────────
export interface EntityDB {
    library: FunctionBlock[];
    units: Unit[];
    equipmentModules: EquipmentModule[];
    controlModules: ControlModule[];
}

export function findEntityById(db: EntityDB, id: string): BlockBase | null {
    return db.library.find(e => e.id === id)
        || db.units.find(e => e.id === id)
        || db.equipmentModules.find(e => e.id === id)
        || db.controlModules.find(e => e.id === id)
        || null;
}

// ─── Referential Integrity ──────────────────────────────

export interface EntityUsage {
    /** Entities whose assignedFBs/assignedEMs/assignedCMs reference the id */
    referencedBy: { id: string; name: string; level: BlockBase['level'] }[];
    /** Number of assembly tree nodes instantiating the id */
    assemblyCount: number;
}

/** Find every place an architecture entity is referenced before deleting it. */
export function findEntityUsages(id: string, db: EntityDB, assembly: AssemblyProject): EntityUsage {
    const referencedBy: EntityUsage['referencedBy'] = [];
    const all: BlockBase[] = [...db.units, ...db.equipmentModules, ...db.controlModules];
    for (const e of all) {
        const refs: string[] = [
            ...((e as any).assignedFBs || []),
            ...((e as any).assignedEMs || []),
            ...((e as any).assignedCMs || []),
        ];
        if (refs.includes(id)) referencedBy.push({ id: e.id, name: e.name, level: e.level });
    }

    let assemblyCount = 0;
    const walk = (nodes: AssemblyNode[]) => {
        for (const n of nodes) {
            if (n.refId === id) assemblyCount++;
            walk(n.children);
        }
    };
    walk(assembly.tree);

    return { referencedBy, assemblyCount };
}

// ─── Assembly Tree Helpers ──────────────────────────────

/** Resolve all entity refs in assembly tree */
function collectAssemblyEntities(tree: AssemblyNode[], db: EntityDB): BlockBase[] {
    const result: BlockBase[] = [];
    for (const node of tree) {
        const entity = findEntityById(db, node.refId);
        if (entity) result.push(entity);
        result.push(...collectAssemblyEntities(node.children, db));
    }
    return result;
}

/** Get breadcrumb for an assembly node */
export function getAssemblyBreadcrumb(tree: AssemblyNode[], asmNodeId: string, db: EntityDB): string[] {
    const path: string[] = [];
    const find = (nodes: AssemblyNode[], trail: string[]): boolean => {
        for (const n of nodes) {
            const entity = findEntityById(db, n.refId);
            const name = entity ? entity.name : n.refId;
            const current = [...trail, name];
            if (n.id === asmNodeId) {
                path.push(...current);
                return true;
            }
            if (find(n.children, current)) return true;
        }
        return false;
    };
    find(tree, []);
    return path;
}

/** Find assembly node by ID */
export function findAssemblyNode(tree: AssemblyNode[], asmNodeId: string): AssemblyNode | null {
    for (const n of tree) {
        if (n.id === asmNodeId) return n;
        const found = findAssemblyNode(n.children, asmNodeId);
        if (found) return found;
    }
    return null;
}

// ─── Flatten Functions (Assembly-based) ─────────────────

export function flattenVariablesFromAssembly(assembly: AssemblyProject, db: EntityDB): (Variable & { owner: string })[] {
    const entities = collectAssemblyEntities(assembly.tree, db);
    const result: (Variable & { owner: string })[] = [];
    for (const e of entities) {
        for (const v of e.variables) {
            result.push({ ...v, owner: e.name });
        }
    }
    return result;
}

export function flattenAlarmsFromAssembly(assembly: AssemblyProject, db: EntityDB): (Alarm & { owner: string })[] {
    const entities = collectAssemblyEntities(assembly.tree, db);
    const result: (Alarm & { owner: string })[] = [];
    for (const e of entities) {
        for (const a of e.alarms) {
            result.push({ ...a, owner: e.name });
        }
    }
    return result;
}

export function flattenIOFromAssembly(assembly: AssemblyProject, db: EntityDB): (IOSignal & { owner: string })[] {
    const entities = collectAssemblyEntities(assembly.tree, db);
    const result: (IOSignal & { owner: string })[] = [];
    for (const e of entities) {
        for (const io of e.io) {
            result.push({ ...io, owner: e.name });
        }
    }
    return result;
}

export function flattenDFMEAFromAssembly(assembly: AssemblyProject, db: EntityDB): (DFMEAEntry & { owner: string })[] {
    const entities = collectAssemblyEntities(assembly.tree, db);
    const result: (DFMEAEntry & { owner: string })[] = [];
    for (const e of entities) {
        for (const d of e.dfmea) {
            result.push({ ...d, owner: e.name });
        }
    }
    return result;
}

// ─── Architecture DB Flatten Functions ──────────────────

export function flattenVariables(db: EntityDB): (Variable & { owner: string })[] {
    const all: BlockBase[] = [...db.library, ...db.units, ...db.equipmentModules, ...db.controlModules];
    return all.flatMap(e => e.variables.map(v => ({ ...v, owner: e.name })));
}

export function flattenAlarms(db: EntityDB): (Alarm & { owner: string })[] {
    const all: BlockBase[] = [...db.library, ...db.units, ...db.equipmentModules, ...db.controlModules];
    return all.flatMap(e => e.alarms.map(a => ({ ...a, owner: e.name })));
}

export function flattenIO(db: EntityDB): (IOSignal & { owner: string })[] {
    const all: BlockBase[] = [...db.library, ...db.units, ...db.equipmentModules, ...db.controlModules];
    return all.flatMap(e => e.io.map(io => ({ ...io, owner: e.name })));
}

export function flattenDFMEA(db: EntityDB): (DFMEAEntry & { owner: string })[] {
    const all: BlockBase[] = [...db.library, ...db.units, ...db.equipmentModules, ...db.controlModules];
    return all.flatMap(e => e.dfmea.map(d => ({ ...d, owner: e.name })));
}

// ─── Entity Counting ───────────────────────────────────

export function countEntities(db: EntityDB) {
    const all: BlockBase[] = [...db.units, ...db.equipmentModules, ...db.controlModules];
    return {
        units: db.units.length,
        ems: db.equipmentModules.length,
        cms: db.controlModules.length,
        fbs: db.library.length,
        totalVariables: all.reduce((n, e) => n + e.variables.length, 0) + db.library.reduce((n, e) => n + e.variables.length, 0),
        totalAlarms: all.reduce((n, e) => n + e.alarms.length, 0) + db.library.reduce((n, e) => n + e.alarms.length, 0),
        totalIO: all.reduce((n, e) => n + e.io.length, 0) + db.library.reduce((n, e) => n + e.io.length, 0),
        totalDFMEA: all.reduce((n, e) => n + e.dfmea.length, 0) + db.library.reduce((n, e) => n + e.dfmea.length, 0),
    };
}

// ─── Code Generation: FB Calling ────────────────────────

/** Generate FB-calling Structured Text code for a CM/EM/UN based on assigned FBs */
export function generateFBCallingCode(entity: BlockBase, library: FunctionBlock[]): string {
    const assignedFBs = 'assignedFBs' in entity ? (entity as any).assignedFBs as string[] : [];
    if (assignedFBs.length === 0) return `// No Function Blocks assigned to ${entity.name}\n`;

    const lines: string[] = [
        `// ============================================`,
        `// Auto-generated FB Calling Code`,
        `// Entity: ${entity.name} (${entity.level})`,
        `// Generated: ${new Date().toISOString().split('T')[0]}`,
        `// ============================================`,
        ``,
        `// --- FB Instance Declarations ---`,
    ];

    // Collect all FB instances
    const instances: { instanceName: string; fbName: string; fb: FunctionBlock }[] = [];
    for (const fbId of assignedFBs) {
        const fb = library.find(f => f.id === fbId);
        if (!fb) continue;
        const instanceName = `fb${fb.name.replace(/^FB_/, '')}_${entity.name.replace(/^(UN_|EM_|CM_)/, '')}`;
        instances.push({ instanceName, fbName: fb.name, fb });
    }

    // Generate VAR declarations
    lines.push(`VAR`);
    for (const inst of instances) {
        lines.push(`    ${inst.instanceName} : ${inst.fbName};`);
    }
    lines.push(`END_VAR`);
    lines.push(``);
    lines.push(`// --- FB Calls ---`);

    // Generate FB calls
    for (const inst of instances) {
        const { instanceName, fb } = inst;
        const inputs = fb.variables.filter(v => v.scope === 'Input');
        const outputs = fb.variables.filter(v => v.scope === 'Output');

        const params: string[] = [];

        // Wire inputs: try matching entity variables by name
        for (const inp of inputs) {
            const matched = entity.variables.find(v =>
                v.name === inp.name ||
                v.name.toLowerCase().includes(inp.name.toLowerCase().replace('b', '').replace('r', ''))
            );
            const wiredValue = matched ? matched.name : `/* ${inp.name} */`;
            params.push(`${inp.name} := ${wiredValue}`);
        }

        // Wire outputs
        for (const out of outputs) {
            const matched = entity.variables.find(v =>
                v.name === out.name ||
                v.name.toLowerCase().includes(out.name.toLowerCase().replace('b', '').replace('r', ''))
            );
            const wiredValue = matched ? matched.name : `/* ${out.name} */`;
            params.push(`${out.name} => ${wiredValue}`);
        }

        if (params.length === 0) {
            // No parameters — simple call
            lines.push(`${instanceName}();`);
        } else if (params.length <= 3) {
            // Compact single-line call
            lines.push(`${instanceName}(${params.join(', ')});`);
        } else {
            // Multi-line for readability
            lines.push(`${instanceName}(`);
            for (let i = 0; i < params.length; i++) {
                const comma = i < params.length - 1 ? ',' : '';
                lines.push(`    ${params[i]}${comma}`);
            }
            lines.push(`);`);
        }
        lines.push(``);
    }

    return lines.join('\n');
}

// ─── FDS Generation (Assembly-based) ────────────────────

export function generateFDS(assembly: AssemblyProject, db: EntityDB): string {
    // ── deterministic ASCII-figure helpers (render inside ``` fences) ──
    const rep = (ch: string, n: number) => ch.repeat(Math.max(0, n));
    const center = (s: string, w: number) => {
        s = (s || '').slice(0, w);
        const pad = w - s.length, l = Math.floor(pad / 2);
        return rep(' ', l) + s + rep(' ', pad - l);
    };
    const bar = (label: string, value: number, max: number, width = 24) => {
        const f = max > 0 ? Math.round((value / max) * width) : 0;
        return `${label.padEnd(16)}│${rep('█', f)}${rep('░', width - f)}│ ${value}`;
    };
    const boxGrid = (items: { title: string; sub?: string }[], perRow = 3, cw = 22): string[] => {
        if (items.length === 0) return ['(none)'];
        const out: string[] = [];
        for (let i = 0; i < items.length; i += perRow) {
            const row = items.slice(i, i + perRow);
            out.push(row.map(() => '┌' + rep('─', cw) + '┐').join('  '));
            out.push(row.map(it => '│' + center(it.title, cw) + '│').join('  '));
            out.push(row.map(it => '│' + center(it.sub || '', cw) + '│').join('  '));
            out.push(row.map(() => '└' + rep('─', cw) + '┘').join('  '));
        }
        return out;
    };

    // ── collect assembled entities + stats for the visual dashboard ────
    const assembled: BlockBase[] = [];
    const levelCounts: Record<string, number> = { UN: 0, EM: 0, CM: 0 };
    const walkStats = (nodes: AssemblyNode[]) => {
        for (const n of nodes) {
            const e = findEntityById(db, n.refId);
            if (e) { assembled.push(e); if (levelCounts[e.level] !== undefined) levelCounts[e.level]++; }
            walkStats(n.children);
        }
    };
    walkStats(assembly.tree);

    const ioByType: Record<string, number> = { DI: 0, DO: 0, AI: 0, AO: 0, Frequency: 0 };
    const almByLevel: Record<string, number> = { Warning: 0, Alarm: 0, Fault: 0, Safety: 0 };
    let plcH = 0, hmiH = 0, commH = 0;
    const dfmeaAll: { mode: string; rpn: number; owner: string }[] = [];
    for (const e of assembled) {
        for (const io of e.io || []) if (ioByType[io.signalType] !== undefined) ioByType[io.signalType]++;
        for (const a of e.alarms || []) if (almByLevel[a.level] !== undefined) almByLevel[a.level]++;
        const dt = (e as any).devTimes || {};
        plcH += dt.plcHours || 0; hmiH += dt.hmiHours || 0; commH += dt.commissioningHours || 0;
        for (const d of e.dfmea || []) dfmeaAll.push({ mode: d.failureMode, rpn: d.rpn || d.severity * d.occurrence * d.detection, owner: e.name });
    }
    const totalIO = Object.values(ioByType).reduce((a, b) => a + b, 0);
    const totalAlm = Object.values(almByLevel).reduce((a, b) => a + b, 0);
    const genDate = `${new Date().toLocaleDateString('it-IT')} ${new Date().toLocaleTimeString('it-IT')}`;

    const lines: string[] = [
        `<div align="center">`,
        ``,
        `# 🛠️ ${assembly.name}`,
        ``,
        `### Functional Design Specification · FDS`,
        ``,
        `\`ISA-88\` · \`PackML\` · \`IEC 62443\` · \`SCL\` · \`v${assembly.version}\``,
        ``,
        `</div>`,
        ``,
        `> ${assembly.description || 'No description.'}`,
        assembly.secondaryDescription ? `>\n> _${assembly.secondaryDescription}_` : ``,
        ``,
        `<a id="top"></a>`,
        ``,
        `| 📋 Project | 🔖 Version | 📅 Generated | 🧩 Modules | 🔌 I/O | ⚠️ Alarms |`,
        `|:---|:---:|:---:|:---:|:---:|:---:|`,
        `| **${assembly.name}** | \`v${assembly.version}\` | ${genDate} | ${levelCounts.UN} UN · ${levelCounts.EM} EM · ${levelCounts.CM} CM | ${totalIO} | ${totalAlm} |`,
        ``,
        `## 📑 Contents`,
        ``,
        `1. [🗂️ Module Tree (ISA-88)](#sec-1)`,
        `2. [📊 Cruscotto Visivo](#sec-2)`,
        `3. [📝 Module Specification Details](#sec-3)`,
        `4. [🌐 Industrial Network and Cybersecurity](#sec-4)`,
        ``,
        `---`,
        ``,
        `<a id="sec-1"></a>`,
        ``,
        `## 1. 🗂️ Module Tree (ISA-88)`,
        ``,
        `The machine hierarchy follows the **ISA-88** standard — Unit (UN) → Equipment Module (EM) → Control Module (CM):`,
        ``,
        `\`\`\``,
    ];

    // Helper to generate recursive ASCII tree
    function buildAsciiTree(nodes: AssemblyNode[], prefix = ''): string {
        let result = '';
        nodes.forEach((node, idx) => {
            const entity = findEntityById(db, node.refId);
            const typeName = entity ? entity.name : node.refId;
            const name = node.label && node.label !== typeName ? `${node.label} (${typeName})` : typeName;
            const params = (node.params || []).filter(p => p.name).map(p => `${p.name}=${p.value}${p.unit ? ' ' + p.unit : ''}`).join(', ');
            const level = entity ? entity.level : node.level;
            const isLast = idx === nodes.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            result += `${prefix}${connector}[${level}] ${name}${params ? `  {${params}}` : ''}\n`;
            if (node.children && node.children.length > 0) {
                const nextPrefix = prefix + (isLast ? '    ' : '│   ');
                result += buildAsciiTree(node.children, nextPrefix);
            }
        });
        return result;
    }

    lines.push(buildAsciiTree(assembly.tree));
    lines.push(`\`\`\``);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // ── SECTION 2: VISUAL DASHBOARD (deterministic ASCII figures) ──────
    lines.push(`<a id="sec-2"></a>`);
    lines.push(``);
    lines.push(`## 2. 📊 Cruscotto Visivo`);
    lines.push(``);

    // 2.a Architecture block diagram: OB Main → each Unit → its sub-modules
    lines.push(`### 🗺️ Architecture Diagram`);
    lines.push(``);
    lines.push('```');
    const cw = 22;
    const vbox = (label: string) => {
        lines.push('┌' + rep('─', cw) + '┐');
        lines.push('│' + center(label, cw) + '│');
        lines.push('└' + rep('─', cw) + '┘');
    };
    const stem = () => lines.push(rep(' ', Math.floor(cw / 2)) + '│');
    vbox('OB Main (cyclic)');
    for (const root of assembly.tree) {
        const rEnt = findEntityById(db, root.refId);
        stem();
        vbox(rEnt ? `[${rEnt.level}] ${rEnt.name}` : root.refId);
        const kids = root.children.map(c => {
            const e = findEntityById(db, c.refId);
            return { title: e ? `[${e.level}] ${e.name}` : c.refId };
        });
        if (kids.length) {
            stem();
            lines.push(rep(' ', Math.floor(cw / 2)) + '▼  sub-modules');
            lines.push(...boxGrid(kids, 3, cw));
        }
    }
    lines.push('```');
    lines.push(``);

    // 2.b Bar charts
    lines.push(`### 🔌 I/O distribution`);
    lines.push('```');
    if (totalIO === 0) lines.push('(no I/O signals)');
    else {
        const maxIO = Math.max(...Object.values(ioByType));
        for (const [k, v] of Object.entries(ioByType)) if (v > 0) lines.push(bar(k, v, maxIO));
    }
    lines.push('```');
    lines.push(``);

    lines.push(`### ⚠️ Alarms by Level`);
    lines.push('```');
    if (totalAlm === 0) lines.push('(no alarms)');
    else {
        const maxAlm = Math.max(...Object.values(almByLevel));
        for (const [k, v] of Object.entries(almByLevel)) if (v > 0) lines.push(bar(k, v, maxAlm));
    }
    lines.push('```');
    lines.push(``);

    if (plcH || hmiH || commH) {
        lines.push(`### ⏱️ Estimated Development Effort (hours)`);
        lines.push('```');
        const maxH = Math.max(plcH, hmiH, commH);
        lines.push(bar('PLC', plcH, maxH));
        lines.push(bar('HMI', hmiH, maxH));
        lines.push(bar('Commissioning', commH, maxH));
        lines.push(rep('─', 45));
        lines.push(`${'TOTALE'.padEnd(16)}  ${plcH + hmiH + commH} h`);
        lines.push('```');
        lines.push(``);
    }

    if (dfmeaAll.length) {
        const top = [...dfmeaAll].sort((a, b) => b.rpn - a.rpn).slice(0, 8);
        const maxRpn = Math.max(...top.map(d => d.rpn), 1);
        lines.push(`### 🛡️ DFMEA Risk Profile (RPN — top ${top.length})`);
        lines.push('```');
        for (const d of top) lines.push(bar(d.mode.slice(0, 16), d.rpn, maxRpn));
        lines.push('```');
        lines.push(`> RPN = Severity × Occurrence × Detection. High values = mitigation priority.`);
        lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);

    // ── SECTION 3: MODULE DETAIL ───────────────────────────────────────
    lines.push(`<a id="sec-3"></a>`);
    lines.push(``);
    lines.push(`## 3. 📝 Module Specification Details`);
    lines.push(`Variables, physical I/O signals, alarms, DFMEA matrices and development times for each assembled module. _Expand each module for details._`);
    lines.push(``);

    function writeNode(node: AssemblyNode, depth: number) {
        const entity = findEntityById(db, node.refId);
        if (!entity) return;
        const summary = entity.description ? ` — ${entity.description.split('\n')[0].slice(0, 70)}` : '';

        lines.push(`<details${depth === 0 ? ' open' : ''}>`);
        lines.push(`<summary>🔹 <b>[${entity.level}] ${entity.name}</b>${summary}</summary>`);
        lines.push(``);
        lines.push(`**Description:** ${entity.description || '*No description.*'}`);

        // Development Times
        const devTimes = (entity as any).devTimes || { plcHours: 0, hmiHours: 0, commissioningHours: 0 };
        if (devTimes.plcHours > 0 || devTimes.hmiHours > 0 || devTimes.commissioningHours > 0) {
            lines.push(`* **Estimated Development Time:** 💻 PLC: \`${devTimes.plcHours}h\` | 🖥️ HMI: \`${devTimes.hmiHours}h\` | 🔧 Commissioning: \`${devTimes.commissioningHours}h\``);
        }

        // Assigned FBs
        const fbIds = 'assignedFBs' in entity ? (entity as any).assignedFBs : [];
        if (fbIds.length > 0) {
            const fbNames = fbIds.map((id: string) => db.library.find(f => f.id === id)?.name || id).join(', ');
            lines.push(`* **Assigned Function Blocks (FB):** \`${fbNames}\``);
        }
        lines.push(``);

        // Variables Table
        if (entity.variables && entity.variables.length > 0) {
            lines.push(`#### 📋 Module Variables`);
            lines.push(`| Variable | Data Type | Scope | Description |`);
            lines.push(`| :--- | :--- | :--- | :--- |`);
            for (const v of entity.variables) {
                lines.push(`| \`${v.name}\` | \`${v.dataType}\` | ${v.scope} | ${v.description} |`);
            }
            lines.push(``);
        }

        // Physical I/O Table
        if (entity.io && entity.io.length > 0) {
            lines.push(`#### 🔌 Physical I/O Signals`);
            lines.push(`| Signal ID | Type | Address | Associated Variable | Description |`);
            lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
            for (const io of entity.io) {
                lines.push(`| \`${io.signalId}\` | **${io.signalType}** | \`${io.address}\` | \`${io.variable}\` | ${io.description} |`);
            }
            lines.push(``);
        }

        // Alarms Specification
        if (entity.alarms && entity.alarms.length > 0) {
            lines.push(`#### ⚠️ Alarms and Diagnostics`);
            lines.push(`| Alarm ID | Level | Message | Corrective Action | Causes / Solutions |`);
            lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
            for (const a of entity.alarms) {
                const causeSol = [];
                if (a.possibleCauses) causeSol.push(`*Cause:* ${a.possibleCauses}`);
                if (a.possibleSolutions) causeSol.push(`*Solutions:* ${a.possibleSolutions}`);
                lines.push(`| \`${a.alarmId}\` | **${a.level}** | ${a.message} | ${a.action} | ${causeSol.join('<br>') || '—'} |`);
            }
            lines.push(``);
        }

        // DFMEA Matrix
        if (entity.dfmea && entity.dfmea.length > 0) {
            lines.push(`#### 🛡️ DFMEA Analysis`);
            lines.push(`| Failure Mode | Failure Effect | S | O | D | RPN | Status |`);
            lines.push(`| :--- | :--- | :---: | :---: | :---: | :---: | :--- |`);
            for (const d of entity.dfmea) {
                lines.push(`| ${d.failureMode} | ${d.effect} | ${d.severity} | ${d.occurrence} | ${d.detection} | **${d.rpn}** | *${d.status}* |`);
            }
            lines.push(``);
        }

        for (const child of node.children) {
            writeNode(child, depth + 1);
        }

        lines.push(``);
        lines.push(`</details>`);
        lines.push(``);
    }

    for (const rootNode of assembly.tree) {
        writeNode(rootNode, 0);
    }

    // SECTION 4: NETWORK TOPOLOGY & CYBERSECURITY (IEC 62443)
    lines.push(`---`);
    lines.push(``);
    lines.push(`<a id="sec-4"></a>`);
    lines.push(``);
    lines.push(`## 4. 🌐 Industrial Network and Cybersecurity (IEC 62443)`);
    lines.push(`The machine network integrates the **IEC 62443** security requirements, segmenting the devices into isolated zones and defining secure communication conduits.`);
    lines.push(``);

    const sbom = assembly.sbom || [];
    const networkNodes = assembly.networkNodes || [];
    const networkEdges = assembly.networkEdges || [];

    // ASCII network diagram: controller/bus with devices hanging below
    if (networkNodes.length > 0) {
        lines.push(`### 🗺️ Network Diagram`);
        lines.push(``);
        lines.push('```');
        const devs = networkNodes.map((n: any) => {
            const it = sbom.find((s: any) => s.id === n.sbomId);
            return { title: (it?.hardware || n.label || 'Device').slice(0, 20), sub: (n.ip || it?.ipAddress || '') };
        });
        lines.push('╔' + rep('═', 46) + '╗');
        lines.push('║' + center('INDUSTRIAL NETWORK  (EtherNet/IP bus)', 46) + '║');
        lines.push('╚' + rep('═', 46) + '╝');
        lines.push(rep(' ', 23) + '│');
        lines.push(rep('─', 47));
        lines.push(...boxGrid(devs, 3, 20));
        lines.push('```');
        lines.push(``);
    }

    lines.push(`### 🖥️ 4.1 Device Inventory (SBOM & Zone Mapping)`);
    lines.push(`Below are the hardware, software and security devices registered in the SBOM and placed on the topology map with their zones and VLANs:`);
    lines.push(``);

    if (sbom.length === 0) {
        lines.push(`*No device configured in the SBOM.*`);
        lines.push(``);
    } else {
        lines.push(`| Type | Name / Model | IP Address | Version / FW | Qty | Security Zone | VLAN ID | Notes |`);
        lines.push(`| :--- | :--- | :--- | :--- | :---: | :--- | :---: | :--- |`);
        for (const item of sbom) {
            const isPlaced = networkNodes.some(n => n.sbomId === item.id);
            const placementIndicator = isPlaced ? '📍 Map' : '📦 SBOM';
            lines.push(`| ${item.type || 'Hardware'} | **${item.hardware || 'Unknown'}** | \`${item.ipAddress || '—'}\` | ${item.firmware || '—'} | ${item.quantity} | **${item.securityZone || 'Not defined'}** | \`${item.vlanId || '—'}\` | ${item.notes || '—'} [${placementIndicator}] |`);
        }
        lines.push(``);
    }

    lines.push(`### 🔌 4.2 Communication Conduit Specifications (Network Links)`);
    lines.push(`The communication channels between the different modules of the machine are structured in compliance with the IEC 62443 requirements (SL-T, encryption and firewalling):`);
    lines.push(``);

    if (networkEdges.length === 0) {
        lines.push(`*No network link conduit configured.*`);
        lines.push(``);
    } else {
        lines.push(`| Device A (Source) | Device B (Destination) | Industrial Protocol | Ports (A → B) | Subnet Mask | Gateway | Channel Encryption | Firewall | Target Security Level |`);
        lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- |`);

        const getNodeLabel = (nodeId: string) => {
            const node = networkNodes.find(n => n.id === nodeId);
            if (!node) return nodeId;
            const sbomItem = sbom.find(item => item.id === node.sbomId);
            const label = sbomItem?.hardware || node.label || 'Sconosciuto';
            const ip = sbomItem?.ipAddress || node.ip || '';
            return ip ? `**${label}** (\`${ip}\`)` : `**${label}**`;
        };

        for (const edge of networkEdges) {
            const srcLabel = getNodeLabel(edge.source);
            const dstLabel = getNodeLabel(edge.target);
            const protocol = edge.protocol === 'Other' ? (edge.customProtocol || 'Custom') : (edge.protocol || 'Not configured');
            const sPort = edge.sourcePort || '';
            const tPort = edge.targetPort || '';
            const ports = sPort || tPort ? `\`${sPort} → ${tPort}\`` : 'N/D (Layer 2)';
            const subnet = edge.subnetMask ? `\`${edge.subnetMask}\`` : 'N/D';
            const gw = edge.gateway ? `\`${edge.gateway}\`` : 'N/D';
            const cipher = edge.isEncrypted ? '🔐 Encrypted' : '❌ Not encrypted';
            const fw = edge.isFirewalled ? '🛡️ Active' : '❌ Disabilitato';
            const sl = edge.iecSecurityLevel || 'None';

            lines.push(`| ${srcLabel} | ${dstLabel} | **${protocol}** | ${ports} | ${subnet} | ${gw} | ${cipher} | ${fw} | \`${sl}\` |`);
        }
        lines.push(``);
    }

    return lines.join('\n');
}

// ─── Recent Activity Helper ─────────────────────────────

export interface RecentActivity {
    id: string;
    entityId: string;
    entityName: string;
    entityLevel: string;
    version: string;
    date: string;
    author: string;
    notes: string;
}

export function getRecentActivity(db: EntityDB, limit: number = 5): RecentActivity[] {
    const allEntities = [...db.library, ...db.units, ...db.equipmentModules, ...db.controlModules];
    const activities: RecentActivity[] = [];

    for (const e of allEntities) {
        if (e.revisions && e.revisions.length > 0) {
            for (const r of e.revisions) {
                activities.push({
                    id: `${e.id}-${r.version}`,
                    entityId: e.id,
                    entityName: e.name,
                    entityLevel: e.level,
                    version: r.version,
                    date: r.date,
                    author: r.author || 'Unknown',
                    notes: r.notes
                });
            }
        }
    }

    // Sort by date desc, then by version desc
    return activities
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, limit);
}

// ─── Assembly Helpers ────────────────────────────────────────

export interface AssemblyDFMEAEntry extends DFMEAEntry {
    context: string; // e.g. "Filler > Valve"
    entityId: string;
}

export function getAssemblyDFMEA(store: any): AssemblyDFMEAEntry[] {
    const entries: AssemblyDFMEAEntry[] = [];
    const traverse = (nodes: AssemblyNode[], path: string[]) => {
        for (const node of nodes) {
            let entity: BlockBase | undefined;
            if (node.level === 'UN') entity = store.units.find((u: any) => u.id === node.refId);
            else if (node.level === 'EM') entity = store.equipmentModules.find((e: any) => e.id === node.refId);
            else if (node.level === 'CM') entity = store.controlModules.find((c: any) => c.id === node.refId);

            if (entity) {
                const currentPath = [...path, entity.name];
                const context = currentPath.join(' > ');
                if (entity.dfmea) {
                    entity.dfmea.forEach((d: DFMEAEntry) => {
                        entries.push({ ...d, context, entityId: entity.id });
                    });
                }
                traverse(node.children, currentPath);
            }
        }
    };
    traverse(store.assembly.tree, []);
    // Sort by RPN desc
    return entries.sort((a, b) => b.rpn - a.rpn);
}



// ─── Dashboard Analytics Helpers ────────────────────────

export function getMachineStructure(db: EntityDB) {
    return db.units.map(u => {
        // Find children (EMs/CMs) that belong to this unit (if we had a hierarchy field, but currently it's flat/assignedFBs).
        // Wait, the current model doesn't explicitly link UN -> EM -> CM in a tree structure in the DB types, 
        // EXCEPT via the Assembly Tree or if we infer it from naming conventions or if we just list them.
        // However, the prompt implies "description of the UN and the derivations". 
        // Let's return the Unit details and maybe a count of assigned FBs as a proxy for complexity.
        return {
            id: u.id,
            name: u.name,
            description: u.description || 'No description',
            assignedFBs: (u as any).assignedFBs?.length || 0,
            ioCount: u.io.length
        };
    });
}

export function getComponentUsage(db: EntityDB) {
    const usage: Record<string, number> = {};
    const allEntities = [...db.units, ...db.equipmentModules, ...db.controlModules]; // FBs don't use FBs in this starter model usually, but UN/EM/CM do.

    for (const e of allEntities) {
        const assigned: string[] = (e as any).assignedFBs || [];
        for (const fbId of assigned) {
            const fb = db.library.find(f => f.id === fbId);
            if (fb) {
                usage[fb.name] = (usage[fb.name] || 0) + 1;
            }
        }
    }

    // Convert to sorted array
    return Object.entries(usage)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
}

export function getIOSummary(db: EntityDB) {
    const summary = { DI: 0, DO: 0, AI: 0, AO: 0 };
    const allEntities = [...db.library, ...db.units, ...db.equipmentModules, ...db.controlModules];

    for (const e of allEntities) {
        for (const io of e.io) {
            if (io.signalType in summary) {
                summary[io.signalType as keyof typeof summary]++;
            }
        }
    }
    return summary;
}

// ─── Empty Block Creator ────────────────────────────────

export function createEmptyBlock(level: 'UN' | 'EM' | 'CM' | 'FB', name: string, author: string = ''): any {
    const base = {
        id: generateId(),
        name,
        description: '',
        category: 'Other' as const,
        level,
        variables: [],
        alarms: [],
        io: [],
        dfmea: [],
        revisions: [{ version: '1.0', date: new Date().toISOString().split('T')[0], author, notes: 'Created' }],
        code: '',
        currentVersion: '1.0',
        lastModifiedBy: author,
        status: 'Draft' as const,
    };

    if (level === 'UN') {
        return { ...base, assignedFBs: [], assignedEMs: [], checklist: [], devTimes: { plcHours: 0, hmiHours: 0, commissioningHours: 0 } };
    }
    if (level === 'EM') {
        return { ...base, assignedFBs: [], assignedCMs: [], checklist: [], devTimes: { plcHours: 0, hmiHours: 0, commissioningHours: 0 } };
    }
    if (level === 'CM') {
        return { ...base, assignedFBs: [], checklist: [], devTimes: { plcHours: 0, hmiHours: 0, commissioningHours: 0 } };
    }
    return base;
}

