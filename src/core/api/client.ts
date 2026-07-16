import axios, { isAxiosError, type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { storage, StorageKeys } from '@/src/core/storage';
import { useNetworkStore } from '@/src/core/network/store';
import { attachStartTime, elapsed, logError, logRequest, logResponse } from './log';

let client: AxiosInstance | null = null;

/** In-flight silent reauth, shared so a burst of simultaneously-expired requests
 *  triggers exactly ONE re-login; each awaits the same result then retries. */
let reauthInFlight: Promise<boolean> | null = null;

function reauthOnce(): Promise<boolean> {
  if (!reauthInFlight) {
    reauthInFlight = (async () => {
      try {
        // Dynamic import breaks the client → repository → roles-api → client
        // require cycle (repository/roles-api both import this module).
        const { authRepository } = await import('@/src/core/auth/repository');
        return await authRepository.reauthenticate();
      } catch {
        return false;
      }
    })();
    // Let a later expiry reauth again once this attempt settles.
    reauthInFlight.finally(() => {
      reauthInFlight = null;
    });
  }
  return reauthInFlight;
}

/** A response that means "your session is gone", as opposed to a genuine
 *  permission denial. Frappe returns 403 (request downgraded to Guest) with a
 *  `session_expired` flag on an expired sid — NOT 401 — so we must key on that
 *  flag, or we'd both miss real expiries and loop on legitimate 403s. */
function isSessionExpired(err: AxiosError): boolean {
  const res = err.response;
  if (!res) return false;
  if (res.status === 401) return true;
  if (res.status === 403) {
    const body = res.data as { session_expired?: unknown; exc_type?: string } | null;
    return !!(body && (body.session_expired || body.exc_type === 'AuthenticationError'));
  }
  return false;
}

type RetryableConfig = AxiosRequestConfig & { _reauthRetry?: boolean };

function buildClient(): AxiosInstance {
  const instance = axios.create({ timeout: 30000 });
  instance.interceptors.request.use(async (config) => {
    const baseUrl = await storage.get(StorageKeys.instanceUrl);
    const cookie = await storage.get(StorageKeys.cookie);
    if (baseUrl) config.baseURL = baseUrl;
    config.headers = config.headers ?? {};
    if (cookie) (config.headers as Record<string, string>).Cookie = cookie;
    if (!config.headers['Content-Type']) {
      (config.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
    attachStartTime(config);
    logRequest(config);
    return config;
  });
  instance.interceptors.response.use(
    (response) => {
      logResponse(response, elapsed(response.config));
      try { useNetworkStore.getState().notifyApiSuccess(); } catch {}
      return response;
    },
    async (error) => {
      if (isAxiosError(error)) {
        logError(error, elapsed(error.config));
        // A request with no response is EITHER a genuine connectivity loss OR a
        // slow server that blew past our timeout. Only a real connectivity loss
        // should flip the offline banner — a timeout against a reachable server
        // must NOT (that produced the false "no internet" on heavy submits).
        if (isConnectivityError(error)) {
          try { useNetworkStore.getState().notifyApiFailure(); } catch {}
        }
        // Expired session → silently reauth with the stored password and retry
        // the request ONCE. _reauthRetry guards against a reauth-then-401 loop.
        const cfg = error.config as RetryableConfig | undefined;
        if (cfg && !cfg._reauthRetry && isSessionExpired(error)) {
          const ok = await reauthOnce();
          if (ok) {
            cfg._reauthRetry = true;
            // Re-issue through the same instance so the request interceptor
            // re-reads the freshly-stored cookie.
            return instance.request(cfg);
          }
          // Stored credentials are missing or no longer valid — hard logout so
          // the root layout routes the user back to the login screen.
          try {
            const { useAuthStore } = await import('@/src/core/auth/store');
            await useAuthStore.getState().forgetDevice();
          } catch {}
        }
      } else {
        console.log('[API] ✗ non-axios error:', error);
      }
      return Promise.reject(error);
    },
  );
  return instance;
}

export function apiClient(): AxiosInstance {
  if (!client) client = buildClient();
  return client;
}

export async function api<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  const res = await apiClient().request<T>(config);
  return res.data;
}

export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** The request exceeded our client timeout. The server is reachable but slow —
 *  this is NOT an offline condition, and the request may still be processing
 *  server-side. */
function isTimeout(err: AxiosError): boolean {
  if (err.response) return false;
  if (err.code === 'ECONNABORTED') return true;
  return typeof err.message === 'string' && /timeout|timed out|exceeded/i.test(err.message);
}

/** A genuine connectivity failure — the request never reached the server
 *  because the network is unreachable. Deliberately excludes timeouts. */
function isConnectivityError(err: AxiosError): boolean {
  if (err.response || isTimeout(err)) return false;
  if (err.code === 'ERR_NETWORK') return true;
  return typeof err.message === 'string' && /network\s*error|failed to fetch/i.test(err.message);
}

export function mapAxiosError(err: unknown): HttpError {
  if (isAxiosError(err)) {
    if (isTimeout(err)) {
      // Don't cry "offline" — the server just took too long. The write may have
      // gone through, so steer the user to verify rather than blindly resubmit.
      return new HttpError(
        0,
        'The server is taking longer than usual to respond. Your submission may still be processing — please check before submitting again.',
        null,
      );
    }
    if (isConnectivityError(err)) {
      // If the OS still reports connectivity, don't claim the user is offline —
      // the request just couldn't reach this server.
      let online = false;
      try { online = useNetworkStore.getState().online; } catch {}
      return new HttpError(
        0,
        online
          ? "Couldn't reach the server. Please try again in a moment."
          : "You're offline. Check your network connection and try again.",
        null,
      );
    }
    const status = err.response?.status ?? 0;
    const body = err.response?.data;
    let message = err.message;
    if (body && typeof body === 'object') {
      const exc = body as { exc_type?: string; _server_messages?: string; message?: string };
      if (exc.message) message = exc.message;
      else if (exc.exc_type) message = exc.exc_type;
    }
    return new HttpError(status, message, body);
  }
  return new HttpError(0, err instanceof Error ? err.message : 'Unknown error', null);
}
