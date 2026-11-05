# AMA — Automation Machine Architecture

Desktop app (Electron + React + TypeScript) to build PLC software from reusable,
deterministic blocks, following ISA-95, ISA-88 and PackML concepts.

Two workspaces:

- **Code base** (Product Owner): the reusable ISA-88 library (Unit, Equipment Module,
  Control Module, Function Block) with code, alarms, I/O, components and DFMEA. It lives in
  a Git repository you point to. A block can be *Released* only after it passes the release
  checks; the DFMEA tells where the blocks and components need attention.
- **Machine** (assembler): assembles a machine from the code base, adjusts it for the
  customer (instances, parameters, SBOM, network topology), verifies it and exports to
  Studio 5000 (L5X) and TIA Portal (Openness package), plus the documents.

It can also import a Studio 5000 `.L5X` project into a machine.

## Run

Requires Node.js 20+.

```bash
npm install
npm run dev            # web UI at http://localhost:3000
npm run electron:start # desktop app (loads the built UI from dist/)
```

```bash
npm run typecheck
npm test
npm run build
```

## Layout

| Folder | What |
|---|---|
| `pages/`, `components/` | UI (ribbon, workspaces, editors) |
| `lib/` | store, exporters/importers, release checks, DFMEA guidance |
| `electron/` | main process and preload bridge |
| `tests/` | tests (`npm test`) |

The built-in demo machine in `lib/defaults.ts` is invented; it contains no real machine data.
