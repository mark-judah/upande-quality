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

export const karenTraceabilityApi = {
  async lookup(payload: { bucket_id?: string; bunch_id?: string }): Promise<RawTraceabilityResponse> {
    return api<RawTraceabilityResponse>({
      method: 'POST',
      url: '/api/method/getTraceability',
      data: payload,
    });
  },
};
