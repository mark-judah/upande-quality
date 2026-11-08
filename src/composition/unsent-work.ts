import { countUnsentScans } from '@/src/tenants/karen/offline/bucket-requests-db';
import { countAllPending as countBucketCounts } from '@/src/tenants/karen/offline/karen-bucket-count-db';
import { countAllPending as countStockTake } from '@/src/tenants/karen/offline/karen-stock-take-db';

/** Scans queued on this phone for the current server and not sent to it yet:
 *  trolley scans, bucket counts and stock-take scans. A store that cannot be
 *  read counts as none. */
export async function countUnsentWork(): Promise<number> {
  const counts = await Promise.all(
    [countUnsentScans, countBucketCounts, countStockTake].map((f) => f().catch(() => 0)),
  );
  return counts.reduce((a, b) => a + b, 0);
}
