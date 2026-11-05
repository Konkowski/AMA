// ============================================================
// AMA — Command registry
//
// The ribbon (and the command palette) fire commands by id. Whoever
// owns the behaviour registers a handler while it is mounted:
//   - Layout registers the global ones (file:*, view:*, nav:*)
//   - each page registers its own (arch:*, data:*, git:* ...)
// A command whose page is not mounted yet can carry a `route`: the
// ribbon navigates there first and runs the command once it appears.
// ============================================================
import { useEffect, useRef } from 'react';

export type CommandHandler = () => void;

const handlers = new Map<string, CommandHandler>();
const listeners = new Set<() => void>();

export const hasCommand = (id: string): boolean => handlers.has(id);

/** Runs a command now if registered; returns whether it was. */
export function runCommandNow(id: string): boolean {
    const h = handlers.get(id);
    if (!h) return false;
    try { h(); } catch (e) { console.error(`Command ${id} failed`, e); }
    return true;
}

/** Waits (up to ~1.5 s) for a command's page to mount, then runs it. */
export function runCommandWhenReady(id: string, tries = 30): void {
    if (runCommandNow(id) || tries <= 0) return;
    setTimeout(() => runCommandWhenReady(id, tries - 1), 50);
}

export function registerCommands(map: Record<string, CommandHandler>): () => void {
    const ids = Object.keys(map);
    for (const id of ids) handlers.set(id, map[id]);
    listeners.forEach(l => l());
    return () => {
        for (const id of ids) if (handlers.get(id) === map[id]) handlers.delete(id);
        listeners.forEach(l => l());
    };
}

/**
 * Register page commands while the component is mounted. The map may be a
 * fresh object every render: handlers always call the latest closure.
 */
export function useCommands(map: Record<string, CommandHandler>): void {
    const ref = useRef(map);
    ref.current = map;
    const idsKey = Object.keys(map).join('|');
    useEffect(() => {
        const stable: Record<string, CommandHandler> = {};
        for (const id of Object.keys(ref.current)) stable[id] = () => ref.current[id]?.();
        return registerCommands(stable);
    }, [idsKey]);
}
