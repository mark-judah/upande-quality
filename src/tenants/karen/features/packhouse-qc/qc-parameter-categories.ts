/**
 * Groups the QC Parameters into the four inspection categories the packhouse
 * uses, so the parameter / rejection-reason picker can show short, labelled
 * sections instead of one long alphabetical scroll.
 *
 * The QC Parameters doctype has no category field, so the mapping lives here.
 * Keyed by the exact parameter name (the QC Parameters doc name). Any parameter
 * not listed here falls under "Other" automatically, so adding a new parameter
 * in the ERP never breaks the picker — it just lands in Other until it's slotted
 * into a category below.
 */

export type QcParameterCategory = {
  title: string;
  /** Exact QC Parameter names that belong to this category. */
  params: string[];
};

/** Display order matches the packhouse's own numbering. */
export const QC_PARAMETER_CATEGORIES: QcParameterCategory[] = [
  {
    title: 'Physiological Damage / Disorders',
    params: [
      'Advanced Cut Stage',
      'Tight Cut Stage',
      'Mixed Cut Stage',
      'Drooping',
      'Limp Necks',
      'Hooks',
      'Bull Heads',
      'Pelican Heads',
      'Short Stem',
      'Weak Stems',
      'Fine Stems',
      'Crooked Stems',
      'Chlorosis',
      'Scorching',
      'Sunburns',
      'Leaf Blackening',
      'Petal Blackening',
      'Less Buds',
      'Live Suckers',
      'Late De-suckering',
    ],
  },
  {
    title: 'Pests',
    params: [
      'Helicoverpa Egg',
      'Helicoverpa Damage',
      'Helicoverpa Larvae',
      'FCM Egg',
      'FCM Damages',
      'FCM Larvae',
      'Spodoptera Egg',
      'Spodoptera Damage',
      'Spodoptera Larvae',
      'Aphids',
      'Live Aphids',
      'Mites',
      'Mite Damage',
      'Thrips',
      'Thrips Damage',
      'Mealy Bugs',
      'White Flies',
      'Leaf Miner',
      'Slugs',
      'Poor Defoliation',
      'Poor Sizing',
    ],
  },
  {
    title: 'Diseases',
    params: [
      'Botrytis',
      'Fresh Powdery Mildew',
      'Dry Powdery Mildew',
      'Fresh Downy Mildew',
      'Dry Downy Mildew',
      'Black Spot',
      'Rust',
      'Rotting',
    ],
  },
  {
    title: 'Physical Problems',
    params: [
      'Bruises',
      'Wrong Length',
      'Severe Chemical Residue',
      'Broken Stem',
      'Petal plucking',
      'Mixed Variety',
      'Wrong Variety',
      'Wrong Bucket Rates',
      'Missing Traceability',
    ],
  },
];

/** Fallback bucket for any parameter not explicitly categorised above. */
export const QC_PARAMETER_OTHER_CATEGORY = 'Other';

const CATEGORY_BY_PARAM: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const cat of QC_PARAMETER_CATEGORIES) {
    for (const p of cat.params) map[p] = cat.title;
  }
  return map;
})();

/** The category title a parameter belongs to, or "Other" if uncategorised. */
export function categoryForParam(paramName: string): string {
  return CATEGORY_BY_PARAM[paramName] ?? QC_PARAMETER_OTHER_CATEGORY;
}

/** Order index used to sort options into category order (Other last). */
export function categoryOrder(title: string): number {
  const idx = QC_PARAMETER_CATEGORIES.findIndex((c) => c.title === title);
  return idx === -1 ? QC_PARAMETER_CATEGORIES.length : idx;
}
