// Preload bridge: the renderer runs with contextIsolation and WITHOUT Node
// integration, and reaches the main process only through this small API.
// (Sandboxed preloads may only require electron: no "os" here.)
const { contextBridge, ipcRenderer } = require('electron');

let username = '';
try { username = ipcRenderer.sendSync('ama:username') || ''; } catch { /* ignore */ }

contextBridge.exposeInMainWorld('amaIpc', {
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    /** Subscribe to a main-process message; returns the unsubscribe function. */
    on: (channel, cb) => {
        const h = (_e, ...args) => cb(...args);
        ipcRenderer.on(channel, h);
        return () => ipcRenderer.removeListener(channel, h);
    },
    username,
});
