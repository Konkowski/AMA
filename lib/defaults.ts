// ============================================================
// AMA — Built-in demo machine ("Demo Line DM-100")
// A small, invented machine: one conveyor line with a bottle sensor and a
// reject pusher. It exists to show every feature (ISA-88 blocks, code,
// alarms, I/O, DFMEA, components with alternatives, SBOM, topology).
// Nothing here comes from a real machine or customer.
// ============================================================
import type {
    FunctionBlock, Unit, EquipmentModule, ControlModule, AssemblyProject,
    Variable, Alarm, IOSignal, DFMEAEntry, BomPart, BlockBase,
} from '../types/machine';

const DATE = '2025-01-01';

const v = (id: string, name: string, description: string, dataType: Variable['dataType'], scope: Variable['scope']): Variable =>
    ({ id, name, description, dataType, scope });
const al = (id: string, alarmId: string, message: string, level: Alarm['level'], triggerVariable: string, action: Alarm['action'], causes: string, solutions: string): Alarm =>
    ({ id, alarmId, message, level, triggerVariable, action, linkedModules: [], possibleCauses: causes, possibleSolutions: solutions });
const io = (id: string, signalId: string, signalType: IOSignal['signalType'], address: string, variable: string, description: string): IOSignal =>
    ({ id, signalId, signalType, address, variable, description, dataType: 'BOOL' });
const fm = (id: string, failureMode: string, effect: string, cause: string, s: number, o: number, d: number,
    controls: string, actions: string, status: DFMEAEntry['status'], extra: Partial<DFMEAEntry> = {}): DFMEAEntry =>
    ({ id, failureMode, effect, cause, severity: s, occurrence: o, detection: d, rpn: s * o * d, controls, actions, status, ...extra });

const base = (level: BlockBase['level'], id: string, name: string, description: string, category: BlockBase['category'], code: string): BlockBase => ({
    id, name, description, category, level,
    variables: [], alarms: [], io: [], dfmea: [],
    revisions: [{ version: '1.0', date: DATE, author: 'AMA', notes: 'Created' }],
    code, currentVersion: '1.0', lastModifiedBy: 'AMA', status: 'Released',
});

const times = { plcHours: 8, hmiHours: 4, commissioningHours: 4 };

// ─── Function blocks (library) ─────────────────────────────
export const defaultLibraryFBs: FunctionBlock[] = [
    {
        ...base('FB', 'demo-fb-debounce', 'FB_Debounce', 'Filters a digital input: the output follows the input only after it is stable for the set time.', 'Logic',
            `FUNCTION_BLOCK FB_Debounce\nVAR_INPUT\n    In : BOOL;\n    Time_ms : TIME := T#50ms;\nEND_VAR\nVAR_OUTPUT\n    Out : BOOL;\nEND_VAR\nVAR\n    Timer : TON;\nEND_VAR\n\nTimer(IN := (In <> Out), PT := Time_ms);\nIF Timer.Q THEN\n    Out := In;\nEND_IF;\nEND_FUNCTION_BLOCK`),
        variables: [
            v('fb-deb-v1', 'In', 'Raw input', 'BOOL', 'Input'),
            v('fb-deb-v2', 'Time_ms', 'Stable time', 'TIME', 'Input'),
            v('fb-deb-v3', 'Out', 'Filtered output', 'BOOL', 'Output'),
        ],
    } as FunctionBlock,
    {
        ...base('FB', 'demo-fb-scale', 'FB_AnalogScale', 'Scales a raw analog value to engineering units and flags wire break.', 'Sensor',
            `FUNCTION_BLOCK FB_AnalogScale\nVAR_INPUT\n    Raw : INT;\n    RawMin : INT := 0;\n    RawMax : INT := 27648;\n    EngMin : REAL := 0.0;\n    EngMax : REAL := 100.0;\nEND_VAR\nVAR_OUTPUT\n    Value : REAL;\n    WireBreak : BOOL;\nEND_VAR\n\nWireBreak := Raw < RawMin - 1000;\nValue := EngMin + (INT_TO_REAL(Raw - RawMin) / INT_TO_REAL(RawMax - RawMin)) * (EngMax - EngMin);\nEND_FUNCTION_BLOCK`),
        variables: [
            v('fb-sc-v1', 'Raw', 'Raw analog value', 'INT', 'Input'),
            v('fb-sc-v2', 'Value', 'Scaled value', 'REAL', 'Output'),
            v('fb-sc-v3', 'WireBreak', 'Signal lost', 'BOOL', 'Output'),
        ],
    } as FunctionBlock,
];

// ─── Control modules ───────────────────────────────────────
const conveyorPart: BomPart = {
    id: 'demo-bom-motor', code: 'MOT-0.37-4P', description: 'Gear motor 0.37 kW', manufacturer: 'Demo Motors', type: 'Hardware', quantity: 1, unit: 'pz',
    alternatives: [{ id: 'demo-bom-motor-alt1', code: 'MOT-0.55-4P', manufacturer: 'Other Motors', description: 'Gear motor 0.55 kW', notes: 'Use on heavy products' }],
};
const sensorPart: BomPart = {
    id: 'demo-bom-sensor', code: 'PHOTO-M18', description: 'Photoelectric sensor M18', manufacturer: 'Demo Sensors', type: 'Hardware', quantity: 1, unit: 'pz',
};
const valvePart: BomPart = {
    id: 'demo-bom-valve', code: 'VALVE-5/2', description: 'Solenoid valve 5/2', manufacturer: 'Demo Pneumatics', type: 'Hardware', quantity: 1, unit: 'pz',
};

export const defaultCMs: ControlModule[] = [
    {
        ...base('CM', 'demo-cm-conveyor', 'CM_ConveyorMotor', 'Runs the conveyor belt with a start/stop request and a feedback timeout.', 'Motion',
            `IF Cmd_Run AND NOT Fault THEN\n    Out_Run := TRUE;\nELSE\n    Out_Run := FALSE;\nEND_IF;\n\n// the drive must confirm within 3 s\nFeedbackTimer(IN := Out_Run AND NOT In_Running, PT := T#3s);\nFault := FeedbackTimer.Q;`),
        variables: [
            v('cm-cv-v1', 'Cmd_Run', 'Run request', 'BOOL', 'Input'),
            v('cm-cv-v2', 'In_Running', 'Drive running feedback', 'BOOL', 'Input'),
            v('cm-cv-v3', 'Out_Run', 'Run command to the drive', 'BOOL', 'Output'),
            v('cm-cv-v4', 'Fault', 'Feedback timeout', 'BOOL', 'Output'),
        ],
        alarms: [al('cm-cv-a1', 'ALM_CV_001', 'Conveyor drive did not start', 'Fault', 'Fault', 'Stop', 'Drive off, tripped protection or broken coupling.', 'Check the drive and the motor protection, then reset.')],
        io: [io('cm-cv-i1', 'DO_CV_RUN', 'DO', 'Local:2:O.0', 'Out_Run', 'Conveyor run command'), io('cm-cv-i2', 'DI_CV_RUN', 'DI', 'Local:1:I.0', 'In_Running', 'Conveyor running feedback')],
        dfmea: [fm('cm-cv-d1', 'Motor stalls under load', 'Line stops, product accumulates', 'Overload or jam', 7, 5, 4, 'Motor protection and feedback timeout', 'Feedback timeout raises ALM_CV_001', 'Implemented', { componentId: 'demo-bom-motor', alarmId: 'cm-cv-a1' })],
        bom: [conveyorPart], assignedFBs: [], checklist: [], devTimes: times,
    } as ControlModule,
    {
        ...base('CM', 'demo-cm-sensor', 'CM_BottleSensor', 'Detects a bottle in front of the sensor, filtered against flicker.', 'Sensor',
            `Filter(In := In_Raw, Time_ms := T#30ms);\nBottlePresent := Filter.Out;`),
        variables: [
            v('cm-bs-v1', 'In_Raw', 'Sensor signal', 'BOOL', 'Input'),
            v('cm-bs-v2', 'BottlePresent', 'Filtered presence', 'BOOL', 'Output'),
        ],
        alarms: [],
        io: [io('cm-bs-i1', 'DI_BOTTLE', 'DI', 'Local:1:I.1', 'In_Raw', 'Bottle presence sensor')],
        dfmea: [fm('cm-bs-d1', 'Sensor dirty, bottles not detected', 'Bad bottles are not rejected', 'Dust on the lens', 8, 6, 7, 'Periodic cleaning', '', 'To Do', { componentId: 'demo-bom-sensor' })],
        bom: [sensorPart], assignedFBs: ['demo-fb-debounce'], checklist: [], devTimes: times,
    } as ControlModule,
    {
        ...base('CM', 'demo-cm-pusher', 'CM_RejectPusher', 'Pushes a rejected bottle off the line with a pneumatic cylinder.', 'Valve',
            `IF Cmd_Reject THEN\n    Out_Valve := TRUE;\nEND_IF;\nIF In_Extended OR PulseTimer.Q THEN\n    Out_Valve := FALSE;\nEND_IF;\nPulseTimer(IN := Out_Valve, PT := T#1s);`),
        variables: [
            v('cm-rp-v1', 'Cmd_Reject', 'Reject request', 'BOOL', 'Input'),
            v('cm-rp-v2', 'In_Extended', 'Cylinder extended', 'BOOL', 'Input'),
            v('cm-rp-v3', 'Out_Valve', 'Valve command', 'BOOL', 'Output'),
        ],
        alarms: [al('cm-rp-a1', 'ALM_RP_001', 'Reject cylinder did not extend', 'Alarm', 'Out_Valve', 'Log', 'No air or valve coil failure.', 'Check the air supply and the valve.')],
        io: [io('cm-rp-i1', 'DO_REJECT', 'DO', 'Local:2:O.1', 'Out_Valve', 'Reject valve')],
        dfmea: [fm('cm-rp-d1', 'Cylinder does not extend', 'Defective bottle reaches packing', 'No air or valve failure', 6, 4, 5, 'Position sensor and timeout', 'Alarm ALM_RP_001', 'Verified', { componentId: 'demo-bom-valve', alarmId: 'cm-rp-a1' })],
        bom: [valvePart], assignedFBs: [], checklist: [], devTimes: times,
    } as ControlModule,
];

// ─── Equipment modules ─────────────────────────────────────
export const defaultEMs: EquipmentModule[] = [
    {
        ...base('EM', 'demo-em-conveyance', 'EM_Conveyance', 'Moves bottles along the line and detects them.', 'Logic', ''),
        variables: [v('em-cv-v1', 'LineRunning', 'Line is running', 'BOOL', 'Output')],
        assignedFBs: [], assignedCMs: ['demo-cm-conveyor', 'demo-cm-sensor'], checklist: [], devTimes: times,
    } as EquipmentModule,
    {
        ...base('EM', 'demo-em-rejection', 'EM_Rejection', 'Rejects bottles that fail the quality check.', 'Logic', ''),
        variables: [v('em-rj-v1', 'RejectCount', 'Rejected bottles', 'DINT', 'Output')],
        assignedFBs: [], assignedCMs: ['demo-cm-pusher'], checklist: [], devTimes: times,
    } as EquipmentModule,
];

// ─── Unit ──────────────────────────────────────────────────
export const defaultUnits: Unit[] = [
    {
        ...base('UN', 'demo-un-line', 'UN_DemoLine', 'Demo line DM-100: one conveyor, a bottle sensor and a reject pusher.', 'Logic', ''),
        variables: [v('un-v1', 'Mode', 'Machine mode', 'INT', 'Local')],
        alarms: [al('un-a1', 'ALM_UN_001', 'Emergency stop', 'Safety', 'EStop', 'EmergencyStop', 'Emergency button pressed.', 'Release the button and reset.')],
        assignedFBs: [], assignedEMs: ['demo-em-conveyance', 'demo-em-rejection'], checklist: [], devTimes: times,
    } as Unit,
];

// ─── Assembly (machine) with SBOM and topology ─────────────
export const defaultAssembly: AssemblyProject = {
    id: 'demo-assembly',
    name: 'Demo Line DM-100',
    description: 'Invented demo machine that shows the features of AMA.',
    version: '1.0.0',
    tree: [{
        id: 'demo-n-un', refId: 'demo-un-line', level: 'UN',
        children: [
            { id: 'demo-n-em1', refId: 'demo-em-conveyance', level: 'EM', children: [
                { id: 'demo-n-cm1', refId: 'demo-cm-conveyor', level: 'CM', children: [] },
                { id: 'demo-n-cm2', refId: 'demo-cm-sensor', level: 'CM', children: [{ id: 'demo-n-fb1', refId: 'demo-fb-debounce', level: 'FB', children: [] }] },
            ] },
            { id: 'demo-n-em2', refId: 'demo-em-rejection', level: 'EM', children: [
                { id: 'demo-n-cm3', refId: 'demo-cm-pusher', level: 'CM', children: [] },
            ] },
        ],
    }],
    sbom: [
        { id: 'demo-hw-plc', type: 'Hardware', hardware: 'Demo PLC controller', firmware: 'v1.0', quantity: 1, notes: 'Main controller', ipAddress: '192.168.10.1', securityZone: 'Zone 1 - Control' },
        { id: 'demo-hw-switch', type: 'Network', hardware: 'Managed switch 8-port', firmware: 'v2.1', quantity: 1, notes: 'Machine network', ipAddress: '192.168.10.254', securityZone: 'Zone 1 - Control' },
        { id: 'demo-hw-drive', type: 'Hardware', hardware: 'Frequency drive 0.37 kW', firmware: 'v3.0', quantity: 1, notes: 'Conveyor drive', ipAddress: '192.168.10.11', securityZone: 'Zone 1 - Control' },
        { id: 'demo-hw-hmi', type: 'Hardware', hardware: 'HMI panel 7"', firmware: 'v1.4', quantity: 1, notes: 'Operator panel', ipAddress: '192.168.10.20', securityZone: 'Zone 2 - Operator' },
    ],
    networkNodes: [
        { id: 'demo-tn-plc', sbomId: 'demo-hw-plc', x: 300, y: 60, label: 'Demo PLC controller', ip: '192.168.10.1', type: 'Hardware', note: 'Main controller' },
        { id: 'demo-tn-switch', sbomId: 'demo-hw-switch', x: 300, y: 200, label: 'Managed switch 8-port', ip: '192.168.10.254', type: 'Network', note: 'Machine network' },
        { id: 'demo-tn-drive', sbomId: 'demo-hw-drive', x: 100, y: 340, label: 'Frequency drive 0.37 kW', ip: '192.168.10.11', type: 'Hardware', note: 'Conveyor drive' },
        { id: 'demo-tn-hmi', sbomId: 'demo-hw-hmi', x: 500, y: 340, label: 'HMI panel 7"', ip: '192.168.10.20', type: 'Hardware', note: 'Operator panel' },
    ],
    networkEdges: [
        { id: 'demo-te-1', source: 'demo-tn-plc', target: 'demo-tn-switch', protocol: 'EtherNet/IP', sourcePort: '44818', targetPort: '44818', subnetMask: '255.255.255.0', gateway: '192.168.10.254', isEncrypted: false, isFirewalled: false },
        { id: 'demo-te-2', source: 'demo-tn-switch', target: 'demo-tn-drive', protocol: 'EtherNet/IP', sourcePort: '44818', targetPort: '44818', subnetMask: '255.255.255.0', gateway: '192.168.10.254', isEncrypted: false, isFirewalled: false },
        { id: 'demo-te-3', source: 'demo-tn-switch', target: 'demo-tn-hmi', protocol: 'HTTPS', sourcePort: '443', targetPort: '443', subnetMask: '255.255.255.0', gateway: '192.168.10.254', isEncrypted: true, isFirewalled: false },
    ],
};
