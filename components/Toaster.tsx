// ============================================================
// AMA — Toast / Snackbar system
// toast('Project saved', 'success') from anywhere; the
// Toaster (mounted once in App) renders the stack bottom-right.
// ============================================================
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

export function toast(message: string, kind: ToastKind = 'info') {
    window.dispatchEvent(new CustomEvent('ama-toast', { detail: { message, kind } }));
}

interface ToastItem { id: number; message: string; kind: ToastKind; leaving?: boolean }

let nextId = 1;

const ICONS: Record<ToastKind, React.ReactNode> = {
    success: <CheckCircle size={16} />,
    error: <AlertCircle size={16} />,
    info: <Info size={16} />,
};

export const Toaster: React.FC = () => {
    const [items, setItems] = useState<ToastItem[]>([]);

    useEffect(() => {
        const handler = (e: Event) => {
            const { message, kind } = (e as CustomEvent).detail;
            const id = nextId++;
            setItems(prev => [...prev.slice(-3), { id, message, kind }]);
            setTimeout(() => setItems(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t)), 3600);
            setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 4000);
        };
        window.addEventListener('ama-toast', handler);
        return () => window.removeEventListener('ama-toast', handler);
    }, []);

    if (items.length === 0) return null;
    return (
        <div className="toaster">
            {items.map(t => (
                <div key={t.id} className={`toast toast-${t.kind} ${t.leaving ? 'toast-leaving' : ''}`}>
                    <span className="toast-icon">{ICONS[t.kind]}</span>
                    <span className="toast-message">{t.message}</span>
                    <button className="toast-close" onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}>
                        <X size={13} />
                    </button>
                </div>
            ))}
        </div>
    );
};
