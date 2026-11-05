# Example: Rotary Tablet Press TP-200

An **invented** demo for solid-dose pharmaceutical production. It contains no real machine, customer or company data, and it is a good way to explore every feature of AMA.

The press feeds powder, compresses it under force control, dedusts the tablets, counts them and diverts the rejected ones, with a dual-channel guard door.

## Files

| Path | What |
|---|---|
| `codebase/` | The **code base**: a reusable ISA-88 library (1 Unit, 4 Equipment Modules, 9 Control Modules, 5 Function Blocks), all Released |
| `TP-200_machine.json` | The **machine**: assembled from that code base, with parameters, SBOM and network topology |

## Try it

1. Open AMA.
2. **Machine** workspace → **File → Open**, choose `TP-200_machine.json`.
3. Click **Link code base** and choose the `codebase/` folder of this example.
4. Walk through the steps: **Assembly → Analysis → Verify and export**.

To look at the library itself, switch to the **Code base** workspace and open the `codebase/` folder.

## What you will find

- A machine with **two blocks adjusted for the customer** (`CM_ForceFeeder`, `CM_HopperLevel`) and **one block that exists only on this machine** (`CM_LubricationPump`, still Draft).
- **DFMEA** entries in every state, including open ones, so the Analysis views have something to show.
- Components with **alternatives**, an **SBOM** built from the blocks plus manual hardware, and a **network topology** with security zones.
- Code in IEC 61131-3 Structured Text at every level: a PackML-style state machine in the Unit, step sequences in the Equipment Modules, and drive, sensor, safety and PI weight-control logic in the Control Modules and Function Blocks. It exports to Studio 5000 (L5X) and TIA Portal.
- A DFMEA on every block, with severity, occurrence and detection scores, linked components and alarms, in all four states (To Do, In Progress, Implemented, Verified).
