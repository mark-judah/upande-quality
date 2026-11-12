import { useEffect } from 'react';
import { create } from 'zustand';
import { storage, StorageKeys } from '@/src/core/storage';

/**
 * The remote-transfer sales farms as last reported by the server and remembered on the
 * phone: the first one (`hub`, e.g. Kapkolia), every one of them (`salesFarms`: an order's
 * buckets go to its own sales farm), and which station farms send buckets at all
 * (`sends`). A sales farm that packs only its own orders (Karen) never sends, so Bucket
 * Requests is hidden there, on Home and in the menu alike; a sales farm whose buckets go
 * to another sales farm's orders (Kapkolia, Chepsito) keeps it.
 */
type HubState = {
  hub: string | null;
  salesFarms: string[];
  sends: Record<string, boolean>;
  loaded: boolean;
  setHub: (hub: string) => void;
  setFarms: (farm: string, sends: boolean | null, salesFarms: string[]) => void;
  hydrate: () => Promise<void>;
};

const useHubStore = create<HubState>((set, get) => ({
  hub: null,
  salesFarms: [],
  sends: {},
  loaded: false,
  setHub: (hub) => {
    if (!hub || hub === get().hub) return;
    set({ hub });
    storage.set(StorageKeys.transferHub, hub).catch(() => {});
  },
  setFarms: (farm, sends, salesFarms) => {
    const next = { ...get().sends };
    if (farm && sends != null) next[farm] = sends;
    const farms = salesFarms.length ? salesFarms : get().salesFarms;
    set({ sends: next, salesFarms: farms });
    storage.set(StorageKeys.transferFarms, JSON.stringify({ sends: next, salesFarms: farms })).catch(() => {});
  },
  hydrate: async () => {
    const hub = await storage.get(StorageKeys.transferHub).catch(() => null);
    const raw = await storage.get(StorageKeys.transferFarms).catch(() => null);
    let saved: { sends?: Record<string, boolean>; salesFarms?: string[] } = {};
    try {
      saved = raw ? JSON.parse(raw) : {};
    } catch {
      saved = {};
    }
    set({
      hub: get().hub ?? hub,
      sends: { ...(saved.sends ?? {}), ...get().sends },
      salesFarms: get().salesFarms.length ? get().salesFarms : saved.salesFarms ?? [],
      loaded: true,
    });
  },
}));

function useHydrated() {
  const loaded = useHubStore((s) => s.loaded);
  const hydrate = useHubStore((s) => s.hydrate);
  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);
}

export function useTransferHub(): string | null {
  useHydrated();
  return useHubStore((s) => s.hub);
}

/** The sales farms remote buckets go to (an order's own, see the server). */
export function useSalesFarms(): string[] {
  useHydrated();
  return useHubStore((s) => s.salesFarms);
}

/** false when `farm` never sends buckets (a sales farm packing only its own orders); null = not known yet. */
export function useFarmSendsBuckets(farm: string | null | undefined): boolean | null {
  useHydrated();
  return useHubStore((s) => (farm && farm in s.sends ? s.sends[farm] : null));
}

export const setTransferHub = (hub: string) => useHubStore.getState().setHub(hub);
export const setTransferFarms = (farm: string, sends: boolean | null, salesFarms: string[]) =>
  useHubStore.getState().setFarms(farm, sends, salesFarms);

/** " → Chepsito": where a trip delivers, shown only once there is more than one sales farm. */
export const toSalesFarm = (farm: string | null | undefined): string =>
  farm && useHubStore.getState().salesFarms.length > 1 ? ` → ${farm}` : '';
