// ============================================================
// AMA — Git Management
// A focused Git client over the project repository: status,
// stage/commit, branches, remotes (fetch/pull/push), history,
// tags, stash, and a raw command runner. All commands run
// through the main process (gitOps → IPC → git CLI).
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../lib/store';
import { useCommands } from '../lib/commands';
import { toast } from '../components/Toaster';
import {
    gitAvailable, getGitDir, pickGitFolder, gitRun, gitWriteProject, gitEnsureIdentity,
} from '../lib/gitOps';
import {
    FolderGit2, FolderOpen, GitBranch, GitCommit, GitMerge, Upload, Download,
    RefreshCw, Plus, Tag, Archive, Terminal, Check, X, Trash2, FilePlus,
    ArrowUp, ArrowDown, Save, Play,
} from 'lucide-react';

interface StatusFile { x: string; y: string; path: string; staged: boolean; untracked: boolean }

const Card: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> =
    ({ title, icon, children, right }) => (
        <div className="card git-card">
            <div className="git-card-head">
                <span className="git-card-title">{icon} {title}</span>
                {right}
            </div>
            <div className="git-card-body">{children}</div>
        </div>
    );

export const GitPage: React.FC = () => {
    const activeUser = useStore(s => s.activeUser);
    const assembly = useStore(s => s.assembly);
    const [dir, setDir] = useState(getGitDir());
    const [isRepo, setIsRepo] = useState(false);
    const [branch, setBranch] = useState('');
    const [branches, setBranches] = useState<string[]>([]);
    const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([]);
    const [files, setFiles] = useState<StatusFile[]>([]);
    const [ahead, setAhead] = useState(0);
    const [behind, setBehind] = useState(0);
    const [logGraph, setLogGraph] = useState('');
    const [busy, setBusy] = useState(false);

    // form inputs
    const [commitMsg, setCommitMsg] = useState('');
    const [newBranch, setNewBranch] = useState('');
    const [mergeFrom, setMergeFrom] = useState('');
    const [remoteName, setRemoteName] = useState('origin');
    const [remoteUrl, setRemoteUrl] = useState('');
    const [tagName, setTagName] = useState('');
    const [rawCmd, setRawCmd] = useState('');
    const [rawOut, setRawOut] = useState('');

    const refresh = useCallback(async () => {
        const d = getGitDir();
        if (!d) { setIsRepo(false); return; }
        const repoCheck = await gitRun(['rev-parse', '--is-inside-work-tree']);
        const repo = repoCheck.ok && repoCheck.stdout.trim() === 'true';
        setIsRepo(repo);
        if (!repo) { setBranch(''); setBranches([]); setFiles([]); setRemotes([]); setLogGraph(''); return; }

        setBranch((await gitRun(['branch', '--show-current'])).stdout.trim());
        setBranches((await gitRun(['branch', '--format=%(refname:short)'])).stdout.split('\n').map(s => s.trim()).filter(Boolean));

        const st = await gitRun(['status', '--porcelain=v1', '-b']);
        let a = 0, b = 0; const fl: StatusFile[] = [];
        st.stdout.split('\n').filter(Boolean).forEach(line => {
            if (line.startsWith('##')) {
                const am = line.match(/ahead (\d+)/); const bm = line.match(/behind (\d+)/);
                if (am) a = +am[1]; if (bm) b = +bm[1];
                return;
            }
            const x = line[0], y = line[1], p = line.slice(3);
            fl.push({ x, y, path: p, staged: x !== ' ' && x !== '?', untracked: x === '?' });
        });
        setAhead(a); setBehind(b); setFiles(fl);

        const rm = (await gitRun(['remote', '-v'])).stdout.split('\n').filter(Boolean);
        const rmap: Record<string, string> = {};
        rm.forEach(l => { const [name, rest] = l.split('\t'); if (rest) rmap[name] = rest.split(' ')[0]; });
        setRemotes(Object.entries(rmap).map(([name, url]) => ({ name, url })));

        const lg = await gitRun(['log', '--graph', '--oneline', '--decorate', '--all', '-40']);
        setLogGraph(lg.ok ? (lg.stdout || '(no commits)') : '(no commits)');
    }, []);

    useEffect(() => { if (dir) refresh(); }, [dir, refresh]);

    const run = async (args: string[], successMsg?: string): Promise<boolean> => {
        setBusy(true);
        const res = await gitRun(args);
        setBusy(false);
        if (!res.ok) { toast(res.error || 'Git error.', 'error'); return false; }
        if (successMsg) toast(successMsg, 'success');
        await refresh();
        return true;
    };

    const choose = async () => { const d = await pickGitFolder(); if (d) setDir(d); };

    const stagedFiles = files.filter(f => f.staged);
    const unstagedFiles = files.filter(f => !f.staged);

    const codeLabel = (f: StatusFile) => {
        if (f.untracked) return 'new';
        const c = (f.x + f.y).trim();
        if (c.includes('D')) return 'eliminato';
        if (c.includes('A')) return 'aggiunto';
        if (c.includes('R')) return 'rinominato';
        return 'modificato';
    };

    const doCommit = async () => {
        if (stagedFiles.length === 0) { toast('No staged files to commit.', 'error'); return; }
        await gitEnsureIdentity();
        const msg = commitMsg.trim() || `Aggiornamento ${assembly.name} v${assembly.version}`;
        if (await run(['commit', '-m', msg], `Commit created as ${activeUser || 'AMA'}.`)) setCommitMsg('');
    };

    const syncProject = async () => {
        setBusy(true);
        const res = await gitWriteProject();
        setBusy(false);
        if (!res.ok) { toast(res.error || 'Write error.', 'error'); return; }
        toast(`${res.count} files written to the folder.`, 'success');
        await refresh();
    };

    const runRaw = async () => {
        const parts = rawCmd.trim().replace(/^git\s+/i, '').match(/"[^"]*"|'[^']*'|\S+/g);
        if (!parts) return;
        const args = parts.map(p => p.replace(/^["']|["']$/g, ''));
        setBusy(true);
        const res = await gitRun(args);
        setBusy(false);
        setRawOut([res.stdout, res.stderr, res.error].filter(Boolean).join('\n') || '(no output)');
        await refresh();
    };

    useCommands({ 'git:choose': choose, 'git:sync': syncProject, 'git:refresh': refresh });

    if (!gitAvailable()) {
        return (
            <div style={{ padding: 40 }}>
                <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                    <FolderGit2 size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
                    <h3>Git is only available in the desktop app</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 6 }}>
                        L'integrazione Git richiede l'esecuzione in Electron.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="git-page">
            <div className="page-header">
                <div>
                    <h1>Version Control (Git)</h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: 2, fontSize: '0.85rem' }}>
                        Version the machine architecture as a Git repository
                    </p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary" onClick={refresh} disabled={!dir || busy}>
                        <RefreshCw size={14} /> Refresh
                    </button>
                </div>
            </div>

            {/* Repository */}
            <Card title="Repository" icon={<FolderGit2 size={15} />}
                right={isRepo ? <span className="badge badge-em">active repository</span> : dir ? <span className="badge badge-warning">folder not initialized</span> : null}>
                <div className="git-repo-row">
                    <span className="git-dir" title={dir}>{dir || 'No folder selected'}</span>
                    <button className="btn btn-secondary btn-sm" onClick={choose}><FolderOpen size={13} /> {dir ? 'Change' : 'Choose folder'}</button>
                    {dir && !isRepo && (
                        <button className="btn btn-primary btn-sm" onClick={() => run(['init'], 'Repository inizializzato.').then(() => gitRun(['symbolic-ref', 'HEAD', 'refs/heads/main']).then(refresh))}>
                            <GitBranch size={13} /> Inizializza repo
                        </button>
                    )}
                    {dir && (
                        <button className="btn btn-secondary btn-sm" onClick={syncProject} disabled={busy} title="Writes one JSON file per entity + README/FDS/code into the folder">
                            <Save size={13} /> Sync project
                        </button>
                    )}
                </div>
            </Card>

            {isRepo && (
                <div className="git-grid">
                    {/* Status + Commit */}
                    <Card title="Changes & Commit" icon={<GitCommit size={15} />}
                        right={<span className="git-branch-chip"><GitBranch size={12} /> {branch || 'HEAD'}{ahead > 0 && <span className="git-ab"><ArrowUp size={10} />{ahead}</span>}{behind > 0 && <span className="git-ab"><ArrowDown size={10} />{behind}</span>}</span>}>
                        <div className="git-actions-row">
                            <button className="btn btn-secondary btn-sm" onClick={() => run(['add', '-A'])} disabled={unstagedFiles.length === 0}><Plus size={13} /> Stage all</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => run(['reset'])} disabled={stagedFiles.length === 0}><X size={13} /> Unstage all</button>
                        </div>
                        {files.length === 0 ? (
                            <p className="git-empty"><Check size={14} style={{ color: 'var(--em-color)' }} /> Working tree clean — no changes.</p>
                        ) : (
                            <div className="git-file-list">
                                {stagedFiles.length > 0 && <div className="git-file-section">In stage ({stagedFiles.length})</div>}
                                {stagedFiles.map((f, i) => (
                                    <div className="git-file staged" key={'s' + i}>
                                        <span className={`git-file-tag tag-${codeLabel(f)}`}>{codeLabel(f)}</span>
                                        <span className="git-file-path" title={f.path}>{f.path}</span>
                                        <button className="btn-icon" title="Unstage" onClick={() => run(['restore', '--staged', '--', f.path])}><X size={13} /></button>
                                    </div>
                                ))}
                                {unstagedFiles.length > 0 && <div className="git-file-section">Changes ({unstagedFiles.length})</div>}
                                {unstagedFiles.map((f, i) => (
                                    <div className="git-file" key={'u' + i}>
                                        <span className={`git-file-tag tag-${codeLabel(f)}`}>{codeLabel(f)}</span>
                                        <span className="git-file-path" title={f.path}>{f.path}</span>
                                        <button className="btn-icon" title="Stage" onClick={() => run(['add', '--', f.path])}><Plus size={13} /></button>
                                        {!f.untracked && <button className="btn-icon" title="Discard changes" onClick={() => { if (confirm(`Discard the changes to ${f.path}?`)) run(['checkout', '--', f.path]); }}><Trash2 size={13} style={{ color: 'var(--red)' }} /></button>}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="git-commit-box">
                            <input className="input" placeholder={`Commit message (default: "Update ${assembly.name} v${assembly.version}")`}
                                value={commitMsg} onChange={e => setCommitMsg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doCommit(); }} />
                            <button className="btn btn-primary" onClick={doCommit} disabled={busy || stagedFiles.length === 0}>
                                <GitCommit size={14} /> Commit ({stagedFiles.length})
                            </button>
                        </div>
                    </Card>

                    {/* Branches */}
                    <Card title="Branches" icon={<GitBranch size={15} />}>
                        <div className="git-branch-list">
                            {branches.map(b => (
                                <div className={`git-branch-item ${b === branch ? 'current' : ''}`} key={b}>
                                    <GitBranch size={13} />
                                    <span style={{ flex: 1 }}>{b}{b === branch && <span className="git-cur-tag"> current</span>}</span>
                                    {b !== branch && (
                                        <>
                                            <button className="btn-icon" title="Switch to this branch" onClick={() => run(['checkout', b], `Passato a ${b}.`)}><Play size={12} /></button>
                                            <button className="btn-icon" title="Merge into current (merge)" onClick={() => { if (confirm(`Unire '${b}' in '${branch}'?`)) run(['merge', b], `Merge of ${b} completato.`); }}><GitMerge size={12} /></button>
                                            <button className="btn-icon" title="Delete branch" onClick={() => { if (confirm(`Delete the branch '${b}'?`)) run(['branch', '-d', b]); }}><Trash2 size={12} style={{ color: 'var(--red)' }} /></button>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="git-inline-form">
                            <input className="input" placeholder="new-branch-name" value={newBranch} onChange={e => setNewBranch(e.target.value)} />
                            <button className="btn btn-secondary btn-sm" disabled={!newBranch.trim()} onClick={() => { run(['checkout', '-b', newBranch.trim()], `Branch ${newBranch.trim()} creato.`); setNewBranch(''); }}>
                                <FilePlus size={13} /> Create & switch
                            </button>
                        </div>
                    </Card>

                    {/* Remotes */}
                    <Card title="Remote & Sync" icon={<Upload size={15} />}>
                        {remotes.length === 0 ? (
                            <p className="git-empty">No remote configured. Add one to push/pull to GitHub/GitLab.</p>
                        ) : (
                            <div className="git-remote-list">
                                {remotes.map(r => (
                                    <div className="git-remote-item" key={r.name}>
                                        <span className="badge badge-secondary">{r.name}</span>
                                        <span className="git-remote-url" title={r.url}>{r.url}</span>
                                        <button className="btn-icon" title="Remove remote" onClick={() => { if (confirm(`Remove the remote '${r.name}'?`)) run(['remote', 'remove', r.name]); }}><X size={12} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="git-actions-row" style={{ marginTop: 10 }}>
                            <button className="btn btn-secondary btn-sm" disabled={remotes.length === 0} onClick={() => run(['fetch', '--all'], 'Fetch completato.')}><Download size={13} /> Fetch</button>
                            <button className="btn btn-secondary btn-sm" disabled={remotes.length === 0} onClick={() => run(['pull'], 'Pull completato.')}><ArrowDown size={13} /> Pull</button>
                            <button className="btn btn-primary btn-sm" disabled={remotes.length === 0} onClick={() => run(['push', '-u', 'origin', branch], 'Push completato.')}><ArrowUp size={13} /> Push</button>
                        </div>
                        <div className="git-inline-form" style={{ marginTop: 10 }}>
                            <input className="input" style={{ width: 90 }} placeholder="origin" value={remoteName} onChange={e => setRemoteName(e.target.value)} />
                            <input className="input" placeholder="https://github.com/user/repo.git" value={remoteUrl} onChange={e => setRemoteUrl(e.target.value)} />
                            <button className="btn btn-secondary btn-sm" disabled={!remoteName.trim() || !remoteUrl.trim()} onClick={() => { run(['remote', 'add', remoteName.trim(), remoteUrl.trim()], 'Remote aggiunto.'); setRemoteUrl(''); }}>
                                <Plus size={13} /> Add
                            </button>
                        </div>
                    </Card>

                    {/* History */}
                    <Card title="History" icon={<GitCommit size={15} />}>
                        <pre className="git-graph">{logGraph || '(no commits)'}</pre>
                    </Card>

                    {/* Tags + Stash */}
                    <Card title="Tag & Stash" icon={<Tag size={15} />}>
                        <div className="git-inline-form">
                            <input className="input" placeholder="v1.0.0" value={tagName} onChange={e => setTagName(e.target.value)} />
                            <button className="btn btn-secondary btn-sm" disabled={!tagName.trim()} onClick={() => { run(['tag', tagName.trim()], `Tag ${tagName.trim()} creato.`); setTagName(''); }}>
                                <Tag size={13} /> Create tag
                            </button>
                        </div>
                        <div className="git-actions-row" style={{ marginTop: 10 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => run(['stash', 'push', '-u'], 'Changes stashed (stash).')}><Archive size={13} /> Stash</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => run(['stash', 'pop'], 'Stash restored.')}><ArrowUp size={13} /> Stash pop</button>
                        </div>
                    </Card>

                    {/* Raw command */}
                    <Card title="Git command" icon={<Terminal size={15} />}>
                        <div className="git-inline-form">
                            <span className="git-prompt">git</span>
                            <input className="input mono" placeholder="status -sb" value={rawCmd}
                                onChange={e => setRawCmd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runRaw(); }} />
                            <button className="btn btn-secondary btn-sm" disabled={!rawCmd.trim() || busy} onClick={runRaw}><Play size={13} /> Run</button>
                        </div>
                        {rawOut && <pre className="git-graph" style={{ marginTop: 10 }}>{rawOut}</pre>}
                    </Card>
                </div>
            )}
        </div>
    );
};

export default GitPage;
