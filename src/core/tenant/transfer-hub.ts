import { useEffect } from 'react';
import { create } from 'zustand';
import { storage, StorageKeys } from '@/src/core/storage';

/**
 * The remote-transfer hub (the sales farm, e.g. Kapkolia), as last reported by the
 * server and remembered on the phone. Screens for the remote farms (Bucket Requests)
 * are hidden from a station at the hub, on Home and in the menu alike.
 */
type HubState = { hub: string | null; loaded: boolean; setHub: (hub: string) => void; hydrate: () => Promise<void> };

const useHubStore = create<HubState>((set, get) => ({
  hub: null,
  loaded: false,
  setHub: (hub) => {
    if (!hub || hub === get().hub) return;
    set({ hub });
    storage.set(StorageKeys.transferHub, hub).catch(() => {});
  },
  hydrate: async () => {
    const hub = await storage.get(StorageKeys.transferHub).catch(() => null);
    set({ hub: get().hub ?? hub, loaded: true });
  },
}));

export function useTransferHub(): string | null {
  const hub = useHubStore((s) => s.hub);
  const loaded = useHubStore((s) => s.loaded);
  const hydrate = useHubStore((s) => s.hydrate);
  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);
  return hub;
}

export const setTransferHub = (hub: string) => useHubStore.getState().setHub(hub);
