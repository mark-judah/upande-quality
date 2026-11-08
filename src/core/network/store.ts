import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import { storage, StorageKeys } from '@/src/core/storage';

/**
 * Network-status store. OS connectivity + API-failure escalation. After
 * `FAILURE_THRESHOLD` consecutive failures, flips to offline regardless of
 * what the OS reports — practical signal is whether OUR server is reachable.
 */

const FAILURE_THRESHOLD = 2;
const ONLINE_POLL_MS = 15_000;
const OFFLINE_POLL_MS = 6_000;
const PROBE_TIMEOUT_MS = 6_000;

interface NetworkState {
  online: boolean;
  checking: boolean;
  consecutiveFailures: number;
  ready: boolean;

  init: () => void;
  forceCheck: () => Promise<void>;
  notifyApiSuccess: () => void;
  notifyApiFailure: () => void;
  setOnline: (online: boolean) => void;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

/** Does our server answer? Any HTTP reply counts: the request got there. */
async function serverReachable(): Promise<boolean> {
  const base = await storage.get(StorageKeys.instanceUrl).catch(() => null);
  if (!base) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${base.replace(/\/+$/, '')}/api/method/ping`, { method: 'GET', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Android only reports internet as reachable once Google's connectivity check passes
 * (NET_CAPABILITY_VALIDATED), which fails on networks that block it although our
 * server is reachable. So no network at all is offline; anything less certain asks
 * the server.
 */
export async function checkConnectivity(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false && state.type === Network.NetworkStateType.NONE) return false;
    if (state.isConnected && state.isInternetReachable !== false) return true;
  } catch {
    /* unknown: ask the server */
  }
  return serverReachable();
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  online: true,
  checking: false,
  consecutiveFailures: 0,
  ready: false,

  init: () => {
    if (get().ready) return;
    set({ ready: true });
    const scheduleNext = () => {
      if (pollTimer) clearTimeout(pollTimer);
      const delay = get().online ? ONLINE_POLL_MS : OFFLINE_POLL_MS;
      pollTimer = setTimeout(() => {
        get().forceCheck().finally(scheduleNext);
      }, delay);
    };
    appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') get().forceCheck();
    });
    get().forceCheck().finally(scheduleNext);
  },

  forceCheck: async () => {
    if (get().checking) return;
    set({ checking: true });
    try {
      const online = await checkConnectivity();
      if (online && get().consecutiveFailures === 0) {
        if (!get().online) set({ online: true });
      } else if (online && (await serverReachable())) {
        // Requests failed earlier but the server answers now.
        set({ online: true, consecutiveFailures: 0 });
      } else if (!online) {
        if (get().online) set({ online: false });
      }
    } finally {
      set({ checking: false });
    }
  },

  notifyApiSuccess: () => {
    if (get().consecutiveFailures > 0) set({ consecutiveFailures: 0 });
    if (!get().online) set({ online: true });
  },

  notifyApiFailure: () => {
    const next = get().consecutiveFailures + 1;
    set({ consecutiveFailures: next });
    if (next >= FAILURE_THRESHOLD && get().online) {
      set({ online: false });
      get().forceCheck();
    }
  },

  setOnline: (online) => set({ online }),
}));
