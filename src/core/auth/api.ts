import axios, { isAxiosError } from 'axios';
import {
  attachStartTime,
  elapsed,
  logError,
  logRequest,
  logResponse,
  type LoggableConfig,
} from '@/src/core/api/log';

export type LoginRawResponse = {
  status: number;
  body: { full_name?: string; message?: string };
  setCookie: string | null;
};

/** Does `base` answer as a Frappe site? A quick GET of /api/method/ping. */
async function answers(base: string): Promise<boolean> {
  const config: LoggableConfig = attachStartTime({ method: 'GET', url: `${base}/api/method/ping` });
  logRequest(config);
  try {
    const res = await axios.get(`${base}/api/method/ping`, { timeout: 8000, validateStatus: () => true });
    logResponse({ ...res, config: { ...res.config, ...config } } as never, elapsed(config));
    // Any HTTP answer means the server is there (a site in maintenance answers 503).
    return res.status > 0;
  } catch (err) {
    if (isAxiosError(err)) logError(err, elapsed(config));
    return false;
  }
}

/**
 * The site's base URL for whatever was typed: nobody has to know or type http
 * or https. https is tried first, then http; the first that answers is used,
 * and https when neither does (the sign-in then reports the network error).
 * A scheme typed anyway is ignored -- both are still tried.
 */
export async function probeBaseUrl(rawUrl: string): Promise<string> {
  const host = rawUrl.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const https = `https://${host}`;
  const http = `http://${host}`;
  if (await answers(https)) return https;
  if (await answers(http)) return http;
  return https;
}

export async function loginRequest(
  fullUrl: string,
  email: string,
  password: string,
): Promise<LoginRawResponse> {
  const form = new URLSearchParams();
  form.append('usr', email);
  form.append('pwd', password);

  // Password is intentionally NOT logged — we log usr only.
  const config: LoggableConfig = attachStartTime({
    method: 'POST',
    url: `${fullUrl}/api/method/login`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: { usr: email, pwd: '<redacted>' },
  });
  logRequest(config);

  try {
    const res = await axios.post(`${fullUrl}/api/method/login`, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
      validateStatus: () => true,
    });
    logResponse({ ...res, config: { ...res.config, ...config } } as never, elapsed(config));
    const setCookie =
      (res.headers['set-cookie'] as string[] | string | undefined) ?? null;
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    return { status: res.status, body: res.data ?? {}, setCookie: cookieHeader };
  } catch (err) {
    if (isAxiosError(err)) logError(err, elapsed(config));
    else console.log('[API] ✗ login error:', err);
    const e = err as { message?: string };
    return { status: 0, body: { message: e.message ?? 'Network error' }, setCookie: null };
  }
}
