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
  setFarms: (farm: string, sends: boolean | null, salesFarms: string[]) => Promise<void>;
  hydrate: () => Promise<void>;
};

/** The one hydrate in flight: a write waits for it, so the saved farms are merged, not overwritten. */
let hydrating: Promise<void> | null = null;

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
  setFarms: async (farm, sends, salesFarms) => {
    if (!get().loaded) await get().hydrate();
    const next = { ...get().sends };
    if (farm && sends != null) next[farm] = sends;
    const farms = salesFarms.length ? salesFarms : get().salesFarms;
    set({ sends: next, salesFarms: farms });
    storage.set(StorageKeys.transferFarms, JSON.stringify({ sends: next, salesFarms: farms })).catch(() => {});
  },
  hydrate: () => {
    hydrating ??= (async () => {
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
    })().finally(() => {
      hydrating = null;
    });
    return hydrating;
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

/** The sales farm an order without one goes to: the only one there is, else the hub. */
export const knownSalesFarm = (): string => {
  const { hub, salesFarms } = useHubStore.getState();
  return salesFarms.length === 1 ? salesFarms[0] : hub || salesFarms[0] || '';
};

/** " → Chepsito": where a trip delivers, shown only once there is more than one sales farm.
 *  `several` is the caller's reactive `useSalesFarms().length > 1`, where it renders. */
export const toSalesFarm = (
  farm: string | null | undefined,
  several: boolean = useHubStore.getState().salesFarms.length > 1,
): string => (farm && several ? ` → ${farm}` : '');
