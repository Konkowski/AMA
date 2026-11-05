// ============================================================
// AMA — Persistence (native save/open, autosave, crash recovery)
// ============================================================
import { saveAs } from 'file-saver';
import { useStore } from './store';
import { importGitZip } from './gitExport';
import { PROJECT_SCHEMA_VERSION } from './normalize';
import { safeFileName } from './helpers';

// Electron IPC access: the preload script (electron/preload.cjs) exposes
// window.amaIpc; it is absent in a plain browser.
const ipcRenderer: any = (window as any).amaIpc ?? null;

export const isElectron = (): boolean => !!ipcRenderer;

/** The logged-in OS user (Windows/macOS/Linux), used as the default app user. */
export function getOsUsername(): string {
    const name = (window as any).amaIpc?.username;
    if (name) return String(name).trim();
    // Browser / fallback
    const env = (globalThis as any).process?.env;
    return (env?.USERNAME || env?.USER || '').trim();
}

function collectProjectData() {
    const s = useStore.getState();
    return {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        library: s.library,
        units: s.units,
        equipmentModules: s.equipmentModules,
        controlModules: s.controlModules,
        assembly: s.assembly,
        kind: s.workspaceKind,
        codebase: s.codebase,
    };
}

/**
 * Save the current project. In Electron writes to the known file path
 * (or prompts Save As when there is none / saveAsNew is true) and returns
 * the path. In the browser falls back to a classic download and returns null.
 */
export async function saveProjectToFile(saveAsNew = false): Promise<string | null> {
    const s = useStore.getState();
    const json = JSON.stringify(collectProjectData(), null, 2);
    const suggestedName = `${safeFileName(s.assembly.name)}_project.json`;

    if (ipcRenderer) {
        const currentPath = saveAsNew ? null : s.projectFilePath;
        const result = await ipcRenderer.invoke('ama:save-file', {
            content: json,
            defaultName: suggestedName,
            currentPath,
        });
        if (result?.path) {
            useStore.setState({ projectFilePath: result.path });
            return result.path;
        }
        return null;
    }

    saveAs(new Blob([json], { type: 'application/json' }), suggestedName);
    return null;
}

/**
 * Open a project via the native dialog (Electron only). Accepts both the
 * monolithic project JSON and the per-entity Git export ZIP. For JSON the
 * file path is remembered for later Ctrl+S saves; for ZIP it is not (Ctrl+S
 * writes JSON, so it must prompt Save As instead of overwriting the ZIP).
 * Returns null when canceled or when running in a plain browser;
 * throws when the file cannot be parsed.
 */
export async function openProjectFromFile(): Promise<any | null> {
    if (!ipcRenderer) return null;
    const result = await ipcRenderer.invoke('ama:open-file');
    if (!result?.content) return null;
    if (result.encoding === 'base64') {
        const data = await importGitZip(result.content, { base64: true });
        if (!data) throw new Error('The ZIP file does not look like an AMA Git export.');
        return data;
    }
    const data = JSON.parse(result.content);
    useStore.setState({ projectFilePath: result.path });
    return data;
}

// ─── Autosave & Crash Recovery ──────────────────────────────
// Desktop: snapshots go to a file in userData via IPC (atomic write, no
// size limit). Browser: localStorage fallback (~5 MB — best effort).
// The lightweight meta stays in localStorage in both cases so the status
// bar can read it synchronously.
const AUTOSAVE_KEY = 'ama_autosave';
const AUTOSAVE_META_KEY = 'ama_autosave_meta';
const AUTOSAVE_DEBOUNCE_MS = 2000;

export interface AutosaveMeta {
    savedAt: string; // ISO timestamp
    projectName: string;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveStarted = false;
let lastSlices: {
    library?: unknown; units?: unknown; equipmentModules?: unknown;
    controlModules?: unknown; assembly?: unknown;
} = {};

function writeAutosaveMeta(projectName: string): void {
    try {
        const meta: AutosaveMeta = { savedAt: new Date().toISOString(), projectName };
        localStorage.setItem(AUTOSAVE_META_KEY, JSON.stringify(meta));
    } catch { /* ignore */ }
}

/**
 * Start watching the store and snapshot project data (debounced).
 * UI-only state changes are ignored via reference comparison of the
 * data slices.
 */
export function initAutosave(): void {
    if (autosaveStarted) return;
    autosaveStarted = true;

    useStore.subscribe(() => {
        const s = useStore.getState();
        if (!s.workspaceLoaded) return;
        if (
            s.library === lastSlices.library &&
            s.units === lastSlices.units &&
            s.equipmentModules === lastSlices.equipmentModules &&
            s.controlModules === lastSlices.controlModules &&
            s.assembly === lastSlices.assembly
        ) return;
        lastSlices = {
            library: s.library,
            units: s.units,
            equipmentModules: s.equipmentModules,
            controlModules: s.controlModules,
            assembly: s.assembly,
        };

        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(async () => {
            const data = collectProjectData();
            const name = data.assembly?.name || 'Unnamed project';
            if (ipcRenderer) {
                const res = await ipcRenderer.invoke('ama:autosave-write', {
                    content: JSON.stringify(data),
                }).catch(() => null);
                if (res?.ok) writeAutosaveMeta(name);
                return;
            }
            try {
                localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
                writeAutosaveMeta(name);
            } catch {
                // localStorage full or unavailable — skip this snapshot
            }
        }, AUTOSAVE_DEBOUNCE_MS);
    });
}

export function getAutosaveMeta(): AutosaveMeta | null {
    try {
        const raw = localStorage.getItem(AUTOSAVE_META_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function loadAutosave(): Promise<any | null> {
    if (ipcRenderer) {
        const res = await ipcRenderer.invoke('ama:autosave-read').catch(() => null);
        if (res?.ok && res.content) {
            try { return JSON.parse(res.content); } catch { return null; }
        }
        // fall through: older versions autosaved to localStorage
    }
    try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function clearAutosave(): void {
    if (ipcRenderer) ipcRenderer.invoke('ama:autosave-clear').catch(() => {});
    try {
        localStorage.removeItem(AUTOSAVE_KEY);
        localStorage.removeItem(AUTOSAVE_META_KEY);
    } catch {
        // ignore
    }
}
