// Fixed lists for the Packhouse Cleaning checklists, transcribed from the paper
// templates. Areas and per-component condition options are stable, so they live
// in code (mirroring the Coldroom feature's fixed constants).

export type ComponentSpec = { label: string; options: string[] };

// ── Inspection Log ───────────────────────────────────────────────────────────
export const INSPECTION_AREAS = [
  'Team A',
  'Team B',
  'Team C',
  'Team Eldama',
  'Print Room',
  'Consumable Store',
  'Vase Room',
];

// Each component's options are the distinct conditions seen in that column of
// the template — so the operator only sees choices that make sense for it.
export const INSPECTION_COMPONENTS: ComponentSpec[] = [
  { label: 'Bunching Tables', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Needs painting', 'Needs repair', 'In good condition'] },
  { label: 'Sleeving Tables', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Needs painting', 'Broken', 'In good condition'] },
  { label: 'QC Table', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Dim light', 'Blown light', 'Needs painting'] },
  { label: 'Guillotine', options: ['Clean', 'Dirty', 'Blurred', 'Detached', 'In good condition'] },
  { label: 'Floor', options: ['Clean', 'Dirty', 'Broken tiles', 'Faded marks', 'Slippery'] },
  { label: 'Walls', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Needs painting'] },
  { label: 'Windows / Windowpanes', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs'] },
  { label: 'Trolleys', options: ['Clean', 'Dirty', 'Broken', 'Unmovable', 'Rusty', 'In good condition'] },
  { label: 'Drainage', options: ['Clean', 'Dirty', 'Blocked'] },
  { label: 'Sockets', options: ['In good condition', 'Broken', 'Naked wire'] },
  { label: 'Lights', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Blown', 'Dim light'] },
  { label: 'Printers', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Unfunctioning', 'In good condition'] },
  { label: 'Roof', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Needs painting'] },
  { label: 'Roof Traces', options: ['Clean', 'Dusty', 'Dirty', 'Cobwebs', 'Rusty', 'Broken'] },
  { label: 'Vaseroom Airconditioner', options: ['Functioning', 'Unusual sound', 'Clean', 'Dusty', 'Dirty', 'Cobwebs'] },
  { label: 'Vase Containers', options: ['Clean', 'Dirty', 'Broken', 'In good condition', 'Leaking'] },
  { label: 'Vase Secateurs / Scissors', options: ['Clean', 'Dirty', 'Blurred', 'Detached', 'In good condition'] },
  { label: 'Vase Shelves', options: ['Clean', 'Dusty', 'Dirty', 'Broken', 'Needs painting', 'In good condition'] },
  { label: 'Vase Buckets', options: ['Clean', 'Dirty', 'Broken', 'In good condition', 'Leaking'] },
];

// ── Cleaning Checklist ───────────────────────────────────────────────────────
export const CLEANING_AREAS = INSPECTION_AREAS;
export const CLEANING_MODES = ['Washing', 'Sweeping'];
export const DETERGENTS = ['MPD', 'Omo', 'Aerial'];
export const DISINFECTANTS = ['Sporekill', 'Sodium Hypochlorite', 'Physan', 'TOG 6'];
export const DISINFECTION_EQUIPMENT = ['Powered Knapsack', 'Fogging Machine'];
export const RATE_UNITS = ['ml/L', 'g/L'];

// ── Glass-like Materials Inspection ──────────────────────────────────────────
export const GLASS_AREAS = [
  'Grading Hall A',
  'Grading Hall B',
  'Grading Hall C',
  'Grading Hall Eldama',
  'Post Harvest Office',
  'HR Office',
  'Quality B Area',
  'Print Room',
  'Vase Room',
  'Incoming Cold Room',
  'Sea Freight Cold Room',
  'Consumable Store',
  'Dispatch 1',
  'Dispatch 2',
  'Dispatch 3',
  'Force Air Room',
];

const GLASS_CONDITIONS = ['In good condition', 'Broken', 'Cracked'];

export const GLASS_COMPONENTS: ComponentSpec[] = [
  'Window Glass',
  'Fluorescent Tube',
  'Digital Thermometer',
  'High Bay Lamps',
  'Flood Lamps',
  'Door Glass',
  'Fire Extinguisher Glass',
  'CBA Frame',
  'Phone Gadget',
  'Computer Screen',
  'Photo Frames',
  'Wall Clock',
  'Weighing Scale',
  'Vase Container',
  'Wall Temp',
  'Fire Exits',
  'Printer Dashboard',
  'Temperature Wall Check Box',
].map((label) => ({ label, options: GLASS_CONDITIONS }));
