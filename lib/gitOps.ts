// ============================================================
// AMA — Git operations (Electron only)
// Writes the per-entity Git structure to a real folder and runs
// git init / add / commit / log through the main process, so the
// architecture can be version-controlled without leaving the app.
// ============================================================
import { useStore } from './store';
import { buildGitStructure } from './gitExport';
import type { EntityDB } from './helpers';

const ipc = (): any => (window as any).amaIpc ?? null;

export const gitAvailable = (): boolean => !!ipc();
export const getGitDir = (): string => { try { return localStorage.getItem('ama_git_dir') || ''; } catch { return ''; } };
export const setGitDir = (d: string) => { try { localStorage.setItem('ama_git_dir', d); } catch { /* ignore */ } };

/** Native folder picker; remembers the chosen repository directory. */
export async function pickGitFolder(): Promise<string | null> {
    const r = ipc();
    if (!r) return null;
    const res = await r.invoke('ama:pick-folder');
    if (res?.dir) { setGitDir(res.dir); return res.dir; }
    return null;
}

export interface GitResult { ok: boolean; committed?: boolean; error?: string; log?: string; message?: string; hash?: string }

/** Write the current project's Git structure to the repo folder and commit it. */
export async function gitCommit(message: string): Promise<GitResult> {
    const r = ipc();
    if (!r) return { ok: false, error: 'Only available in the desktop app.' };
    const dir = getGitDir();
    if (!dir) return { ok: false, error: 'No repository folder selected.' };
    const s = useStore.getState();
    const db: EntityDB = { library: s.library, units: s.units, equipmentModules: s.equipmentModules, controlModules: s.controlModules };
    const files = buildGitStructure(s.assembly, db);
    return r.invoke('ama:git-commit', { dir, files, message, author: s.activeUser });
}

/** Recent commit history (oneline) of the repo. */
export async function gitLog(): Promise<string> {
    const r = ipc();
    const dir = getGitDir();
    if (!r || !dir) return '';
    const res = await r.invoke('ama:git-log', { dir });
    return res?.ok ? res.log : '';
}

export interface GitRun { ok: boolean; stdout: string; stderr: string; error?: string }

/** Run an arbitrary git command in the current repo folder. */
export async function gitRun(args: string[]): Promise<GitRun> {
    const r = ipc();
    const dir = getGitDir();
    if (!r) return { ok: false, stdout: '', stderr: '', error: 'Only available in the desktop app.' };
    if (!dir) return { ok: false, stdout: '', stderr: '', error: 'No repository folder selected.' };
    const res = await r.invoke('ama:git-run', { dir, args });
    return { ok: !!res?.ok, stdout: res?.stdout || '', stderr: res?.stderr || '', error: res?.error };
}

/** Run a git command in a specific folder (does not touch the remembered repo folder). */
export async function gitRunIn(dir: string, args: string[]): Promise<GitRun> {
    const r = ipc();
    if (!r) return { ok: false, stdout: '', stderr: '', error: 'Only available in the desktop app.' };
    const res = await r.invoke('ama:git-run', { dir, args });
    return { ok: !!res?.ok, stdout: res?.stdout || '', stderr: res?.stderr || '', error: res?.error };
}

/** Commit id and cleanliness of a code base folder; empty when it is not a Git repository. */
export async function gitStateOf(dir: string): Promise<{ commit?: string; dirty?: boolean }> {
    try {
        const head = await gitRunIn(dir, ['rev-parse', 'HEAD']);
        if (!head.ok) return {};
        const st = await gitRunIn(dir, ['status', '--porcelain']);
        return { commit: head.stdout.trim().slice(0, 40), dirty: st.ok ? st.stdout.trim().length > 0 : undefined };
    } catch { return {}; }
}

/** Write the current project's per-entity structure into the repo (no commit). */
export async function gitWriteProject(): Promise<{ ok: boolean; count?: number; error?: string }> {
    const r = ipc();
    const dir = getGitDir();
    if (!r) return { ok: false, error: 'Only available in the desktop app.' };
    if (!dir) return { ok: false, error: 'No repository folder selected.' };
    const s = useStore.getState();
    const db: EntityDB = { library: s.library, units: s.units, equipmentModules: s.equipmentModules, controlModules: s.controlModules };
    const files = buildGitStructure(s.assembly, db);
    return r.invoke('ama:git-write', { dir, files });
}

/** Ensure the repo commit identity matches the active AMA user. */
export async function gitEnsureIdentity(): Promise<void> {
    const who = (useStore.getState().activeUser || 'AMA').trim();
    await gitRun(['config', 'user.name', who]);
    await gitRun(['config', 'user.email', `${who.replace(/\s+/g, '.').toLowerCase()}@ama.local`]);
}
