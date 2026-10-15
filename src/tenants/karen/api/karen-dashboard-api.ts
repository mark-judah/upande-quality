import { api } from '@/src/core/api/client';

/** Quality home: the desk Intake FTR Overview figures for one day. Backed by
 *  upande_quality.mobile.api.getQualityDashboardData. */

export type RawDashboardFarm = {
  farm?: string;
  stems_received?: number;
  quarantined?: number;
  ftr?: number | null;
};

export type RawDashboardIssue = { issue?: string; stems?: number };

export type RawDashboardVariety = { variety?: string; stems?: number };

export type RawDashboardData = {
  date?: string;
  /** The farm the figures cover; '' = every farm. */
  farm?: string;
  /** Farms this user may pick. */
  farms?: string[];
  all_farms?: boolean;
  kpi?: {
    total_reports?: number;
    total_stems_received?: number;
    total_stems_checked?: number;
    total_quarantined?: number;
    overall_ftr?: number | null;
    overall_sampled?: number | null;
    not_received_buckets?: number;
    not_received_stems?: number;
    pending_reshelving?: number;
    open_replacements?: number;
  };
  ftr_by_farm?: RawDashboardFarm[];
  quarantined_by_issue?: RawDashboardIssue[];
  quarantined_by_variety?: RawDashboardVariety[];
  error?: string;
};

export type RawDashboardResponse = {
  message?: RawDashboardData;
};

export const karenDashboardApi = {
  /** The server decides the farm scope: `farm` is the user's pick, `stationFarm`
   *  the default for a user limited to some farms. */
  async fetch(params: {
    date: string;
    farm?: string;
    stationFarm?: string;
    company?: string;
  }): Promise<RawDashboardResponse> {
    return api<RawDashboardResponse>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.getQualityDashboardData',
      params: {
        date: params.date,
        ...(params.farm !== undefined ? { farm: params.farm } : {}),
        ...(params.stationFarm ? { station_farm: params.stationFarm } : {}),
        ...(params.company ? { company: params.company } : {}),
      },
    });
  },
};
