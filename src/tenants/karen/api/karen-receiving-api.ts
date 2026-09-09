import { api } from '@/src/core/api/client';

export type ReceivingStatus =
  | 'received'
  | 'already_received'
  | 'not_harvested'
  | 'not_exist'
  | 'no_harvest_on_date'
  | 'error';

export type RawReceivingResponse = {
  http_status_code?: number;
  status?: ReceivingStatus | string;
  message?: string;
  error?: string;
  stock_entry_name?: string;
  farm?: string;
  greenhouse?: string;
  stem_length?: string;
  number_of_stems?: string;
  /** Item code from the harvesting entry (e.g. "Bombastic"). Populated on
   *  any status branch where the bucket has a known last entry. */
  variety?: string;
  /** ISO date (YYYY-MM-DD) of the harvest entry's posting_date. */
  harvest_date?: string;
  /** Number of bunches — only meaningful for spray roses (stems / 10). */
  bunches?: string;
};


export const karenReceivingApi = {
  async createReceiving(
    bucketId: string,
    batchId: string | null,
  ): Promise<RawReceivingResponse> {
    return api<RawReceivingResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.createReceivingStockEntry',
      data: {
        bucket_id: bucketId,
        custom_receiving_batch_id: batchId,
      },
      // Accept any status so we can read the typed body for 4xx/5xx outcomes —
      // the server packs the user-facing message into the body itself.
      validateStatus: () => true,
    });
  },
};
