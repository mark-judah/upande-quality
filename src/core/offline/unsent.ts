/**
 * How many scans this phone holds for the current server and has not sent
 * yet. Core cannot read the tenants' offline stores, so the app layer
 * registers the counter (app/(tabs)/_layout.tsx); none registered = nothing queued.
 */
let counter: (() => Promise<number>) | null = null;

export function setUnsentCounter(fn: () => Promise<number>): void {
  counter = fn;
}

export async function countUnsent(): Promise<number> {
  if (!counter) return 0;
  try {
    return await counter();
  } catch {
    return 0;
  }
}
