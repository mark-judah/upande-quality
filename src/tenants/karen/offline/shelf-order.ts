const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** [letter prefix, number, suffix]; a shelf without a number sorts on its name alone. */
function shelfKey(shelf: string): [string, number, string] {
  const m = /^(\D*)(\d+)(.*)$/.exec(shelf);
  return m ? [m[1], Number(m[2]), m[3]] : [shelf, -1, ''];
}

/** Shelves in natural order: letter prefix, then the number as a number, then the
 *  suffix (G2M < G3M < G10M, KPK-A2T < KPK-A12T); no shelf last. */
export function compareShelf(a: string | null | undefined, b: string | null | undefined): number {
  const x = (a || '').trim().toUpperCase();
  const y = (b || '').trim().toUpperCase();
  if (!x || !y) return Number(!x) - Number(!y);
  const kx = shelfKey(x);
  const ky = shelfKey(y);
  return cmp(kx[0], ky[0]) || kx[1] - ky[1] || cmp(kx[2], ky[2]);
}
