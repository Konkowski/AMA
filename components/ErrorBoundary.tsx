// ============================================================
// AMA — Error Boundary
// A render crash anywhere in a page must not white-screen the
// whole app: work stays in the autosave, the user can reload.
// ============================================================
import React from 'react';

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children?: React.ReactNode }, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('AMA render error:', error, info.componentStack);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div style={{
                height: '100vh', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 14,
                background: 'var(--bg, #0b0f17)', color: 'var(--text-primary, #e5e7eb)',
                padding: 24, textAlign: 'center',
            }}>
                <h2 style={{ margin: 0 }}>An unexpected error occurred</h2>
                <p style={{ margin: 0, color: 'var(--text-secondary, #9ca3af)', maxWidth: 520 }}>
                    Your recent work is kept in the autosave. Reload the application to continue.
                </p>
                <pre style={{
                    maxWidth: 640, maxHeight: 180, overflow: 'auto', fontSize: 12,
                    background: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8,
                    color: '#f87171', textAlign: 'left',
                }}>{String(this.state.error?.stack || this.state.error)}</pre>
                <button
                    onClick={() => window.location.reload()}
                    style={{
                        padding: '10px 22px', borderRadius: 8, border: 'none',
                        background: '#0ea5e9', color: 'white', fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    Reload AMA
                </button>
            </div>
        );
    }
}
