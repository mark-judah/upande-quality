import { api } from '@/src/core/api/client';

/** Direct Frappe REST resource access for the Bucket Return doctype — no
 *  backend app method needed (dispatch = create, receipt = read + update). */

export type RawRef = { name?: string; license_plate?: string };

export type RawReturnChild = {
  name?: string;
  bucket_id?: string;
  scanned_time?: string;
  received?: number;
  received_time?: string;
  received_by?: string;
};

export type RawBucketReturn = {
  name?: string;
  target_farm?: string;
  vehicle?: string;
  status?: string;
  dispatch_datetime?: string;
  dispatched_by?: string;
  total_dispatched?: number;
  total_received?: number;
  received_scan?: string;
  received_time?: string;
  received_by?: string;
  remarks?: string;
  buckets?: RawReturnChild[];
};

/** One row of the child-flattened get_list used to find a bucket's open batch. */
export type RawFlatRow = { name?: string; bucket_id?: string };

type ListResp<T> = { data?: T[]; exc_type?: string; _server_messages?: string; message?: string };
type DocResp = { data?: RawBucketReturn; exc_type?: string; _server_messages?: string; message?: string };

const BR = '/api/resource/Bucket%20Return';

export const karenBucketReturnApi = {
  listFarms(): Promise<ListResp<RawRef>> {
    return api<ListResp<RawRef>>({
      method: 'GET',
      url: '/api/resource/Farm',
      params: { fields: JSON.stringify(['name']), limit_page_length: 0, order_by: 'name asc' },
      validateStatus: () => true,
    });
  },

  listVehicles(): Promise<ListResp<RawRef>> {
    return api<ListResp<RawRef>>({
      method: 'GET',
      url: '/api/resource/Vehicle',
      params: { fields: JSON.stringify(['name', 'license_plate']), limit_page_length: 0, order_by: 'name asc' },
      validateStatus: () => true,
    });
  },

  create(doc: RawBucketReturn): Promise<DocResp> {
    return api<DocResp>({ method: 'POST', url: BR, data: doc, validateStatus: () => true });
  },

  /** Open (not Fully Received) batches for a farm, flattened to one row per
   *  child bucket so we can find the batch a scanned bucket belongs to. */
  openBatchesForFarm(farm: string): Promise<ListResp<RawFlatRow>> {
    return api<ListResp<RawFlatRow>>({
      method: 'GET',
      url: BR,
      params: {
        fields: JSON.stringify(['name', '`tabBucket Return Item`.bucket_id']),
        filters: JSON.stringify([['status', '!=', 'Fully Received'], ['target_farm', '=', farm]]),
        limit_page_length: 0,
      },
      validateStatus: () => true,
    });
  },

  getDoc(name: string): Promise<DocResp> {
    return api<DocResp>({ method: 'GET', url: `${BR}/${encodeURIComponent(name)}`, validateStatus: () => true });
  },

  update(name: string, doc: Partial<RawBucketReturn>): Promise<DocResp> {
    return api<DocResp>({ method: 'PUT', url: `${BR}/${encodeURIComponent(name)}`, data: doc, validateStatus: () => true });
  },
};
