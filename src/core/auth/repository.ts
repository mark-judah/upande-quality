import { storage, secureStorage, StorageKeys } from '@/src/core/storage';
import { api } from '@/src/core/api/client';
import { loginRequest, probeBaseUrl } from './api';
import { fetchCurrentUser, needsRealName } from './roles-api';
import { knownInstances } from './known-instances';
import { clearServerData, isOtherServer } from './server-change';

/** The stock /api/method/login response's `full_name` is computed as
 *  `first_name + last_name` server-side (frappe/auth.py), which reads as an
 *  empty string for any User whose name was set via the `full_name` field
 *  directly. Read the real field straight off the User doctype instead, the
 *  same fix the packhouse app carries. */
async function fetchRealFullName(email: string): Promise<string | null> {
  try {
    const body = await api<{ message?: { full_name?: string }; data?: { full_name?: string } }>({
      method: 'GET',
      url: `/api/method/frappe.client.get_value?doctype=User&filters={"name":"${email}"}&fieldname=["full_name"]`,
    });
    const m = body?.message ?? body?.data;
    return (m && m.full_name) || null;
  } catch {
    return null;
  }
}

export type LoginOutcome =
  /** `switched`: the app was on another server before this login. */
  | { ok: true; fullName: string; email: string; instanceUrl: string; roles: string[]; switched: boolean }
  | { ok: false; error: string };

function extractSidCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  // Frappe sends multiple cookies in one Set-Cookie line concatenated.
  // We forward the entire header string back to the server on subsequent calls.
  if (setCookie.includes('sid=')) return setCookie;
  return null;
}

export const authRepository = {
  /** `login` is the email or the username: Frappe signs in with either (the
   *  username when System Settings allows it). The account's email is stored. */
  async login(login: string, password: string, bareUrl: string): Promise<LoginOutcome> {
    const email = login.trim();
    const cleanUrl = bareUrl.trim().toLowerCase();
    if (!cleanUrl) return { ok: false, error: 'URL required' };

    const fullUrl = await probeBaseUrl(cleanUrl);
    const res = await loginRequest(fullUrl, email, password);

    if (res.status === 200) {
      const cookie = extractSidCookie(res.setCookie);
      if (!cookie) return { ok: false, error: 'Login succeeded but no session cookie was returned' };
      // `||`, not `??`: the login response's full_name is often an empty string.
      const fullName = res.body.full_name || email;
      // Another server's leftovers (station, roles, …) go before this one's are written.
      const switched = await isOtherServer(fullUrl);
      if (switched) await clearServerData();
      await Promise.all([
        storage.set(StorageKeys.cookie, cookie),
        storage.set(StorageKeys.instanceUrl, fullUrl),
        storage.set(StorageKeys.instanceUrlBackup, fullUrl),
        storage.set(StorageKeys.emailBackup, email),
        storage.set(StorageKeys.fullName, fullName),
        // Password goes to the Keychain/Keystore, and any pre-migration
        // plaintext copy in AsyncStorage is cleared so it can't linger.
        secureStorage.set(StorageKeys.passwordBackup, password),
        storage.remove(StorageKeys.passwordBackup),
      ]);

      // Signed in to another server: the app restarts before anything else
      // talks to it, and the restarted start finishes the sign-in (hydrate).
      if (switched) {
        await knownInstances.remember(fullUrl, email, needsRealName(fullName) ? null : fullName).catch(() => {});
        return { ok: true, fullName, email, instanceUrl: fullUrl, roles: [], switched };
      }
      const done = await authRepository.completeLogin(email, fullName, fullUrl);
      return { ok: true, ...done, instanceUrl: fullUrl, switched };
    }

    if (res.status === 401) {
      return { ok: false, error: 'Username or Password is incorrect' };
    }

    const message = res.body?.message ?? 'Login failed, Try again later';
    return { ok: false, error: message };
  },

  /** The authenticated follow-ups of a sign-in, once its cookie is stored: the
   *  real name, the roles and the account's email. Never rejects. */
  async completeLogin(
    login: string,
    responseName: string,
    fullUrl: string,
  ): Promise<{ email: string; fullName: string; roles: string[] }> {
    let email = login;
    let fullName = responseName || email;
    // Now that the cookie is stored, an authenticated follow-up can read the
    // real name. Non-fatal: keeps the response's value (or email) on failure.
    const real = await fetchRealFullName(email);
    if (real && real !== fullName) {
      fullName = real;
      await storage.set(StorageKeys.fullName, fullName);
    }
    // Roles, and the full name for users who cannot read their own User
    // record (most of them). Failure is non-fatal — login still succeeds.
    let roles: string[] = [];
    try {
      const me = await fetchCurrentUser();
      roles = me.roles;
      // Signed in with a username: keep the account's email from here on.
      if (me.user && me.user !== email && me.user !== 'Guest') {
        email = me.user;
        await storage.set(StorageKeys.emailBackup, email);
        if (needsRealName(fullName)) fullName = email;
      }
      await storage.set(StorageKeys.userRoles, JSON.stringify(roles));
      if (me.fullName && needsRealName(fullName)) {
        fullName = me.fullName;
        await storage.set(StorageKeys.fullName, fullName);
      }
    } catch {
      // ignore — UI will treat missing roles as "no special permissions"
    }

    // After the real name is known, so the login screen can greet by name.
    await knownInstances
      .remember(fullUrl, email, fullName && !needsRealName(fullName) ? fullName : null)
      .catch(() => {});
    return { email, fullName, roles };
  },

  async logout(): Promise<void> {
    await storage.clearExcept([
      StorageKeys.emailBackup,
      StorageKeys.instanceUrlBackup,
      StorageKeys.knownInstances,
      // Which on-device database is whose: another server's queued scans stay its own.
      StorageKeys.instanceDbOwners,
    ]);
    // clearExcept only touches AsyncStorage — the password lives in secure store.
    await secureStorage.remove(StorageKeys.passwordBackup);
  },

  /** Read the stored login password from secure store, migrating a legacy
   *  plaintext AsyncStorage copy (pre-secure-store builds) on first read. */
  async getPassword(): Promise<string | null> {
    const secure = await secureStorage.get(StorageKeys.passwordBackup);
    if (secure != null) return secure;
    const legacy = await storage.get(StorageKeys.passwordBackup);
    if (legacy != null) {
      await secureStorage.set(StorageKeys.passwordBackup, legacy);
      await storage.remove(StorageKeys.passwordBackup);
      return legacy;
    }
    return null;
  },

  /** Silently mint a fresh session cookie from the stored credentials. Called by
   *  the API client when a request fails with an expired session. Uses the bare
   *  `loginRequest` (not the shared client) so it can't recurse through the
   *  reauth interceptor. Returns false when creds are missing or login fails. */
  async reauthenticate(): Promise<boolean> {
    const { email, password, url } = await this.loadFullCredentials();
    if (!email || !password || !url) return false;
    const res = await loginRequest(url, email, password);
    if (res.status !== 200) return false;
    const cookie = extractSidCookie(res.setCookie);
    if (!cookie) return false;
    await storage.set(StorageKeys.cookie, cookie);
    return true;
  },

  async loadBackupCredentials(): Promise<{ email: string | null; url: string | null }> {
    const [email, url] = await Promise.all([
      storage.get(StorageKeys.emailBackup),
      storage.get(StorageKeys.instanceUrlBackup),
    ]);
    return { email, url };
  },

  /** Read every credential needed to silently re-authenticate after a biometric
   *  prompt: email + password + URL. Returns nulls if any piece is missing. */
  async loadFullCredentials(): Promise<{
    email: string | null;
    password: string | null;
    url: string | null;
  }> {
    const [email, password, url] = await Promise.all([
      storage.get(StorageKeys.emailBackup),
      this.getPassword(),
      storage.get(StorageKeys.instanceUrlBackup),
    ]);
    return { email, password, url };
  },

  async loadRoles(): Promise<string[]> {
    const raw = await storage.get(StorageKeys.userRoles);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async hasSession(): Promise<boolean> {
    const cookie = await storage.get(StorageKeys.cookie);
    return !!cookie;
  },
};
