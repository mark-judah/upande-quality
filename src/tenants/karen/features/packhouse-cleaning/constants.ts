// Fixed lists for the Packhouse Cleaning checklists, transcribed from the paper
// templates. Areas and per-component condition options are stable, so they live
// in code (mirroring the Coldroom feature's fixed constants).

export type ComponentSpec = { label: string; options: string[] };

// Inspection Log areas and items come from the server (Post Harvest Team, Packhouse Inspection Item).

// ── Cleaning Checklist ───────────────────────────────────────────────────────
// Must match the Packhouse Cleaning Record `area` Select on the server (no Team Bravo there).
export const CLEANING_AREAS = ['Team A', 'Team B', 'Team C', 'Team Eldama'];
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
