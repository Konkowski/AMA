// ============================================================
// AMA — User Prompt (username on first use)
// ============================================================
import React, { useState } from 'react';
import { useStore } from '../lib/store';
import { User } from 'lucide-react';
import { getUsers, saveUsers } from './Layout';

export const UserPrompt: React.FC = () => {
    const activeUser = useStore(s => s.activeUser);
    const setActiveUser = useStore(s => s.setActiveUser);
    const [name, setName] = useState('');

    const register = (n: string) => {
        const users = getUsers();
        if (!users.includes(n)) saveUsers([...users, n]);
        setActiveUser(n);
    };

    if (activeUser) return null;

    return (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
            <div className="modal" style={{ maxWidth: 420 }}>
                <div className="modal-header">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <User size={20} /> Benvenuto in Automation Machine Architecture
                    </h3>
                </div>
                <div className="modal-body">
                    <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                        Please enter your name. It will be associated with all the changes you make.
                    </p>
                    <input
                        className="input"
                        placeholder="Your name (e.g. J. Smith)"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter' && name.trim()) {
                                register(name.trim());
                            }
                        }}
                    />
                </div>
                <div className="modal-footer">
                    <button
                        className="btn btn-primary"
                        disabled={!name.trim()}
                        onClick={() => register(name.trim())}
                    >
                        Continua
                    </button>
                </div>
            </div>
        </div>
    );
};
