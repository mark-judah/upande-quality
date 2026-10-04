import { api } from '@/src/core/api/client';

export type RawCandidate = {
  bucket_id?: string;
  shelf?: string;
  shelf_item?: string;
  variety?: string;
  stem_length?: string;
  greenhouse?: string;
  warehouse?: string;
  date_added?: string;
  age_days?: number | null;
  stem_qty?: number | null;
  allocated_qty?: number;
  available_qty?: number;
};

export type RawCandidatesResponse = {
  data?: {
    criteria?: { variety?: string; stem_length?: string; farm?: string };
    candidates?: RawCandidate[];
    destinations?: RawCandidate[];
    count?: number;
    error?: string;
  };
  message?: { error?: string };
};

export type RawReplaceBucketResponse = {
  data?: {
    status?: string;
    message?: string;
    old_bucket?: string;
    new_bucket?: string;
    opl?: string;
    sale_order_item?: string;
    error?: string;
    needs_pick_list_item?: boolean;
    candidate_pick_list_items?: string[];
  };
  message?: { status?: string; message?: string; error?: string };
};

export type RawGradingOptionsResponse = {
  data?: {
    supported?: boolean;
    item_group?: string;
    message?: string;
    pick_list_item?: string;
    destination_bucket?: string;
    conversion_factor?: number;
    criteria?: { variety?: string; stem_length?: string; farm?: string };
    candidates?: RawCandidate[];
    count?: number;
    error?: string;
  };
  message?: { error?: string };
};

export type RawBucketOpl = {
  pick_list_item?: string;
  opl_name?: string;
  order_name?: string;
  customer?: string;
  team?: string;
  date_created?: string;
  total_stems?: number;
  opl_status?: string;
  sales_order?: string;
  sale_order_item?: string;
  item_code?: string;
  stem_length?: string;
  stems_from_this_bucket?: number;
  bunches_from_this_bucket?: number;
  issued?: boolean;
};

export type RawBucketOplsResponse = {
  data?: { bucket_id?: string; opls?: RawBucketOpl[]; count?: number; error?: string };
  message?: { error?: string };
};

export type RawReplaceStemsResponse = {
  data?: {
    status?: string;
    message?: string;
    log_name?: string;
    donor_bucket?: string;
    donor_shelf?: string;
    stems?: number;
    donor_remaining_stems?: number;
    destination_bucket?: string;
    opl?: string;
    error?: string;
  };
  message?: { error?: string };
};

export type RawCorrectDetailsResponse = {
  data?: {
    status?: string;
    message?: string;
    kind?: string;
    id?: string;
    updates?: string[];
    new_variety?: string | null;
    new_stem_length?: string | null;
    error?: string;
  };
  message?: { error?: string };
};

export type RawMoveBunchResponse = {
  data?: {
    status?: string;
    message?: string;
    bunch_id?: string;
    source_bucket?: string;
    dest_bucket?: string;
    dest_shelf?: string;
    stems_moved?: number;
    corrected_variety?: string;
    corrected_stem_length?: string;
    updates?: string[];
    error?: string;
  };
  message?: { status?: string; message?: string; error?: string };
};

export type RawPendingBunch = {
  grading_se?: string;
  bunch_id?: string;
  source_bucket?: string;
  pending_since?: string;
  variety?: string;
  stem_length?: string;
  bunch_size?: string;
  farm?: string;
  flagged_by?: string;
};

export type RawPendingResponse = {
  data?: { pending?: RawPendingBunch[]; count?: number; error?: string };
  message?: { error?: string };
};

type RawListResponse<T> = { data?: T[] };


/** Varieties + stem lengths for the Edit Details / Replacement pickers, in one
 *  call (shared by both lists; fetched again after a failure). */
let optionsCall: Promise<{ varieties: string[]; stemLengths: string[] }> | null = null;
function pickerOptions(): Promise<{ varieties: string[]; stemLengths: string[] }> {
  if (!optionsCall) {
    optionsCall = api<{ data?: { varieties?: string[]; stem_lengths?: string[] } }>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.getVarietyAndStemLengthOptions',
    })
      .then((res) => ({ varieties: res.data?.varieties ?? [], stemLengths: res.data?.stem_lengths ?? [] }))
      .catch((e) => {
        optionsCall = null;
        throw e;
      });
  }
  return optionsCall;
}

export const karenReplacementApi = {
  async listReplacementCandidates(payload: { bucket_id: string }): Promise<RawCandidatesResponse> {
    return api<RawCandidatesResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.listReplacementCandidates',
      data: payload,
      validateStatus: () => true,
    });
  },

  async replaceBucket(payload: {
    bucket_id: string;
    new_bucket_id?: string;
    pick_list_item?: string;
  }): Promise<RawReplaceBucketResponse> {
    return api<RawReplaceBucketResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.replaceBucket',
      data: payload,
      validateStatus: () => true,
    });
  },

  async listBucketOpls(payload: { bucket_id: string }): Promise<RawBucketOplsResponse> {
    return api<RawBucketOplsResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.listBucketOpls',
      data: payload,
      validateStatus: () => true,
    });
  },

  async replaceStems(payload: {
    pick_list_item: string;
    donor_bucket_id: string;
    stems: number;
    reason?: string;
  }): Promise<RawReplaceStemsResponse> {
    return api<RawReplaceStemsResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.replaceStems',
      data: payload,
      validateStatus: () => true,
    });
  },

  async replaceBunchInOpl(payload: {
    pick_list_item: string;
    donor_bucket_id: string;
    stems?: number;
    reason?: string;
  }): Promise<RawReplaceStemsResponse> {
    return api<RawReplaceStemsResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.replaceBunchInOpl',
      data: payload,
      validateStatus: () => true,
    });
  },

  async correctDetails(payload: {
    kind: 'bunch' | 'bucket';
    id: string;
    bucket_id?: string;
    variety?: string;
    stem_length?: string;
  }): Promise<RawCorrectDetailsResponse> {
    return api<RawCorrectDetailsResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.correctDetails',
      data: payload,
      validateStatus: () => true,
    });
  },

  /** Grading QC replacement: resolve the OPL line's PLI + discard-aware donor
   *  candidates for the given order + variety. */
  async gradingReplacementOptions(payload: {
    order_pick_list: string;
    variety: string;
    stem_length?: string;
    /** The scanned bunch's bucket — pins the destination PLI to that bucket. */
    bucket_id?: string;
  }): Promise<RawGradingOptionsResponse> {
    return api<RawGradingOptionsResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.gradingReplacementOptions',
      data: payload,
      validateStatus: () => true,
    });
  },

  async listBunchDestinations(payload: {
    variety: string;
    stem_length: string;
    farm: string;
    exclude_bucket?: string;
  }): Promise<RawCandidatesResponse> {
    return api<RawCandidatesResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.listBunchDestinations',
      data: payload,
      validateStatus: () => true,
    });
  },

  async moveBunch(payload: {
    bunch_id: string;
    source_bucket_id: string;
    variety?: string;
    stem_length?: string;
    dest_bucket_id?: string;
  }): Promise<RawMoveBunchResponse> {
    return api<RawMoveBunchResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.moveBunch',
      data: payload,
      validateStatus: () => true,
    });
  },

  async listPendingReshelving(): Promise<RawPendingResponse> {
    return api<RawPendingResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.listPendingReshelving',
      validateStatus: () => true,
    });
  },

  /** Every rose variety, sub-groups included — from the server, so users without
   *  read rights on Item still get the full list. */
  async listVarieties(): Promise<string[]> {
    return (await pickerOptions()).varieties;
  },

  /** Map of item_code → item_group for the given varieties, so the UI can gate
   *  features by rose type (e.g. replacement is Spray-Roses-only for now). */
  async getItemGroups(itemCodes: string[]): Promise<Record<string, string>> {
    if (!itemCodes.length) return {};
    const res = await api<RawListResponse<{ item_code?: string; item_group?: string }>>({
      method: 'GET',
      url: '/api/resource/Item',
      params: {
        filters: JSON.stringify([['item_code', 'in', itemCodes]]),
        fields: JSON.stringify(['item_code', 'item_group']),
        limit_page_length: 500,
      },
    });
    const map: Record<string, string> = {};
    for (const r of res.data ?? []) {
      if (r.item_code) map[r.item_code] = r.item_group ?? '';
    }
    return map;
  },

  async listStemLengths(): Promise<string[]> {
    return (await pickerOptions()).stemLengths;
  },
};
