import { storage, secureStorage, StorageKeys } from '@/src/core/storage';
import { loginRequest, probeBaseUrl } from './api';
import { fetchCurrentUserRoles } from './roles-api';

export type LoginOutcome =
  | { ok: true; fullName: string; instanceUrl: string; roles: string[] }
  | { ok: false; error: string };

function extractSidCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  // Frappe sends multiple cookies in one Set-Cookie line concatenated.
  // We forward the entire header string back to the server on subsequent calls.
  if (setCookie.includes('sid=')) return setCookie;
  return null;
}

export const authRepository = {
  async login(email: string, password: string, bareUrl: string): Promise<LoginOutcome> {
    const cleanUrl = bareUrl.trim().toLowerCase();
    if (!cleanUrl) return { ok: false, error: 'URL required' };

    const fullUrl = await probeBaseUrl(cleanUrl);
    const res = await loginRequest(fullUrl, email, password);

    if (res.status === 200) {
      const cookie = extractSidCookie(res.setCookie);
      if (!cookie) return { ok: false, error: 'Login succeeded but no session cookie was returned' };
      const fullName = res.body.full_name ?? email;
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

      // Fetch roles in the background. Failure is non-fatal — login still succeeds.
      let roles: string[] = [];
      try {
        roles = await fetchCurrentUserRoles();
        await storage.set(StorageKeys.userRoles, JSON.stringify(roles));
      } catch {
        // ignore — UI will treat missing roles as "no special permissions"
      }
      return { ok: true, fullName, instanceUrl: fullUrl, roles };
    }

    if (res.status === 401) {
      return { ok: false, error: 'Username or Password is incorrect' };
    }

    const message = res.body?.message ?? 'Login failed, Try again later';
    return { ok: false, error: message };
  },

  async logout(): Promise<void> {
    await storage.clearExcept([StorageKeys.emailBackup, StorageKeys.instanceUrlBackup]);
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
