import { api } from '@/src/core/api/client';

export type RawJourneyStage = {
  stage?: string;
  doc?: string;
  date?: string;
  datetime?: string;
  variety?: string;
  stem_length?: string;
  qty?: number | null;
  who?: string;
  who_kind?: string;
  user?: string;
  detail?: string;
  harvest_time?: string;
  cut_stage?: string;
  receiving_time?: string;
  shelving_time?: string;
};

export type RawBunchInfo = {
  bunch_id?: string;
  variety?: string;
  stem_length?: string;
  bunch_size?: string;
  farm?: string;
};

export type RawSessionBunch = {
  bunch_id?: string;
  variety?: string;
  stem_length?: string;
  bunch_size?: string;
  grading_se?: string;
  grading_stem_length?: string;
  graded_by?: string;
  issued_opl?: string;
};

export type RawAllocation = {
  exists?: boolean;
  variety?: string;
  stem_length?: string;
  shelf_location?: string;
  shelf_farm?: string;
  total_quantity?: number;
  allocated_quantity?: number;
  available_quantity?: number;
  is_allocated?: boolean;
  fully_allocated?: boolean;
  harvest_date?: string;
};

export type RawTraceabilitySnapshot = {
  kind?: string;
  rose_type?: string;
  bucket_id?: string;
  bunch_id?: string;
  status?: string;
  variety?: string;
  farm?: string;
  greenhouse?: string;
  stem_length?: string;
  number_of_stems?: number | null;
  date?: string | null;
  batch_no?: string;
  session_size?: number;
  bunch_info?: RawBunchInfo | null;
  bunches?: RawSessionBunch[];
  stages?: RawJourneyStage[];
  warnings?: string[];
  allocation?: RawAllocation | null;
  error?: string;
};

export type RawTraceabilityResponse = {
  data?: RawTraceabilitySnapshot;
  message?: RawTraceabilitySnapshot;
};

// ── Box traceability ──────────────────────────────────────────────────────────

export type RawBoxBucketTrace = {
  bucket?: string;
  variety?: string;
  stem_length?: string;
  harvest?: {
    greenhouse?: string; farm?: string; harvester?: string; cut_stage?: string;
    date?: string; time?: string;
  } | null;
  receiving?: { warehouse?: string; date?: string; time?: string } | null;
  grading?: { graded_by?: string; stem_length?: string; bunch_id?: string; date?: string } | null;
  shelving?: { shelf?: string; greenhouse?: string; date?: string; shelved_by?: string } | null;
  picked?: { for_box?: string | number | null; date?: string; picked_by?: string } | null;
};

export type RawBoxTraceability = {
  success?: boolean;
  error?: string;
  box?: {
    box_label?: string; box_number?: number | string; box_total_count?: number | string;
    order_pick_list?: string; order_name?: string; customer?: string; length?: string;
    pack_rate?: number | string; farm?: string; packed_on?: string; packed_by?: string;
    exact_buckets?: number;
  };
  buckets?: RawBoxBucketTrace[];
  dispatch?: {
    sales_order?: string; order_name?: string; customer?: string; consignee?: string;
    delivery_point?: string; freight_agent?: string; truck?: string;
    delivery_note?: string; delivered?: number; date?: string;
  };
};

export type RawBoxTraceabilityResponse = {
  data?: RawBoxTraceability;
  message?: RawBoxTraceability;
};

export const karenTraceabilityApi = {
  async lookup(payload: { bucket_id?: string; bunch_id?: string }): Promise<RawTraceabilityResponse> {
    return api<RawTraceabilityResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.getTraceability',
      // url: '/api/method/getTraceability',
      data: payload,
    });
  },

  // Box traceability is served by the live "Get Box Traceability" Server Script
  // (short api_method path), so it works without an api.py deploy. Port to the
  // module path once getBoxTraceability ships in api.py.
  async lookupBox(box_label: string): Promise<RawBoxTraceabilityResponse> {
    return api<RawBoxTraceabilityResponse>({
      method: 'GET',
      url: '/api/method/getBoxTraceability',
      params: { box_label },
    });
  },
};
