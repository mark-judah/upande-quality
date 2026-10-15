import { create } from 'zustand';
import { format } from 'date-fns';
import { karenDashboardApi } from '../api/karen-dashboard-api';
import { mapAxiosError } from '@/src/core/api/client';
import { useAuthStore } from '@/src/core/auth/store';
import { storage } from '@/src/core/storage';
import { getTenantByUrl } from '@/src/core/tenant/instance-mapper';
import { readUserStation } from '@/src/core/tenant/user-station';
import { tenantCompany } from '@/src/core/features/station/repository';

export type DashboardFarm = {
  farm: string;
  stemsReceived: number;
  quarantined: number;
  /** null when the farm received nothing. */
  ftr: number | null;
};

export type DashboardBar = { label: string; stems: number };

export type DashboardKpi = {
  totalReports: number;
  stemsReceived: number;
  stemsChecked: number;
  quarantined: number;
  /** FTR % = (received - quarantined) / received; null when nothing was received. */
  ftr: number | null;
  /** Sampled % = checked / received; null when nothing was received. */
  sampled: number | null;
  notReceivedBuckets: number;
  notReceivedStems: number;
  pendingReshelving: number;
  openReplacements: number;
};

export type DashboardData = {
  date: string;
  /** The farm the figures cover; '' = every farm. */
  farm: string;
  /** Farms this user may pick. */
  allowedFarms: string[];
  allFarms: boolean;
  kpi: DashboardKpi;
  farms: DashboardFarm[];
  issues: DashboardBar[];
  varieties: DashboardBar[];
};

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
}

function pctOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' ? null : n(v);
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

interface DashboardState {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  /** Day being viewed (YYYY-MM-DD). */
  selectedDate: string;
  /** Farm picked this session ('' = all farms); null = not picked yet, so the
   *  user's saved pick (or the server's default) applies. */
  selectedFarm: string | null;
  load: () => Promise<void>;
  setDate: (date: string) => Promise<void>;
  setFarm: (farm: string) => Promise<void>;
  /** A new session: back to today, the previous user's numbers dropped. */
  reset: () => void;
}

const farmKey = (email: string | null) => `quality_home_farm:${email ?? ''}`;

// Latest request wins: a reply for an earlier date/refresh is dropped.
let requestSeq = 0;

export const useKarenDashboardStore = create<DashboardState>((set, get) => ({
  data: null,
  loading: false,
  error: null,
  selectedDate: todayISO(),
  selectedFarm: null,

  load: async () => {
    const seq = ++requestSeq;
    set({ loading: true, error: null });
    try {
      const date = get().selectedDate;
      const { email, instanceUrl } = useAuthStore.getState();
      let farm = get().selectedFarm;
      let saved = false;
      if (farm === null) {
        farm = await storage.get(farmKey(email)).catch(() => null);
        saved = farm !== null;
      }
      const station = await readUserStation().catch(() => null);
      const raw = await karenDashboardApi.fetch({
        date,
        farm: farm ?? undefined,
        stationFarm: station?.userFarm,
        company: tenantCompany(getTenantByUrl(instanceUrl)),
      });
      const m = raw?.message;
      // A malformed/auth-failure response must not render as an all-zero day.
      if (!m || typeof m !== 'object') {
        throw new Error('Unexpected response from server.');
      }
      if (m.error) throw new Error(m.error);
      if (!m.kpi || typeof m.kpi !== 'object') {
        throw new Error('Server response is missing dashboard data.');
      }
      const k = m.kpi;
      const allowedFarms = (m.farms ?? []).map(String);
      const allFarms = Boolean(m.all_farms);
      // A saved pick the server no longer allows is dropped.
      if (saved && farm !== null && !(farm === '' ? allFarms : allowedFarms.includes(farm))) {
        storage.remove(farmKey(email)).catch(() => {});
      }
      const data: DashboardData = {
        date: String(m.date ?? date),
        farm: String(m.farm ?? ''),
        allowedFarms,
        allFarms,
        kpi: {
          totalReports: n(k.total_reports),
          stemsReceived: n(k.total_stems_received),
          stemsChecked: n(k.total_stems_checked),
          quarantined: n(k.total_quarantined),
          ftr: pctOrNull(k.overall_ftr),
          sampled: pctOrNull(k.overall_sampled),
          notReceivedBuckets: n(k.not_received_buckets),
          notReceivedStems: n(k.not_received_stems),
          pendingReshelving: n(k.pending_reshelving),
          openReplacements: n(k.open_replacements),
        },
        farms: (m.ftr_by_farm ?? []).map((f) => ({
          farm: String(f.farm ?? ''),
          stemsReceived: n(f.stems_received),
          quarantined: n(f.quarantined),
          ftr: pctOrNull(f.ftr),
        })),
        issues: (m.quarantined_by_issue ?? []).map((r) => ({
          label: String(r.issue ?? ''),
          stems: n(r.stems),
        })),
        varieties: (m.quarantined_by_variety ?? []).map((r) => ({
          label: String(r.variety ?? ''),
          stems: n(r.stems),
        })),
      };
      if (seq !== requestSeq) return;
      set({ data, loading: false, selectedFarm: data.farm });
    } catch (err) {
      if (seq !== requestSeq) return;
      set({ error: mapAxiosError(err).message, loading: false });
    }
  },

  reset: () => {
    requestSeq++;
    set({ data: null, loading: false, error: null, selectedDate: todayISO(), selectedFarm: null });
  },

  setDate: async (date) => {
    set({ selectedDate: date, data: null });
    await get().load();
  },

  setFarm: async (farm) => {
    set({ selectedFarm: farm, data: null });
    storage.set(farmKey(useAuthStore.getState().email), farm).catch(() => {});
    await get().load();
  },
}));
