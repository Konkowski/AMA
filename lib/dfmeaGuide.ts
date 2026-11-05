// ============================================================
// AMA — DFMEA guidance
// Turns the DFMEA from a register into advice for the Product Owner:
// where the risk is, what the block / component should do about it.
// Pure functions: no store, no UI.
// ============================================================
import type { BlockBase, BomPart, DFMEAEntry, FBCategory } from '../types/machine';

export type RpnBand = 'critical' | 'high' | 'medium' | 'low';

/** RPN at or above this needs a defined, implemented answer before release. */
export const RPN_ATTENTION = 100;
export const RPN_CRITICAL = 200;

export const rpnBand = (rpn: number): RpnBand =>
    rpn >= RPN_CRITICAL ? 'critical' : rpn >= RPN_ATTENTION ? 'high' : rpn >= 50 ? 'medium' : 'low';

export const isMitigated = (d: Pick<DFMEAEntry, 'status'>): boolean => d.status === 'Implemented' || d.status === 'Verified';

/** A failure that still needs work: high RPN and not implemented/verified yet. */
export const needsAttention = (d: DFMEAEntry): boolean => d.rpn >= RPN_ATTENTION && !isMitigated(d);

export type SuggestionKind = 'safety' | 'detect' | 'component' | 'alarm' | 'action';

export interface Suggestion { id: string; kind: SuggestionKind; text: string }

const DETECT_HINTS: Partial<Record<FBCategory, string>> = {
    Motion: 'Add a feedback timeout and a following-error / overcurrent check on the drive.',
    Valve: 'Add open/closed feedback with a travel-time timeout alarm.',
    Sensor: 'Add a plausibility check (signal stuck, wire break, 4-20 mA below 3.6 mA) and debounce.',
    Communication: 'Add a heartbeat / watchdog and a connection-lost alarm.',
    Safety: 'Use a dual-channel safety function with discrepancy monitoring (verify PL/SIL).',
    Logic: 'Add a step timeout so a stuck sequence raises an alarm instead of waiting forever.',
    HMI: 'Show the failure state on the HMI and require an acknowledgement.',
};

type Scored = Pick<DFMEAEntry, 'severity' | 'occurrence' | 'detection' | 'componentId' | 'alarmId' | 'controls' | 'actions'>;

/** Advice for one failure mode, from its S/O/D and what the block already has. */
export function suggestFor(d: Scored, block: BlockBase): Suggestion[] {
    const out: Suggestion[] = [];
    const rpn = d.severity * d.occurrence * d.detection;
    const part = (block.bom || []).find(p => p.id === d.componentId);
    const alarm = (block.alarms || []).find(a => a.id === d.alarmId);

    if (d.severity >= 9) {
        out.push({
            id: 'safety', kind: 'safety',
            text: 'Severity 9-10: protect people or the machine with a hardwired / safety-rated interlock, not only PLC logic. Add a Safety-level alarm.',
        });
    }
    if (d.detection >= 7 && rpn >= RPN_ATTENTION) {
        out.push({ id: 'detect', kind: 'detect', text: `Hard to detect (D=${d.detection}). ${DETECT_HINTS[block.category] || 'Add a diagnostic: a feedback signal, a timeout or a plausibility check.'}` });
    }
    if (rpn >= RPN_ATTENTION && !alarm) {
        out.push({ id: 'alarm', kind: 'alarm', text: 'No alarm is linked to this failure. Create one (or link an existing one) so the operator sees it.' });
    }
    if (alarm && d.severity >= 8 && alarm.level !== 'Fault' && alarm.level !== 'Safety') {
        out.push({ id: 'alarm-level', kind: 'alarm', text: `Severity ${d.severity} but the linked alarm is only "${alarm.level}". Raise it to Fault or Safety.` });
    }
    if (d.occurrence >= 6 && part && !(part.alternatives || []).length) {
        out.push({ id: 'alt', kind: 'component', text: `Frequent failure (O=${d.occurrence}) of "${part.description || part.code || 'this component'}". Choose a higher-grade part or register an alternative.` });
    }
    if (d.occurrence >= 6 && !part) {
        out.push({ id: 'link', kind: 'component', text: 'Frequent failure: link it to the component that causes it, so the component choice can be reviewed.' });
    }
    if (rpn >= RPN_ATTENTION && !(d.controls || '').trim() && !(d.actions || '').trim()) {
        out.push({ id: 'action', kind: 'action', text: 'Describe the control (how it is prevented / detected) or the action to reduce S, O or D.' });
    }
    return out;
}

export interface BlockRisk {
    block: BlockBase;
    total: number;
    maxRpn: number;
    open: number;        // RPN >= attention and not implemented/verified
    critical: number;    // RPN >= critical and not implemented/verified
    unlinked: number;    // attention-level failures with no alarm
    suggestions: number;
}

export function blockRisk(block: BlockBase): BlockRisk {
    const list = block.dfmea || [];
    return {
        block,
        total: list.length,
        maxRpn: list.reduce((m, d) => Math.max(m, d.rpn), 0),
        open: list.filter(needsAttention).length,
        critical: list.filter(d => d.rpn >= RPN_CRITICAL && !isMitigated(d)).length,
        unlinked: list.filter(d => d.rpn >= RPN_ATTENTION && !(block.alarms || []).some(a => a.id === d.alarmId)).length,
        suggestions: list.reduce((n, d) => n + suggestFor(d, block).length, 0),
    };
}

export interface ComponentRisk {
    block: BlockBase;
    part: BomPart;
    failures: DFMEAEntry[];
    maxRpn: number;
    hint: string;
}

/** Every component that a failure points to, riskiest first. */
export function componentRisks(blocks: BlockBase[]): ComponentRisk[] {
    const rows: ComponentRisk[] = [];
    for (const block of blocks) {
        for (const part of block.bom || []) {
            const failures = (block.dfmea || []).filter(d => d.componentId === part.id);
            if (!failures.length) continue;
            const maxRpn = failures.reduce((m, d) => Math.max(m, d.rpn), 0);
            const maxO = failures.reduce((m, d) => Math.max(m, d.occurrence), 0);
            const alts = (part.alternatives || []).length;
            const hint = maxRpn >= RPN_ATTENTION && !alts
                ? 'High risk and no alternative registered: add a fallback part.'
                : maxO >= 6 && alts
                    ? 'Frequent failures: review whether the first alternative should become the preferred part.'
                    : maxRpn >= RPN_ATTENTION ? 'High risk, alternatives available: confirm the choice per machine.' : '';
            rows.push({ block, part, failures, maxRpn, hint });
        }
    }
    return rows.sort((a, b) => b.maxRpn - a.maxRpn);
}
