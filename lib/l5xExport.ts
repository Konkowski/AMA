// ============================================================
// AMA — Studio 5000 L5X Export
// Generates a controller .L5X importable in Studio 5000:
//   - Programs from assembled UN/EM/CM (program tags = variables,
//     Main ST routine = entity code)
//   - AOI definitions from library FBs
//   - Controller alias tags from I/O signals (real addresses)
//   - Hardware Modules from the SBOM / network topology, using
//     verbatim device templates (PowerFlex 525, 1734 Point I/O,
//     generic Ethernet) so the config blobs are valid
//   - UDT stubs for custom types not covered by AOIs
// Schema mirrored from a real Studio 5000 v38 export.
// ============================================================
import { saveAs } from 'file-saver';
import type { AssemblyProject, AssemblyNode, BlockBase, Variable, FunctionBlock } from '../types/machine';
import type { EntityDB } from './helpers';
import {
    TPL_CONTROLLER_LOCAL, TPL_POINT_IO_ADAPTER, TPL_POINT_IO_IB8,
    TPL_POINT_IO_OB8, TPL_POINT_IO_IK, TPL_POWERFLEX_525, TPL_GENERIC_ETHERNET,
} from './l5xTemplates';

// ─── Helpers ────────────────────────────────────────────────
const xmlEsc = (s: string) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s: string) => `<![CDATA[${String(s ?? '').replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
const logixName = (s: string) => {
    let n = String(s ?? '').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!n) n = 'Unnamed';
    if (/^[0-9]/.test(n)) n = `_${n}`;
    return n.slice(0, 40);
};

/**
 * Studio 5000 rejected an import with "Invalid description" over an em-dash:
 * real Rockwell exports contain ASCII only (and cap descriptions at 480).
 * Transliterate accents/punctuation to ASCII and drop anything else.
 */
function toAscii(s: string): string {
    return String(s ?? '')
        .replace(/[‒-―−]/g, '-')            // dashes
        .replace(/[‘’‚′]/g, "'")       // quotes
        .replace(/[“”„″]/g, '"')
        .replace(/…/g, '...')
        .replace(/[°]/g, ' deg')
        .replace(/[µμ]/g, 'u')
        .replace(/[×]/g, 'x')
        .replace(/[ ]/g, ' ')
        .replace(/[àáâãäå]/g, 'a').replace(/[ÀÁÂÃÄÅ]/g, 'A')
        .replace(/[èéêë]/g, 'e').replace(/[ÈÉÊË]/g, 'E')
        .replace(/[ìíîï]/g, 'i').replace(/[ÌÍÎÏ]/g, 'I')
        .replace(/[òóôõö]/g, 'o').replace(/[ÒÓÔÕÖ]/g, 'O')
        .replace(/[ùúûü]/g, 'u').replace(/[ÙÚÛÜ]/g, 'U')
        .replace(/[ç]/g, 'c').replace(/[Ç]/g, 'C')
        .replace(/[ñ]/g, 'n').replace(/[Ñ]/g, 'N')
        .replace(/[ýÿ]/g, 'y').replace(/[Ý]/g, 'Y')
        .replace(/ß/g, 'ss')
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');         // drop the rest
}

/** Sanitized description text (ASCII, length-capped; Logix limit is 480). */
function logixDesc(s: string, max = 400): string {
    const t = toAscii(s).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

/** <Description> element laid out like a real Rockwell export (own lines). */
function descXml(s: string, max = 400): string {
    const t = logixDesc(s, max);
    return t ? `<Description>\n${cdata(t)}\n</Description>\n` : '';
}

/** Date in the ctime format Rockwell uses: "Sun May 31 20:57:11 2026". */
function logixDate(d: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = (n: number) => String(n).padStart(2, '0');
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()}`;
}

// Built-in Logix types that custom AMA types may legitimately reference.
// Includes MODULE (module-reference InOut), FBD_TIMER, MESSAGE etc. — emitting
// any of these as a user UDT stub makes Studio 5000 reject the import.
const LOGIX_BUILTINS = new Set([
    'BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT',
    'REAL', 'LREAL', 'STRING', 'TIMER', 'COUNTER', 'CONTROL', 'PID', 'MESSAGE',
    'MOTION_INSTRUCTION', 'AXIS_CIP_DRIVE', 'AXIS_VIRTUAL', 'ALARM_DIGITAL', 'ALARM_ANALOG',
    'MODULE', 'CONNECTION', 'FBD_TIMER', 'FBD_COUNTER', 'PHASE', 'CAM', 'CAM_PROFILE',
    'MOTION_GROUP', 'COORDINATE_SYSTEM', 'AXIS_CONSUMED', 'AXIS_GENERIC', 'AXIS_GENERIC_DRIVE',
    'AXIS_SERVO', 'AXIS_SERVO_DRIVE', 'SFC_STEP', 'SFC_ACTION', 'SFC_STOP',
]);

/** Motion objects (motion group, axes, coordinate systems) are configured in the
 *  Motion Group / drive setup, not as plain tags: a bare tag of these types makes
 *  Studio 5000 reject the import at "Motion". They are left out and listed in a
 *  comment so they can be created by hand. */
const isMotionObject = (dt: string) => /^(MOTION_GROUP|COORDINATE_SYSTEM|AXIS_[A-Z_]+)$/i.test(dt);

/** True for module-defined connection types (e.g. "AB:PowerFlex...:I:0",
 *  "_06FD:000C_11F8:O:0") — Studio 5000 auto-creates these from the module
 *  definitions on import, so they must never be emitted as user UDT stubs. */
function isModuleDefinedType(raw: string): boolean {
    return /:/.test(String(raw || ''));
}
const ATOMIC = new Set(['BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'REAL']);

/** REAL tags use Radix="Float" — Decimal on a REAL is rejected on import. */
const radixAttr = (dataType: string) =>
    dataType === 'REAL' || dataType === 'LREAL' ? ' Radix="Float"'
        : ATOMIC.has(dataType) ? ' Radix="Decimal"' : '';

interface LogixType { dataType: string; dimensions?: number }

/** Map an AMA variable to a Logix data type (+ array dimension). */
function logixTypeOf(v: Variable): LogixType {
    switch (v.dataType) {
        case 'TIME': return { dataType: 'DINT' };          // Logix has no TIME tag type
        case 'WORD': return { dataType: 'INT' };
        case 'DWORD': return { dataType: 'DINT' };
        case 'ARRAY OF': {
            // parse e.g. "ARRAY[0..9] OF BOOL" / "Struct_Recipe[100]" from
            // customDataType — built-ins uppercased, UDT names keep casing
            const c = v.customDataType || '';
            const norm = (n: string) => LOGIX_BUILTINS.has(n.toUpperCase()) ? n.toUpperCase() : n;
            const m1 = c.match(/ARRAY\s*\[\s*\d+\s*\.\.\s*(\d+)\s*\]\s*OF\s*(\w+)/i);
            if (m1) return { dataType: norm(m1[2]), dimensions: parseInt(m1[1]) + 1 };
            const m2 = c.match(/^(\w+)\s*\[\s*(\d+)\s*\]$/);
            if (m2) return { dataType: norm(m2[1]), dimensions: parseInt(m2[2]) };
            return { dataType: 'DINT', dimensions: 10 };
        }
        case 'System':
        case 'Union OF':
        case 'Other': {
            const raw = v.customDataType || 'DINT';
            // Module-defined I/O connection types are created by the modules
            // themselves; a program/AOI tag can't legally reference them, so
            // fall back to DINT rather than emitting a broken reference.
            if (isModuleDefinedType(raw)) return { dataType: 'DINT' };
            const upper = raw.toUpperCase();
            if (upper === 'TON' || upper === 'TOF' || upper === 'FBD_TIMER') return { dataType: 'TIMER' };
            return { dataType: logixName(raw) };
        }
        default:
            return { dataType: v.dataType };
    }
}

function collectAssemblyRefIds(tree: AssemblyNode[]): Set<string> {
    const ids = new Set<string>();
    const walk = (nodes: AssemblyNode[]) => {
        for (const n of nodes) { ids.add(n.refId); walk(n.children); }
    };
    walk(tree);
    return ids;
}

/** Replace the Name attribute, port address / IP and description of a module template. */
function instantiateModule(tpl: string, opts: {
    name: string; ip?: string; slot?: string; parent?: string; description?: string;
}): string {
    let xml = tpl;
    xml = xml.replace(/^<Module Name="[^"]*"/, `<Module Name="${xmlEsc(opts.name)}"`);
    if (opts.parent) xml = xml.replace(/ParentModule="[^"]*"/, `ParentModule="${xmlEsc(opts.parent)}"`);
    if (opts.ip) xml = xml.replace(/(<Port[^>]*Type="Ethernet"[^>]*Address=")[^"]*(")/, `$1${xmlEsc(opts.ip)}$2`)
        .replace(/(Address=")(\d{1,3}(?:\.\d{1,3}){3})(")/, `$1${xmlEsc(opts.ip)}$3`);
    if (opts.slot !== undefined) {
        // first non-Ethernet port address = chassis slot
        xml = xml.replace(/(<Port Id="1" Address=")[^"]*(" Type="(?!Ethernet)[^"]*")/, `$1${xmlEsc(opts.slot)}$2`);
    }
    if (opts.description !== undefined) {
        const safe = logixDesc(opts.description);
        if (/<Description>/.test(xml)) {
            xml = xml.replace(/<Description>\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Description>/, `<Description>${cdata(safe)}</Description>`);
        } else {
            xml = xml.replace(/(<Module[^>]*>)/, `$1<Description>${cdata(safe)}</Description>`);
        }
    }
    return xml;
}

// ─── Hardware modules from SBOM + network topology ──────────
function generateModulesList(assembly: AssemblyProject, codeModuleRefs: Set<string> = new Set()): string[] {
    const sbom = assembly.sbom || [];
    const nodes = assembly.networkNodes || [];
    const parts: string[] = [TPL_CONTROLLER_LOCAL];

    const catalogOf = (hw: string) => {
        const m = String(hw || '').match(/\(([^)]+)\)/);
        return m ? m[1] : String(hw || '');
    };

    // The PLC code references modules by their short device tag (INV1, A0,
    // IK4 …) — extract it from the topology label so rung references resolve
    // instead of producing names like "INV1_PowerFlex_525".
    const shortDeviceName = (label: string): string | null => {
        for (const w of String(label || '').split(/[\s\-()\/,:]+/)) {
            if (/^[A-Za-z]{1,6}[0-9]+(_[0-9]+)?$/.test(w) && !/^\d/.test(w)) return w;
        }
        return null;
    };

    // Resolve per-device info: prefer network nodes (one per physical device,
    // each with its own IP); fall back to SBOM rows expanded by quantity.
    interface Device { name: string; label: string; ip: string; catalog: string; hardware: string; notes: string }
    const devices: Device[] = [];
    if (nodes.length > 0) {
        for (const n of nodes) {
            const item = sbom.find(h => h.id === (n as any).sbomId);
            const hardware = item?.hardware || (n as any).label || '';
            const label = (n as any).label || hardware;
            devices.push({
                name: logixName(shortDeviceName(label) || label),
                label,
                // The node's own IP wins: one SBOM row (qty N) is shared by N
                // devices, so its IP is only a fallback — using it first gave
                // every drive the same address ("Duplicate IP Address" on import).
                ip: (n as any).ip || item?.ipAddress || '',
                catalog: catalogOf(hardware),
                hardware,
                notes: item?.notes || (n as any).note || '',
            });
        }
    } else {
        for (const h of sbom) {
            for (let i = 0; i < Math.max(1, h.quantity || 1); i++) {
                devices.push({
                    name: logixName(h.hardware) + (h.quantity > 1 ? `_${i + 1}` : ''),
                    label: h.hardware,
                    ip: i === 0 ? (h.ipAddress || '') : '',
                    catalog: catalogOf(h.hardware),
                    hardware: h.hardware,
                    notes: h.notes || '',
                });
            }
        }
    }

    // The PLC code is the authority on module names: when a module reference
    // in the code (e.g. "OmronNJ:O.Data[13]") has no matching device name,
    // rename the device whose label condenses to it (Omron NJ501 … → OmronNJ).
    const condensed = (s: string) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const deviceNames = new Set(devices.map(d => d.name));
    for (const ref of codeModuleRefs) {
        if (deviceNames.has(ref)) continue;
        const matches = devices.filter(d =>
            !codeModuleRefs.has(d.name) && condensed(d.label).includes(condensed(ref)));
        if (matches.length === 1) {
            deviceNames.delete(matches[0].name);
            matches[0].name = logixName(ref);
            deviceNames.add(matches[0].name);
        }
    }

    const isCat = (d: Device, re: RegExp) => re.test(d.catalog) || re.test(d.hardware);
    const seen = new Set<string>();
    const claim = (base: string) => {
        let n = base, i = 2;
        while (seen.has(n)) n = `${base}_${i++}`;
        seen.add(n);
        return n;
    };

    // Point I/O adapter + rack (slots: IB8 inputs first, then IK, then OB8)
    const adapter = devices.find(d => isCat(d, /1734-AENTR/i));
    if (adapter) {
        const adapterName = claim(logixName(adapter.name) || 'A0');
        parts.push(instantiateModule(TPL_POINT_IO_ADAPTER, {
            name: adapterName, ip: adapter.ip, description: adapter.notes || adapter.hardware,
        }));
        let slot = 1;
        const rack = (re: RegExp, tpl: string, prefix: string) => {
            const rows = sbom.filter(h => re.test(catalogOf(h.hardware)) || re.test(h.hardware));
            for (const row of rows) {
                for (let i = 0; i < Math.max(1, row.quantity || 1); i++) {
                    parts.push(instantiateModule(tpl, {
                        name: claim(`${prefix}${slot}`), parent: adapterName,
                        slot: String(slot), description: row.hardware,
                    }));
                    slot++;
                }
            }
        };
        rack(/1734-IB8/i, TPL_POINT_IO_IB8, 'A');
        rack(/1734-IK/i, TPL_POINT_IO_IK, 'IK');
        rack(/1734-OB8/i, TPL_POINT_IO_OB8, 'A');
    }

    // Studio 5000 rejects modules with duplicate IPs — never emit two.
    const usedIps = new Set<string>();
    if (adapter?.ip) usedIps.add(adapter.ip);
    const claimIp = (ip: string) => {
        if (!ip || usedIps.has(ip)) return false;
        usedIps.add(ip);
        return true;
    };

    // PowerFlex 525 drives — one module per device, each with its IP
    for (const d of devices.filter(x => isCat(x, /PowerFlex\s*525/i))) {
        if (!claimIp(d.ip)) continue;
        parts.push(instantiateModule(TPL_POWERFLEX_525, {
            name: claim(d.name), ip: d.ip, description: d.notes || d.hardware,
        }));
    }

    // Other Ethernet peers (e.g. Omron NJ) as generic ETHERNET-MODULE
    for (const d of devices.filter(x => isCat(x, /NJ501|ETHERNET-MODULE/i))) {
        if (!claimIp(d.ip)) continue;
        parts.push(instantiateModule(TPL_GENERIC_ETHERNET, {
            name: claim(d.name), ip: d.ip, description: d.notes || d.hardware,
        }));
    }

    return parts;
}

// ─── ST code helpers ────────────────────────────────────────
/** Extract the executable body from FUNCTION_BLOCK-style ST (after the last END_VAR). */
function stBody(code: string): string {
    const src = String(code || '');
    const idx = src.lastIndexOf('END_VAR');
    let body = idx >= 0 ? src.slice(idx + 'END_VAR'.length) : src;
    body = body.replace(/END_FUNCTION_BLOCK\s*$/i, '').replace(/^\s*BEGIN\b/i, '').trim();
    return body;
}

/** Heuristic: does this body look like compilable ST, or ladder neutral-text
 *  (XIC/OTE/…) / "ROUTINE x (RLL)" dumps that wouldn't verify as ST? */
function looksLikeST(body: string): boolean {
    if (!body.trim()) return true;
    const ladder = /\b(XIC|XIO|OTE|OTL|OTU|ROUTINE\s+\w+\s*\(RLL\))\b/.test(body);
    if (ladder) return false;
    return /:=|\bIF\b|\bFOR\b|\bWHILE\b|\bCASE\b|\bREPEAT\b/.test(body) || body.trim().length === 0;
}

/** Split a comment line that exceeds the safe length into multiple // lines. */
function wrapCommentLine(line: string, max = 180): string[] {
    if (line.length <= max || !line.trimStart().startsWith('//')) return [line];
    const out: string[] = [];
    let rest = line;
    while (rest.length > max) {
        out.push(rest.slice(0, max));
        rest = `// ${rest.slice(max)}`;
    }
    out.push(rest);
    return out;
}

/** Live ST routine from raw lines (transliterated + wrapped).
 *  TRUE/FALSE literals (IEC style) are not defined in Logix ST — map to 1/0. */
function stRoutineXml(name: string, rawLines: string[]): string {
    const safeLines = rawLines
        .map(toAscii)
        .map(l => l.trimStart().startsWith('//') ? l : l.replace(/\bTRUE\b/gi, '1').replace(/\bFALSE\b/gi, '0'))
        .flatMap(l => wrapCommentLine(l));
    const xmlLines = safeLines.map((l, i) => `<Line Number="${i}">${cdata(l)}</Line>`).join('\n');
    return `<Routine Name="${xmlEsc(name)}" Type="ST">\n<STContent>\n${xmlLines}\n</STContent>\n</Routine>`;
}

interface Rung { comment?: string; text: string }

/** A neutral-text rung starts with an instruction call or a branch. */
const RUNG_START = /^(\[|[A-Za-z_][A-Za-z0-9_]*\s*\()/;

/**
 * Turn ladder neutral-text lines into rungs: // comments attach to the next
 * rung, instruction text accumulates until the closing ';'. Prose lines
 * (multi-line comments whose continuation lacks the leading //, separator
 * "====" art, etc.) become rung comments — joining them into the instruction
 * text caused "Syntax error found while scanning import file".
 */
function rungsFromLines(lines: string[]): Rung[] {
    const rungs: Rung[] = [];
    let comment: string[] = [];
    let buf = '';
    const flush = () => {
        if (!buf) return;
        const text = buf.endsWith(';') ? buf : `${buf};`;
        rungs.push({ comment: comment.length ? comment.join('\n') : undefined, text });
        comment = [];
        buf = '';
    };
    for (const raw of lines) {
        const l = toAscii(raw).trim();
        if (!l) continue;
        if (l.startsWith('//')) { flush(); comment.push(l.replace(/^\/\/\s?/, '')); continue; }
        if (!buf && !RUNG_START.test(l)) { comment.push(l); continue; }   // prose, not an instruction
        buf += (buf ? ' ' : '') + l;
        if (buf.endsWith(';')) flush();
    }
    flush();
    return rungs;
}

function rllRoutineXml(name: string, rungs: Rung[]): string {
    const rungXml = rungs.map((r, i) =>
        `<Rung Number="${i}" Type="N">\n`
        + (r.comment ? `<Comment>\n${cdata(r.comment)}\n</Comment>\n` : '')
        + `<Text>\n${cdata(r.text)}\n</Text>\n</Rung>`
    ).join('\n');
    return `<Routine Name="${xmlEsc(name)}" Type="RLL">\n<RLLContent>\n${rungXml}\n</RLLContent>\n</Routine>`;
}

interface CodeSection { name: string; type: 'RLL' | 'ST'; lines: string[] }

/** Split entity code on "ROUTINE <name> (RLL|ST)" markers. */
function parseCodeSections(body: string): CodeSection[] {
    const sections: CodeSection[] = [];
    let current: CodeSection | null = null;
    const preamble: string[] = [];
    for (const raw of body.split(/\r?\n/)) {
        const m = raw.match(/^\s*(?:\/\/\s*)?ROUTINE\s+([A-Za-z0-9_]+)\s*\(\s*(RLL|ST)\s*\)\s*$/i);
        if (m) {
            if (current) sections.push(current);
            current = { name: logixName(m[1]), type: m[2].toUpperCase() as 'RLL' | 'ST', lines: [] };
        } else if (current) {
            current.lines.push(raw);
        } else {
            preamble.push(raw);
        }
    }
    if (current) sections.push(current);
    // Code before the first marker (if it has substance) becomes its own section
    if (sections.length > 0 && preamble.some(l => l.trim() && !l.trim().startsWith('//'))) {
        const pre = preamble.join('\n');
        sections.unshift({ name: 'Preamble', type: looksLikeST(pre) ? 'ST' : 'RLL', lines: preamble });
    }
    return sections;
}

/**
 * Build the <Routines> content for a program from its AMA code:
 * "ROUTINE x (RLL)" sections become real RLL routines with real rungs,
 * ST becomes live ST, and a Main routine JSRing everything is synthesized
 * when the code doesn't define one.
 */
function buildProgramRoutines(code: string, header: string): string {
    const body = stBody(code);
    const sections = parseCodeSections(body);
    const routines: string[] = [];
    const names: string[] = [];
    const used = new Set<string>(['Main']);
    const claimName = (base: string) => {
        let n = base, i = 2;
        while (used.has(n)) n = `${base}_${i++}`;
        used.add(n);
        return n;
    };

    let hasMain = false;
    if (sections.length === 0) {
        if (looksLikeST(body)) {
            return stRoutineXml('Main', [`// ${header}`, ...body.split(/\r?\n/)]);
        }
        const rungs = rungsFromLines(body.split(/\r?\n/));
        if (rungs.length === 0) {
            return stRoutineXml('Main', [`// ${header}`, '// TODO: implement the logic.']);
        }
        routines.push(rllRoutineXml('Logic', rungs));
        names.push('Logic');
    } else {
        for (const s of sections) {
            // "Mian" — typo present in the source project; normalize it
            const isMain = s.name.toLowerCase() === 'main' || s.name.toLowerCase() === 'mian';
            const name = isMain ? 'Main' : claimName(s.name);
            if (s.type === 'ST') {
                routines.push(stRoutineXml(name, s.lines));
            } else {
                routines.push(rllRoutineXml(name, rungsFromLines(s.lines)));
            }
            if (isMain) hasMain = true;
            else names.push(name);
        }
    }

    if (!hasMain) {
        const jsrRungs: Rung[] = names.map((n, i) => ({
            comment: i === 0 ? header : undefined,
            text: `JSR(${n},0);`,
        }));
        routines.unshift(rllRoutineXml('Main', jsrRungs));
    }
    return routines.filter(r => r).join('\n');
}

// ─── AOIs from library FBs ──────────────────────────────────
/** The single Logic routine of an AOI: real ST stays live, ladder becomes real rungs. */
function buildAoiLogic(code: string, header: string): string {
    const body = stBody(code);
    const sections = parseCodeSections(body);
    if (sections.length > 0) {
        const stOnly = sections.length === 1 && sections[0].type === 'ST';
        if (stOnly) return stRoutineXml('Logic', [`// ${header}`, ...sections[0].lines]);
        const rungs = sections.flatMap(s => rungsFromLines(s.lines));
        if (rungs.length > 0) return rllRoutineXml('Logic', rungs);
    }
    if (looksLikeST(body)) return stRoutineXml('Logic', [`// ${header}`, ...body.split(/\r?\n/)]);
    const rungs = rungsFromLines(body.split(/\r?\n/));
    if (rungs.length > 0) return rllRoutineXml('Logic', rungs);
    return stRoutineXml('Logic', [`// ${header}`, '// TODO: implement the logic.']);
}

/** DefaultData pair as in real Rockwell AOI exports (atomic scalars only). */
function defaultDataXml(dataType: string, dims?: number): string {
    if (!ATOMIC.has(dataType) || dims) return '';
    const v = dataType === 'REAL' ? '0.0' : '0';
    return `<DefaultData Format="L5K">\n${cdata(v)}\n</DefaultData>\n`
        + `<DefaultData Format="Decorated">\n<DataValue DataType="${dataType}"${radixAttr(dataType)} Value="${v}"/>\n</DefaultData>\n`;
}

function generateAOI(fb: FunctionBlock): string {
    const params: string[] = [
        `<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">\n${descXml('Enable Input - System Defined Parameter')}</Parameter>`,
        `<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">\n${descXml('Enable Output - System Defined Parameter')}</Parameter>`,
    ];
    const locals: string[] = [];
    for (const v of fb.variables || []) {
        const rawCustom = v.customDataType || '';
        const t = logixTypeOf(v);
        const name = logixName(v.name);
        if (name === 'EnableIn' || name === 'EnableOut') continue;
        const desc = descXml(v.description || '');
        const dims = t.dimensions ? ` Dimensions="${t.dimensions}"` : '';
        if (v.scope === 'Local') {
            // Radix only on atomic types: a Radix on a structured LocalTag
            // (TIMER, AOI type, …) makes Studio 5000 reject the whole AOI
            locals.push(`<LocalTag Name="${name}" DataType="${xmlEsc(t.dataType)}"${dims}${radixAttr(t.dataType)} ExternalAccess="None">\n${desc}${defaultDataXml(t.dataType, t.dimensions)}</LocalTag>`);
        } else if (ATOMIC.has(t.dataType) && !t.dimensions && v.scope !== 'InOut') {
            const usage = v.scope === 'Input' ? 'Input' : 'Output';
            params.push(`<Parameter Name="${name}" TagType="Base" DataType="${xmlEsc(t.dataType)}" Usage="${usage}"${radixAttr(t.dataType)} Required="false" Visible="true" ExternalAccess="Read/Write">\n${desc}${defaultDataXml(t.dataType)}</Parameter>`);
        } else {
            // structured / array / InOut parameters must be InOut in Logix;
            // module-defined connection types (AB:…:I:0) are legal here and
            // must be kept verbatim
            const ioType = isModuleDefinedType(rawCustom) ? rawCustom : t.dataType;
            // original exports: Constant="false" on InOut except MODULE refs
            const constant = ioType === 'MODULE' ? '' : ' Constant="false"';
            params.push(`<Parameter Name="${name}" TagType="Base" DataType="${xmlEsc(ioType)}"${dims} Usage="InOut"${radixAttr(ioType)} Required="true" Visible="true"${constant}>\n${desc}</Parameter>`);
        }
    }
    const revision = /^\d+\.\d+$/.test(fb.currentVersion) ? fb.currentVersion : '1.0';
    return `<AddOnInstructionDefinition Name="${logixName(fb.name)}" Revision="${revision}" Vendor="AMA" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2026-06-10T00:00:00.000Z" CreatedBy="AMA" EditedDate="2026-06-10T00:00:00.000Z" EditedBy="AMA" SoftwareRevision="v38.01">\n`
        + descXml(fb.description || '')
        + `<Parameters>\n${params.join('\n')}\n</Parameters>\n`
        + `<LocalTags>\n${locals.join('\n')}\n</LocalTags>\n`
        + `<Routines>\n${buildAoiLogic(fb.code || '', `${fb.name} - generated by AMA. Verify the logic.`)}\n</Routines>\n`
        + `</AddOnInstructionDefinition>`;
}

// ─── Main generator ─────────────────────────────────────────
export function generateL5X(assembly: AssemblyProject, db: EntityDB): string {
    const usedIds = collectAssemblyRefIds(assembly.tree);
    const scoped = usedIds.size > 0;
    const inScope = <T extends BlockBase>(list: T[]): T[] => scoped ? list.filter(e => usedIds.has(e.id)) : list;

    const units = inScope(db.units);
    const ems = inScope(db.equipmentModules);
    const cms = inScope(db.controlModules);
    const programs = [...units, ...ems, ...cms];

    // FBs become AOIs. They are referenced through entities' assignedFBs
    // (not placed directly in the assembly tree), so scope by that — plus
    // any FB whose type name is used by an in-scope variable. Without this
    // they'd wrongly fall through to UDT stubs.
    const fbIdsInUse = new Set<string>();
    for (const e of programs) {
        for (const id of (e as any).assignedFBs || []) fbIdsInUse.add(id);
    }
    const fbs = scoped
        ? db.library.filter(fb => fbIdsInUse.has(fb.id) || usedIds.has(fb.id))
        : db.library;

    const controllerName = logixName(assembly.name).slice(0, 22) || 'AMA_Controller';

    // Module names referenced by the code ("INV1:I", "OmronNJ:O.Data[13]") —
    // used to align generated hardware module names with the logic.
    const codeModuleRefs = new Set<string>();
    for (const e of [...programs, ...db.library]) {
        for (const m of String(e.code || '').matchAll(/\b([A-Za-z_][A-Za-z0-9_]*):[IO]\b/g)) {
            codeModuleRefs.add(m[1]);
        }
    }

    // AOIs
    const aoiNames = new Set(fbs.map(fb => logixName(fb.name)));
    const aoiXml = fbs.map(generateAOI).join('\n');

    // UDTs for genuine user types not covered by AOIs or built-ins.
    // Module-defined connection types and Logix built-ins are excluded so
    // the import does not collide with auto-created definitions.
    const udtNames = new Set<string>();
    for (const e of [...programs, ...fbs]) {
        for (const v of e.variables || []) {
            if (isModuleDefinedType(v.customDataType || '')) continue;
            const t = logixTypeOf(v);
            const base = t.dataType;
            if (!LOGIX_BUILTINS.has(base.toUpperCase()) && !aoiNames.has(base) && !ATOMIC.has(base)) {
                udtNames.add(base);
            }
        }
    }

    // Reconstruct UDT members from the member accesses found in the code
    // (e.g. "Recipes[Num_Recipe].DINT_001" => Struct_Recipe has DINT_001):
    // a stub without the real members breaks every reference at verify.
    const allCode = [...programs, ...fbs].map(e => String(e.code || '')).join('\n');
    const memberTypeOf = (m: string) =>
        /^STRING/i.test(m) ? 'STRING' : /^REAL/i.test(m) ? 'REAL' : /^BOOL/i.test(m) ? 'BOOL'
            : /^INT/i.test(m) ? 'INT' : /^SINT/i.test(m) ? 'SINT' : 'DINT';
    const udtMembers = new Map<string, Set<string>>();
    for (const e of programs) {
        for (const v of e.variables || []) {
            const t = logixTypeOf(v);
            if (!udtNames.has(t.dataType)) continue;
            const re = new RegExp(`\\b${logixName(v.name)}(?:\\[[^\\]]*\\])?\\.([A-Za-z_]\\w*)`, 'g');
            const set = udtMembers.get(t.dataType) || new Set<string>();
            for (const m of allCode.matchAll(re)) set.add(m[1]);
            udtMembers.set(t.dataType, set);
        }
    }
    const udtXml = [...udtNames].map(n => {
        const members = [...(udtMembers.get(n) || new Set<string>())].sort();
        const memberXml = members.length > 0
            ? members.map(m => `<Member Name="${xmlEsc(m)}" DataType="${memberTypeOf(m)}" Dimension="0"${radixAttr(memberTypeOf(m))} Hidden="false" ExternalAccess="Read/Write"/>`).join('\n')
            : `<Member Name="TODO_Define" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>`;
        return `<DataType Name="${xmlEsc(n)}" Family="NoFamily" Class="User">\n${descXml('Generated by AMA: members reconstructed from the references in the code. Verify order and completeness.')}<Members>\n${memberXml}\n</Members>\n</DataType>`;
    }).join('\n');

    // Controller-scope alias tags from every assembled entity's I/O.
    // Only Logix-shaped addresses become aliases ("A0:4:I.1", "INV1:I.Fault");
    // anything else (EtherCAT/Omron notation) becomes a plain BOOL tag, since
    // an alias to a nonexistent target makes the verify fail.
    const LOGIX_ADDR = /^[A-Za-z_]\w*(:\d+)?:[IOC]\b/;
    const aliasSeen = new Set<string>();
    const aliasXml: string[] = [];
    const aliasNamesByEntity = new Map<string, Set<string>>();
    for (const e of programs) {
        const names = new Set<string>();
        for (const io of e.io || []) {
            const addr = (io.address || '').trim();
            const name = logixName(io.variable || io.signalId);
            names.add(name.toLowerCase());
            if (!addr || aliasSeen.has(name)) continue;
            aliasSeen.add(name);
            if (LOGIX_ADDR.test(addr)) {
                aliasXml.push(`<Tag Name="${name}" TagType="Alias" Radix="Decimal" AliasFor="${xmlEsc(addr)}" ExternalAccess="None">${descXml(io.description || '')}</Tag>`);
            } else {
                aliasXml.push(`<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="None">${descXml(`${io.description || ''} [non-Logix address: ${addr}]`)}</Tag>`);
            }
        }
        aliasNamesByEntity.set(e.id, names);
    }

    // Controller-scope Base tags: in Logix a tag referenced by another
    // program's logic must live at controller scope. Promote a variable when
    // some other program's code references its name without defining its own
    // variable of that name (this reconstructs the original controller tags,
    // which AMA stores among UN_MAIN's variables).
    const codeTokens = new Map<string, Set<string>>();   // entity id -> identifiers in code
    const ownVarNames = new Map<string, Set<string>>();  // entity id -> variable names
    for (const e of programs) {
        codeTokens.set(e.id, new Set(
            [...String(e.code || '').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(m => m[0])
        ));
        ownVarNames.set(e.id, new Set((e.variables || []).map(v => logixName(v.name))));
    }
    const isControllerScope = (owner: BlockBase, varName: string, v?: Variable): boolean => {
        // explicit flag (set by the L5K cross-check corrector) wins
        if ((v as any)?.controllerScope === true) return true;
        for (const p of programs) {
            if (p.id === owner.id) continue;
            if (codeTokens.get(p.id)!.has(varName) && !ownVarNames.get(p.id)!.has(varName)) return true;
        }
        return false;
    };
    const ctrlTagXml: string[] = [];
    const ctrlTagNames = new Set<string>();
    for (const e of programs) {
        const ioNames = aliasNamesByEntity.get(e.id) || new Set();
        for (const v of e.variables || []) {
            const name = logixName(v.name);
            if (ioNames.has(name.toLowerCase()) || aliasSeen.has(name)) continue;   // alias tag already
            if (ctrlTagNames.has(name)) continue;
            if (!isControllerScope(e, name, v)) continue;
            ctrlTagNames.add(name);
            const t = logixTypeOf(v);
            if (isMotionObject(t.dataType)) { ctrlTagXml.push(`<!-- AMA: ${name} (${t.dataType}) cannot be imported as a tag: create the axis/motion group in the Motion Group -->`); continue; }
            const dims = t.dimensions ? ` Dimensions="${t.dimensions}"` : '';
            ctrlTagXml.push(`<Tag Name="${name}" TagType="Base" DataType="${xmlEsc(t.dataType)}"${dims}${radixAttr(t.dataType)} Constant="false" ExternalAccess="None">${descXml(v.description || '')}</Tag>`);
        }
    }

    // Programs
    const programXml = programs.map(e => {
        const ioNames = aliasNamesByEntity.get(e.id) || new Set();
        const tagSeen = new Set<string>();
        const tags = (e.variables || []).map(v => {
            const name = logixName(v.name);
            // variables promoted to controller scope or mapped to alias tags
            // must not be duplicated as program tags
            if (ioNames.has(name.toLowerCase()) || aliasSeen.has(name) || ctrlTagNames.has(name)) return '';
            if (tagSeen.has(name)) return '';
            tagSeen.add(name);
            const t = logixTypeOf(v);
            if (isMotionObject(t.dataType)) return `<!-- AMA: ${name} (${t.dataType}) cannot be imported as a tag: create the axis in the Motion Group -->`;
            const dims = t.dimensions ? ` Dimensions="${t.dimensions}"` : '';
            return `<Tag Name="${name}" TagType="Base" DataType="${xmlEsc(t.dataType)}"${dims} ExternalAccess="None">${descXml(v.description || '')}</Tag>`;
        }).filter(Boolean).join('\n');
        return `<Program Name="${logixName(e.name)}" TestEdits="false" MainRoutineName="Main" Disabled="false" UseAsFolder="false">\n`
            + descXml(e.description || '')
            + `<Tags>\n${tags}\n</Tags>\n`
            + `<Routines>\n${buildProgramRoutines(e.code || '', `[${e.level}] ${e.name} v${e.currentVersion} - generated by AMA (${logixDesc(assembly.name, 60)}). Logic to verify/adapt.`)}\n</Routines>\n`
            + `</Program>`;
    }).join('\n');

    const scheduled = programs.map(e => `<ScheduledProgram Name="${logixName(e.name)}"/>`).join('\n');

    const now = logixDate(new Date());
    // Keep the controller description short and plain — Studio 5000 rejected
    // a long description containing em-dashes with "Invalid description".
    const controllerDesc = logixDesc(`${assembly.name} (generated by AMA v${assembly.version})`, 120);
    // BOM + pretty-printing match real Rockwell exports; errors then point to
    // meaningful line numbers instead of "Line 2".
    return `﻿<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
        + `<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="38.01" TargetName="${controllerName}" TargetType="Controller" ContainsContext="false" Owner="AMA - Automation Machine Architecture" ExportDate="${now}" ExportOptions="NoRawData L5KData DecoratedData ForceProtectedEncoding AllProjDocTrans">\n`
        + `<Controller Use="Target" Name="${controllerName}" ProcessorType="5069-L306ERM" MajorRev="38" MinorRev="11" ProjectCreationDate="${now}" LastModifiedDate="${now}" SFCExecutionControl="CurrentActive" SFCRestartPosition="MostRecent" SFCLastScan="DontScan" MatchProjectToController="false" CanUseRPIFromProducer="false" InhibitAutomaticFirmwareUpdate="0" PassThroughConfiguration="EnabledWithAppend" DownloadProjectDocumentationAndExtendedProperties="true" DownloadProjectCustomProperties="true" ReportMinorOverflow="false" EtherNetIPMode="A1/A2: Dual-IP" AutoDiagsEnabled="false" WebServerEnabled="false">\n`
        + descXml(controllerDesc, 120)
        + `<RedundancyInfo Enabled="false" KeepTestEditsOnSwitchOver="false"/>\n`
        + `<Security Code="0" ChangesToDetect="16#ffff_ffff_ffff_ffff"/>\n`
        + `<SafetyInfo/>\n`
        + `<DataTypes>\n${udtXml}\n</DataTypes>\n`
        + `<Modules>\n${generateModulesList(assembly, codeModuleRefs).join('\n')}\n</Modules>\n`
        + `<AddOnInstructionDefinitions>\n${aoiXml}\n</AddOnInstructionDefinitions>\n`
        + `<Tags>\n${[...ctrlTagXml, ...aliasXml].join('\n')}\n</Tags>\n`
        + `<Programs>\n${programXml}\n</Programs>\n`
        + `<Tasks>\n<Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">\n<ScheduledPrograms>\n${scheduled}\n</ScheduledPrograms>\n</Task>\n</Tasks>\n`
        + `</Controller>\n`
        + `</RSLogix5000Content>\n`;
}

export function downloadL5X(assembly: AssemblyProject, db: EntityDB): void {
    const xml = generateL5X(assembly, db);
    const name = logixName(assembly.name).slice(0, 22) || 'AMA_Controller';
    saveAs(new Blob([xml], { type: 'application/xml' }), `${name}.L5X`);
}
