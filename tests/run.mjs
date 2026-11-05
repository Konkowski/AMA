// Runs tests/*.test.ts with no extra dependency: esbuild (already installed with Vite)
// bundles each file and Node executes it.   Usage: npm test
import { build } from 'esbuild';
import { readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '.out');
mkdirSync(out, { recursive: true });
let failed = 0;
for (const f of readdirSync(here).filter(n => n.endsWith('.test.ts'))) {
    const outfile = path.join(out, f.replace('.ts', '.mjs'));
    await build({ entryPoints: [path.join(here, f)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' });
    const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
    if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
