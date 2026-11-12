import { setTransferFarms, setTransferHub } from '@/src/core/tenant/transfer-hub';
import { karenBucketRequestsRepository } from '../repository/karen-bucket-requests-repository';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Whether `farm` sends buckets (and the sales farms), read again from the server: a farm
 *  that once sent nothing gets Bucket Requests back on Home and the menu once it does. */
export async function refreshTransferFarms(farm: string): Promise<void> {
  if (!farm) return;
  try {
    // one day's shelved list: the lightest read that carries the flag
    const res = await karenBucketRequestsRepository.fetchShelvedBuckets(farm, today());
    if (res.kind !== 'ok') return;
    if (res.hub) setTransferHub(res.hub);
    await setTransferFarms(farm, res.sendsBuckets, res.salesFarms);
  } catch {
    // offline or the server is away: the remembered flag stands
  }
}
