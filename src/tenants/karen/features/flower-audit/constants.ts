import type { Ionicons } from '@expo/vector-icons';

/** Child-table fieldnames on "Flower Audit Sample Item". */
export type SampleField = 'buds' | 'width' | 'height' | 'val_42' | 'val_52' | 'val_62' | 'val_72';

export type AuditType = 'Bud Count' | 'Head Size' | 'Stem Weight' | 'Spray Diameter';

export type AuditColumn = {
  field: SampleField;
  /** Short header shown above the sample grid. */
  header: string;
  unit: string;
};

export type AuditDef = {
  type: AuditType;
  /** Route param + tile key. */
  slug: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  columns: AuditColumn[];
  /** Bud Count and Head Size are taken in the greenhouse, so they record one.
   *  Stem Weight and Spray Diameter are graded post-harvest — no greenhouse. */
  needsGreenhouse: boolean;
};

/** Mirrors toggle_grid_columns() in flower_quality_audit.js — each audit type
 *  only measures its own columns, so the app shows exactly those. */
export const AUDITS: AuditDef[] = [
  {
    type: 'Bud Count',
    slug: 'bud-count',
    needsGreenhouse: true,
    hint: 'Buds per stem across the sample',
    icon: 'flower-outline',
    columns: [{ field: 'buds', header: 'Buds', unit: '' }],
  },
  {
    type: 'Head Size',
    slug: 'head-size',
    needsGreenhouse: true,
    hint: 'Bud head width & height',
    icon: 'resize-outline',
    columns: [
      { field: 'width', header: 'Width', unit: 'cm' },
      { field: 'height', header: 'Height', unit: 'cm' },
    ],
  },
  {
    type: 'Stem Weight',
    slug: 'stem-weight',
    needsGreenhouse: false,
    hint: 'Weight per stem at 42, 52 & 62 cm',
    icon: 'barbell-outline',
    columns: [
      { field: 'val_42', header: '42 cm', unit: 'g' },
      { field: 'val_52', header: '52 cm', unit: 'g' },
      { field: 'val_62', header: '62 cm', unit: 'g' },
    ],
  },
  {
    type: 'Spray Diameter',
    slug: 'spray-diameter',
    needsGreenhouse: false,
    hint: 'Spray head diameter at 52, 62 & 72 cm',
    icon: 'radio-button-on-outline',
    columns: [
      { field: 'val_52', header: '52 cm', unit: 'cm' },
      { field: 'val_62', header: '62 cm', unit: 'cm' },
      { field: 'val_72', header: '72 cm', unit: 'cm' },
    ],
  },
];

export function auditBySlug(slug: string | undefined): AuditDef | undefined {
  return AUDITS.find((a) => a.slug === slug);
}

/** Rows the form starts with — enough for a normal round without tapping Add. */
export const INITIAL_SAMPLE_ROWS = 10;
