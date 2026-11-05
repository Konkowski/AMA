// ============================================================
// AMA — Git-First Export Utility (flat model)
//
// File layout philosophy:
//  - one stable-ordered JSON per entity  → minimal, meaningful git diffs
//  - Markdown where HUMANS read (README, assembly_tree, docs/FDS)
//  - docs/Machine_Description.md + network_topology.json + generated/*
//    where AI AGENTS read (complete, self-contained context)
//  - assembly_state.json carries the exact app state for round-trip import
// ============================================================
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { FunctionBlock, Unit, EquipmentModule, ControlModule, BlockBase, AssemblyProject, AssemblyNode } from '../types/machine';
import type { EntityDB } from './helpers';
import { findEntityById, generateFDS } from './helpers';
import { buildGeneratedFiles, generateBomCsv } from './codeGen';

// Canonical key order for entity JSON files: stable ordering means a change
// to one field produces a one-line git diff instead of a reshuffled file.
const ENTITY_KEY_ORDER = [
    'id', 'name', 'level', 'category', 'description', 'currentVersion', 'lastModifiedBy',
    'hardware', 'assignedFBs', 'assignedEMs', 'assignedCMs',
    'variables', 'alarms', 'io', 'dfmea', 'bom', 'checklist', 'devTimes',
    'revisions', 'code',
];
const VAR_KEY_ORDER = ['id', 'name', 'description', 'scope', 'dataType', 'customDataType', 'address', 'controllerScope'];

function orderKeys(obj: any, order: string[]): any {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const out: any = {};
    for (const k of order) if (k in obj) out[k] = obj[k];
    for (const k of Object.keys(obj).sort()) if (!(k in out)) out[k] = obj[k];
    return out;
}

/** Entity → stable, diff-friendly JSON text. */
export function entityToStableJson(entity: BlockBase): string {
    const e: any = orderKeys(entity, ENTITY_KEY_ORDER);
    if (Array.isArray(e.variables)) e.variables = e.variables.map((v: any) => orderKeys(v, VAR_KEY_ORDER));
    return JSON.stringify(e, null, 2) + '\n';
}

function sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Per-folder name claimer: two entities sanitizing to the same name get _2, _3, … suffixes instead of overwriting each other's files. */
function makeNamer(): (name: string) => string {
    const used = new Map<string, number>();
    return (name: string) => {
        const n = used.get(name) || 0;
        used.set(name, n + 1);
        return n === 0 ? name : `${name}_${n + 1}`;
    };
}

/** Collect the refIds of every entity actually placed in the assembly tree. */
function collectAssemblyRefIds(tree: AssemblyNode[]): Set<string> {
    const ids = new Set<string>();
    const walk = (nodes: AssemblyNode[]) => {
        for (const n of nodes) {
            ids.add(n.refId);
            walk(n.children);
        }
    };
    walk(tree);
    return ids;
}

interface FileMap { [path: string]: string; }

/**
 * Build a flat map of path → JSON content for the Architecture + Assembly.
 */
export function buildGitStructure(assembly: AssemblyProject, db: EntityDB): FileMap {
    const files: FileMap = {};

    // Scope the export to the machine actually assembled. With an empty
    // assembly tree there is nothing to scope by, so fall back to the full DB.
    const usedIds = collectAssemblyRefIds(assembly.tree);
    const scoped = usedIds.size > 0;
    const inScope = <T extends BlockBase>(list: T[]): T[] =>
        scoped ? list.filter(e => usedIds.has(e.id)) : list;

    const scopedUnits = inScope(db.units);
    const scopedEMs = inScope(db.equipmentModules);
    const scopedCMs = inScope(db.controlModules);
    // FBs are referenced through entities' assignedFBs, not placed directly
    // in the assembly tree — scope them through the assembled entities.
    const fbIdsInUse = new Set<string>();
    for (const e of [...scopedUnits, ...scopedEMs, ...scopedCMs]) {
        for (const id of (e as any).assignedFBs || []) fbIdsInUse.add(id);
    }
    const scopedLibrary = scoped
        ? db.library.filter(fb => usedIds.has(fb.id) || fbIdsInUse.has(fb.id))
        : db.library;

    // Full assembly state (tree, SBOM, network topology with layout):
    // makes the ZIP round-trip importable via "Importa ZIP Git".
    files['assembly_state.json'] = JSON.stringify(assembly, null, 2) + '\n';

    // Assembly project metadata (small, human-scannable)
    files['assembly.json'] = JSON.stringify({
        id: assembly.id,
        name: assembly.name,
        description: assembly.description,
        secondaryDescription: assembly.secondaryDescription,
        version: assembly.version,
        treeNodeCount: assembly.tree.length,
        exportScope: scoped ? 'assembled-entities-only' : 'full-database',
        sbom: assembly.sbom || []
    }, null, 2) + '\n';

    // 1. Library FBs (software_library/function_blocks/)
    const fbNamer = makeNamer();
    scopedLibrary.forEach(fb => {
        const safeName = fbNamer(sanitize(fb.name));
        files[`software_library/function_blocks/${safeName}.json`] = entityToStableJson(fb);
        if (fb.code && fb.code.trim().length > 0) {
            files[`software_library/function_blocks/${safeName}.scl`] = fb.code;
        }
    });

    // 2. Physical hierarchy entities (stable key order → clean diffs)
    const unNamer = makeNamer();
    scopedUnits.forEach(un => {
        files[`physical_hierarchy/units/${unNamer(sanitize(un.name))}.json`] = entityToStableJson(un);
    });
    const emNamer = makeNamer();
    scopedEMs.forEach(em => {
        files[`physical_hierarchy/equipment_modules/${emNamer(sanitize(em.name))}.json`] = entityToStableJson(em);
    });
    const cmNamer = makeNamer();
    scopedCMs.forEach(cm => {
        files[`physical_hierarchy/control_modules/${cmNamer(sanitize(cm.name))}.json`] = entityToStableJson(cm);
    });

    // 3. Assembly tree — one human-readable Markdown file instead of the old
    // folder sprawl (one ref.json per node) and the fully-resolved duplicate
    // tree, both of which polluted git history with redundant data.
    {
        const lines: string[] = [
            `# Assembly Tree — ${assembly.name}`,
            '',
            `Project version: v${assembly.version}`,
            '',
        ];
        const walkMd = (nodes: AssemblyNode[], depth: number) => {
            for (const n of nodes) {
                const entity = findEntityById(db, n.refId);
                const name = entity?.name || n.refId;
                const extra = entity ? ` — v${entity.currentVersion}${entity.description ? ` · ${entity.description.split('\n')[0].slice(0, 80)}` : ''}` : ' (missing reference!)';
                lines.push(`${'  '.repeat(depth)}- **[${n.level}] ${name}**${extra}`);
                walkMd(n.children, depth + 1);
            }
        };
        walkMd(assembly.tree, 0);
        lines.push('');
        files['assembly_tree.md'] = lines.join('\n');
    }

    // Machine Description markdown is assembled below but not written to the ZIP.
    let md = `# Machine Specification: ${assembly.name}\n\n`;
    if (assembly.description) md += `**Description:** ${assembly.description}\n\n`;
    if (assembly.secondaryDescription) md += `**Secondary Description:** ${assembly.secondaryDescription}\n\n`;
    md += `*Generated automatically from the Assembly Tree & Architecture Database for the Siemens Agent / Siemens Copilot.*\n\n`;

    // Hardware SBOM
    if (assembly.sbom && assembly.sbom.length > 0) {
        md += `## Hardware Configuration & SBOM\n\n`;
        md += `| Hardware Item | Type | Firmware / Version | Quantity | IP Address | MAC Address | Security Zone (IEC 62443) | VLAN | Notes |\n`;
        md += `|---|---|---|---:|---|---|---|---|---|\n`;
        assembly.sbom.forEach(hw => {
            md += `| ${hw.hardware} | ${hw.type} | ${hw.firmware || '-'} | ${hw.quantity} | ${hw.ipAddress || '-'} | ${hw.macAddress || '-'} | ${hw.securityZone || '-'} | ${hw.vlanId || '-'} | ${hw.notes || '-'} |\n`;
        });
        md += `\n`;
    }

    // Network Topology
    if (assembly.networkNodes && assembly.networkNodes.length > 0) {
        const sbom = assembly.sbom || [];
        md += `## Industrial Network Connections & Protocols\n\n`;
        md += `This section specifies the interconnection of hardware modules, IP mapping, and protocol configurations (e.g. OPC UA, PROFINET, Modbus).\n\n`;
        
        md += `### Network Devices & IP List\n\n`;
        md += `| Device Label | Model / Hardware | Type | IP Address | MAC Address | Security Zone (IEC 62443) | VLAN ID | Notes |\n`;
        md += `|---|---|---|---|---|---|---|---|\n`;
        assembly.networkNodes.forEach((node: any) => {
            const sbomItem = sbom.find((item: any) => item.id === node.sbomId);
            const label = sbomItem?.hardware || node.label || 'Unknown';
            const model = sbomItem?.hardware || '-';
            const type = sbomItem?.type || node.type || 'Hardware';
            const ip = sbomItem?.ipAddress || node.ip || '-';
            const mac = sbomItem?.macAddress || '-';
            const zone = sbomItem?.securityZone || '-';
            const vlan = sbomItem?.vlanId || '-';
            const notes = sbomItem?.notes || node.note || '-';
            md += `| ${label} | ${model} | ${type} | ${ip} | ${mac} | ${zone} | ${vlan} | ${notes} |\n`;
        });
        md += `\n`;

        if (assembly.networkEdges && assembly.networkEdges.length > 0) {
            md += `### Physical & Logical Topology Connections\n\n`;
            md += `| Source Device | Target Device | Connection Protocol | Port Configuration | Subnet Mask | Gateway | Encrypted | Firewall | Target SL (SL-T) |\n`;
            md += `|---|---|---|---|---|---|:---:|:---:|---|\n`;
            assembly.networkEdges.forEach((edge: any) => {
                const srcNode = assembly.networkNodes?.find((n: any) => n.id === edge.source);
                const tgtNode = assembly.networkNodes?.find((n: any) => n.id === edge.target);
                const srcSbom = sbom.find((item: any) => item.id === srcNode?.sbomId);
                const tgtSbom = sbom.find((item: any) => item.id === tgtNode?.sbomId);

                const srcLabel = srcSbom?.hardware || srcNode?.label || 'Unknown';
                const tgtLabel = tgtSbom?.hardware || tgtNode?.label || 'Unknown';

                const proto = edge.protocol === 'Other' ? (edge.customProtocol || 'Custom') : (edge.protocol || 'Unknown');
                const portInfo = edge.sourcePort || edge.targetPort ? `${edge.sourcePort || '*'} → ${edge.targetPort || '*'}` : 'N/A';
                const subnet = edge.subnetMask || '-';
                const gw = edge.gateway || '-';
                const enc = edge.isEncrypted ? '✅ Yes' : '❌ No';
                const fw = edge.isFirewalled ? '✅ Yes' : '❌ No';
                const sl = edge.iecSecurityLevel || 'None';

                md += `| **${srcLabel}** (${srcSbom?.ipAddress || ''}) | **${tgtLabel}** (${tgtSbom?.ipAddress || ''}) | **${proto}** | ${portInfo} | ${subnet} | ${gw} | ${enc} | ${fw} | ${sl} |\n`;
            });
            md += `\n`;
        }
    }

    // Component details — only entities placed in the assembly tree
    md += `## ISA-88 Physical & Software Modules\n\n`;
    md += scoped
        ? `All software and physical blocks **assembled on this machine**, ordered from high-level Units down to Control Modules and Function Blocks.\n\n`
        : `All software and physical blocks in the architecture database (the assembly tree is empty, so the full database is listed), ordered from high-level Units down to Control Modules and Function Blocks.\n\n`;

    const usedEntities: BlockBase[] = [
        ...scopedUnits,
        ...scopedEMs,
        ...scopedCMs,
        ...scopedLibrary
    ];

    const levelOrder = { 'UN': 1, 'EM': 2, 'CM': 3, 'FB': 4 };
    usedEntities.sort((a, b) => (levelOrder[a.level as keyof typeof levelOrder] || 99) - (levelOrder[b.level as keyof typeof levelOrder] || 99));

    usedEntities.forEach(entity => {
        md += `### [${entity.level}] ${entity.name}\n\n`;
        if (entity.description) md += `**Description:** ${entity.description}\n\n`;
        md += `- **Version:** v${entity.currentVersion}\n`;
        md += `- **Category:** ${entity.category}\n`;
        md += `- **Last Modified By:** ${entity.lastModifiedBy || 'Unknown'}\n\n`;

        // Assigned sub-components info
        if ('assignedEMs' in entity && (entity as any).assignedEMs?.length > 0) {
            md += `**Assigned Equipment Modules (EMs):**\n`;
            (entity as any).assignedEMs.forEach((emId: string) => {
                const em = db.equipmentModules.find(x => x.id === emId);
                if (em) md += `- [EM] ${em.name}\n`;
            });
            md += `\n`;
        }
        if ('assignedCMs' in entity && (entity as any).assignedCMs?.length > 0) {
            md += `**Assigned Control Modules (CMs):**\n`;
            (entity as any).assignedCMs.forEach((cmId: string) => {
                const cm = db.controlModules.find(x => x.id === cmId);
                if (cm) md += `- [CM] ${cm.name}\n`;
            });
            md += `\n`;
        }
        if ('assignedFBs' in entity && (entity as any).assignedFBs?.length > 0) {
            md += `**Assigned Function Blocks (FBs):**\n`;
            (entity as any).assignedFBs.forEach((fbId: string) => {
                const fb = db.library.find(x => x.id === fbId);
                if (fb) md += `- [FB] ${fb.name}\n`;
            });
            md += `\n`;
        }

        // Variables Table
        if (entity.variables && entity.variables.length > 0) {
            md += `#### Variables\n\n`;
            md += `| Variable Name | Scope | Data Type | PLC Address | Description |\n`;
            md += `|---|---|---|---|---|\n`;
            entity.variables.forEach(v => {
                md += `| ${v.name} | ${v.scope} | ${v.dataType}${v.customDataType ? ` (${v.customDataType})` : ''} | ${v.address || '-'} | ${v.description || '-'} |\n`;
            });
            md += `\n`;
        }

        // Alarms Table
        if (entity.alarms && entity.alarms.length > 0) {
            md += `#### Alarms & Warnings\n\n`;
            md += `| Alarm ID | Level | Message | Trigger Variable | Action | Possible Causes | Possible Solutions |\n`;
            md += `|---|---|---|---|---|---|---|\n`;
            entity.alarms.forEach(al => {
                md += `| ${al.alarmId} | ${al.level} | ${al.message} | ${al.triggerVariable} | ${al.action} | ${al.possibleCauses || '-'} | ${al.possibleSolutions || '-'} |\n`;
            });
            md += `\n`;
        }

        // I/O Signals Table
        if (entity.io && entity.io.length > 0) {
            md += `#### Physical I/O Mapping\n\n`;
            md += `| Signal ID | Signal Type | Address | Linked PLC Variable | Data Type | Description |\n`;
            md += `|---|---|---|---|---|---|\n`;
            entity.io.forEach(io => {
                md += `| ${io.signalId} | ${io.signalType} | ${io.address} | ${io.variable} | ${io.dataType}${io.customDataType ? ` (${io.customDataType})` : ''} | ${io.description || '-'} |\n`;
            });
            md += `\n`;
        }

        // DFMEA Table
        if (entity.dfmea && entity.dfmea.length > 0) {
            md += `#### Safety & DFMEA (Failure Modes & Effects Analysis)\n\n`;
            md += `| Failure Mode | Effect of Failure | Root Cause | Preventive Controls | Recommended Actions | Severity | Occurrence | Detection | RPN | Status |\n`;
            md += `|---|---|---|---|---|---:|---:|---:|---:|---|\n`;
            entity.dfmea.forEach(df => {
                const rpnVal = df.rpn || (df.severity * df.occurrence * df.detection);
                md += `| ${df.failureMode} | ${df.effect} | ${df.cause} | ${df.controls} | ${df.actions} | ${df.severity} | ${df.occurrence} | ${df.detection} | **${rpnVal}** | ${df.status} |\n`;
            });
            md += `\n`;
        }



        // Logic SCL Code block
        if (entity.code && entity.code.trim().length > 0) {
            md += `#### Structured Text / SCL Logic Interface\n\n`;
            md += `\`\`\`pascal\n${entity.code}\n\`\`\`\n\n`;
        }

        md += `---\n\n`;
    });

    // For AI agents: complete machine context in one document
    files['docs/Machine_Description.md'] = md;

    // For humans: the Functional Design Specification
    files['docs/FDS.md'] = generateFDS(assembly, db);

    // 8. Deterministic code scaffolding (SCL interfaces, PLC tags, HMI alarms)
    Object.assign(files, buildGeneratedFiles(usedEntities, db));

    // 9. Procurement BOM from the machine SBOM
    if ((assembly.sbom || []).length > 0) {
        files['generated/purchasing_bom.csv'] = generateBomCsv(assembly.sbom || []);
    }

    // 10. Root README — the human entry point of the repository
    files['README.md'] = [
        `# ${assembly.name}`,
        '',
        `> ${assembly.description || 'AMA project.'}`,
        assembly.secondaryDescription ? `>\n> ${assembly.secondaryDescription}` : '',
        '',
        `**Version:** v${assembly.version} · **Exported:** ${new Date().toISOString().slice(0, 10)} · **Scope:** ${scoped ? 'assembled entities only' : 'complete database'}`,
        '',
        '## Contents',
        '',
        `| Path | Content | For whom |`,
        `|---|---|---|`,
        `| \`assembly_tree.md\` | Assembly tree of the machine (${scopedUnits.length} UN, ${scopedEMs.length} EM, ${scopedCMs.length} CM) | Humans |`,
        `| \`physical_hierarchy/\` | One JSON per entity (UN/EM/CM) — stable key order, clean diffs | Git / Humans |`,
        `| \`software_library/\` | Function Block riusabili (${scopedLibrary.length}) with \`.scl\` code | Git / Humans |`,
        `| \`docs/FDS.md\` | Generated Functional Design Specification | Humans |`,
        `| \`generated/\` | SCL scaffolding, PLC tags, HMI alarms, purchasing BOM | AI Agents / Purchasing |`,
        `| \`assembly_state.json\` | Exact project state — re-importable in AMA | AMA |`,
        '',
        '## How to use',
        '',
        '- **Resume work:** in AMA → *Import Project* → select the ZIP of this folder (or `assembly_state.json` together with the entities).',
        '- **Generate PLC code (Rockwell):** import the `.L5X` in Studio 5000. **Generate PLC code (Siemens):** use the TIA Portal (Openness) package from the Export page.',
        '- **Reviewing changes:** every entity is one file: `git diff` shows exactly what changed and in which module.',
        '',
        '---',
        `*Generated by AMA — Automation Machine Architecture.*`,
        '',
    ].filter(l => l !== undefined).join('\n');

    return files;
}

/**
 * Round-trip import of a Git export ZIP: rebuilds the entity lists from the
 * per-entity JSON files and the assembly from assembly_state.json (with a
 * fallback to assembly.json + assembly_full_tree.json for older exports).
 * Returns null when the ZIP does not look like an AMA Git export.
 */
export async function importGitZip(
    file: File | Blob | string | ArrayBuffer | Uint8Array,
    opts?: { base64?: boolean },
): Promise<{
    library: FunctionBlock[];
    units: Unit[];
    equipmentModules: EquipmentModule[];
    controlModules: ControlModule[];
    assembly: AssemblyProject;
} | null> {
    const zip = await JSZip.loadAsync(file as any, opts?.base64 ? { base64: true } : undefined);

    const library: FunctionBlock[] = [];
    const units: Unit[] = [];
    const equipmentModules: EquipmentModule[] = [];
    const controlModules: ControlModule[] = [];
    let assembly: AssemblyProject | null = null;
    let assemblyMeta: any = null;
    let fullTree: any[] | null = null;

    const tasks: Promise<void>[] = [];
    zip.forEach((relPath, entry) => {
        if (entry.dir) return;
        const path = relPath.replace(/\\/g, '/');
        const readJson = (apply: (data: any) => void) => {
            tasks.push(entry.async('string').then(text => {
                try { apply(JSON.parse(text)); } catch { /* skip malformed file */ }
            }));
        };
        if (/software_library\/function_blocks\/[^/]+\.json$/.test(path)) readJson(d => library.push(d));
        else if (/physical_hierarchy\/units\/[^/]+\.json$/.test(path)) readJson(d => units.push(d));
        else if (/physical_hierarchy\/equipment_modules\/[^/]+\.json$/.test(path)) readJson(d => equipmentModules.push(d));
        else if (/physical_hierarchy\/control_modules\/[^/]+\.json$/.test(path)) readJson(d => controlModules.push(d));
        else if (/(^|\/)assembly_state\.json$/.test(path)) readJson(d => { assembly = d; });
        else if (/(^|\/)assembly\.json$/.test(path)) readJson(d => { assemblyMeta = d; });
        else if (/(^|\/)assembly_full_tree\.json$/.test(path)) readJson(d => { fullTree = d; });
    });
    await Promise.all(tasks);

    const entityCount = library.length + units.length + equipmentModules.length + controlModules.length;
    if (entityCount === 0 && !assembly && !assemblyMeta) return null;

    if (!assembly) {
        // Older export without assembly_state.json: rebuild what we can
        const stripNode = (n: any): AssemblyNode => ({
            id: n.id,
            refId: n.refId,
            level: n.entityLevel || n.level,
            children: (n.children || []).map(stripNode),
        });
        assembly = {
            id: assemblyMeta?.id,
            name: assemblyMeta?.name || 'Imported Project',
            description: assemblyMeta?.description || 'Imported from Git ZIP.',
            secondaryDescription: assemblyMeta?.secondaryDescription || '',
            version: assemblyMeta?.version || '1.0.0',
            tree: (fullTree || []).map(stripNode),
            sbom: assemblyMeta?.sbom || [],
            networkNodes: [],
            networkEdges: [],
        };
    }

    return { library, units, equipmentModules, controlModules, assembly };
}

export async function downloadAsZip(assembly: AssemblyProject, db: EntityDB): Promise<void> {
    const structure = buildGitStructure(assembly, db);
    const zip = new JSZip();
    const rootFolder = zip.folder(sanitize(assembly.name)) || zip;

    Object.entries(structure).forEach(([path, content]) => {
        rootFolder.file(path, content);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${sanitize(assembly.name)}_git_export.zip`);
}
